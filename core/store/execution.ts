// Async broker/sandbox execution audit store facade.
//
// SIGMA_CONTROL_STORE=postgres moves paper_orders and sandbox_writes to
// Postgres. Default behavior remains the existing SQLite-backed broker and
// sandbox modules.

import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { isAbsolute, join, normalize, resolve } from 'path';
import type { QueryResultRow } from 'pg';
import { query, usingPostgresControlStore } from './postgres.js';

export const ALLOWED_SYMBOLS = new Set(['MES', 'MNQ', 'ES', 'NQ']);

export type OrderSide = 'long' | 'short' | 'buy' | 'sell';
export type BrokerMode = 'paper';

export interface BrokerOrder {
  approvalId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entry: number;
  stop: number;
  target: number;
  resolvedBy?: string;
  mode?: BrokerMode;
}

export interface PaperOrderResult {
  id: string;
  approvalId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entry: number;
  stop: number;
  target: number;
  mode: 'paper';
  brokerAdapter: 'paper';
  resolvedBy: string | undefined;
  simulatedFill: number;
  submittedAt: string;
  outcome: 'filled_paper';
}

export interface BrokerStatus {
  mode: 'paper';
  adapter: 'paper';
  live: false;
  allowedSymbols: string[];
  ready: true;
}

export interface SandboxWriteResult {
  id: string;
  approvalId: string;
  action: string;
  agent: string;
  sandboxPath: string;
  checksumPre: string;
  checksumPost: string;
  resolvedBy: string | undefined;
  writtenAt: string;
  outcome: 'written' | 'denied' | 'blocked';
}

export class BrokerModeError extends Error {
  constructor(mode: string) {
    super(`[broker] live trading is not permitted. Only 'paper' mode is supported. Received: '${mode}'`);
    this.name = 'BrokerModeError';
  }
}

export class OrderValidationError extends Error {
  public readonly field: string;
  constructor(field: string, reason: string) {
    super(`[broker] order validation failed - ${field}: ${reason}`);
    this.name = 'OrderValidationError';
    this.field = field;
  }
}

export class SandboxViolationError extends Error {
  public readonly code: 'PATH_TRAVERSAL' | 'ABSOLUTE_PATH' | 'OUTSIDE_SANDBOX' | 'OVERWRITE_BLOCKED';
  constructor(
    message: string,
    code: 'PATH_TRAVERSAL' | 'ABSOLUTE_PATH' | 'OUTSIDE_SANDBOX' | 'OVERWRITE_BLOCKED',
  ) {
    super(message);
    this.name = 'SandboxViolationError';
    this.code = code;
  }
}

interface PaperOrderRow extends QueryResultRow {
  id: string;
  approval_id: string;
  symbol: string;
  side: OrderSide;
  quantity: number | string;
  entry: number | string;
  stop: number | string;
  target: number | string;
  mode: 'paper';
  broker_adapter: 'paper';
  resolved_by: string | null;
  simulated_fill: number | string;
  submitted_at: string;
  outcome: 'filled_paper';
}

interface SandboxWriteRow extends QueryResultRow {
  id: string;
  approval_id: string;
  action: string;
  agent: string;
  sandbox_path: string;
  checksum_pre: string;
  checksum_post: string | null;
  resolved_by: string | null;
  written_at: string;
  outcome: 'written' | 'denied' | 'blocked';
}

