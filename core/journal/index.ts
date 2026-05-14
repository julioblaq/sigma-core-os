// core/journal/index.ts
// Slice 7c (v0.7.0): Trade Journal.
// Journal entries attach to workspaceId with optional strategyId.
//
// Rules:
// - entries are append-only (no hard delete)
// - close action records exitPrice, pnlDollars, outcome, closedAt
// - closed entries cannot be closed again
// - archived strategies remain visible in old journal entries
// - role enforcement in API layer only

import { randomUUID } from 'crypto';
import { db } from '../db.js';

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

export function migrateJournal(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id          TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL REFERENCES workspaces(id),
      strategyId  TEXT,
      symbol      TEXT NOT NULL,
      side        TEXT NOT NULL CHECK(side IN ('long', 'short')),
      entryPrice  REAL NOT NULL,
      exitPrice   REAL,
      contracts   INTEGER NOT NULL,
      pnlDollars  REAL,
      outcome     TEXT NOT NULL DEFAULT 'open' CHECK(outcome IN ('open', 'win', 'loss', 'scratch')),
      notes       TEXT,
      tags        TEXT,
      openedAt    TEXT NOT NULL,
      closedAt    TEXT
    );
  `);
}

migrateJournal();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JournalSide = 'long' | 'short';
export type JournalOutcome = 'open' | 'win' | 'loss' | 'scratch';

export interface JournalEntry {
  id: string;
  workspaceId: string;
  strategyId: string | undefined;
  symbol: string;
  side: JournalSide;
  entryPrice: number;
  exitPrice: number | undefined;
  contracts: number;
  pnlDollars: number | undefined;
  outcome: JournalOutcome;
  notes: string | undefined;
  tags: string[];
  openedAt: string;
  closedAt: string | undefined;
}

export interface JournalSummary {
  workspaceId: string;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number;
  totalPnl: number;
  averagePnl: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class JournalError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`[journal] ${message}`);
    this.name = 'JournalError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function orStr(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function orNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function orStrOpt(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return typeof v === 'string' ? v : String(v);
}

function parseTags(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string' || raw.trim() === '') return [];
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

function rowToEntry(row: Record<string, unknown>): JournalEntry {
  return {
    id: orStr(row['id']),
    workspaceId: orStr(row['workspaceId']),
    strategyId: orStrOpt(row['strategyId']),
    symbol: orStr(row['symbol']),
    side: orStr(row['side']) as JournalSide,
    entryPrice: Number(row['entryPrice']),
    exitPrice: orNum(row['exitPrice']),
    contracts: Number(row['contracts']),
    pnlDollars: orNum(row['pnlDollars']),
    outcome: orStr(row['outcome']) as JournalOutcome,
    notes: orStrOpt(row['notes']),
    tags: parseTags(row['tags']),
    openedAt: orStr(row['openedAt']),
    closedAt: orStrOpt(row['closedAt']),
  };
}

// ---------------------------------------------------------------------------
// createJournalEntry
// ---------------------------------------------------------------------------

export interface CreateJournalEntryInput {
  workspaceId: string;
  strategyId?: string;
  symbol: string;
  side: JournalSide;
  entryPrice: number;
  contracts: number;
  notes?: string;
  tags?: string[];
  openedAt?: string;
}

export function createJournalEntry(input: CreateJournalEntryInput): JournalEntry {
  if (!input.workspaceId || input.workspaceId.trim().length === 0) {
    throw new JournalError('INVALID_WORKSPACE', 'workspaceId is required');
  }
  if (!input.symbol || input.symbol.trim().length === 0) {
    throw new JournalError('INVALID_SYMBOL', 'symbol is required');
  }
  if (!['long', 'short'].includes(input.side)) {
    throw new JournalError('INVALID_SIDE', `side must be 'long' or 'short'`);
  }
  if (typeof input.entryPrice !== 'number' || input.entryPrice <= 0) {
    throw new JournalError('INVALID_PRICE', 'entryPrice must be > 0');
  }
  if (!Number.isInteger(input.contracts) || input.contracts <= 0) {
    throw new JournalError('INVALID_CONTRACTS', 'contracts must be a positive integer');
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const openedAt = input.openedAt ?? now;
  const tagsStr = input.tags ? input.tags.join(',') : '';

  db.run(
    `INSERT INTO journal_entries
       (id, workspaceId, strategyId, symbol, side, entryPrice, contracts,
        outcome, notes, tags, openedAt)
     VALUES (:id, :wid, :sid, :sym, :side, :ep, :ct, 'open', :notes, :tags, :openedAt)`,
    {
      ':id': id, ':wid': input.workspaceId,
      ':sid': input.strategyId ?? null,
      ':sym': input.symbol.toUpperCase(),
      ':side': input.side,
      ':ep': input.entryPrice,
      ':ct': input.contracts,
      ':notes': input.notes ?? null,
      ':tags': tagsStr,
      ':openedAt': openedAt,
    },
  );

  return rowToEntry(db.get('SELECT * FROM journal_entries WHERE id = :id', { ':id': id })!);
}

// ---------------------------------------------------------------------------
// getJournalEntry
// ---------------------------------------------------------------------------

export function getJournalEntry(id: string): JournalEntry | undefined {
  const row = db.get('SELECT * FROM journal_entries WHERE id = :id', { ':id': id });
  return row ? rowToEntry(row) : undefined;
}

// ---------------------------------------------------------------------------
// listJournalEntries — by workspace, optional strategyId filter
// ---------------------------------------------------------------------------

export function listJournalEntries(
  workspaceId: string,
  strategyId?: string,
): JournalEntry[] {
  const rows = strategyId
    ? db.all(
        'SELECT * FROM journal_entries WHERE workspaceId = :wid AND strategyId = :sid ORDER BY openedAt DESC',
        { ':wid': workspaceId, ':sid': strategyId },
      )
    : db.all(
        'SELECT * FROM journal_entries WHERE workspaceId = :wid ORDER BY openedAt DESC',
        { ':wid': workspaceId },
      );
  return rows.map(rowToEntry);
}

// ---------------------------------------------------------------------------
// closeJournalEntry
// Records exit data and computes final P&L and outcome.
// P&L = (exitPrice - entryPrice) * contracts * pointValue
// For futures: caller passes pnlDollars directly (already calculated),
// or we compute from price delta × contracts using a simple per-point approach.
// Since pointValue varies per instrument, the API layer should pass pnlDollars.
// ---------------------------------------------------------------------------

export interface CloseJournalEntryInput {
  exitPrice: number;
  pnlDollars: number;
  outcome: Exclude<JournalOutcome, 'open'>;
  notes?: string;
  closedAt?: string;
}

export function closeJournalEntry(id: string, input: CloseJournalEntryInput): JournalEntry {
  const entry = getJournalEntry(id);
  if (!entry) {
    throw new JournalError('ENTRY_NOT_FOUND', `journal entry '${id}' not found`);
  }
  if (entry.outcome !== 'open') {
    throw new JournalError('ALREADY_CLOSED', `journal entry '${id}' is already closed (outcome: ${entry.outcome})`);
  }

  if (typeof input.exitPrice !== 'number' || input.exitPrice <= 0) {
    throw new JournalError('INVALID_PRICE', 'exitPrice must be > 0');
  }
  if (typeof input.pnlDollars !== 'number') {
    throw new JournalError('INVALID_PNL', 'pnlDollars is required');
  }
  if (!['win', 'loss', 'scratch'].includes(input.outcome)) {
    throw new JournalError('INVALID_OUTCOME', `outcome must be 'win', 'loss', or 'scratch'`);
  }

  const closedAt = input.closedAt ?? new Date().toISOString();

  db.run(
    `UPDATE journal_entries
     SET exitPrice = :ep, pnlDollars = :pnl, outcome = :outcome,
         notes = COALESCE(:notes, notes), closedAt = :closedAt
     WHERE id = :id`,
    {
      ':ep': input.exitPrice,
      ':pnl': input.pnlDollars,
      ':outcome': input.outcome,
      ':notes': input.notes ?? null,
      ':closedAt': closedAt,
      ':id': id,
    },
  );

  return rowToEntry(db.get('SELECT * FROM journal_entries WHERE id = :id', { ':id': id })!);
}

// ---------------------------------------------------------------------------
// getJournalSummary — aggregate stats for a workspace
// Optionally filtered by strategyId
// ---------------------------------------------------------------------------

export function getJournalSummary(workspaceId: string, strategyId?: string): JournalSummary {
  const entries = listJournalEntries(workspaceId, strategyId);

  const closed = entries.filter(e => e.outcome !== 'open');
  const wins = closed.filter(e => e.outcome === 'win').length;
  const losses = closed.filter(e => e.outcome === 'loss').length;
  const scratches = closed.filter(e => e.outcome === 'scratch').length;
  const openTrades = entries.filter(e => e.outcome === 'open').length;

  const closedWithPnl = closed.filter(e => e.pnlDollars !== undefined);
  const totalPnl = +closedWithPnl.reduce((sum, e) => sum + (e.pnlDollars ?? 0), 0).toFixed(2);
  const averagePnl = closedWithPnl.length > 0
    ? +(totalPnl / closedWithPnl.length).toFixed(2)
    : 0;
  const winRate = closed.length > 0
    ? +((wins / closed.length) * 100).toFixed(1)
    : 0;

  return {
    workspaceId,
    totalTrades: entries.length,
    openTrades,
    closedTrades: closed.length,
    wins,
    losses,
    scratches,
    winRate,
    totalPnl,
    averagePnl,
  };
}
