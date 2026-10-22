import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as https from 'https';

import {
  ExecutorOptions,
  ExecutorResult,
  InfrastructureExecutor,
} from './infrastructure-executor';
import type { RemediationActionType } from '../entities/remediation-action.entity';

const DEFAULT_NAMESPACE = 'agri-fi';
const SERVICE_ACCOUNT_TOKEN_PATH =
  '/var/run/secrets/kubernetes.io/serviceaccount/token';
const SERVICE_ACCOUNT_CA_PATH =
  '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

/**
 * KubernetesInfrastructureExecutor
 *
 * Talks directly to the Kubernetes API server using the in-cluster service
 * account credentials. Only the verbs required by the self-healing actions
 * are granted, see `devops/k8s/self-healing-rbac.yaml`.
 */
@Injectable()
export class KubernetesInfrastructureExecutor implements InfrastructureExecutor {
  readonly name = 'kubernetes';

  private readonly logger = new Logger(KubernetesInfrastructureExecutor.name);
  private readonly apiUrl: string;
  private readonly defaultNamespace: string;
  private readonly token: string | null;
  private readonly client: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService
      .get<string>('KUBERNETES_API_URL', 'https://kubernetes.default.svc')
      .replace(/\/+$/, '');
    this.defaultNamespace = this.configService.get<string>(
      'SELF_HEALING_NAMESPACE',
      DEFAULT_NAMESPACE,
    );
    this.token = this.resolveToken();

    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: parseInt(
        this.configService.get<string>('KUBERNETES_TIMEOUT_MS', '15000'),
        10,
      ),
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      httpsAgent: this.buildHttpsAgent(),
    });
  }

  /**
   * Split a `namespace/name` target into its parts.
   */
  private parseTarget(target: string): { namespace: string; name: string } {
    const separator = target.indexOf('/');
    if (separator > 0) {
      return {
        namespace: target.slice(0, separator),
        name: target.slice(separator + 1),
      };
    }
    return { namespace: this.defaultNamespace, name: target };
  }

  supports(actionType: RemediationActionType): boolean {
    return (
      actionType === 'restart_pod' ||
      actionType === 'restart_service' ||
      actionType === 'scale_up' ||
      actionType === 'scale_down'
    );
  }

  async restartPod(
    target: string,
    options: ExecutorOptions,
  ): Promise<ExecutorResult> {
    const { namespace, name } = this.parseTarget(target);
    const podName = name.split('/').pop() ?? name;

    if (options.dryRun) {
      return {
        success: true,
        message: `Dry run: pod ${namespace}/${podName} would have been deleted.`,
      };
    }

    try {
      await this.client.delete(
        `/api/v1/namespaces/${namespace}/pods/${podName}`,
        {
          params: {
            gracePeriodSeconds:
              this.configService.get<string>(
                'KUBERNETES_POD_TERMINATION_GRACE_SECONDS',
                '30',
              ) ?? '30',
          },
        },
      );

      this.logger.warn(
        `Deleted pod ${namespace}/${podName} as part of a self-healing remediation.`,
      );

      return {
        success: true,
        message: `Pod ${namespace}/${podName} deleted; the deployment will reschedule it.`,
        details: { namespace, pod: podName },
      };
    } catch (error) {
      return this.toErrorResult(error, `restart pod ${namespace}/${podName}`);
    }
  }

  async scaleDeployment(
    target: string,
    replicas: number,
    options: ExecutorOptions,
  ): Promise<ExecutorResult> {
    const { namespace, name } = this.parseTarget(target);
    const deployment = name.split('/').pop() ?? name;

    if (options.dryRun) {
      return {
        success: true,
        message: `Dry run: deployment ${namespace}/${deployment} would have been scaled to ${replicas}.`,
      };
    }

    try {
      await this.client.patch(
        `/apis/apps/v1/namespaces/${namespace}/deployments/${deployment}/scale`,
        { spec: { replicas } },
        { headers: { 'Content-Type': 'application/merge-patch+json' } },
      );

      this.logger.warn(
        `Scaled deployment ${namespace}/${deployment} to ${replicas} replicas.`,
      );

      return {
        success: true,
        message: `Deployment ${namespace}/${deployment} scaled to ${replicas} replicas.`,
        details: { namespace, deployment, replicas },
      };
    } catch (error) {
      return this.toErrorResult(
        error,
        `scale deployment ${namespace}/${deployment} to ${replicas}`,
      );
    }
  }

  async restartService(
    target: string,
    options: ExecutorOptions,
  ): Promise<ExecutorResult> {
    const { namespace, name } = this.parseTarget(target);
    const deployment = name.split('/').pop() ?? name;

    if (options.dryRun) {
      return {
        success: true,
        message: `Dry run: deployment ${namespace}/${deployment} would have been restarted.`,
      };
    }

    try {
      await this.client.patch(
        `/apis/apps/v1/namespaces/${namespace}/deployments/${deployment}`,
        {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
                },
              },
            },
          },
        },
        { headers: { 'Content-Type': 'application/merge-patch+json' } },
      );

      this.logger.warn(
        `Triggered a rollout restart of deployment ${namespace}/${deployment}.`,
      );

      return {
        success: true,
        message: `Deployment ${namespace}/${deployment} restarted (rollout).`,
        details: { namespace, deployment },
      };
    } catch (error) {
      return this.toErrorResult(
        error,
        `restart deployment ${namespace}/${deployment}`,
      );
    }
  }

  async cleanupDisk(): Promise<ExecutorResult> {
    return {
      success: false,
      unsupported: true,
      message:
        'Disk cleanup is not available through the Kubernetes API; use the disk cleanup remediation script or the Ansible executor.',
    };
  }

  /**
   * Read the current replica count of a deployment.
   */
  async getCurrentReplicas(target: string): Promise<number | null> {
    const { namespace, name } = this.parseTarget(target);
    const deployment = name.split('/').pop() ?? name;

    try {
      const response = await this.client.get(
        `/apis/apps/v1/namespaces/${namespace}/deployments/${deployment}/scale`,
      );
      const replicas = response.data?.spec?.replicas;
      return typeof replicas === 'number' ? replicas : null;
    } catch (error) {
      this.logger.warn(
        `Unable to read the replica count of ${namespace}/${deployment}: ${
          (error as Error).message
        }`,
      );
      return null;
    }
  }

  /**
   * Resolve the bearer token used for the API calls.
   */
  private resolveToken(): string | null {
    const configured = this.configService.get<string>('KUBERNETES_TOKEN');
    if (configured) {
      return configured;
    }

    try {
      if (fs.existsSync(SERVICE_ACCOUNT_TOKEN_PATH)) {
        return fs.readFileSync(SERVICE_ACCOUNT_TOKEN_PATH, 'utf8').trim();
      }
    } catch (error) {
      this.logger.warn(
        `Unable to read the in-cluster service account token: ${
          (error as Error).message
        }`,
      );
    }

    return null;
  }

  /**
   * Build an HTTPS agent that trusts the cluster certificate authority.
   */
  private buildHttpsAgent(): https.Agent | undefined {
    const caPath = this.configService.get<string>(
      'KUBERNETES_CA_PATH',
      SERVICE_ACCOUNT_CA_PATH,
    );

    try {
      if (caPath && fs.existsSync(caPath)) {
        return new https.Agent({ ca: fs.readFileSync(caPath) });
      }
    } catch (error) {
      this.logger.warn(
        `Unable to read the Kubernetes CA certificate: ${(error as Error).message}`,
      );
    }

    return undefined;
  }

  /**
   * Convert an axios error into an executor result.
   */
  private toErrorResult(error: unknown, action: string): ExecutorResult {
    const message =
      axios.isAxiosError(error) && error.response
        ? `${action} failed with status ${error.response.status}: ${
            error.response.statusText
          }`
        : `${action} failed: ${(error as Error).message}`;

    this.logger.error(message);
    return { success: false, message };
  }
}
