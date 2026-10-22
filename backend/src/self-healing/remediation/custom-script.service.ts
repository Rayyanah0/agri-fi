import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { RemediationScript } from '../entities/remediation-script.entity';
import type { SelfHealingIssueType } from '../entities/self-healing-issue.entity';

const DEFAULT_SCRIPTS_DIR = 'devops/scripts/self-healing';

/** Interpreters that may be used to run a remediation script. */
const ALLOWED_INTERPRETERS = ['bash', 'sh', 'python3'];

/** Arguments must not contain characters that could break out of a command. */
const SAFE_ARGUMENT = /^[a-zA-Z0-9_.:@%=,\/+-]+$/;

/** Maximum number of characters captured from stdout/stderr. */
const MAX_OUTPUT_LENGTH = 8000;

/** Result of a script execution. */
export interface ScriptExecutionResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  message: string;
}

/**
 * CustomScriptService
 *
 * Runs platform specific remediation scripts. Scripts have to be registered
 * in the database and stored inside an allow-listed directory; nothing is
 * ever executed from an arbitrary path. Arguments are passed as separate
 * process arguments (never through a shell) and the execution is bounded by
 * a timeout.
 */
@Injectable()
export class CustomScriptService {
  private readonly logger = new Logger(CustomScriptService.name);

  constructor(
    @InjectRepository(RemediationScript)
    private readonly scriptRepo: Repository<RemediationScript>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Absolute path of the directory that may contain remediation scripts.
   */
  getScriptsDirectory(): string {
    const configured = this.configService.get<string>(
      'SELF_HEALING_SCRIPTS_DIR',
      DEFAULT_SCRIPTS_DIR,
    );
    return path.resolve(process.cwd(), configured);
  }

  /**
   * List every registered script.
   */
  async listScripts(): Promise<RemediationScript[]> {
    return this.scriptRepo.find({ order: { name: 'ASC' } });
  }

  /**
   * Register a new remediation script.
   */
  async registerScript(
    entry: Partial<RemediationScript>,
  ): Promise<RemediationScript | null> {
    try {
      const script = this.scriptRepo.create({
        ...entry,
        allowedEnvironmentsJson: entry.allowedEnvironmentsJson ?? ['staging'],
        defaultArgsJson: entry.defaultArgsJson ?? [],
        version: entry.version ?? 1,
      });
      return await this.scriptRepo.save(script);
    } catch (error) {
      this.logger.error(
        `Failed to register remediation script: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Update an existing remediation script.
   */
  async updateScript(
    id: string,
    changes: Partial<RemediationScript>,
  ): Promise<RemediationScript | null> {
    const script = await this.scriptRepo.findOne({ where: { id } });
    if (!script) {
      return null;
    }
    Object.assign(script, changes, { version: script.version + 1 });
    return this.scriptRepo.save(script);
  }

  /**
   * Find the enabled script registered for an issue type.
   */
  async findForIssueType(
    issueType: SelfHealingIssueType,
  ): Promise<RemediationScript | null> {
    const scripts = await this.scriptRepo.find({
      where: { issueType, enabled: true },
      order: { name: 'ASC' },
    });

    return scripts[0] ?? null;
  }

  /**
   * Resolve the absolute path of a script and make sure it stays inside the
   * allow-listed directory.
   */
  resolveScriptPath(script: RemediationScript): string | null {
    const scriptsDir = this.getScriptsDirectory();
    const candidate = path.resolve(scriptsDir, script.scriptPath);

    const relative = path.relative(scriptsDir, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      this.logger.error(
        `Refusing to run "${script.name}": the script path escapes the scripts directory.`,
      );
      return null;
    }

    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      this.logger.error(
        `Refusing to run "${script.name}": ${candidate} is not an existing file.`,
      );
      return null;
    }

    return candidate;
  }

  /**
   * Execute a registered remediation script.
   */
  async run(
    script: RemediationScript,
    args: string[] = [],
  ): Promise<ScriptExecutionResult> {
    const startedAt = Date.now();

    if (!script.enabled) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        message: `Remediation script "${script.name}" is disabled.`,
      };
    }

    if (!ALLOWED_INTERPRETERS.includes(script.interpreter)) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        message: `Interpreter "${script.interpreter}" is not allowed for remediation scripts.`,
      };
    }

    const scriptPath = this.resolveScriptPath(script);
    if (!scriptPath) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        message: `Remediation script "${script.name}" could not be resolved safely.`,
      };
    }

    const mergedArgs = [...(script.defaultArgsJson ?? []), ...args];
    for (const argument of mergedArgs) {
      if (!SAFE_ARGUMENT.test(argument)) {
        return {
          success: false,
          exitCode: null,
          stdout: '',
          stderr: '',
          durationMs: 0,
          message: `Remediation script "${script.name}" was not executed: the argument "${argument}" contains unsupported characters.`,
        };
      }
    }

    const timeoutSeconds = Math.min(
      Math.max(script.timeoutSeconds || 300, 1),
      1800,
    );

    try {
      const result = await this.spawnScript(
        script.interpreter,
        scriptPath,
        mergedArgs,
        timeoutSeconds * 1000,
      );

      const durationMs = Date.now() - startedAt;
      await this.scriptRepo.update(script.id, {
        lastRunAt: new Date(),
        lastResult: result.code === 0 ? 'success' : 'failed',
      });

      if (result.code === 0) {
        this.logger.warn(
          `Remediation script "${script.name}" completed successfully in ${durationMs}ms.`,
        );
        return {
          success: true,
          exitCode: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs,
          message: `Remediation script "${script.name}" completed successfully.`,
        };
      }

      return {
        success: false,
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs,
        message: `Remediation script "${script.name}" failed with exit code ${result.code}.`,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      await this.scriptRepo.update(script.id, {
        lastRunAt: new Date(),
        lastResult: 'failed',
      });

      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: (error as Error).message,
        durationMs,
        message: `Remediation script "${script.name}" failed: ${
          (error as Error).message
        }`,
      };
    }
  }

  /**
   * Spawn the script process and collect its output.
   */
  private spawnScript(
    interpreter: string,
    scriptPath: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(interpreter, [scriptPath, ...args], {
        shell: false,
        cwd: path.dirname(scriptPath),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          SELF_HEALING_SCRIPT: path.basename(scriptPath),
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
        reject(new Error(`script timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = (stdout + chunk.toString()).slice(-MAX_OUTPUT_LENGTH);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_OUTPUT_LENGTH);
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
        resolve({ code, stdout, stderr });
      });
    });
  }
}
