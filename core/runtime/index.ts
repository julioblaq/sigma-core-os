// core/runtime/index.ts
// Logs final task outcomes after approval resolution.
// Slice 2: reason field added for denial records.
// Slice 3d: executeWrite() - sandboxed file write for approved dev_task artifacts.
// Slice 3b: executeTrade() - paper broker submission for approved trade_plan.
// Slice 7d: searchLog() - audit log search with filters.

import { randomUUID } from 'crypto';
import { db } from '../db.js';
import type { Approval } from '../policies/index.js';
import {
  executeSandboxWrite,
  SandboxWriteResult,
  SandboxViolationError,
} from '../sandbox/index.js';
import {
  submitPaperOrder,
  PaperOrderResult,
  BrokerModeError,
  OrderValidationError,
} from '../broker/index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS outcome_log (
    id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    agent TEXT NOT NULL,
    outcome TEXT NOT NULL,
    resolved_by TEXT,
    reason TEXT,
    logged_at TEXT NOT NULL
  )
`);

// Add reason column if upgrading from slice-1 DB (idempotent)
try { db.exec('ALTER TABLE outcome_log ADD COLUMN reason TEXT'); } catch { /* already exists */ }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface LogSearchParams {
  agent?: string;
  action?: string;
  status?: 'approved' | 'denied';
  from?: string;
  to?: string;
  limit?: number;
}

export type WriteResult =
  | { outcome: 'written'; sandboxResult: SandboxWriteResult }
  | { outcome: 'denied'; reason: string }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'blocked'; error: string };

export type TradeResult =
  | { outcome: 'submitted'; orderResult: PaperOrderResult }
  | { outcome: 'denied'; reason: string }
  | { outcome: 'blocked'; error: string };

// ---------------------------------------------------------------------------
// logOutcome - append-only outcome record
// ---------------------------------------------------------------------------

export function logOutcome(approval: Approval, taskType: string): OutcomeEntry {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO outcome_log
      (id, approval_id, task_type, agent, outcome, resolved_by, reason, logged_at)
      VALUES (:id, :aid, :type, :agent, :outcome, :by, :reason, :at)`,
    {
      ':id': id,
      ':aid': approval.id,
      ':type': taskType,
      ':agent': approval.agent,
      ':outcome': approval.status,
      ':by': approval.resolvedBy ?? null,
      ':reason': approval.reason ?? null,
      ':at': now,
    },
  );
  console.log(`[runtime] outcome=${approval.status} approval=${approval.id}`);
  return {
    id,
    approvalId: approval.id,
    taskType,
    agent: approval.agent,
    outcome: approval.status as 'approved' | 'denied',
    resolvedBy: approval.resolvedBy,
    reason: approval.reason,
    loggedAt: now,
  };
}

function rowToEntry(r: Record<string, unknown>): OutcomeEntry {
  return {
    id: r['id'] as string,
    approvalId: r['approval_id'] as string,
    taskType: r['task_type'] as string,
    agent: r['agent'] as string,
    outcome: r['outcome'] as 'approved' | 'denied',
    resolvedBy: r['resolved_by'] as string | undefined,
    reason: r['reason'] as string | undefined,
    loggedAt: r['logged_at'] as string,
  };
}

export function getLog(): OutcomeEntry[] {
  return db.all('SELECT * FROM outcome_log ORDER BY logged_at DESC').map(rowToEntry);
}

