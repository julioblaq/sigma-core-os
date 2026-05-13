/**
 * core/policies/index.ts
 * SQLite-backed approval queue via node-sqlite3-wasm.
 */

import { randomUUID } from 'crypto';
import { db } from '../db.js';

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

function toApproval(r: Record<string, unknown>): Approval {
      return {
              id:          r['id'] as string,
              agent:       r['agent'] as string,
              action:      r['action'] as string,
              description: r['description'] as string,
              payload:     JSON.parse(r['payload'] as string),
              status:      r['status'] as ApprovalStatus,
              createdAt:   r['created_at'] as string,
              resolvedAt:  r['resolved_at'] as string | undefined,
              resolvedBy:  r['resolved_by'] as string | undefined,
      };
}

export function requestApproval(
      agent: string,
      action: string,
      description: string,
      payload: Record<string, unknown>,
    ): Approval {
      const id  = randomUUID();
      const now = new Date().toISOString();
      db.run(
              `INSERT INTO approvals (id, agent, action, description, payload, status, created_at)
                   VALUES (:id, :agent, :action, :description, :payload, 'pending', :now)`,
          { ':id': id, ':agent': agent, ':action': action, ':description': description,
                 ':payload': JSON.stringify(payload), ':now': now },
            );
      console.log(`[policies] queued  id=${id}  action=${action}`);
      return toApproval(db.get('SELECT * FROM approvals WHERE id = :id', { ':id': id })!);
}

export function resolveApproval(id: string, approved: boolean, resolvedBy: string): Approval | null {
      const row = db.get('SELECT * FROM approvals WHERE id = :id', { ':id': id });
      if (!row || row['status'] !== 'pending') return null;
      const status: ApprovalStatus = approved ? 'approved' : 'denied';
      const now = new Date().toISOString();
      db.run(
              `UPDATE approvals SET status = :status, resolved_at = :now, resolved_by = :by
                   WHERE id = :id`,
          { ':status': status, ':now': now, ':by': resolvedBy, ':id': id },
            );
      console.log(`[policies] ${status}  id=${id}  by=${resolvedBy}`);
      return toApproval(db.get('SELECT * FROM approvals WHERE id = :id', { ':id': id })!);
}

export function listPending(): Approval[] {
      return db.all("SELECT * FROM approvals WHERE status = 'pending'").map(toApproval);
}

export function getApproval(id: string): Approval | null {
      const row = db.get('SELECT * FROM approvals WHERE id = :id', { ':id': id });
      return row ? toApproval(row) : null;
}
