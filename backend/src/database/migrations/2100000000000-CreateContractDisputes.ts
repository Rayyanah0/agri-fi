import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Issue #1004 — local projection of on-chain milestone disputes.
 *
 * `contract_disputes` mirrors the FarmCampaign `DisputeRecord` the Soroban
 * event listener indexes, so dispute status can be served from the DB and the
 * evidence/vote trail is queryable without replaying the chain.
 */
export class CreateContractDisputes2100000000000 implements MigrationInterface {
  name = 'CreateContractDisputes2100000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contract_disputes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "contract_id" varchar(64) NOT NULL,
        "deal_id" uuid,
        "milestone_index" integer NOT NULL,
        "raised_by" varchar(56) NOT NULL,
        "phase" varchar(16) NOT NULL DEFAULT 'open',
        "voting_deadline" timestamptz NOT NULL,
        "release_votes" integer NOT NULL DEFAULT 0,
        "refund_votes" integer NOT NULL DEFAULT 0,
        "outcome" varchar(16),
        "evidence_json" jsonb,
        "votes_json" jsonb,
        "opened_tx_hash" varchar(64),
        "resolved_tx_hash" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_contract_disputes_contract_milestone"
          UNIQUE ("contract_id", "milestone_index")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_contract_disputes_deal" ON "contract_disputes" ("deal_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_contract_disputes_phase_deadline" ON "contract_disputes" ("phase", "voting_deadline")`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_disputes" ADD CONSTRAINT "fk_contract_disputes_deal" FOREIGN KEY ("deal_id") REFERENCES "trade_deals"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contract_disputes_phase_deadline"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contract_disputes_deal"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contract_disputes"`);
  }
}