// searchLog — read-only filtered query against outcome_log
// Filters: agent (exact), action/taskType (exact), status/outcome (exact),
//          from/to (ISO date string prefix, inclusive), limit (max 500)
export function searchLog(params: LogSearchParams): OutcomeEntry[] {
  const conditions: string[] = [];
  const bindings: Record<string, string | number> = {};

  if (params.agent) {
    conditions.push('agent = :agent');
    bindings[':agent'] = params.agent;
  }
  if (params.action) {
    conditions.push('task_type = :action');
    bindings[':action'] = params.action;
  }
  if (params.status) {
    conditions.push('outcome = :status');
    bindings[':status'] = params.status;
  }
  if (params.from) {
    conditions.push('logged_at >= :from');
    bindings[':from'] = params.from;
  }
  if (params.to) {
    conditions.push('logged_at <= :to');
    bindings[':to'] = params.to;
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = Math.min(params.limit ?? 100, 500);
  const sql = `SELECT * FROM outcome_log ${where} ORDER BY logged_at DESC LIMIT ${limit}`;

  return db.all(sql, Object.keys(bindings).length > 0 ? bindings : undefined).map(rowToEntry);
}

// ---------------------------------------------------------------------------
// executeWrite - sandboxed file write for approved dev_task artifacts
// ---------------------------------------------------------------------------

export function executeWrite(approval: Approval): WriteResult {
  if (approval.status !== 'approved') {
    console.log(`[runtime] write skipped: approval ${approval.id} status=${approval.status}`);
    return { outcome: 'denied', reason: approval.reason ?? 'not approved' };
  }

  const payload = approval.payload as Record<string, unknown>;
  const artifact = payload.artifact as Record<string, unknown> | undefined;

  if (!artifact || !artifact.requiresWrite) {
    return { outcome: 'skipped', reason: 'approval payload has no writable artifact' };
  }

  const filePath = artifact.filePath as string | undefined;
  const content = artifact.content as string | undefined;
  const action = artifact.action as string | undefined;

  if (!filePath || !content || !action) {
    return { outcome: 'blocked', error: 'artifact missing filePath, content, or action' };
  }

  const overwriteApproved = !!(payload.overwriteApproved ?? artifact.overwriteApproved ?? false);

  try {
    const sandboxResult = executeSandboxWrite(
      approval.id, action, approval.agent, filePath, content,
      approval.resolvedBy, overwriteApproved,
    );
    return { outcome: 'written', sandboxResult };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runtime] sandbox write blocked: ${msg}`);
    return { outcome: 'blocked', error: msg };
  }
}

// ---------------------------------------------------------------------------
// executeTrade - paper broker submission for approved trade_plan
//
// Called after a trade_plan approval is resolved.
// Denied = no order submitted, outcome logged.
// Approved = signal extracted from payload, validated, submitted to paper broker.
// ---------------------------------------------------------------------------

export function executeTrade(approval: Approval): TradeResult {
  if (approval.status !== 'approved') {
    console.log(`[runtime] trade skipped: approval ${approval.id} status=${approval.status}`);
    return { outcome: 'denied', reason: approval.reason ?? 'not approved' };
  }

  // Extract signal from approval payload
  const payload = approval.payload as Record<string, unknown>;
  const signal = (payload.signal ?? payload) as Record<string, unknown>;

  const symbol = (signal.symbol ?? payload.symbol) as string | undefined;
  const side = (signal.direction ?? signal.side ?? payload.side) as string | undefined;
  const quantity = (signal.quantity ?? payload.quantity) as number | undefined;
  const entry = (signal.entry ?? payload.entry) as number | undefined;
  const stop = (signal.stop ?? payload.stop) as number | undefined;
  const target = (signal.target ?? payload.target) as number | undefined;

  if (!symbol || !side || quantity === undefined || entry === undefined
    || stop === undefined || target === undefined) {
    const missing = ['symbol', 'side', 'quantity', 'entry', 'stop', 'target']
      .filter(f => !(signal[f] ?? payload[f]))
      .join(', ');
    return { outcome: 'blocked', error: `trade_plan payload missing required fields: ${missing}` };
  }

  try {
    const orderResult = submitPaperOrder({
      approvalId: approval.id,
      symbol,
      side: side as 'long' | 'short',
      quantity,
      entry,
      stop,
      target,
      resolvedBy: approval.resolvedBy,
      mode: 'paper',
    });
    console.log(`[runtime] trade submitted order=${orderResult.id} symbol=${symbol} approval=${approval.id}`);
    return { outcome: 'submitted', orderResult };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runtime] trade blocked: ${msg}`);
    return { outcome: 'blocked', error: msg };
  }
}
