// core/runtime/index.ts
// Logs final task outcomes after approval resolution.
// Slice 2: reason field added for denial records.
// Slice 3d: executeWrite() - executes sandboxed file write for approved dev_task artifacts.

import { randomUUID } from 'crypto';
import { db } from '../db.js';
import type { Approval } from '../policies/index.js';
import {
  executeSandboxWrite,
  SandboxWriteResult,
  SandboxViolationError,
} from '../sandbox/index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS outcome_log (
    id          TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL,
    task_type   TEXT NOT NULL,
    agent       TEXT NOT NULL,
    outcome     TEXT NOT NULL,
    resolved_by TEXT,
    reason      TEXT,
    logged_at   TEXT NOT NULL
  )
`);

// Add reason column if upgrading from slice-1 DB (idempotent)
try { db.exec('ALTER TABLE outcome_log ADD COLUMN reason TEXT'); } catch { /* already exists */ }

export interface OutcomeEntry {
  id: string;
  approvalId: string;
  taskType: string;
  agent: string;
  outcome: 'approved' | 'denied';
  resolvedBy?: string;
  reason?: string;
  loggedAt: string;
}

export function logOutcome(approval: Approval, taskType: string): OutcomeEntry {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO outcome_log
      (id, approval_id, task_type, agent, outcome, resolved_by, reason, logged_at)
     VALUES (:id, :aid, :type, :agent, :outcome, :by, :reason, :at)`,
    {
      ':id':      id,
      ':aid':     approval.id,
      ':type':    taskType,
      ':agent':   approval.agent,
      ':outcome': approval.status,
      ':by':      approval.resolvedBy ?? null,
      ':reason':  approval.reason ?? null,
      ':at':      now,
    },
  );
  console.log(`[runtime] outcome=${approval.status} approval=${approval.id}`);
  return {
    id,
    approvalId:  approval.id,
    taskType,
    agent:       approval.agent,
    outcome:     approval.status as 'approved' | 'denied',
    resolvedBy:  approval.resolvedBy,
    reason:      approval.reason,
    loggedAt:    now,
  };
}

export function getLog(): OutcomeEntry[] {
  return db.all('SELECT * FROM outcome_log ORDER BY logged_at DESC').map(r => ({
    id:          r['id'] as string,
    approvalId:  r['approval_id'] as string,
    taskType:    r['task_type'] as string,
    agent:       r['agent'] as string,
    outcome:     r['outcome'] as 'approved' | 'denied',
    resolvedBy:  r['resolved_by'] as string | undefined,
    reason:      r['reason'] as string | undefined,
    loggedAt:    r['logged_at'] as string,
  }));
}

// ---------------------------------------------------------------------------
// Slice 3d: executeWrite
// Called after an approval is resolved to write a Sigma Dev artifact to disk.
//
// Rules:
//   - Approval must be 'approved' status (denied = no write, log only)
//   - Approval payload must contain an artifact with filePath and content
//   - Delegates all path safety to core/sandbox
//   - Returns the SandboxWriteResult for the caller to include in API response
// ---------------------------------------------------------------------------

export type WriteResult =
  | { outcome: 'written';  sandboxResult: SandboxWriteResult }
  | { outcome: 'denied';   reason: string }
  | { outcome: 'skipped';  reason: string }
  | { outcome: 'blocked';  error: string };

export function executeWrite(approval: Approval): WriteResult {
  // Only approved dev_task write actions proceed
  if (approval.status !== 'approved') {
    console.log(`[runtime] write skipped: approval ${approval.id} status=${approval.status}`);
    return { outcome: 'denied', reason: approval.reason ?? 'not approved' };
  }

  // Extract artifact from approval payload
  const payload  = approval.payload as Record<string, unknown>;
  const artifact = payload.artifact as Record<string, unknown> | undefined;

  if (!artifact || !artifact.requiresWrite) {
    // Not a write artifact (e.g. explain_code result stored in approval) - skip silently
    return { outcome: 'skipped', reason: 'approval payload has no writable artifact' };
  }

  const filePath = artifact.filePath as string | undefined;
  const content  = artifact.content  as string | undefined;
  const action   = artifact.action   as string | undefined;

  if (!filePath || !content || !action) {
    return { outcome: 'blocked', error: 'artifact missing filePath, content, or action' };
  }

  const overwriteApproved = !!(payload.overwriteApproved ?? artifact.overwriteApproved ?? false);

  try {
    const sandboxResult = executeSandboxWrite(
      approval.id,
      action,
      approval.agent,
      filePath,
      content,
      approval.resolvedBy,
      overwriteApproved,
    );
    return { outcome: 'written', sandboxResult };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runtime] sandbox write blocked: ${msg}`);
    return { outcome: 'blocked', error: msg };
  }
}
