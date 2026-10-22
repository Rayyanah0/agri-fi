# Database Migration Tooling

Safe schema-change tooling built on the existing **TypeORM** migration infrastructure
(`backend/src/database/data-source.ts`, `backend/src/database/migrations/`).

| Component | File |
|---|---|
| CLI (backup → run → validate → track → document) | `backend/src/database/migration-tooling/migrate.ts` |
| Safety helpers (backup, restore, lint, validation, schema diff) | `backend/src/database/migration-tooling/migration-safety.ts` |
| Versioning, run history and analytics | `backend/src/database/migration-tooling/migration-tracker.ts` |
| CI/CD automation | `.github/workflows/db-migrations.yml` |
| Generated schema changelog | `docs/database/schema-changelog.md` |

## Commands

```bash
cd backend
npm run migrate:status              # executed [x] / pending [ ] with versions
npm run migrate:lint                # static safety checks
npm run migrate:up                  # backup → run pending → validate → record → document
npm run migrate:down -- --steps 2   # roll back last 2 migrations (backup first)
npm run migrate:test                # staging: up → down → up reversibility test
npm run migrate:restore -- <file>   # restore a pre-migration backup
npm run migrate:history             # run history
npm run migrate:analytics           # durations & success rates
```

Flags: `--dry-run`, `--no-backup` (rejected when `NODE_ENV=production`), `--restore-on-fail`.

## Features

### Versioning
The version is the timestamp suffix of the migration class name (`CreateFoo1700000000000` → `1700000000000`).
TypeORM's `migrations` table remains the source of truth for what is applied; `migration_runs`
additionally keeps **every attempt** (up, down, test), including failed ones, with environment,
executor, git SHA and backup path.

### Rollback
Every migration must implement a non-empty `down()` — `migrate:lint` fails otherwise.
`migrate:down --steps N` reverts via `undoLastMigration` with a transaction per migration.
For catastrophic failures, `migrate:restore <dump>` restores the pre-migration backup.

### Testing (staging before production)
`migrate:test` (refuses to run in production) runs each pending migration `up`, then `down`,
compares a schema snapshot to verify the original schema is restored, and re-applies it.
CI runs this on staging before the production job is allowed.

### Automation (CI/CD)
`db-migrations.yml`:
- **PRs** touching migrations: linearity check, lint, fresh apply, rollback 3 + re-apply on Postgres 16.
- **main / manual dispatch**: staging reversibility test → `migrate:up --restore-on-fail` against the
  selected GitHub environment (production requires environment approval), backup uploaded as artifact.

### Validation
After `up`, `validateSchema()` asserts:
- no pending migrations remain,
- no `INVALID` indexes (failed `CREATE INDEX CONCURRENTLY`),
- no `NOT VALID` constraints.
Failure exits non-zero and fails the pipeline.

### Backup
`pg_dump -Fc` is taken before every `up`/`down` into `MIGRATION_BACKUP_DIR`
(default `backend/backups/migrations`). This integrates with the existing backup infrastructure
(`backup-restore-verify.yml`) — dumps use the same custom format and can be restored with `pg_restore`.

### Analytics
`migrate:analytics` reports total runs, success rate, average and p95 duration, failures, rollbacks
and the 5 slowest migrations, computed from `migration_runs`.

### Documentation of schema changes
`migrate:up` snapshots `information_schema.columns` before and after and appends a markdown
diff (added/dropped tables, changed columns) to `docs/database/schema-changelog.md`.

## Lint rules

| Pattern | Level |
|---|---|
| Missing `down()` | error |
| `TRUNCATE` | error |
| Empty `down()` | warning |
| `DROP TABLE` without `IF EXISTS`, `DROP COLUMN` | warning |
| `ALTER COLUMN ... TYPE`, `SET NOT NULL` | warning |
| `CREATE INDEX` without `CONCURRENTLY` | warning |

## Environment variables

| Variable | Default |
|---|---|
| `MIGRATION_BACKUP_DIR` | `./backups/migrations` |
| `MIGRATION_CHANGELOG` | `../docs/database/schema-changelog.md` |
| `NODE_ENV` | `development` (recorded as environment) |
