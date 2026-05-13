/**
 * core/db.ts
 * Shared SQLite handle — opened once at startup, imported everywhere.
 * node-sqlite3-wasm: pure WASM, no native build, no Xcode required.
 *
 * API (synchronous after open):
 *   db.run(sql, params?)   — INSERT / UPDATE / DELETE, params: { ':name': value }
 *   db.get(sql, params?)   — SELECT single row → object | undefined
 *   db.all(sql, params?)   — SELECT all rows   → object[]
 *   db.exec(sql)           — run DDL / multi-statement
 */

import { createRequire } from 'module';
import path from 'path';

// node-sqlite3-wasm ships as CJS; use createRequire for ESM compat
const require = createRequire(import.meta.url);
const { Database } = require('node-sqlite3-wasm') as {
   Database: new (path: string) => NodeSQLite3DB;
};

export interface NodeSQLite3DB {
   exec(sql: string): void;
   run(sql: string, params?: Record<string, unknown>): void;
   get(sql: string, params?: Record<string, unknown>): Record<string, unknown> | undefined;
   all(sql: string, params?: Record<string, unknown>): Record<string, unknown>[];
   close(): void;
}

const DB_PATH = path.resolve(process.env.DB_PATH ?? './sigma.db');
export const db: NodeSQLite3DB = new Database(DB_PATH);

console.log(`[db] opened ${DB_PATH}`);
