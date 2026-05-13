/**
 * core/memory/index.ts
 * Namespaced key-value store via node-sqlite3-wasm. Stub — rewrite in slice 2.
 */

import { db } from '../db.js';

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

export function memSet(namespace: string, key: string, value: unknown, writtenBy: string): void {
    db.run(
          `INSERT INTO memory (namespace, key, value, written_by, written_at)
               VALUES (:ns, :key, :val, :by, :at)
                    ON CONFLICT(namespace, key) DO UPDATE SET
                           value = excluded.value, written_by = excluded.written_by, written_at = excluded.written_at`,
      { ':ns': namespace, ':key': key, ':val': JSON.stringify(value),
             ':by': writtenBy, ':at': new Date().toISOString() },
        );
}

export function memGet(namespace: string, key: string): unknown | null {
    const row = db.get(
          'SELECT value FROM memory WHERE namespace = :ns AND key = :key',
      { ':ns': namespace, ':key': key },
        );
    return row ? JSON.parse(row['value'] as string) : null;
}

export function memDel(namespace: string, key: string): void {
    db.run('DELETE FROM memory WHERE namespace = :ns AND key = :key',
           { ':ns': namespace, ':key': key });
}
