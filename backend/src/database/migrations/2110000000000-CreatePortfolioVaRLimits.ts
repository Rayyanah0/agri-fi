import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePortfolioVaRLimits2110000000000 implements MigrationInterface {
  name = 'CreatePortfolioVaRLimits2110000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "portfolio_var_limits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "investor_id" uuid NOT NULL,
        "confidence_level" numeric(4,3) NOT NULL,
        "horizon_days" integer NOT NULL,
        "limit_usd" numeric(36,7) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "last_breached" boolean NOT NULL DEFAULT false,
        "last_alerted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_portfolio_var_limit" UNIQUE ("investor_id", "confidence_level", "horizon_days"),
        CONSTRAINT "ck_portfolio_var_limit_confidence" CHECK ("confidence_level" IN (0.950, 0.990, 0.999)),
        CONSTRAINT "ck_portfolio_var_limit_horizon" CHECK ("horizon_days" IN (1, 10, 30)),
        CONSTRAINT "ck_portfolio_var_limit_amount" CHECK ("limit_usd" > 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "portfolio_var_limits"`);
  }
}
