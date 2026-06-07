// core/store/control.ts
// Async control-plane store facade.
//
// SIGMA_CONTROL_STORE=postgres moves approvals, outcome_log, and memory to
// Postgres through the shared runtime-store helper. Default behavior remains
// the existing SQLite-backed modules.

import { randomUUID } from 'crypto';
import type { QueryResultRow } from 'pg';
import * as sqliteMemory from '../memory/index.js';
import * as sqlitePolicies from '../policies/index.js';
import * as sqliteRuntime from '../runtime/index.js';
import type { MemEntry } from '../memory/index.js';
import type { Approval, ApprovalStatus } from '../policies/index.js';
import type { LogSearchParams, OutcomeEntry } from '../runtime/index.js';
import { query, usingPostgresControlStore } from './postgres.js';

export { controlStoreMode, usingPostgresControlStore } from './postgres.js';

interface ApprovalRow extends QueryResultRow {
  id: string;
  agent: string;
  action: string;
  description: string;
  payload: string;
  status: ApprovalStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  reason: string | null;
}

interface OutcomeRow extends QueryResultRow {
  id: string;
  approval_id: string;
  task_type: string;
  agent: string;
  outcome: 'approved' | 'denied';
  resolved_by: string | null;
  reason: string | null;
  logged_at: string;
}

interface MemoryRow extends QueryResultRow {
  namespace: string;
  key: string;
  value: string;
  written_by: string;
  written_at: string;
}

function orUndef(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    agent: row.agent,
    action: row.action,
    description: row.description,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: orUndef(row.resolved_at),
    resolvedBy: orUndef(row.resolved_by),
    reason: orUndef(row.reason),
  };
}

function toOutcome(row: OutcomeRow): OutcomeEntry {
  return {
    id: row.id,
    approvalId: row.approval_id,
    taskType: row.task_type,
    agent: row.agent,
    outcome: row.outcome,
    resolvedBy: orUndef(row.resolved_by),
    reason: orUndef(row.reason),
    loggedAt: row.logged_at,
  };
}

function toMemory(row: MemoryRow): MemEntry {
  return {
    namespace: row.namespace,
    key: row.key,
    value: JSON.parse(row.value) as unknown,
    writtenBy: row.written_by,
    writtenAt: row.written_at,
  };
}

async function requestApprovalPostgres(
  agent: string,
  action: string,
  description: string,
  payload: Record<string, unknown>,
): Promise<Approval> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await query<ApprovalRow>(
    `INSERT INTO approvals (id, agent, action, description, payload, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     RETURNING *`,
    [id, agent, action, description, JSON.stringify(payload), now],
  );
  console.log(`[control-store] queued id=${id} action=${action}`);
  return toApproval(result.rows[0]);
}

async function resolveApprovalPostgres(
  id: string,
  approved: boolean,
  resolvedBy: string,
  reason?: string,
): Promise<Approval | null> {
  const status: ApprovalStatus = approved ? 'approved' : 'denied';
  const now = new Date().toISOString();
  const result = await query<ApprovalRow>(
    `UPDATE approvals
     SET status = $1, resolved_at = $2, resolved_by = $3, reason = $4
     WHERE id = $5 AND status = 'pending'
     RETURNING *`,
    [status, now, resolvedBy, reason ?? null, id],
  );
  if (result.rows.length === 0) return null;
  console.log(`[control-store] ${status} id=${id} by=${resolvedBy}`);
  return toApproval(result.rows[0]);
}

async function getApprovalPostgres(id: string): Promise<Approval | null> {
  const result = await query<ApprovalRow>('SELECT * FROM approvals WHERE id = $1', [id]);
  return result.rows[0] ? toApproval(result.rows[0]) : null;
}

async function listPendingPostgres(): Promise<Approval[]> {
  const result = await query<ApprovalRow>(
    "SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at ASC",
  );
  return result.rows.map(toApproval);
}

async function listAllPostgres(): Promise<Approval[]> {
  const result = await query<ApprovalRow>('SELECT * FROM approvals ORDER BY created_at DESC');
  return result.rows.map(toApproval);
}

