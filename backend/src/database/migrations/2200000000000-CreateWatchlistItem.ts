import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Investor watchlist (#1003).
 *
 * `alerted_pct` / `alerted_status` are per-row dedup watermarks for the alert
 * pass, so an alert is never re-sent after a restart or a second run.
 */
export class CreateWatchlistItem2200000000000 implements MigrationInterface {
  name = 'CreateWatchlistItem2200000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "watchlist_item" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "deal_id" uuid NOT NULL,
      "notify_funding_pct" jsonb NOT NULL DEFAULT '[50, 100]'::jsonb,
      "notify_status_change" boolean NOT NULL DEFAULT true,
      "alerted_pct" integer NOT NULL DEFAULT 0,
      "alerted_status" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_watchlist_item" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_watchlist_item_user_deal" UNIQUE ("user_id", "deal_id"),
      CONSTRAINT "FK_watchlist_item_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_watchlist_item_deal" FOREIGN KEY ("deal_id") REFERENCES "trade_deals"("id") ON DELETE CASCADE,
      CONSTRAINT "CHK_watchlist_item_alerted_pct" CHECK ("alerted_pct" >= 0 AND "alerted_pct" <= 100)
    )`);
    // The alert pass looks up every watcher of a deal; the unique constraint
    // above only indexes (user_id, deal_id).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_watchlist_item_deal" ON "watchlist_item" ("deal_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_watchlist_item_deal"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "watchlist_item"`);
  }
}
