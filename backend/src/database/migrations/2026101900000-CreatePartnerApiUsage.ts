import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePartnerApiUsage2026101900000 implements MigrationInterface {
  name = 'CreatePartnerApiUsage2026101900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "partner_api_usage" (
      "owner_id" uuid NOT NULL,
      "tier" varchar(16) NOT NULL DEFAULT 'free',
      "monthly_quota_override" integer,
      "last_alerted_month" varchar(7),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_partner_api_usage" PRIMARY KEY ("owner_id"),
      CONSTRAINT "CHK_partner_api_usage_tier" CHECK ("tier" IN ('free', 'standard', 'premium')),
      CONSTRAINT "CHK_partner_api_usage_quota" CHECK ("monthly_quota_override" IS NULL OR "monthly_quota_override" >= 0)
    )`);
    await queryRunner.query(`CREATE TABLE "api_usage_events" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "owner_id" uuid NOT NULL,
      "api_key_id" uuid NOT NULL,
      "method" varchar(10) NOT NULL,
      "endpoint" varchar(160) NOT NULL,
      "status_code" integer NOT NULL,
      "data_transfer_bytes" bigint NOT NULL DEFAULT 0,
      "compute_time_ms" integer NOT NULL DEFAULT 0,
      "anomalous" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_api_usage_events" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_api_usage_owner_created" ON "api_usage_events" ("owner_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_api_usage_key_created" ON "api_usage_events" ("api_key_id", "created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_api_usage_key_created"`);
    await queryRunner.query(`DROP INDEX "IDX_api_usage_owner_created"`);
    await queryRunner.query(`DROP TABLE "api_usage_events"`);
    await queryRunner.query(`DROP TABLE "partner_api_usage"`);
  }
}