import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditLogRetention2202000000000 implements MigrationInterface {
  name = 'AddAuditLogRetention2202000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "system_audit_logs" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_id" VARCHAR,
        "actor_role" VARCHAR,
        "route" VARCHAR NOT NULL,
        "status_code" INT,
        "request_details" JSONB,
        "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        ADD COLUMN "log_type" VARCHAR NOT NULL DEFAULT 'financial_transaction',
        ADD COLUMN "retention_period" VARCHAR NOT NULL DEFAULT '7 years',
        ADD COLUMN "retention_until" TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 years');
      UPDATE "audit_logs"
        SET "log_type" = CASE
          WHEN lower("entity_name") LIKE '%kyc%' THEN 'kyc_document'
          ELSE 'financial_transaction'
        END,
        "retention_period" = CASE
          WHEN lower("entity_name") LIKE '%kyc%' THEN '5 years'
          ELSE '7 years'
        END,
        "retention_until" = CASE
          WHEN lower("entity_name") LIKE '%kyc%' THEN "created_at" + interval '5 years'
          ELSE "created_at" + interval '7 years'
        END;
      CREATE INDEX "idx_audit_logs_retention"
        ON "audit_logs" ("retention_until");
      CREATE INDEX "idx_audit_logs_created_user"
        ON "audit_logs" ("created_at", "user_id");
      ALTER TABLE "audit_logs"
        ADD CONSTRAINT "chk_audit_logs_log_type"
        CHECK ("log_type" IN ('financial_transaction', 'kyc_document', 'operational', 'debug'));
    `);

    await queryRunner.query(`
      ALTER TABLE "system_audit_logs"
        ADD COLUMN "log_type" VARCHAR NOT NULL DEFAULT 'operational',
        ADD COLUMN "retention_period" VARCHAR NOT NULL DEFAULT '1 year',
        ADD COLUMN "retention_until" TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 year');
      UPDATE "system_audit_logs"
        SET "log_type" = CASE
          WHEN lower("route") LIKE '%kyc%' OR lower("route") LIKE '%document%' THEN 'kyc_document'
          WHEN lower("route") ~ '(investment|payout|payment|settlement|transaction|trade.?deal)' THEN 'financial_transaction'
          ELSE 'operational'
        END,
        "retention_period" = CASE
          WHEN lower("route") LIKE '%kyc%' OR lower("route") LIKE '%document%' THEN '5 years'
          WHEN lower("route") ~ '(investment|payout|payment|settlement|transaction|trade.?deal)' THEN '7 years'
          ELSE '1 year'
        END,
        "retention_until" = CASE
          WHEN lower("route") LIKE '%kyc%' OR lower("route") LIKE '%document%' THEN "timestamp" + interval '5 years'
          WHEN lower("route") ~ '(investment|payout|payment|settlement|transaction|trade.?deal)' THEN "timestamp" + interval '7 years'
          ELSE "timestamp" + interval '1 year'
        END;
      CREATE INDEX "idx_system_audit_logs_retention"
        ON "system_audit_logs" ("retention_until");
      CREATE INDEX "idx_system_audit_logs_timestamp_actor"
        ON "system_audit_logs" ("timestamp", "actor_id");
      ALTER TABLE "system_audit_logs"
        ADD CONSTRAINT "chk_system_audit_logs_log_type"
        CHECK ("log_type" IN ('financial_transaction', 'kyc_document', 'operational', 'debug'));
    `);

    await queryRunner.query(`
      ALTER TABLE "transaction_audit_log"
        ADD COLUMN "log_type" VARCHAR NOT NULL DEFAULT 'financial_transaction',
        ADD COLUMN "retention_period" VARCHAR NOT NULL DEFAULT '7 years',
        ADD COLUMN "retention_until" TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 years');
      UPDATE "transaction_audit_log"
        SET "retention_until" = COALESCE("created_at", now()) + interval '7 years';
      CREATE INDEX "idx_transaction_audit_log_retention"
        ON "transaction_audit_log" ("retention_until");
      ALTER TABLE "transaction_audit_log"
        ADD CONSTRAINT "chk_transaction_audit_log_log_type"
        CHECK ("log_type" IN ('financial_transaction', 'kyc_document', 'operational', 'debug'));
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_archive_records" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_table" VARCHAR NOT NULL
          CHECK ("source_table" IN ('audit_logs', 'system_audit_logs', 'transaction_audit_log')),
        "source_id" UUID NOT NULL,
        "log_type" VARCHAR NOT NULL
          CHECK ("log_type" IN ('financial_transaction', 'kyc_document', 'operational', 'debug')),
        "source_created_at" TIMESTAMPTZ NOT NULL,
        "retention_until" TIMESTAMPTZ NOT NULL,
        "storage_key" VARCHAR NOT NULL UNIQUE,
        "version_id" VARCHAR NOT NULL,
        "checksum" VARCHAR NOT NULL,
        "archived_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE ("source_table", "source_id")
      );
      CREATE INDEX "idx_audit_archive_records_retention"
        ON "audit_archive_records" ("retention_until");
      CREATE INDEX "idx_audit_archive_records_type_created"
        ON "audit_archive_records" ("log_type", "source_created_at");

      CREATE TABLE "audit_archive_retrieval_requests" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "archive_record_id" UUID NOT NULL
          REFERENCES "audit_archive_records" ("id") ON DELETE CASCADE,
        "requester_id" UUID NOT NULL,
        "approver_id" UUID,
        "reason" TEXT NOT NULL,
        "status" VARCHAR NOT NULL DEFAULT 'pending'
          CHECK ("status" IN ('pending', 'approved', 'fulfilled')),
        "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "approved_at" TIMESTAMPTZ,
        "fulfilled_at" TIMESTAMPTZ,
        CHECK ("approver_id" IS NULL OR "approver_id" <> "requester_id")
      );
      CREATE INDEX "idx_audit_archive_retrieval_requests_status"
        ON "audit_archive_retrieval_requests" ("status", "requested_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "audit_archive_retrieval_requests"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_archive_records"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_transaction_audit_log_retention"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transaction_audit_log" DROP CONSTRAINT IF EXISTS "chk_transaction_audit_log_log_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transaction_audit_log" DROP COLUMN IF EXISTS "retention_until", DROP COLUMN IF EXISTS "retention_period", DROP COLUMN IF EXISTS "log_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_system_audit_logs_retention"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_system_audit_logs_timestamp_actor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "system_audit_logs" DROP CONSTRAINT IF EXISTS "chk_system_audit_logs_log_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "system_audit_logs" DROP COLUMN IF EXISTS "retention_until", DROP COLUMN IF EXISTS "retention_period", DROP COLUMN IF EXISTS "log_type"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_retention"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_audit_logs_created_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "chk_audit_logs_log_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "retention_until", DROP COLUMN IF EXISTS "retention_period", DROP COLUMN IF EXISTS "log_type"`,
    );
  }
}
