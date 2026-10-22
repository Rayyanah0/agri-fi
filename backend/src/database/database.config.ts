import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { join } from 'path';

export interface PoolStats {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  checkedOutConnections: number;
  oldestCheckedOutSeconds: number;
  acquisitionCount: number;
  averageAcquireWaitSeconds: number;
  timestamp: string;
}

interface PgPoolLike {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  connect(
    callback: (
      error: Error | undefined,
      client: unknown,
      release: (error?: Error) => void,
    ) => void,
  ): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
}

function isPgPool(value: unknown): value is PgPoolLike {
  if (typeof value !== 'object' || value === null) return false;
  const pool = value as Partial<PgPoolLike>;
  return (
    typeof pool.totalCount === 'number' &&
    typeof pool.idleCount === 'number' &&
    typeof pool.waitingCount === 'number' &&
    typeof pool.connect === 'function' &&
    typeof pool.on === 'function' &&
    typeof pool.off === 'function'
  );
}

export function parseReplicaHosts(
  raw: string,
  defaultPort: number,
): Array<{ host: string; port: number }> {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, port] = entry.split(':');
      return { host, port: port ? parseInt(port, 10) : defaultPort };
    });
}

@Injectable()
export class DatabaseConfig
  implements TypeOrmOptionsFactory, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseConfig.name);
  private readonly checkedOutClients = new Map<
    unknown,
    { acquiredAt: number; warningLogged: boolean }
  >();
  private readonly instrumentedPools = new WeakSet<object>();
  private readonly poolListeners: Array<{
    pool: PgPoolLike;
    event: string;
    listener: (...args: unknown[]) => void;
  }> = [];
  private readonly restorePoolConnect: Array<{
    pool: PgPoolLike;
    connect: PgPoolLike['connect'];
  }> = [];
  private dataSource?: DataSource;
  private monitorInterval?: NodeJS.Timeout;
  private lastHealthCheckAt = 0;
  private healthy = false;
  private acquisitionCount = 0;
  private totalAcquireWaitMs = 0;

  constructor(private readonly config: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const isProduction =
      this.config.get<string>('NODE_ENV', 'development') === 'production';
    const poolMin = this.config.get<number>('DATABASE_POOL_MIN', 2);
    const poolMax = this.config.get<number>(
      'DATABASE_POOL_MAX',
      isProduction ? 5 : 10,
    );
    const masterConnection = {
      host: this.config.get<string>('DATABASE_HOST', 'localhost'),
      port: this.config.get<number>('DATABASE_PORT', 5432),
      username: this.config.get<string>('DATABASE_USER', 'postgres'),
      password: this.config.get<string>('DATABASE_PASSWORD', 'postgres'),
      database: this.config.get<string>('DATABASE_NAME', 'agric_onchain'),
    };

    // Falls back to the primary when no replica is configured, so read
    // queries stay correct in environments without one (local/dev).
    // DATABASE_REPLICA_HOSTS (comma-separated, optional `host:port`) enables
    // multiple read replicas; TypeORM's pg driver round-robins reads across
    // them. Falls back to DATABASE_REPLICA_HOST, then the primary (#1238).
    const replicaConnections = parseReplicaHosts(
      this.config.get<string>('DATABASE_REPLICA_HOSTS') ??
        this.config.get<string>('DATABASE_REPLICA_HOST', masterConnection.host),
      masterConnection.port,
    ).map(({ host, port }) => ({ ...masterConnection, host, port }));

    return {
      type: 'postgres',
      replication: {
        master: masterConnection,
        slaves: replicaConnections,
        selector: 'RR',
      },
      entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
      migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
      synchronize: false,
      // pgAudit requires queries to be logged to CloudWatch in production
      logging: isProduction ? ['error'] : 'all',
      retryAttempts: 10,
      retryDelay: 3000,
      extra: {
        // ── Pool sizing ──────────────────────────────────────────────────────
        min: poolMin,
        max: poolMax,

        // ── Timeout settings ─────────────────────────────────────────────────
        /** Milliseconds an excess idle connection remains in the pool. */
        idleTimeoutMillis: this.config.get<number>(
          'DATABASE_POOL_IDLE_TIMEOUT_MS',
          30_000,
        ),
        /** Milliseconds to wait for a connection before throwing. */
        connectionTimeoutMillis: this.config.get<number>(
          'DATABASE_POOL_CONNECTION_TIMEOUT_MS',
          5_000,
        ),
        /** Hard cap on query execution time. Any query that runs longer than
         *  this is cancelled by Postgres and the connection returned to the
         *  pool, preventing pool starvation from runaway queries (#742). */
        statement_timeout: this.config.get<number>(
          'DATABASE_STATEMENT_TIMEOUT_MS',
          30_000,
        ),

        // ── Graceful shutdown ────────────────────────────────────────────────
        /** Release all idle connections when the pool has no remaining clients.
         *  Ensures no ghost connections remain after a graceful NestJS shutdown. */
        allowExitOnIdle: true,

        // ── Application name for database-side connection monitoring ─────────
        application_name: 'agri-fi-backend',
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        onConnect: async (client: {
          query: (sql: string) => Promise<unknown>;
        }) => {
          await client.query('SELECT 1');
        },
      },
    };
  }

  /**
   * Samples native pool state and runs a lightweight database health check.
   *
   * NOTE: DataSource is injected lazily via a class-level setter because
   * DatabaseConfig is instantiated before TypeORM finishes registering the
   * DataSource token. The setter is called by DatabaseModule after boot.
   */
  setDataSource(ds: DataSource): void {
    this.dataSource = ds;
    this.instrumentPools();
  }

  async onApplicationBootstrap(): Promise<void> {
    const intervalMs = this.config.get<number>(
      'DATABASE_HEALTH_CHECK_INTERVAL_MS',
      15_000,
    );
    this.monitorInterval = setInterval(() => {
      void this.monitorPool();
    }, intervalMs);
    this.monitorInterval.unref?.();
    await this.monitorPool();
  }

  onModuleDestroy(): void {
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    for (const { pool, connect } of this.restorePoolConnect) {
      pool.connect = connect;
    }
    this.restorePoolConnect.length = 0;
    for (const { pool, event, listener } of this.poolListeners) {
      pool.off(event, listener);
    }
    this.poolListeners.length = 0;
    this.checkedOutClients.clear();
  }

  get isHealthy(): boolean {
    return this.healthy;
  }

  async healthCheck(): Promise<void> {
    if (!this.dataSource?.isInitialized) {
      this.healthy = false;
      throw new Error('Database connection is not initialized');
    }

    try {
      await this.dataSource.query('SELECT 1');
      this.healthy = true;
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }

  async queryPoolStats(): Promise<PoolStats> {
    const pools = this.getPools();
    const totalConnections = pools.reduce(
      (total, pool) => total + pool.totalCount,
      0,
    );
    const idleConnections = pools.reduce(
      (total, pool) => total + pool.idleCount,
      0,
    );
    const waitingClients = pools.reduce(
      (total, pool) => total + pool.waitingCount,
      0,
    );
    const now = Date.now();
    const checkedOutTimes = [...this.checkedOutClients.values()].map(
      (client) => client.acquiredAt,
    );

    return {
      totalConnections,
      idleConnections,
      waitingClients,
      checkedOutConnections: Math.max(totalConnections - idleConnections, 0),
      oldestCheckedOutSeconds:
        checkedOutTimes.length === 0
          ? 0
          : Math.max(0, (now - Math.min(...checkedOutTimes)) / 1000),
      acquisitionCount: this.acquisitionCount,
      averageAcquireWaitSeconds:
        this.acquisitionCount === 0
          ? 0
          : this.totalAcquireWaitMs / this.acquisitionCount / 1000,
      timestamp: new Date().toISOString(),
    };
  }

  private getPools(): PgPoolLike[] {
    if (!this.dataSource?.isInitialized) return [];
    const driver = this.dataSource.driver;
    if (!(driver instanceof PostgresDriver)) return [];
    const pools: unknown[] = [driver.master, ...driver.slaves];
    return pools.filter(isPgPool);
  }

  private instrumentPools(): void {
    for (const pool of this.getPools()) {
      if (this.instrumentedPools.has(pool)) continue;
      this.instrumentedPools.add(pool);

      const originalConnect = pool.connect.bind(pool);
      this.restorePoolConnect.push({ pool, connect: originalConnect });
      pool.connect = (callback) => {
        const requestedAt = Date.now();
        originalConnect((error, client, release) => {
          this.acquisitionCount += 1;
          this.totalAcquireWaitMs += Date.now() - requestedAt;
          if (!error && client !== undefined) {
            this.checkedOutClients.set(client, {
              acquiredAt: Date.now(),
              warningLogged: false,
            });
          }
          callback(error, client, release);
        });
      };

      this.listen(pool, 'release', (_error, client) => {
        this.checkedOutClients.delete(client);
      });
      this.listen(pool, 'remove', (client) => {
        this.checkedOutClients.delete(client);
      });
      this.listen(pool, 'error', (error) => {
        this.healthy = false;
        this.logger.error(
          `PostgreSQL pool error: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  private listen(
    pool: PgPoolLike,
    event: string,
    listener: (...args: unknown[]) => void,
  ): void {
    pool.on(event, listener);
    this.poolListeners.push({ pool, event, listener });
  }

  private async monitorPool(): Promise<void> {
    try {
      this.instrumentPools();
      const stats = await this.queryPoolStats();
      this.detectLeakedConnections();
      const now = Date.now();
      const healthCheckInterval = this.config.get<number>(
        'DATABASE_HEALTH_CHECK_INTERVAL_MS',
        15_000,
      );
      if (now - this.lastHealthCheckAt >= healthCheckInterval) {
        await this.healthCheck();
        this.lastHealthCheckAt = now;
      }
      this.logger.debug(
        `DB pool total=${stats.totalConnections} idle=${stats.idleConnections} ` +
          `checked_out=${stats.checkedOutConnections} waiting=${stats.waitingClients}`,
      );
    } catch (error) {
      this.healthy = false;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database pool health check failed: ${message}`);
    }
  }

  private detectLeakedConnections(): void {
    const thresholdMs = this.config.get<number>(
      'DATABASE_CONNECTION_LEAK_THRESHOLD_MS',
      60_000,
    );
    const now = Date.now();
    for (const client of this.checkedOutClients.values()) {
      if (!client.warningLogged && now - client.acquiredAt >= thresholdMs) {
        client.warningLogged = true;
        this.logger.warn(
          `Database connection checked out for ${Math.round((now - client.acquiredAt) / 1000)}s ` +
            `(leak threshold ${Math.round(thresholdMs / 1000)}s)`,
        );
      }
    }
  }
}
