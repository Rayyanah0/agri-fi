import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { DatabaseConfig } from './database.config';

describe('DatabaseConfig', () => {
  const poolConfig = () =>
    new DatabaseConfig(
      new ConfigService({
        NODE_ENV: 'production',
        DATABASE_POOL_MIN: 2,
        DATABASE_POOL_MAX: 5,
        DATABASE_POOL_IDLE_TIMEOUT_MS: 20_000,
        DATABASE_POOL_CONNECTION_TIMEOUT_MS: 3_000,
        DATABASE_HEALTH_CHECK_INTERVAL_MS: 10_000,
        DATABASE_CONNECTION_LEAK_THRESHOLD_MS: 30_000,
      }),
    );

  it('configures bounded, validated PostgreSQL connections', async () => {
    const config = poolConfig();
    const options = config.createTypeOrmOptions();

    expect(options).toMatchObject({
      extra: {
        min: 2,
        max: 5,
        idleTimeoutMillis: 20_000,
        connectionTimeoutMillis: 3_000,
        keepAlive: true,
        application_name: 'agri-fi-backend',
      },
    });

    const client = {
      query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    };
    await options.extra?.onConnect(client);
    expect(client.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports driver pool state and connection acquisition wait time', async () => {
    const config = poolConfig();
    const dataSource = new DataSource({ type: 'postgres' });
    const client = {};
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const pool = {
      totalCount: 2,
      idleCount: 1,
      waitingCount: 3,
      connect: (callback: (...args: unknown[]) => void) =>
        callback(undefined, client, jest.fn()),
      on: (event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return pool;
      },
      off: (event: string) => {
        listeners.delete(event);
        return pool;
      },
    };

    (dataSource.driver as PostgresDriver).master = pool;
    Object.defineProperty(dataSource, 'isInitialized', { value: true });
    config.setDataSource(dataSource);

    const initialStats = await config.queryPoolStats();
    expect(initialStats).toMatchObject({
      totalConnections: 2,
      idleConnections: 1,
      waitingClients: 3,
      checkedOutConnections: 1,
    });

    pool.connect(jest.fn());
    const acquiredStats = await config.queryPoolStats();
    expect(acquiredStats.acquisitionCount).toBe(1);
    expect(acquiredStats.averageAcquireWaitSeconds).toBeGreaterThanOrEqual(0);
    expect(acquiredStats.oldestCheckedOutSeconds).toBeGreaterThanOrEqual(0);

    listeners.get('release')?.(undefined, client);
    pool.idleCount = 2;
    expect((await config.queryPoolStats()).oldestCheckedOutSeconds).toBe(0);

    config.onModuleDestroy();
    expect(listeners.size).toBe(0);
  });

  it('marks database health from the validation query result', async () => {
    const config = poolConfig();
    const dataSource = new DataSource({ type: 'postgres' });
    Object.defineProperty(dataSource, 'isInitialized', { value: true });
    const query = jest
      .spyOn(dataSource, 'query')
      .mockResolvedValue([{ '?column?': 1 }]);
    config.setDataSource(dataSource);

    await config.healthCheck();

    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(config.isHealthy).toBe(true);

    query.mockRejectedValueOnce(new Error('connection unavailable'));
    await expect(config.healthCheck()).rejects.toThrow(
      'connection unavailable',
    );
    expect(config.isHealthy).toBe(false);
  });
});
