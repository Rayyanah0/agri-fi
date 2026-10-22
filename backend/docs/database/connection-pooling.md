# Database connection pooling

The backend uses the PostgreSQL connection pools managed by TypeORM's `pg`
driver. Configure the pool per backend process; in Kubernetes, those client
connections go to the local PgBouncer sidecar. PgBouncer's separate server-pool
budget is documented in [database connection sizing](../database-connection-sizing.md).

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `DATABASE_POOL_MIN` | `2` | Minimum open client connections |
| `DATABASE_POOL_MAX` | `5` in production, `10` otherwise | Maximum client connections |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | `30000` | Close excess idle connections after this duration |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `5000` | Maximum time to wait for a pool connection |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `30000` | PostgreSQL statement execution limit |
| `DATABASE_HEALTH_CHECK_INTERVAL_MS` | `15000` | Period for database health and pool checks |
| `DATABASE_CONNECTION_LEAK_THRESHOLD_MS` | `60000` | Warn once for a connection held longer than this duration |

All values are positive integers, except `DATABASE_POOL_MIN`, which may be
zero. When both pool bounds are provided, the minimum cannot exceed the
maximum. The same connection settings are applied to the TypeORM CLI
DataSource used by migrations and maintenance scripts.

New physical connections are validated with `SELECT 1` before the driver
hands them to TypeORM. TCP keepalives detect stale network peers, and the
periodic health check executes its own lightweight `SELECT 1`. A failed
validation removes the bad connection from the `pg` pool; subsequent pool
acquisitions can create a replacement. TypeORM also retries initial
connections. Configure the PostgreSQL/PgBouncer service endpoint for
infrastructure failover; application pool recovery does not invent or switch
to an unconfigured database host.

## Health, leak detection, and metrics

The monitor samples the TypeORM driver's actual master and replica pools,
including total, idle, checked-out, and waiting connections. It records
connection acquisition count and average wait, checks database reachability,
and warns once when a checked-out connection exceeds the leak threshold.
Monitoring stops and its pool event listeners are removed during application
shutdown.

The protected Prometheus `/metrics` endpoint exposes:

| Metric | Meaning |
| --- | --- |
| `db_connections_total` | Open master and replica pool connections |
| `db_connections_idle` | Connections currently idle in the pools |
| `db_connections_waiting` | Requests waiting for a pool connection |
| `db_connections_checked_out` | Connections currently checked out |
| `db_connections_oldest_checkout_seconds` | Age of the longest current checkout |
| `db_connection_acquire_wait_seconds_avg` | Mean acquisition wait since process start |
| `db_pool_healthy` | Latest periodic health check (`1` healthy, `0` unhealthy) |

Use the waiting and acquisition-wait metrics together: a nonzero queue with
rising acquisition latency indicates pool contention. Long checkout age points
to slow queries or unreleased query runners. Pool statistics are per process;
aggregate them with replica labels when comparing against the PgBouncer and
PostgreSQL connection budgets.

## Sizing and performance verification

Set `DATABASE_POOL_MAX` based on measured concurrent database work and the
PgBouncer client limit, not the PostgreSQL server connection limit. The
per-replica client pool, PgBouncer server pool, and Kubernetes replica ceiling
must be budgeted together. See the connection-sizing guide before changing
production limits.

Connection pooling can reduce the cost of repeatedly establishing database
connections, but a 40% improvement is workload-dependent and is not assumed by
this configuration. To evaluate a performance change, run the same
representative load test before and after the change, recording throughput,
p50/p95 latency, pool acquisition wait, database CPU, and connection counts.
Only claim an improvement after comparing those measurements under equivalent
conditions.

## Operations

- Investigate sustained `db_connections_waiting` or rising acquisition wait by
  checking query duration, checked-out connection age, and PgBouncer pool
  saturation before increasing pool size.
- Treat `db_pool_healthy = 0` or repeated PostgreSQL pool errors as a database
  availability issue. Check the configured endpoint and PgBouncer/PostgreSQL
  health; the pool will discard broken clients and reconnect when the endpoint
  is available.
- Always release manually created TypeORM query runners in a `finally` block.
  The leak warning is diagnostic and does not forcibly terminate a transaction.
- Keep health intervals and leak thresholds long enough to avoid turning
  transient load spikes into noisy alerts; both are configurable per
  environment.
