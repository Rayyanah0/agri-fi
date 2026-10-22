import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * Snapshot of a single read replica's health and performance (#1238).
 */
export interface ReplicaStatus {
  index: number;
  healthy: boolean;
  lagSeconds: number | null;
  latencyMs: number | null;
  queriesServed: number;
  failures: number;
  lastCheckedAt: string | null;
  lastError?: string;
}

export interface ReplicaAnalytics {
  replicas: ReplicaStatus[];
  primaryQueries: number;
  replicaQueries: number;
  readShareOnReplicas: number;
  recommendedReplicaCount: number;
  failoverRecommended: boolean;
}

/**
 * Manages read replicas: lag monitoring, health checks, weighted load
 * balancing, failover detection, scaling recommendations and analytics.
 *
 * Read/write splitting itself is handled by TypeORM replication mode
 * (see DatabaseConfig). This service adds the operational layer on top.
 */
@Injectable()
export class ReplicaManagerService {
  private readonly logger = new Logger(ReplicaManagerService.name);
  private readonly statuses: ReplicaStatus[];
  private primaryQueries = 0;
  private primaryFailures = 0;
  private cursor = 0;

  private readonly maxLagSeconds: number;
  private readonly scaleUpLatencyMs: number;
  private readonly primaryFailureThreshold: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.maxLagSeconds = Number(
      this.config.get('DATABASE_REPLICA_MAX_LAG_SECONDS', 10),
    );
    this.scaleUpLatencyMs = Number(
      this.config.get('DATABASE_REPLICA_SCALE_UP_LATENCY_MS', 200),
    );
    this.primaryFailureThreshold = Number(
      this.config.get('DATABASE_PRIMARY_FAILURE_THRESHOLD', 3),
    );
    const count = this.replicaCount();
    this.statuses = Array.from({ length: count }, (_, index) => ({
      index,
      healthy: true,
      lagSeconds: null,
      latencyMs: null,
      queriesServed: 0,
      failures: 0,
      lastCheckedAt: null,
    }));
  }

  private replicaCount(): number {
    const opts = this.dataSource.options as {
      replication?: { slaves?: unknown[] };
    };
    return opts.replication?.slaves?.length ?? 0;
  }

  /** Runs a read query on the least-loaded healthy replica, falling back to the primary. */
  async read<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    const replica = this.pickReplica();
    if (!replica) return this.runOnPrimary<T>(sql, params);

    const runner = this.dataSource.createQueryRunner('slave');
    const start = Date.now();
    try {
      const result = (await runner.query(sql, params)) as T;
      replica.queriesServed += 1;
      replica.latencyMs = this.ewma(replica.latencyMs, Date.now() - start);
      return result;
    } catch (err) {
      this.markFailure(replica, err);
      return this.runOnPrimary<T>(sql, params);
    } finally {
      await runner.release();
    }
  }

  /** Weighted round-robin: healthy replicas within the lag budget only. */
  pickReplica(): ReplicaStatus | null {
    const candidates = this.statuses.filter(
      (r) =>
        r.healthy && (r.lagSeconds === null || r.lagSeconds <= this.maxLagSeconds),
    );
    if (candidates.length === 0) return null;
    this.cursor = (this.cursor + 1) % candidates.length;
    const sorted = [...candidates].sort(
      (a, b) => (a.latencyMs ?? 0) - (b.latencyMs ?? 0),
    );
    // Bias toward the fastest replica while still spreading load.
    return this.cursor === 0 ? sorted[0] : candidates[this.cursor];
  }

  private async runOnPrimary<T>(sql: string, params: unknown[]): Promise<T> {
    this.primaryQueries += 1;
    const runner = this.dataSource.createQueryRunner('master');
    try {
      return (await runner.query(sql, params)) as T;
    } finally {
      await runner.release();
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkHealth(): Promise<ReplicaStatus[]> {
    if (!this.dataSource.isInitialized) return this.statuses;
    await Promise.all(this.statuses.map((s) => this.probeReplica(s)));
    await this.probePrimary();

    const unhealthy = this.statuses.filter((s) => !s.healthy).length;
    if (unhealthy > 0) {
      this.logger.warn(`${unhealthy}/${this.statuses.length} replicas unhealthy`);
    }
    return this.statuses;
  }

  private async probeReplica(status: ReplicaStatus): Promise<void> {
    let runner: QueryRunner | undefined;
    const start = Date.now();
    try {
      runner = this.dataSource.createQueryRunner('slave');
      const rows: Array<{ lag: string | null }> = await runner.query(
        `SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag`,
      );
      const lag = rows[0]?.lag;
      status.lagSeconds = lag === null || lag === undefined ? 0 : Number(lag);
      status.latencyMs = this.ewma(status.latencyMs, Date.now() - start);
      status.healthy = status.lagSeconds <= this.maxLagSeconds;
      status.lastError = status.healthy ? undefined : 'replication lag exceeded';
    } catch (err) {
      this.markFailure(status, err);
    } finally {
      status.lastCheckedAt = new Date().toISOString();
      await runner?.release();
    }
  }

  private async probePrimary(): Promise<void> {
    try {
      await this.runOnPrimary('SELECT 1', []);
      this.primaryQueries -= 1; // health probes are not counted as traffic
      this.primaryFailures = 0;
    } catch (err) {
      this.primaryFailures += 1;
      this.logger.error(
        `Primary health check failed (${this.primaryFailures}): ${(err as Error).message}`,
      );
      if (this.isFailoverRecommended()) {
        this.logger.error(
          `Primary unreachable — promote replica #${this.failoverCandidate()?.index} ` +
            '(see docs/database/read-replicas.md#failover)',
        );
      }
    }
  }

  isFailoverRecommended(): boolean {
    return this.primaryFailures >= this.primaryFailureThreshold;
  }

  /** Healthy replica with the lowest lag — the safest promotion target. */
  failoverCandidate(): ReplicaStatus | null {
    const healthy = this.statuses.filter((s) => s.healthy);
    if (healthy.length === 0) return null;
    return healthy.reduce((best, s) =>
      (s.lagSeconds ?? Infinity) < (best.lagSeconds ?? Infinity) ? s : best,
    );
  }

  /** Suggests replica count from observed latency and health. */
  recommendedReplicaCount(): number {
    const healthy = this.statuses.filter((s) => s.healthy);
    if (healthy.length === 0) return Math.max(1, this.statuses.length);
    const avgLatency =
      healthy.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0) / healthy.length;
    if (avgLatency > this.scaleUpLatencyMs) return this.statuses.length + 1;
    if (avgLatency < this.scaleUpLatencyMs / 4 && this.statuses.length > 1) {
      return this.statuses.length - 1;
    }
    return this.statuses.length;
  }

  /** Replica used for logical backups (pg_dump) to keep load off the primary. */
  backupSource(): ReplicaStatus | null {
    return this.failoverCandidate();
  }

  getAnalytics(): ReplicaAnalytics {
    const replicaQueries = this.statuses.reduce((s, r) => s + r.queriesServed, 0);
    const total = replicaQueries + this.primaryQueries;
    return {
      replicas: this.statuses.map((s) => ({ ...s })),
      primaryQueries: this.primaryQueries,
      replicaQueries,
      readShareOnReplicas: total === 0 ? 0 : replicaQueries / total,
      recommendedReplicaCount: this.recommendedReplicaCount(),
      failoverRecommended: this.isFailoverRecommended(),
    };
  }

  private markFailure(status: ReplicaStatus, err: unknown): void {
    status.failures += 1;
    status.healthy = false;
    status.lastError = (err as Error)?.message ?? String(err);
    this.logger.warn(`Replica #${status.index} failed: ${status.lastError}`);
  }

  private ewma(prev: number | null, sample: number, alpha = 0.3): number {
    return prev === null ? sample : Math.round(alpha * sample + (1 - alpha) * prev);
  }
}
