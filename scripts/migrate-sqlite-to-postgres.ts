import { createRequire } from 'module';
import path from 'path';
import { Client } from 'pg';
import {
  MIGRATION_TABLES,
  POSTGRES_SCHEMA_SQL,
  MigrationTable,
  quoteIdent,
} from '../core/db/postgres-schema.js';

const require = createRequire(import.meta.url);
const { Database } = require('node-sqlite3-wasm') as {
  Database: new (path: string) => SQLiteDB;
};

interface SQLiteDB {
  get(sql: string, params?: Record<string, unknown>): Record<string, unknown> | undefined;
  all(sql: string, params?: Record<string, unknown>): Record<string, unknown>[];
  close(): void;
}

interface TableReport {
  table: string;
  sqliteRows: number;
  postgresRows?: number;
  copiedRows?: number;
  status: 'missing-source' | 'dry-run' | 'ok' | 'mismatch';
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const verifyOnly = args.has('--verify-only');
const truncate = args.has('--truncate');

const sqlitePath = path.resolve(process.env.SQLITE_PATH ?? process.env.DB_PATH ?? './sigma.db');
const postgresUrl =
  process.env.POSTGRES_MIGRATION_URL ??
  process.env.DATABASE_PUBLIC_URL ??
  process.env.DATABASE_URL;

function usageText(): string {
  return [
    'Usage: npm run db:migrate:postgres -- [--dry-run] [--verify-only] [--truncate]',
    '',
    'Environment:',
    '  SQLITE_PATH or DB_PATH points at the source SQLite file.',
    '  POSTGRES_MIGRATION_URL, DATABASE_PUBLIC_URL, or DATABASE_URL points at Postgres.',
    '',
    'Notes:',
    '  --dry-run reads SQLite counts only and does not connect to Postgres.',
    '  --verify-only compares counts and does not copy rows.',
    '  --truncate clears destination tables before copying.',
  ].join('\n');
}

function tableExists(sqlite: SQLiteDB, tableName: string): boolean {
  const row = sqlite.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = :name",
    { ':name': tableName },
  );
  return !!row;
}

function sqliteSelectSql(table: MigrationTable): string {
  const columns = table.columns.map(quoteIdent).join(', ');
  const order = table.orderBy ? ` ORDER BY ${table.orderBy}` : '';
  return `SELECT ${columns} FROM ${quoteIdent(table.name)}${order}`;
}

function pgInsertSql(table: MigrationTable): string {
  const columns = table.columns.map(quoteIdent).join(', ');
  const placeholders = table.columns.map((_, i) => `$${i + 1}`).join(', ');
  const conflict = table.conflictTarget.map(quoteIdent).join(', ');
  const updates = table.columns
    .filter(column => !table.conflictTarget.includes(column))
    .map(column => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
    .join(', ');

  const updateClause = updates ? `DO UPDATE SET ${updates}` : 'DO NOTHING';
  return `INSERT INTO ${quoteIdent(table.name)} (${columns}) VALUES (${placeholders}) ON CONFLICT (${conflict}) ${updateClause}`;
}

async function createPostgresSchema(client: Client): Promise<void> {
  for (const sql of POSTGRES_SCHEMA_SQL) {
    await client.query(sql);
  }
}

async function truncatePostgresTables(client: Client): Promise<void> {
  const tables = [...MIGRATION_TABLES].reverse().map(table => quoteIdent(table.name)).join(', ');
  await client.query(`TRUNCATE ${tables}`);
}

async function postgresCount(client: Client, tableName: string): Promise<number> {
  const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoteIdent(tableName)}`);
  return Number(result.rows[0]?.count ?? 0);
}

function sqliteRows(sqlite: SQLiteDB, table: MigrationTable): Record<string, unknown>[] {
  if (!tableExists(sqlite, table.name)) return [];
  return sqlite.all(sqliteSelectSql(table));
}

function sqliteCount(sqlite: SQLiteDB, tableName: string): number {
  if (!tableExists(sqlite, tableName)) return 0;
  const row = sqlite.get(`SELECT COUNT(*) AS count FROM ${quoteIdent(tableName)}`);
  return Number(row?.['count'] ?? 0);
}

async function migrateTable(client: Client, table: MigrationTable, rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const insertSql = pgInsertSql(table);
  let copied = 0;
  for (const row of rows) {
    const values = table.columns.map(column => row[column] ?? null);
    await client.query(insertSql, values);
    copied++;
  }
  return copied;
}

function printReports(reports: TableReport[]): void {
  console.table(reports);
}

async function main(): Promise<void> {
  if (args.has('--help') || args.has('-h')) {
    console.log(usageText());
    return;
  }

  const sqlite = new Database(sqlitePath);
  console.log(`[migrate] source sqlite=${sqlitePath}`);

  if (dryRun) {
    const reports = MIGRATION_TABLES.map(table => ({
      table: table.name,
      sqliteRows: sqliteCount(sqlite, table.name),
      status: tableExists(sqlite, table.name) ? 'dry-run' as const : 'missing-source' as const,
    }));
    printReports(reports);
    sqlite.close();
    return;
  }

  if (!postgresUrl) {
    sqlite.close();
    throw new Error('Postgres URL is required. Set POSTGRES_MIGRATION_URL, DATABASE_PUBLIC_URL, or DATABASE_URL.');
  }

  const client = new Client({ connectionString: postgresUrl });
  await client.connect();
  console.log('[migrate] connected to postgres');

  try {
    await client.query('BEGIN');
    await createPostgresSchema(client);
    if (truncate && !verifyOnly) {
      console.log('[migrate] truncating destination tables');
      await truncatePostgresTables(client);
    }

    const reports: TableReport[] = [];
    for (const table of MIGRATION_TABLES) {
      const exists = tableExists(sqlite, table.name);
      const rows = sqliteRows(sqlite, table);
      const copiedRows = verifyOnly ? 0 : await migrateTable(client, table, rows);
      const pgRows = await postgresCount(client, table.name);
      const status = !exists ? 'missing-source' : pgRows === rows.length ? 'ok' : 'mismatch';
      reports.push({
        table: table.name,
        sqliteRows: rows.length,
        postgresRows: pgRows,
        copiedRows,
        status,
      });
    }

    const mismatches = reports.filter(report => report.status === 'mismatch');
    if (mismatches.length > 0) {
      printReports(reports);
      throw new Error(`Postgres verification failed for ${mismatches.map(r => r.table).join(', ')}`);
    }

    await client.query('COMMIT');
    printReports(reports);
    console.log(verifyOnly ? '[migrate] verification complete' : '[migrate] migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    sqlite.close();
    await client.end();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
