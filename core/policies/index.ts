/**
 * core/policies/index.ts
 * Approval queue backed by SQLite via better-sqlite3.
 * One table: approvals(id, agent, action, description, payload_json, status, created_at, resolved_at, resolved_by)
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export interface Approval {
    id: string;
    agent: string;
    action: string;
    description: string;
    payload: Record<string, unknown>;
    status: ApprovalStatus;
    createdAt: string;
    resolvedAt?: string;
    resolvedBy?: string;
}

const DB_PATH = path.resolve(process.env.DB_PATH ?? './sigma.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS approvals (
      id          TEXT PRIMARY KEY,
          agent       TEXT NOT NULL,
              action      TEXT NOT NULL,
                  description TEXT NOT NULL,
                      payload     TEXT NOT NULL,
                          status      TEXT NOT NULL DEFAULT 'pending',
                              created_at  TEXT NOT NULL,
                                  resolved_at TEXT,
                                      resolved_by TEXT
                                        )
                                        `);

const insert = db.prepare(`
  INSERT INTO approvals (id, agent, action, description, payload, status, created_at)
    VALUES (@id, @agent, @action, @description, @payload, 'pending', @created_at)
    `);

const resolve = db.prepare(`
  UPDATE approvals
    SET status = @status, resolved_at = @resolved_at, resolved_by = @resolved_by
      WHERE id = @id AND status = 'pending'
      `);

const getById  = db.prepare('SELECT * FROM approvals WHERE id = ?');
const getPending = db.prepare("SELECT * FROM approvals WHERE status = 'pending'");

function row(r: Record<string, unknown>): Approval {
    return {
          id:          r.id as string,
          agent:       r.agent as string,
          action:      r.action as string,
          description: r.description as string,
          payload:     JSON.parse(r.payload as string),
          status:      r.status as ApprovalStatus,
          createdAt:   r.created_at as string,
          resolvedAt:  r.resolved_at as string | undefined,
          resolvedBy:  r.resolved_by as string | undefined,
    };
}

export function requestApproval(
    agent: string,
    action: string,
    description: string,
    payload: Record<string, unknown>,
  ): Approval {
    const id = randomUUID();
    const now = new Date().toISOString();
    insert.run({ id, agent, action, description, payload: JSON.stringify(payload), created_at: now });
    console.log(`[policies] approval queued  id=${id}  action=${action}`);
    return row(getById.get(id) as Record<string, unknown>);
}

export function resolveApproval(id: string, approved: boolean, resolvedBy: string): Approval | null {
    const existing = getById.get(id) as Record<string, unknown> | undefined;
    if (!existing || existing.status !== 'pending') return null;
    const status: ApprovalStatus = approved ? 'approved' : 'denied';
    resolve.run({ id, status, resolved_at: new Date().toISOString(), resolved_by: resolvedBy });
    const updated = row(getById.get(id) as Record<string, unknown>);
    console.log(`[policies] approval ${status}  id=${id}  by=${resolvedBy}`);
    return updated;
}

export function listPending(): Approval[] {
    return (getPending.all() as Record<string, unknown>[]).map(row);
}

export function getApproval(id: string): Approval | null {
    const r = getById.get(id) as Record<string, unknown> | undefined;
    return r ? row(r) : null;
}
