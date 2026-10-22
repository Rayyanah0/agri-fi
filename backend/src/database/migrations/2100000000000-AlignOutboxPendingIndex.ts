import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns the outbox worker index with the `OutboxService.publishPending`
 * query (#968):
 *
 *   WHERE processed = FALSE AND retry_count < 10
 *   ORDER BY created_at ASC
 *   LIMIT $1
 *   FOR UPDATE SKIP LOCKED
 *
 * Migration 1820000000000 created `idx_outbox_unprocessed`
 * `(processed, retry_count, created_at) WHERE processed = FALSE`, which is
 * already close to the worker query, but the entity's `@Index` decorator
 * declared the index as non-partial. That mismatch means `synchronize` in a
 * non-production environment would rebuild the index without the predicate,
 * and it makes the "entity matches migration" invariant impossible to reason
 * about.
 *
 * This migration:
 *   1. Creates `idx_outbox_pending_scan` with the exact column order and
 *      predicate the worker query needs (idempotent, so environments where
 *      1820000000000 never applied still converge).
 *   2. Drops the superseded `idx_outbox_unprocessed`, so a single index owns
 *      the pending-event scan.
 *
 * The entity decorator in `src/outbox/outbox.entity.ts` declares the same
 * index name, columns and predicate.
 *
 * Why not make the predicate `retry_count < 10` as well? The planner can still
 * use the equality on `processed` plus the `retry_count` range and read the
 * `created_at` order directly from the index. Keeping `processed = FALSE` as
 * the sole predicate avoids churning index entries on every retry increment.
 */
export class AlignOutboxPendingIndex2100000000000 implements MigrationInterface {
  name = 'AlignOutboxPendingIndex2100000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_pending_scan"
        ON "outbox" ("processed", "retry_count", "created_at")
        WHERE "processed" = FALSE
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_unprocessed"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the previous index definition so a revert leaves a usable
    // worker index behind.
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_pending_scan"`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_unprocessed"
        ON "outbox" ("processed", "retry_count", "created_at")
        WHERE "processed" = FALSE
    `);
  }
}