function toNum(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function toPaperOrder(row: PaperOrderRow): PaperOrderResult {
  return {
    id: row.id,
    approvalId: row.approval_id,
    symbol: row.symbol,
    side: row.side,
    quantity: toNum(row.quantity),
    entry: toNum(row.entry),
    stop: toNum(row.stop),
    target: toNum(row.target),
    mode: 'paper',
    brokerAdapter: 'paper',
    resolvedBy: row.resolved_by ?? undefined,
    simulatedFill: toNum(row.simulated_fill),
    submittedAt: row.submitted_at,
    outcome: 'filled_paper',
  };
}

function toSandboxWrite(row: SandboxWriteRow): SandboxWriteResult {
  return {
    id: row.id,
    approvalId: row.approval_id,
    action: row.action,
    agent: row.agent,
    sandboxPath: row.sandbox_path,
    checksumPre: row.checksum_pre,
    checksumPost: row.checksum_post ?? '',
    resolvedBy: row.resolved_by ?? undefined,
    writtenAt: row.written_at,
    outcome: row.outcome,
  };
}

export function validateOrder(order: Partial<BrokerOrder>): void {
  if (order.mode && order.mode !== 'paper') {
    throw new BrokerModeError(order.mode);
  }
  if (!order.approvalId) throw new OrderValidationError('approvalId', 'required - orders must reference an approved trade_plan');
  if (!order.symbol) throw new OrderValidationError('symbol', 'required');
  if (!order.side) throw new OrderValidationError('side', 'required');
  if (order.quantity === undefined || order.quantity === null) throw new OrderValidationError('quantity', 'required');
  if (order.entry === undefined || order.entry === null) throw new OrderValidationError('entry', 'required');
  if (order.stop === undefined || order.stop === null) throw new OrderValidationError('stop', 'required - no orders without a stop loss');
  if (order.target === undefined || order.target === null) throw new OrderValidationError('target', 'required - no orders without a profit target');

  const sym = order.symbol.toUpperCase();
  if (!ALLOWED_SYMBOLS.has(sym)) {
    throw new OrderValidationError(
      'symbol',
      `'${order.symbol}' is not on the allowlist. Allowed: ${[...ALLOWED_SYMBOLS].join(', ')}`,
    );
  }
  if (order.quantity <= 0) {
    throw new OrderValidationError('quantity', `must be > 0, got ${order.quantity}`);
  }
  if (order.stop === order.entry) throw new OrderValidationError('stop', 'stop loss cannot equal entry price');
  if (order.target === order.entry) throw new OrderValidationError('target', 'profit target cannot equal entry price');
}

export function getBrokerStatus(): BrokerStatus {
  return {
    mode: 'paper',
    adapter: 'paper',
    live: false,
    allowedSymbols: [...ALLOWED_SYMBOLS],
    ready: true,
  };
}

export async function submitPaperOrder(order: BrokerOrder): Promise<PaperOrderResult> {
  if (!usingPostgresControlStore()) {
    const sqliteBroker = await import('../broker/index.js');
    return sqliteBroker.submitPaperOrder(order);
  }

  validateOrder(order);
  const id = randomUUID();
  const now = new Date().toISOString();
  const sym = order.symbol.toUpperCase();
  const simulatedFill = order.entry;
  const result = await query<PaperOrderRow>(
    `INSERT INTO paper_orders
       (id, approval_id, symbol, side, quantity, entry, stop, target,
        mode, broker_adapter, resolved_by, simulated_fill, submitted_at, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'paper', 'paper', $9, $10, $11, 'filled_paper')
     RETURNING *`,
    [
      id,
      order.approvalId,
      sym,
      order.side,
      order.quantity,
      order.entry,
      order.stop,
      order.target,
      order.resolvedBy ?? null,
      simulatedFill,
      now,
    ],
  );
  console.log(`[broker] paper order submitted id=${id} symbol=${sym} qty=${order.quantity} approval=${order.approvalId}`);
  return toPaperOrder(result.rows[0]);
}

export async function getPaperOrders(): Promise<PaperOrderResult[]> {
  if (!usingPostgresControlStore()) {
    const sqliteBroker = await import('../broker/index.js');
    return sqliteBroker.getPaperOrders();
  }
  const result = await query<PaperOrderRow>('SELECT * FROM paper_orders ORDER BY submitted_at DESC');
  return result.rows.map(toPaperOrder);
}

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function getSandboxRoot(): string {
  const raw = process.env.SIGMA_SANDBOX_PATH ?? './.sigma-sandbox';
  return resolve(raw);
}

export function resolveSandboxPath(filePath: string): string {
  if (isAbsolute(filePath)) {
    throw new SandboxViolationError(
      `[sandbox] absolute path rejected: ${filePath}`,
      'ABSOLUTE_PATH',
    );
  }

  const normalized = normalize(filePath);
  if (normalized.startsWith('..') || normalized.includes('/..') || normalized.includes('\\..')) {
    throw new SandboxViolationError(
      `[sandbox] path traversal rejected: ${filePath}`,
      'PATH_TRAVERSAL',
    );
  }

  const sandboxRoot = getSandboxRoot();
  const resolved = resolve(join(sandboxRoot, normalized));
  if (!resolved.startsWith(sandboxRoot + '/') && resolved !== sandboxRoot) {
    throw new SandboxViolationError(
      `[sandbox] path escapes sandbox root: ${resolved}`,
      'OUTSIDE_SANDBOX',
    );
  }
  return resolved;
}

const WRITE_ACTIONS = new Set([
  'scaffold_file',
  'write_docs',
  'generate_code',
  'refactor_code',
]);

async function insertSandboxWrite(row: {
  id: string;
  approvalId: string;
  action: string;
  agent: string;
  sandboxPath: string;
  checksumPre: string;
  checksumPost: string;
  resolvedBy: string | undefined;
  writtenAt: string;
  outcome: 'written' | 'denied' | 'blocked';
}): Promise<SandboxWriteResult> {
  const result = await query<SandboxWriteRow>(
    `INSERT INTO sandbox_writes
       (id, approval_id, action, agent, sandbox_path, checksum_pre, checksum_post, resolved_by, written_at, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      row.id,
      row.approvalId,
      row.action,
      row.agent,
      row.sandboxPath,
      row.checksumPre,
      row.checksumPost,
      row.resolvedBy ?? null,
      row.writtenAt,
      row.outcome,
    ],
  );
  return toSandboxWrite(result.rows[0]);
}

export async function executeSandboxWrite(
  approvalId: string,
  action: string,
  agent: string,
  filePath: string,
  content: string,
  resolvedBy: string | undefined,
  overwriteApproved = false,
): Promise<SandboxWriteResult> {
  if (!usingPostgresControlStore()) {
    const sqliteSandbox = await import('../sandbox/index.js');
    return sqliteSandbox.executeSandboxWrite(
      approvalId,
      action,
      agent,
      filePath,
      content,
      resolvedBy,
      overwriteApproved,
    );
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  if (!WRITE_ACTIONS.has(action)) {
    throw new SandboxViolationError(
      `[sandbox] action '${action}' is not permitted to write files`,
      'OUTSIDE_SANDBOX',
    );
  }

  const checksumPre = sha256(content);
  const absPath = resolveSandboxPath(filePath);
  const sandboxRoot = getSandboxRoot();
  const relPath = absPath.slice(sandboxRoot.length + 1);

  if (existsSync(absPath) && !overwriteApproved) {
    await insertSandboxWrite({
      id,
      approvalId,
      action,
      agent,
      sandboxPath: relPath,
      checksumPre,
      checksumPost: '',
      resolvedBy,
      writtenAt: now,
      outcome: 'blocked',
    });
    console.warn(`[sandbox] overwrite blocked path=${relPath} approvalId=${approvalId}`);
    throw new SandboxViolationError(
      `[sandbox] file already exists and overwriteApproved is not set: ${relPath}`,
      'OVERWRITE_BLOCKED',
    );
  }

  const dir = absPath.substring(0, absPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(absPath, content, 'utf8');
  const checksumPost = sha256(readFileSync(absPath, 'utf8'));

  const record = await insertSandboxWrite({
    id,
    approvalId,
    action,
    agent,
    sandboxPath: relPath,
    checksumPre,
    checksumPost,
    resolvedBy,
    writtenAt: now,
    outcome: 'written',
  });
  console.log(`[sandbox] written path=${relPath} approval=${approvalId} checksum=${checksumPost.slice(0, 12)}...`);
  return record;
}

export async function getSandboxLog(): Promise<SandboxWriteResult[]> {
  if (!usingPostgresControlStore()) {
    const sqliteSandbox = await import('../sandbox/index.js');
    return sqliteSandbox.getSandboxLog();
  }
  const result = await query<SandboxWriteRow>('SELECT * FROM sandbox_writes ORDER BY written_at DESC');
  return result.rows.map(toSandboxWrite);
}
