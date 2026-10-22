import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cross-device appearance preferences (#1170).
 *
 * Stores the user's theme preferences (colour scheme, accent palette, font
 * size and contrast level) on the user profile so the theme follows the user
 * to any device. JSONB keeps the payload extensible without further
 * migrations.
 */
export class AddUserThemePreferences2202000000000 implements MigrationInterface {
  name = 'AddUserThemePreferences2202000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "theme_preferences" jsonb`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "theme_preferences"`,
    );
  }
}
