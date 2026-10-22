import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocumentVersions2070000000000 implements MigrationInterface {
  name = 'CreateDocumentVersions2070000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_versions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "document_id" uuid NOT NULL,
        "version_number" integer NOT NULL,
        "ipfs_hash" varchar NOT NULL,
        "storage_url" varchar NOT NULL,
        "mime_type" varchar,
        "size_bytes" integer NOT NULL DEFAULT 0,
        "content_sha256" varchar(64) NOT NULL,
        "comment" text NOT NULL,
        "action" varchar(16) NOT NULL DEFAULT 'upload',
        "restored_from_version" integer,
        "created_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_document_versions_doc_ver" UNIQUE ("document_id", "version_number")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_document_versions_document_id" ON "document_versions" ("document_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "migration_runs" (
        "id" SERIAL PRIMARY KEY,
        "migration_name" varchar(255) NOT NULL,
        "version" varchar(64) NOT NULL,
        "direction" varchar(8) NOT NULL,
        "status" varchar(16) NOT NULL,
        "environment" varchar(32) NOT NULL,
        "duration_ms" integer,
        "backup_file" text,
        "error" text,
        "executed_by" varchar(128),
        "git_sha" varchar(64),
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "email_preferences" (
        "user_id" uuid PRIMARY KEY,
        "frequency" varchar(16) NOT NULL DEFAULT 'instant',
        "categories" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "preferred_hour" integer,
        "timezone" varchar(64) NOT NULL DEFAULT 'UTC',
        "unsubscribed_all" boolean NOT NULL DEFAULT false,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "email_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid,
        "to_address" varchar NOT NULL,
        "template" varchar(64) NOT NULL,
        "category" varchar(32) NOT NULL,
        "subject" varchar NOT NULL,
        "html" text NOT NULL,
        "text" text NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'scheduled',
        "scheduled_for" timestamptz NOT NULL DEFAULT now(),
        "sent_at" timestamptz,
        "opened_at" timestamptz,
        "open_count" integer NOT NULL DEFAULT 0,
        "click_count" integer NOT NULL DEFAULT 0,
        "reply_token" varchar(64),
        "context" jsonb,
        "error" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_email_messages_status_sched" ON "email_messages" ("status", "scheduled_for")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_email_messages_reply_token" ON "email_messages" ("reply_token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "email_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_preferences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_versions"`);
  }
}
