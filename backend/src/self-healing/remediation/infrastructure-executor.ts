import type { RemediationActionType } from '../entities/remediation-action.entity';

/** Injection token for the active infrastructure executor. */
export const INFRASTRUCTURE_EXECUTOR = Symbol('INFRASTRUCTURE_EXECUTOR');

/** Options shared by every executor call. */
export interface ExecutorOptions {
  namespace: string;
  timeoutMs: number;
  dryRun: boolean;
}

/** Result of a single infrastructure operation. */
export interface ExecutorResult {
  success: boolean;
  /** Human readable summary, stored on the remediation record. */
  message: string;
  /** True when the executor does not implement the requested action. */
  unsupported?: boolean;
  details?: Record<string, unknown>;
}

/**
 * Abstraction over the infrastructure control plane used to remediate
 * issues. Implementations exist for Kubernetes and for Ansible driven
 * hosts; a no-op implementation is used when automation is disabled.
 */
export interface InfrastructureExecutor {
  /** Name of the executor, recorded on every remediation action. */
  readonly name: string;

  /** Whether the executor can perform the given action type. */
  supports(actionType: RemediationActionType): boolean;

  /** Restart a single pod (deletion; the deployment recreates it). */
  restartPod(target: string, options: ExecutorOptions): Promise<ExecutorResult>;

  /** Scale a deployment to the requested replica count. */
  scaleDeployment(
    target: string,
    replicas: number,
    options: ExecutorOptions,
  ): Promise<ExecutorResult>;

  /** Restart every replica of a deployment (rollout restart). */
  restartService(
    target: string,
    options: ExecutorOptions,
  ): Promise<ExecutorResult>;

  /** Free disk space on a host. */
  cleanupDisk(
    target: string,
    options: ExecutorOptions,
  ): Promise<ExecutorResult>;

  /**
   * Current number of replicas of a deployment. Returns `null` when the
   * executor cannot resolve it.
   */
  getCurrentReplicas(target: string): Promise<number | null>;
}

/**
 * Executor used when self-healing automation is disabled. Every action is
 * reported as unsupported so that the orchestration layer records the
 * attempt without touching the infrastructure.
 */
export class NoopInfrastructureExecutor implements InfrastructureExecutor {
  readonly name = 'noop';

  supports(): boolean {
    return false;
  }

  private unsupported(action: string): ExecutorResult {
    return {
      success: false,
      unsupported: true,
      message: `Action "${action}" is not supported by the no-op executor.`,
    };
  }

  async restartPod(): Promise<ExecutorResult> {
    return this.unsupported('restart_pod');
  }

  async scaleDeployment(): Promise<ExecutorResult> {
    return this.unsupported('scale_up');
  }

  async restartService(): Promise<ExecutorResult> {
    return this.unsupported('restart_service');
  }

  async cleanupDisk(): Promise<ExecutorResult> {
    return this.unsupported('cleanup_disk');
  }

  async getCurrentReplicas(): Promise<number | null> {
    return null;
  }
}
