# Database Sharding

The sharding control plane is represented by `database_shards`. Route user-owned records with `user_id`; route deal-owned records with `deal_id`. `PlatformIntegrationsService.routeShard` uses a stable SHA-256 bucket and ignores shards marked `failed`, so the same key remains on the same healthy shard while the control plane is unchanged.

## Operations

1. Add a shard in `healthy` state and copy data using an idempotent key-range migration.
2. Mark the source `draining`, dual-write during the migration window, validate row counts and checksums, then switch the routing ring.
3. Rebalance by moving key ranges, not individual requests. Keep a migration journal so a failed move can resume.
4. Health checks update `last_health_check` and `last_error`; failover removes unhealthy shards from routing and raises an operational alert.
5. Back up each shard independently and record restore points per shard.

Cross-shard queries should be avoided for request paths. When unavoidable, fan out only to healthy shards, apply filters on each shard, and merge with a bounded page size. Analytics should report shard latency, row distribution, migration progress, and failover count.