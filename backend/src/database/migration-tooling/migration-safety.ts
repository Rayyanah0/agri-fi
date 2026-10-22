import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';

export interface ConnectionInfo {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/**
 * Creates a compressed logical backup (pg_dump custom format) before any
 * schema change. Returns the path to the dump file.
 */
export function backupDatabase(conn: ConnectionInfo, dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${conn.database}-pre-migration-${stamp}.dump`);
  execFileSync(
    'pg_dump',
    [
      '-h', conn.host,
      '-p', String(conn.port),
      '-U', conn.username,
      '-d', conn.database,
      '-Fc',
      '-f', file,
    ],
    { env: { ...process.env, PGPASSWORD: conn.password }, stdio: 'inherit' },
  );
  return file;
}

/** Restores a dump produced by {@link backupDatabase}. */
export function restoreDatabase(conn: ConnectionInfo, file: string): void {
  execFileSync(
    'pg_restore',
    [
      '-h', conn.host,
      '-p', String(conn.port),
      '-U', conn.username,
      '-d', conn.database,
      '--clean',
      '--if-exists',
      file,
    ],
    { env: { ...process.env, PGPASSWORD: conn.password }, stdio: 'inherit' },
  );
}

export interface LintFinding {
  file: string;
  level: 'error' | 'warning';
  message: string;
}

const RISKY_PATTERNS: { re: RegExp; level: 'error' | 'warning'; message: string }[] = [
  { re: /DROP\s+TABLE(?!\s+IF\s+EXISTS)/i, level: 'warning', message: 'DROP TABLE without IF EXISTS' },
  { re: /DROP\s+COLUMN/i, level: 'warning', message: 'DROP COLUMN is destructive — ensure data is backed up / column is unused' },
  { re: /TRUNCATE\s/i, level: 'error', message: 'TRUNCATE in a migration destroys data' },
  { re: /ALTER\s+COLUMN\s+\S+\s+TYPE/i, level: 'warning', message: 'Column type change may rewrite the table and take an ACCESS EXCLUSIVE lock' },
  { re: /CREATE\s+(UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)/i, level: 'warning', message: 'CREATE INDEX without CONCURRENTLY locks writes on large tables' },
  { re: /SET\s+NOT\s+NULL/i, level: 'warning', message: 'SET NOT NULL scans the full table; backfill first' },
];

/**
 * Static validation of migration source files: every migration must
 * implement a non-empty `down()` (rollback capability) and is scanned for
 * risky DDL patterns.
 */
export function lintMigrations(dir: string): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f))) {
    const src = readFileSync(join(dir, file), 'utf8');
    const downMatch = src.match(/async\s+down\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s{2}\}/);
    if (!downMatch) {
      findings.push({ file, level: 'error', message: 'Missing down() — migration cannot be rolled back' });
    } else if (!/queryRunner\.\w+/.test(downMatch[1])) {
      findings.push({ file, level: 'warning', message: 'down() appears to be empty — rollback is a no-op' });
    }
    const upMatch = src.match(/async\s+up\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s{2}\}/);
    const upBody = upMatch ? upMatch[1] : src;
    for (const p of RISKY_PATTERNS) {
      if (p.re.test(upBody)) findings.push({ file, level: p.level, message: p.message });
    }
  }
  return findings;
}

export interface ValidationResult {
  ok: boolean;
  pending: string[];
  invalidIndexes: string[];
  invalidConstraints: string[];
}

/**
 * Post-migration validation: no pending migrations, no invalid indexes
 * (e.g. failed CONCURRENTLY builds) and no NOT VALID constraints left behind.
 */
export async function validateSchema(ds: DataSource): Promise<ValidationResult> {
  const executed: { name: string }[] = await ds.query(`SELECT name FROM migrations`);
  const executedSet = new Set(executed.map((r) => r.name));
  const pending = ds.migrations
    .map((m) => m.name ?? m.constructor.name)
    .filter((n) => !executedSet.has(n));

  const invalidIndexes = (
    await ds.query(`
      SELECT c.relname AS name FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE NOT i.indisvalid
    `)
  ).map((r: any) => r.name);

  const invalidConstraints = (
    await ds.query(`
      SELECT conname AS name FROM pg_constraint
      WHERE NOT convalidated AND connamespace = 'public'::regnamespace
    `)
  ).map((r: any) => r.name);

  return {
    ok: !pending.length && !invalidIndexes.length && !invalidConstraints.length,
    pending,
    invalidIndexes,
    invalidConstraints,
  };
}

/** Snapshot of public schema used for schema-change documentation. */
export async function snapshotSchema(
  ds: DataSource,
): Promise<Record<string, string[]>> {
  const rows: { table_name: string; column_name: string; data_type: string; is_nullable: string }[] =
    await ds.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    (out[r.table_name] ??= []).push(
      `${r.column_name} ${r.data_type}${r.is_nullable === 'NO' ? ' NOT NULL' : ''}`,
    );
  }
  return out;
}

/** Produces a markdown diff between two schema snapshots. */
export function diffSchemas(
  before: Record<string, string[]>,
  after: Record<string, string[]>,
): string {
  const lines: string[] = [];
  const tables = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const t of [...tables].sort()) {
    const b = new Set(before[t] ?? []);
    const a = new Set(after[t] ?? []);
    if (!before[t]) { lines.push(`- **Added table** \`${t}\``); continue; }
    if (!after[t]) { lines.push(`- **Dropped table** \`${t}\``); continue; }
    for (const c of a) if (!b.has(c)) lines.push(`- \`${t}\`: added/changed column \`${c}\``);
    for (const c of b) if (!a.has(c)) lines.push(`- \`${t}\`: removed/changed column \`${c}\``);
  }
  return lines.length ? lines.join('\n') : '_No structural changes._';
}
