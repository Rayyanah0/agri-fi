import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEdgeComputing2026101900001 implements MigrationInterface {
  name = 'CreateEdgeComputing2026101900001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "edge_nodes" (
      "node_id" varchar(100) NOT NULL,
      "region" varchar(100) NOT NULL,
      "state" varchar(16) NOT NULL DEFAULT 'offline',
      "last_seen_at" timestamptz,
      "latency_ms" integer,
      "queued_items" integer NOT NULL DEFAULT 0,
      "bytes_synced" bigint NOT NULL DEFAULT 0,
      "last_error" text,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_edge_nodes" PRIMARY KEY ("node_id"),
      CONSTRAINT "CHK_edge_nodes_state" CHECK ("state" IN ('online', 'degraded', 'offline')),
      CONSTRAINT "CHK_edge_nodes_metrics" CHECK ("queued_items" >= 0 AND "bytes_synced" >= 0 AND ("latency_ms" IS NULL OR "latency_ms" >= 0))
    )`);
    await queryRunner.query(`CREATE TABLE "edge_sync_records" (
      "event_id" varchar(128) NOT NULL,
      "node_id" varchar(100) NOT NULL,
      "event_type" varchar(100) NOT NULL,
      "payload" jsonb NOT NULL,
      "payload_sha256" varchar(64) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_edge_sync_records" PRIMARY KEY ("event_id"),
      CONSTRAINT "FK_edge_sync_records_node" FOREIGN KEY ("node_id") REFERENCES "edge_nodes"("node_id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_edge_sync_node_created" ON "edge_sync_records" ("node_id", "created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_edge_sync_node_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "edge_sync_records"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "edge_nodes"`);
  }
}