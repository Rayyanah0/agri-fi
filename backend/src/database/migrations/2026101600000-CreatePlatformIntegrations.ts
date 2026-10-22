import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformIntegrations2026101600000 implements MigrationInterface {
  name = 'CreatePlatformIntegrations2026101600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "calendar_connections" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL,
      "provider" varchar(16) NOT NULL, "calendar_id" varchar(512) NOT NULL,
      "access_token" text NOT NULL, "refresh_token" text, "timezone" varchar(64) NOT NULL DEFAULT 'UTC',
      "preferences" jsonb NOT NULL DEFAULT '{"milestones":true,"deadlines":true}',
      "last_synced_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_calendar_connections" PRIMARY KEY ("id"), CONSTRAINT "UQ_calendar_user_provider" UNIQUE ("user_id", "provider"))`);
    await queryRunner.query(`CREATE TABLE "calendar_events" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "connection_id" uuid NOT NULL, "user_id" uuid NOT NULL,
      "source_id" uuid NOT NULL, "source_type" varchar(16) NOT NULL, "external_id" varchar,
      "title" varchar NOT NULL, "description" text, "starts_at" timestamptz NOT NULL, "ends_at" timestamptz NOT NULL,
      "reminder_minutes" integer NOT NULL DEFAULT 60, "status" varchar(16) NOT NULL DEFAULT 'pending',
      "external_updated_at" timestamptz, "last_error" text, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_calendar_events" PRIMARY KEY ("id"), CONSTRAINT "UQ_calendar_event_source" UNIQUE ("connection_id", "source_id"))`);
    await queryRunner.query(`CREATE TABLE "feature_flags" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" varchar(120) NOT NULL, "enabled" boolean NOT NULL DEFAULT false,
      "rollout_percentage" double precision NOT NULL DEFAULT 100, "user_ids" jsonb NOT NULL DEFAULT '[]', "segments" jsonb NOT NULL DEFAULT '[]',
      "starts_at" timestamptz, "ends_at" timestamptz, "updated_by" uuid NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_feature_flags" PRIMARY KEY ("id"), CONSTRAINT "UQ_feature_flag_key" UNIQUE ("key"))`);
    await queryRunner.query(`CREATE TABLE "feature_flag_audit" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "flag_id" uuid NOT NULL, "actor_id" uuid NOT NULL,
      "action" varchar(32) NOT NULL, "changes" jsonb, "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_feature_flag_audit" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "database_shards" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shard_key" varchar(120) NOT NULL, "connection_url" varchar(512) NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'healthy', "weight" integer NOT NULL DEFAULT 1, "last_health_check" timestamptz,
      "last_error" text, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_database_shards" PRIMARY KEY ("id"), CONSTRAINT "UQ_database_shard_key" UNIQUE ("shard_key"))`);
    await queryRunner.query(`CREATE INDEX "IDX_calendar_events_user_starts" ON "calendar_events" ("user_id", "starts_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_feature_flag_audit_flag_created" ON "feature_flag_audit" ("flag_id", "created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_feature_flag_audit_flag_created"`);
    await queryRunner.query(`DROP INDEX "IDX_calendar_events_user_starts"`);
    await queryRunner.query(`DROP TABLE "database_shards"`);
    await queryRunner.query(`DROP TABLE "feature_flag_audit"`);
    await queryRunner.query(`DROP TABLE "feature_flags"`);
    await queryRunner.query(`DROP TABLE "calendar_events"`);
    await queryRunner.query(`DROP TABLE "calendar_connections"`);
  }
}