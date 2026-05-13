/**
 * core/db.ts
  * Shared SQLite handle — opened once, imported everywhere.
   * Uses node-sqlite3-wasm: pure WASM, no native build needed.
    *
     * node-sqlite3-wasm exposes a synchronous API identical to better-sqlite3
      * AFTER the initial async open. We open eagerly at module load time using
       * a top-level await (works because package.json has "type":"module" and
        * tsx handles ESM top-level await fine).
         */

import { default as sqlite3 } from 'node-sqlite3-wasm';
import path from 'path';

const DB_PATH = path.resolve(process.env.DB_PATH ?? './sigma.db');

// node-sqlite3-wasm: new sqlite3.Database(path) — synchronous constructor
export const db = new sqlite3.Database(DB_PATH);

console.log(`[db] opened ${DB_PATH}`);
