/**
 * core/memory/index.ts
 * Namespaced key-value store backed by SQLite.
 * Stub — rewrite in slice 2.
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve(process.env.DB_PATH ?? './sigma.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS memory (
      namespace TEXT NOT NULL,
          key       TEXT NOT NULL,
              value     TEXT NOT NULL,
                  written_by TEXT NOT NULL,
                      written_at TEXT NOT NULL,
                          PRIMARY KEY (namespace, key)
                            )
                            `);

const upsert = db.prepare(`
  INSERT INTO memory (namespace, key, value, written_by, written_at)
    VALUES (@namespace, @key, @value, @written_by, @written_at)
      ON CONFLICT(namespace, key) DO UPDATE SET
          value = excluded.value,
              written_by = excluded.written_by,
                  written_at = excluded.written_at
                  `);

const read  = db.prepare('SELECT value FROM memory WHERE namespace = ? AND key = ?');
const delKV = db.prepare('DELETE FROM memory WHERE namespace = ? AND key = ?');

export function memSet(namespace: string, key: string, value: unknown, writtenBy: string): void {
   upsert.run({ namespace, key, value: JSON.stringify(value), written_by: writtenBy, written_at: new Date().toISOString() });
}

export function memGet(namespace: string, key: string): unknown | null {
   const row = read.get(namespace, key) as { value: string } | undefined;
   return row ? JSON.parse(row.value) : null;
}

export function memDel(namespace: string, key: string): void {
   delKV.run(namespace, key);
}