async function logOutcomePostgres(approval: Approval, taskType: string): Promise<OutcomeEntry> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await query<OutcomeRow>(
    `INSERT INTO outcome_log
      (id, approval_id, task_type, agent, outcome, resolved_by, reason, logged_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      approval.id,
      taskType,
      approval.agent,
      approval.status,
      approval.resolvedBy ?? null,
      approval.reason ?? null,
      now,
    ],
  );
  console.log(`[control-store] outcome=${approval.status} approval=${approval.id}`);
  return toOutcome(result.rows[0]);
}

async function getLogPostgres(): Promise<OutcomeEntry[]> {
  const result = await query<OutcomeRow>('SELECT * FROM outcome_log ORDER BY logged_at DESC');
  return result.rows.map(toOutcome);
}

async function searchLogPostgres(params: LogSearchParams): Promise<OutcomeEntry[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  function addCondition(column: string, value: string): void {
    values.push(value);
    conditions.push(`${column} = $${values.length}`);
  }

  if (params.agent) addCondition('agent', params.agent);
  if (params.action) addCondition('task_type', params.action);
  if (params.status) addCondition('outcome', params.status);
  if (params.from) {
    values.push(params.from);
    conditions.push(`logged_at >= $${values.length}`);
  }
  if (params.to) {
    values.push(params.to);
    conditions.push(`logged_at <= $${values.length}`);
  }

  const limit = Math.min(params.limit ?? 100, 500);
  values.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<OutcomeRow>(
    `SELECT * FROM outcome_log ${where} ORDER BY logged_at DESC LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(toOutcome);
}

async function memSetPostgres(
  namespace: string,
  key: string,
  value: unknown,
  writtenBy: string,
): Promise<void> {
  await query(
    `INSERT INTO memory (namespace, key, value, written_by, written_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(namespace, key) DO UPDATE SET
       value = excluded.value,
       written_by = excluded.written_by,
       written_at = excluded.written_at`,
    [namespace, key, JSON.stringify(value), writtenBy, new Date().toISOString()],
  );
}

async function memListPostgres(namespace: string): Promise<MemEntry[]> {
  const result = await query<MemoryRow>(
    'SELECT * FROM memory WHERE namespace = $1 ORDER BY key ASC',
    [namespace],
  );
  return result.rows.map(toMemory);
}

export async function requestApproval(
  agent: string,
  action: string,
  description: string,
  payload: Record<string, unknown>,
): Promise<Approval> {
  if (usingPostgresControlStore()) {
    return requestApprovalPostgres(agent, action, description, payload);
  }
  return sqlitePolicies.requestApproval(agent, action, description, payload);
}

export async function resolveApproval(
  id: string,
  approved: boolean,
  resolvedBy: string,
  reason?: string,
): Promise<Approval | null> {
  if (usingPostgresControlStore()) {
    return resolveApprovalPostgres(id, approved, resolvedBy, reason);
  }
  return sqlitePolicies.resolveApproval(id, approved, resolvedBy, reason);
}

export async function getApproval(id: string): Promise<Approval | null> {
  if (usingPostgresControlStore()) return getApprovalPostgres(id);
  return sqlitePolicies.getApproval(id);
}

export async function listPending(): Promise<Approval[]> {
  if (usingPostgresControlStore()) return listPendingPostgres();
  return sqlitePolicies.listPending();
}

export async function listAll(): Promise<Approval[]> {
  if (usingPostgresControlStore()) return listAllPostgres();
  return sqlitePolicies.listAll();
}

export async function logOutcome(approval: Approval, taskType: string): Promise<OutcomeEntry> {
  if (usingPostgresControlStore()) return logOutcomePostgres(approval, taskType);
  return sqliteRuntime.logOutcome(approval, taskType);
}

export async function getLog(): Promise<OutcomeEntry[]> {
  if (usingPostgresControlStore()) return getLogPostgres();
  return sqliteRuntime.getLog();
}

export async function searchLog(params: LogSearchParams): Promise<OutcomeEntry[]> {
  if (usingPostgresControlStore()) return searchLogPostgres(params);
  return sqliteRuntime.searchLog(params);
}

export async function memSet(
  namespace: string,
  key: string,
  value: unknown,
  writtenBy: string,
): Promise<void> {
  if (usingPostgresControlStore()) {
    await memSetPostgres(namespace, key, value, writtenBy);
    return;
  }
  sqliteMemory.memSet(namespace, key, value, writtenBy);
}

export async function memList(namespace: string): Promise<MemEntry[]> {
  if (usingPostgresControlStore()) return memListPostgres(namespace);
  return sqliteMemory.memList(namespace);
}
