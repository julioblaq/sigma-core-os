// core/memory/index.ts
// Namespaced key-value store backed by SQLite (node-sqlite3-wasm).
// Slice 2b: full rewrite - MemEntry type, memList, memClear added.

import { db } from '../db.js';

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS memory (
    namespace  TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    written_by TEXT NOT NULL,
    written_at TEXT NOT NULL,
    PRIMARY KEY (namespace, key)
  )
`);

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface MemEntry {
  namespace: string;
  key: string;
  value: unknown;
  writtenBy: string;
  writtenAt: string;
}

// -------------------------------------------------------------------------
// Internal mapper
// -------------------------------------------------------------------------

function toEntry(r: Record<string, unknown>): MemEntry {
  return {
    namespace: r['namespace'] as string,
    key:       r['key']       as string,
    value:     JSON.parse(r['value'] as string),
    writtenBy: r['written_by'] as string,
    writtenAt: r['written_at'] as string,
  };
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

// Write (upsert) a value under namespace/key.
export function memSet(
  namespace: string,
  key: string,
  value: unknown,
  writtenBy: string,
): void {
  db.run(
    `INSERT INTO memory (namespace, key, value, written_by, written_at)
     VALUES (:ns, :key, :val, :by, :at)
     ON CONFLICT(namespace, key) DO UPDATE SET
       value      = excluded.value,
       written_by = excluded.written_by,
       written_at = excluded.written_at`,
    {
      ':ns':  namespace,
      ':key': key,
      ':val': JSON.stringify(value),
      ':by':  writtenBy,
      ':at':  new Date().toISOString(),
    },
  );
}

// Read a single entry. Returns null if not found.
export function memGet(namespace: string, key: string): MemEntry | null {
  const row = db.get(
    'SELECT * FROM memory WHERE namespace = :ns AND key = :key',
    { ':ns': namespace, ':key': key },
  );
  return row ? toEntry(row) : null;
}

// Delete a single key. No-op if it does not exist.
export function memDel(namespace: string, key: string): void {
  db.run(
    'DELETE FROM memory WHERE namespace = :ns AND key = :key',
    { ':ns': namespace, ':key': key },
  );
}

// List all entries in a namespace, ordered by key.
export function memList(namespace: string): MemEntry[] {
  return db
    .all('SELECT * FROM memory WHERE namespace = :ns ORDER BY key ASC', { ':ns': namespace })
    .map(toEntry);
}

// Delete all entries in a namespace.
export function memClear(namespace: string): void {
  db.run('DELETE FROM memory WHERE namespace = :ns', { ':ns': namespace });
}
