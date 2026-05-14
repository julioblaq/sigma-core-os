// core/policies/index.ts
// SQLite-backed approval queue via node-sqlite3-wasm.
// Slice 2: deny flow - reason field, immutability enforced.
// NOTE: SQLite TEXT columns return null (not undefined) for missing values.
// toApproval() normalizes null -> undefined so strict equality against undefined works.

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
  reason?: string;
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
    resolved_by TEXT,
    reason      TEXT
  )
`);

// Add reason column if upgrading from slice-1 DB (idempotent)
try {
  db.exec('ALTER TABLE approvals ADD COLUMN reason TEXT');
} catch {
  // column already exists - safe to ignore
}

// Helper: normalize null -> undefined for optional string fields
function orUndef(v: unknown): string | undefined {
  return (v === null || v === undefined) ? undefined : v as string;
}

function toApproval(r: Record<string, unknown>): Approval {
  return {
    id: r['id'] as string,
    agent: r['agent'] as string,
    action: r['action'] as string,
    description: r['description'] as string,
    payload: JSON.parse(r['payload'] as string),
    status: r['status'] as ApprovalStatus,
    createdAt: r['created_at'] as string,
    resolvedAt: orUndef(r['resolved_at']),
    resolvedBy: orUndef(r['resolved_by']),
    reason:     orUndef(r['reason']),
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
    { ':id': id, ':agent': agent, ':action': action,
      ':description': description, ':payload': JSON.stringify(payload), ':now': now },
  );
  console.log(`[policies] queued id=${id} action=${action}`);
  return toApproval(db.get('SELECT * FROM approvals WHERE id = :id', { ':id': id })!);
}

// Resolve an approval as approved or denied.
// Returns null if the record does not exist OR is already resolved (immutability).
// reason is required when approved === false.
export function resolveApproval(
  id: string,
  approved: boolean,
  resolvedBy: string,
  reason?: string,
): Approval | null {
  const row = db.get('SELECT * FROM approvals WHERE id = :id', { ':id': id });
  if (!row || row['status'] !== 'pending') return null;

  const status: ApprovalStatus = approved ? 'approved' : 'denied';
  const now = new Date().toISOString();

  db.run(
    `UPDATE approvals
     SET status = :status, resolved_at = :now, resolved_by = :by, reason = :reason
     WHERE id = :id`,
    { ':status': status, ':now': now, ':by': resolvedBy,
      ':reason': reason ?? null, ':id': id },
  );

  console.log(`[policies] ${status} id=${id} by=${resolvedBy}`);
  return toApproval(db.get('SELECT * FROM approvals WHERE id = :id', { ':id': id })!);
}

export function listPending(): Approval[] {
  return db.all("SELECT * FROM approvals WHERE status = 'pending'").map(toApproval);
}

export function getApproval(id: string): Approval | null {
  const row = db.get('SELECT * FROM approvals WHERE id = :id', { ':id': id });
  return row ? toApproval(row) : null;
}
