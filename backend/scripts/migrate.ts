/* eslint-disable no-console */
/**
 * Safe migration CLI.
 *
 *   ts-node -r tsconfig-paths/register scripts/migrate.ts <command> [options]
 *
 * Commands:
 *   status              Show executed / pending migrations (versioning)
 *   run                 Backup → run pending migrations one-by-one → validate
 *   revert [--steps N]  Roll back the last N migrations (default 1)
 *   restore --file F    Restore a pre-migration backup
 *   test                Run up → down → up for every pending migration inside
 *                       a transaction that is rolled back (staging dry-run)
 *   lint                Static safety checks on migration files
 *   validate            Post-migration schema validation
 *   history [--limit N] Show recorded migration runs
 *   analytics           Durations and success rates
 *
 * Flags:
 *   --skip-backup       Do not take a pg_dump before running (not allowed in production)
 *   --no-docs           Do not write schema-change documentation
 */
import 'reflect-metadata';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { AppDataSource } from '../src/database/data-source';
import {
  MigrationTracker,
  extractVersion,
} from '../src/database/migration-tooling/migration-tracker';
import {
  ConnectionInfo,
  backupDatabase,
  restoreDatabase,
  lintMigrations,
  validateSchema,
  snapshotSchema,
  diffSchemas,
} from '../src/database/migration-tooling/migration-safety';

const args = process.argv.slice(2);
const command = args[0] ?? 'status';
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const ENV = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
const IS_PROD = ENV === 'production';
const BACKUP_DIR = process.env.MIGRATION_BACKUP_DIR ?? join(__dirname, '..', 'backups', 'migrations');
const DOCS_DIR = join(__dirname, '..', '..', 'docs', 'database', 'schema-changes');
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'database', 'migrations');

type Named = MigrationInterface & { name?: string };
const nameOf = (m: Named) => m.name ?? m.constructor.name;

function connectionInfo(): ConnectionInfo {
  const o: any = AppDataSource.options;
  return o.replication?.master ?? o;
}

async function executedNames(): Promise<string[]> {
  const exists = await AppDataSource.query(`SELECT to_regclass('migrations') AS t`);
  if (!exists[0].t) return [];
  const rows = await AppDataSource.query(`SELECT name FROM migrations ORDER BY id ASC`);
  return rows.map((r: any) => r.name);
}

async function pendingMigrations(): Promise<Named[]> {
  const done = new Set(await executedNames());
  return (AppDataSource.migrations as Named[])
    .filter((m) => !done.has(nameOf(m)))
    .sort((a, b) => Number(extractVersion(nameOf(a))) - Number(extractVersion(nameOf(b))));
}

async function ensureMigrationsTable(qr: QueryRunner) {
  await qr.query(`
    CREATE TABLE IF NOT EXISTS "migrations" (
      "id" SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, "name" varchar NOT NULL
    )`);
}

async function status() {
  const executed = await executedNames();
  const pending = await pendingMigrations();
  console.log(`Environment: ${ENV}`);
  console.log(`Current version: ${executed.length ? extractVersion(executed[executed.length - 1]) : 'none'}`);
  console.log(`Executed: ${executed.length}  Pending: ${pending.length}`);
  pending.forEach((m) => console.log(`  [pending] ${nameOf(m)}`));
}

async function run() {
  const tracker = new MigrationTracker(AppDataSource);
  await tracker.ensureTable();
  const pending = await pendingMigrations();
  if (!pending.length) {
    console.log('No pending migrations.');
    return;
  }

  const lintErrors = lintMigrations(MIGRATIONS_DIR).filter(
    (f) => f.level === 'error' && pending.some((m) => f.file.startsWith(extractVersion(nameOf(m)))),
  );
  if (lintErrors.length) {
    lintErrors.forEach((f) => console.error(`✖ ${f.file}: ${f.message}`));
    throw new Error('Pending migrations failed safety lint');
  }

  let backupFile: string | null = null;
  if (flag('skip-backup')) {
    if (IS_PROD) throw new Error('--skip-backup is not allowed in production');
    console.warn('⚠ Skipping pre-migration backup');
  } else {
    console.log('Creating pre-migration backup...');
    backupFile = backupDatabase(connectionInfo(), BACKUP_DIR);
    console.log(`Backup written to ${backupFile}`);
  }

  const before = await snapshotSchema(AppDataSource);
  const applied: string[] = [];

  for (const m of pending) {
    const name = nameOf(m);
    const runId = await tracker.start({
      migrationName: name,
      version: extractVersion(name),
      direction: 'up',
      status: 'running',
      environment: ENV,
      backupFile,
      executedBy: process.env.USER ?? process.env.GITHUB_ACTOR ?? 'unknown',
      gitSha: process.env.GITHUB_SHA ?? null,
    });
    const qr = AppDataSource.createQueryRunner();
    const started = Date.now();
    try {
      await ensureMigrationsTable(qr);
      await qr.startTransaction();
      await m.up(qr);
      await qr.query(`INSERT INTO "migrations" ("timestamp","name") VALUES ($1,$2)`, [
        extractVersion(name),
        name,
      ]);
      await qr.commitTransaction();
      await tracker.finish(runId, 'success', Date.now() - started);
      applied.push(name);
      console.log(`✔ ${name} (${Date.now() - started}ms)`);
    } catch (err: any) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await tracker.finish(runId, 'failed', Date.now() - started, String(err?.message ?? err));
      console.error(`✖ ${name} failed: ${err?.message}`);
      if (backupFile) console.error(`Restore with: npm run migration:restore -- --file ${backupFile}`);
      throw err;
    } finally {
      await qr.release();
    }
  }

  const result = await validateSchema(AppDataSource);
  if (!result.ok) {
    console.error('✖ Post-migration validation failed', result);
    throw new Error('Migration validation failed');
  }
  console.log('✔ Post-migration validation passed');

  if (!flag('no-docs')) {
    const after = await snapshotSchema(AppDataSource);
    writeSchemaDoc(applied, diffSchemas(before, after));
  }
}

