# Read Replicas

PostgreSQL streaming replicas distribute read load away from the primary.

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_HOST` / `DATABASE_PORT` | Primary (writes) |
| `DATABASE_REPLICA_HOSTS` | Comma-separated replicas, e.g. `replica-1:5432,replica-2` |
| `DATABASE_REPLICA_HOST` | Single-replica fallback (legacy) |
| `DATABASE_REPLICA_MAX_LAG_SECONDS` | Lag budget before a replica is taken out of rotation (default `10`) |
| `DATABASE_REPLICA_SCALE_UP_LATENCY_MS` | Avg latency that triggers a scale-up recommendation (default `200`) |
| `DATABASE_PRIMARY_FAILURE_THRESHOLD` | Consecutive primary failures before failover is recommended (default `3`) |

With no replica configured, reads fall back to the primary.

## Read/write splitting

`DatabaseConfig` enables TypeORM replication mode: `master` handles writes and transactions; `slaves` (round-robin selector `RR`) serve `find`/`SELECT` queries outside transactions. Use `dataSource.createQueryRunner('master')` for read-after-write consistency.

## ReplicaManagerService

`backend/src/database/replica-manager.service.ts` adds the operational layer:

- **Health checks & lag monitoring** – every 30 s each replica runs `now() - pg_last_xact_replay_timestamp()`; replicas over the lag budget or erroring are marked unhealthy.
- **Load balancing** – `read(sql, params)` picks a healthy replica via latency-biased round-robin and falls back to the primary on failure.
- **Failover** – the primary is probed each cycle; after `DATABASE_PRIMARY_FAILURE_THRESHOLD` failures `isFailoverRecommended()` is true and `failoverCandidate()` returns the lowest-lag healthy replica. Promote it with `pg_ctl promote` / `SELECT pg_promote()` (or the managed service's promote action), then repoint `DATABASE_HOST`.
- **Scaling** – `recommendedReplicaCount()` suggests adding a replica when average latency exceeds the threshold and removing one when far below it. Apply via Terraform/managed service.
- **Analytics** – `getAnalytics()` returns per-replica queries served, latency (EWMA), failures, lag, and the share of reads served by replicas.
- **Backups** – `backupSource()` returns the replica to run `pg_dump` / base backups against, keeping load off the primary.

## Operational notes

- Ensure `hot_standby_feedback = on` to reduce query cancellations on replicas.
- Monitor `pg_stat_replication` on the primary alongside the service's analytics.
