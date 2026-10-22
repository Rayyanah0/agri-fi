import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCollaborationTables2080000000000
  implements MigrationInterface
{
  name = 'CreateCollaborationTables2080000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collaboration_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "resource_type" varchar(16) NOT NULL,
        "resource_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "display_name" varchar(160) NOT NULL,
        "avatar_url" varchar(512),
        "presence_visible" boolean NOT NULL DEFAULT true,
        "joined_at" timestamptz NOT NULL,
        "left_at" timestamptz,
        "duration_seconds" integer,
        "cursor_updates" integer NOT NULL DEFAULT 0,
        "typing_events" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_collab_sessions_resource" ON "collaboration_sessions" ("resource_type", "resource_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_collab_sessions_user" ON "collaboration_sessions" ("user_id", "joined_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_collab_sessions_resource_id" ON "collaboration_sessions" ("resource_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collaboration_permissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "resource_type" varchar(16) NOT NULL,
        "resource_id" uuid NOT NULL,
        "user_id" uuid,
        "visibility" varchar(16) NOT NULL DEFAULT 'everyone',
        "can_view_presence" boolean NOT NULL DEFAULT true,
        "updated_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_collab_permissions_scope" ON "collaboration_permissions" ("resource_type", "resource_id", "user_id")`,
    );
    // Enforce a single default-policy row per resource (user_id IS NULL is
    // otherwise treated as distinct by Postgres unique indexes).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_collab_permissions_default" ON "collaboration_permissions" ("resource_type", "resource_id") WHERE "user_id" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "collaboration_permissions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "collaboration_sessions"`);
  }
}