function writeSchemaDoc(applied: string[], diff: string) {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
  const version = extractVersion(applied[applied.length - 1]);
  const file = join(DOCS_DIR, `${version}.md`);
  writeFileSync(
    file,
    `# Schema change ${version}\n\n` +
      `- Environment: ${ENV}\n- Applied at: ${new Date().toISOString()}\n` +
      `- Commit: ${process.env.GITHUB_SHA ?? 'local'}\n\n` +
      `## Migrations\n\n${applied.map((a) => `- \`${a}\``).join('\n')}\n\n` +
      `## Structural diff\n\n${diff}\n`,
  );
  console.log(`Schema change documented in ${file}`);
}

async function revert() {
  const steps = parseInt(opt('steps', '1')!, 10);
  const tracker = new MigrationTracker(AppDataSource);
  await tracker.ensureTable();
  const executed = (await executedNames()).reverse().slice(0, steps);
  const byName = new Map((AppDataSource.migrations as Named[]).map((m) => [nameOf(m), m]));

  for (const name of executed) {
    const m = byName.get(name);
    if (!m) throw new Error(`Migration source for ${name} not found`);
    const runId = await tracker.start({
      migrationName: name,
      version: extractVersion(name),
      direction: 'down',
      status: 'running',
      environment: ENV,
      executedBy: process.env.USER ?? process.env.GITHUB_ACTOR ?? 'unknown',
      gitSha: process.env.GITHUB_SHA ?? null,
    });
    const qr = AppDataSource.createQueryRunner();
    const started = Date.now();
    try {
      await qr.startTransaction();
      await m.down(qr);
      await qr.query(`DELETE FROM "migrations" WHERE "name" = $1`, [name]);
      await qr.commitTransaction();
      await tracker.finish(runId, 'success', Date.now() - started);
      console.log(`↩ Reverted ${name}`);
    } catch (err: any) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await tracker.finish(runId, 'failed', Date.now() - started, String(err?.message ?? err));
      throw err;
    } finally {
      await qr.release();
    }
  }
}

async function testMigrations() {
  if (IS_PROD) throw new Error('migration:test must not be run against production');
  const pending = await pendingMigrations();
  if (!pending.length) {
    console.log('No pending migrations to test.');
    return;
  }
  const tracker = new MigrationTracker(AppDataSource);
  await tracker.ensureTable();
  const qr = AppDataSource.createQueryRunner();
  await qr.startTransaction();
  let failed = false;
  try {
    for (const m of pending) {
      const name = nameOf(m);
      const started = Date.now();
      const runId = await tracker.start({
        migrationName: name, version: extractVersion(name), direction: 'test',
        status: 'running', environment: ENV,
      });
      try {
        await qr.query(`SAVEPOINT mig_test`);
        await m.up(qr);
        await m.down(qr);
        await m.up(qr);
        await qr.query(`RELEASE SAVEPOINT mig_test`);
        console.log(`✔ ${name}: up → down → up OK`);
        await tracker.finish(runId, 'success', Date.now() - started);
      } catch (err: any) {
        failed = true;
        await qr.query(`ROLLBACK TO SAVEPOINT mig_test`);
        console.error(`✖ ${name}: ${err?.message}`);
        await tracker.finish(runId, 'failed', Date.now() - started, String(err?.message ?? err));
        break;
      }
    }
  } finally {
    // Always roll back — tests never leave changes behind. Tracker rows are
    // written on a separate connection so they persist.
    await qr.rollbackTransaction();
    await qr.release();
  }
  if (failed) throw new Error('Migration test failed');
}

async function main() {
  if (command === 'lint') {
    const findings = lintMigrations(MIGRATIONS_DIR);
    findings.forEach((f) => console.log(`${f.level === 'error' ? '✖' : '⚠'} ${f.file}: ${f.message}`));
    if (findings.some((f) => f.level === 'error') && flag('strict')) process.exit(1);
    console.log(`${findings.length} finding(s)`);
    return;
  }
  if (command === 'restore') {
    const file = opt('file');
    if (!file) throw new Error('--file is required');
    restoreDatabase(connectionInfo(), file);
    console.log('Restore complete');
    return;
  }

  await AppDataSource.initialize();
  try {
    switch (command) {
      case 'status': await status(); break;
      case 'run': await run(); break;
      case 'revert': await revert(); break;
      case 'test': await testMigrations(); break;
      case 'validate': {
        const r = await validateSchema(AppDataSource);
        console.log(JSON.stringify(r, null, 2));
        if (!r.ok) process.exitCode = 1;
        break;
      }
      case 'history': {
        const t = new MigrationTracker(AppDataSource);
        await t.ensureTable();
        console.table(await t.history(parseInt(opt('limit', '50')!, 10)));
        break;
      }
      case 'analytics': {
        const t = new MigrationTracker(AppDataSource);
        await t.ensureTable();
        console.log(JSON.stringify(await t.analytics(), null, 2));
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
