// Shared Postgres runtime-store helper.
//
// SIGMA_CONTROL_STORE=postgres moves migrated runtime surfaces to Postgres.
// Default behavior remains SQLite through each facade module.

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { POSTGRES_SCHEMA_SQL } from '../db/postgres-schema.js';

type ControlStoreMode = 'sqlite' | 'postgres';

let pool: Pool | undefined;
let schemaReady: Promise<void> | undefined;

export function controlStoreMode(): ControlStoreMode {
  const raw = (process.env.SIGMA_CONTROL_STORE ?? 'sqlite').trim().toLowerCase();
  if (raw === 'sqlite' || raw === 'postgres') return raw;
  throw new Error(`Invalid SIGMA_CONTROL_STORE '${raw}'. Use 'sqlite' or 'postgres'.`);
}

export function usingPostgresControlStore(): boolean {
  return controlStoreMode() === 'postgres';
}

function postgresConnectionString(): string {
  const url =
    process.env.DATABASE_URL ??
    process.env.DATABASE_PUBLIC_URL ??
    process.env.POSTGRES_MIGRATION_URL;

  if (!url) {
    throw new Error('SIGMA_CONTROL_STORE=postgres requires DATABASE_URL or DATABASE_PUBLIC_URL');
  }
  return url;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: postgresConnectionString() });
  }
  return pool;
}

async function ensurePostgresSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = getPool();
      for (const statement of POSTGRES_SCHEMA_SQL) {
        await client.query(statement);
      }
    })().catch((err) => {
      schemaReady = undefined;
      throw err;
    });
  }
  await schemaReady;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  await ensurePostgresSchema();
  return getPool().query<T>(text, values);
}

export async function withPostgresClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensurePostgresSchema();
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
