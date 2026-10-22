import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  ExecutorOptions,
  ExecutorResult,
  InfrastructureExecutor,
} from './infrastructure-executor';
import type { RemediationActionType } from '../entities/remediation-action.entity';

const DEFAULT_PLAYBOOK =
  'devops/ansible/playbooks/self-healing-remediation.yml';
const DEFAULT_INVENTORY = 'devops/ansible/hosts.yaml';

/** Characters accepted inside an Ansible target. */
const SAFE_TARGET = /^[a-zA-Z0-9_.:\/-]+$/;

/**
 * AnsibleInfrastructureExecutor
 *
 * Runs the platform remediation playbook for host level issues (service
 * restarts, disk cleanup) and for Kubernetes workloads managed by Ansible.
 * The playbook lives in `devops/ansible/playbooks/self-healing-remediation.yml`.
 */
@Injectable()
export class AnsibleInfrastructureExecutor implements InfrastructureExecutor {
  readonly name = 'ansible';

  private readonly logger = new Logger(AnsibleInfrastructureExecutor.name);
  private readonly playbookPath: string;
  private readonly inventoryPath: string;

  constructor(private readonly configService: ConfigService) {
    this.playbookPath = this.configService.get<string>(
      'SELF_HEALING_ANSIBLE_PLAYBOOK',
      DEFAULT_PLAYBOOK,
    );
    this.inventoryPath = this.configService.get<string>(
      'SELF_HEALING_ANSIBLE_INVENTORY',
      DEFAULT_INVENTORY,
    );
  }

  supports(actionType: RemediationActionType): boolean {
    return (
      actionType === 'restart_service' ||
      actionType === 'cleanup_disk' ||
      actionType === 'restart_pod' ||
      actionType === 'scale_up' ||
      actionType === 'scale_down'
    );
  }

  async restartPod(
    target: string,
    options: ExecutorOptions,
  ): Promise<ExecutorResult> {
    return this.runPlaybook('restart_pod', target, options, {
      namespace: options.namespace,
    });
  }

  async scaleDeployment(
    target: string,
    replicas: number,
    options: ExecutorOptions,
  ): Promise<ExecutorResult> {
    return this.runPlaybook(
      replicas > 0 ? 'scale_up' : 'scale_down',
      target,
      options,
      { replicas },
    );
  }

  async restartService(
    target: string,
    options: ExecutorOptions,
  ): Promise<ExecutorResult> {
    return this.runPlaybook('restart_service', target, options, {});
  }

  async cleanupDisk(
    target: string,
    options: ExecutorOptions,
  ): Promise<ExecutorResult> {
    return this.runPlaybook('cleanup_disk', target, options, {});
  }

  /**
   * The Ansible executor does not resolve replica counts; the Kubernetes
   * executor is used for that.
   */
  async getCurrentReplicas(): Promise<number | null> {
    return null;
  }

  /**
   * Execute the remediation playbook for a single action.
   */
  private async runPlaybook(
    action: string,
    target: string,
    options: ExecutorOptions,
    extraVars: Record<string, unknown>,
  ): Promise<ExecutorResult> {
    if (!SAFE_TARGET.test(target)) {
      return {
        success: false,
        message: `Refusing to run "${action}": the target contains unsupported characters.`,
      };
    }

    if (!fs.existsSync(this.playbookPath)) {
      return {
        success: false,
        message: `Remediation playbook not found at ${this.playbookPath}.`,
      };
    }

    if (options.dryRun) {
      return {
        success: true,
        message: `Dry run: playbook would have run "${action}" against ${target}.`,
      };
    }

    const vars = {
      self_healing_action: action,
      self_healing_target: target,
      self_healing_namespace: options.namespace,
      ...extraVars,
    };

    const args = [
      this.playbookPath,
      '-i',
      this.inventoryPath,
      '--extra-vars',
      JSON.stringify(vars),
    ];

    try {
      const result = await this.spawnPlaybook(args, options.timeoutMs);

      if (result.code === 0) {
        this.logger.warn(
          `Ansible remediation "${action}" succeeded for target ${target}.`,
        );
        return {
          success: true,
          message: `Ansible remediation "${action}" completed for ${target}.`,
          details: { exitCode: result.code },
        };
      }

      return {
        success: false,
        message: `Ansible remediation "${action}" failed for ${target}: ${result.stderr.trim() || result.stdout.trim()}`,
        details: { exitCode: result.code },
      };
    } catch (error) {
      this.logger.error(
        `Ansible remediation "${action}" errored: ${(error as Error).message}`,
      );
      return {
        success: false,
        message: `Ansible remediation "${action}" errored: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Spawn the playbook and collect its output.
   */
  private spawnPlaybook(
    args: string[],
    timeoutMs: number,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('ansible-playbook', args, {
        cwd: path.resolve(process.cwd()),
        shell: false,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ANSIBLE_HOST_KEY_CHECKING: 'False',
        },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`ansible-playbook timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  }
}
