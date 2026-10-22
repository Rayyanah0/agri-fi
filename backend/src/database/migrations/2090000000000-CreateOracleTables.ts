import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOracleTables2090000000000 implements MigrationInterface {
  name = 'CreateOracleTables2090000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "oracle_feeds" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "feed_id" varchar(64) NOT NULL,
        "description" varchar(200),
        "data_type" varchar(16) NOT NULL DEFAULT 'commodity',
        "providers" jsonb NOT NULL,
        "quorum" integer NOT NULL DEFAULT 1,
        "decimals" integer NOT NULL DEFAULT 7,
        "heartbeat_seconds" integer NOT NULL DEFAULT 3600,
        "max_deviation_bps" integer NOT NULL DEFAULT 1000,
        "contract_id" varchar(64),
        "oracle_address" varchar(64),
        "max_daily_cost_xlm" numeric(18,7),
        "enabled" boolean NOT NULL DEFAULT true,
        "last_value" numeric(36,7),
        "last_round_id" bigint,
        "last_observed_at" timestamptz,
        "last_changed_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_oracle_feeds_feed_id" ON "oracle_feeds" ("feed_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "oracle_observations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "feed_id" varchar(64) NOT NULL,
        "provider" varchar(32) NOT NULL,
        "value" numeric(36,7),
        "decimals" integer NOT NULL DEFAULT 7,
        "round_id" bigint,
        "observed_at" timestamptz,
        "fetched_at" timestamptz NOT NULL,
        "latency_ms" integer NOT NULL DEFAULT 0,
        "deviation_bps" numeric(12,4),
        "valid" boolean NOT NULL DEFAULT false,
        "validation_error" varchar(128),
        "is_fallback" boolean NOT NULL DEFAULT false,
        "selected" boolean NOT NULL DEFAULT false,
        "on_chain" boolean NOT NULL DEFAULT false,
        "stellar_tx_id" varchar(128),
        "gas_cost_xlm" numeric(18,7),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_oracle_observations_feed_fetched" ON "oracle_observations" ("feed_id", "fetched_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_oracle_observations_feed_id" ON "oracle_observations" ("feed_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "oracle_observations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "oracle_feeds"`);
  }
}
