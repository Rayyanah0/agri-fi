import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Farmer credit score dispute workflow (#1160).
 *
 * A farmer can challenge a scoring dimension they believe was mis-measured.
 * The row records the score the farmer was shown, the dimension they
 * disputed, and the administrator's decision.
 */
export class CreateFarmerCreditScoreDisputes2201000000000
  implements MigrationInterface
{
  name = 'CreateFarmerCreditScoreDisputes2201000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "farmer_credit_score_disputes" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "disputed_score" integer NOT NULL DEFAULT 0,
      "reason" text NOT NULL,
      "factor" varchar(64),
      "status" varchar(32) NOT NULL DEFAULT 'open',
      "resolution" text,
      "corrected_score" integer,
      "resolved_by" uuid,
      "resolved_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_farmer_credit_score_disputes" PRIMARY KEY ("id"),
      CONSTRAINT "FK_farmer_credit_score_disputes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "CHK_farmer_credit_score_disputes_score" CHECK ("disputed_score" >= 0 AND "disputed_score" <= 850),
      CONSTRAINT "CHK_farmer_credit_score_disputes_corrected" CHECK ("corrected_score" IS NULL OR ("corrected_score" >= 300 AND "corrected_score" <= 850)),
      CONSTRAINT "CHK_farmer_credit_score_disputes_status" CHECK ("status" IN ('open', 'under_review', 'resolved', 'rejected'))
    )`);
    // The farmer's own dispute list and the admin review queue both filter
    // on (user_id, status).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_farmer_credit_score_disputes_user_status" ON "farmer_credit_score_disputes" ("user_id", "status")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_farmer_credit_score_disputes_user_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "farmer_credit_score_disputes"`);
  }
}
