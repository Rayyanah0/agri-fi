import { DataSource } from 'typeorm';

export type MigrationRunStatus = 'running' | 'success' | 'failed' | 'rolled_back';
export type MigrationDirection = 'up' | 'down' | 'test';

export interface MigrationRunRecord {
  id?: number;
  migrationName: string;
  version: string;
  direction: MigrationDirection;
  status: MigrationRunStatus;
  environment: string;
  durationMs?: number;
  backupFile?: string | null;
  error?: string | null;
  executedBy?: string;
  gitSha?: string | null;
}

export interface MigrationAnalytics {
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  rollbacks: number;
  failures: number;
  slowest: { migrationName: string; durationMs: number }[];
}

export const MIGRATION_RUNS_TABLE = 'migration_runs';

/** Extracts the numeric timestamp version from a TypeORM migration class name. */
export function extractVersion(name: string): string {
  const match = name.match(/(\d{10,})$/);
  return match ? match[1] : name;
}

/**
 * Persists migration execution history separately from TypeORM's own
 * `migrations` table so we keep failed / reverted attempts, durations and
 * environment information for auditing and analytics.
 */
export class MigrationTracker {
  constructor(private readonly ds: DataSource) {}

  async ensureTable(): Promise<void> {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS "${MIGRATION_RUNS_TABLE}" (
        "id" SERIAL PRIMARY KEY,
        "migration_name" varchar(255) NOT NULL,
        "version" varchar(64) NOT NULL,
        "direction" varchar(8) NOT NULL,
        "status" varchar(16) NOT NULL,
        "environment" varchar(32) NOT NULL,
        "duration_ms" integer,
        "backup_file" text,
        "error" text,
        "executed_by" varchar(128),
        "git_sha" varchar(64),
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz
      )
    `);
    await this.ds.query(
      `CREATE INDEX IF NOT EXISTS "idx_migration_runs_name" ON "${MIGRATION_RUNS_TABLE}" ("migration_name")`,
    );
  }

  async start(rec: MigrationRunRecord): Promise<number> {
    const rows = await this.ds.query(
      `INSERT INTO "${MIGRATION_RUNS_TABLE}"
        ("migration_name","version","direction","status","environment","backup_file","executed_by","git_sha")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING "id"`,
      [
        rec.migrationName,
        rec.version,
        rec.direction,
        rec.status,
        rec.environment,
        rec.backupFile ?? null,
        rec.executedBy ?? null,
        rec.gitSha ?? null,
      ],
    );
    return rows[0].id;
  }

  async finish(
    id: number,
    status: MigrationRunStatus,
    durationMs: number,
    error?: string,
  ): Promise<void> {
    await this.ds.query(
      `UPDATE "${MIGRATION_RUNS_TABLE}"
         SET "status"=$2, "duration_ms"=$3, "error"=$4, "finished_at"=now()
       WHERE "id"=$1`,
      [id, status, Math.round(durationMs), error ?? null],
    );
  }

  async history(limit = 50): Promise<any[]> {
    return this.ds.query(
      `SELECT * FROM "${MIGRATION_RUNS_TABLE}" ORDER BY "started_at" DESC LIMIT $1`,
      [limit],
    );
  }

  async analytics(): Promise<MigrationAnalytics> {
    const [agg] = await this.ds.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'success')::int AS success,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failures,
        COUNT(*) FILTER (WHERE direction = 'down' AND status = 'success')::int AS rollbacks,
        COALESCE(AVG(duration_ms), 0)::float AS avg,
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float AS p95
      FROM "${MIGRATION_RUNS_TABLE}"
      WHERE status <> 'running'
    `);
    const slowest = await this.ds.query(`
      SELECT migration_name AS "migrationName", MAX(duration_ms)::int AS "durationMs"
      FROM "${MIGRATION_RUNS_TABLE}" WHERE duration_ms IS NOT NULL
      GROUP BY migration_name ORDER BY 2 DESC LIMIT 5
    `);
    return {
      totalRuns: agg.total,
      successRate: agg.total ? agg.success / agg.total : 1,
      avgDurationMs: Math.round(agg.avg),
      p95DurationMs: Math.round(agg.p95),
      rollbacks: agg.rollbacks,
      failures: agg.failures,
      slowest,
    };
  }
}
