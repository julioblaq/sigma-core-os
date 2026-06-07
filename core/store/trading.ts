// Async strategy, journal, and performance store facade.
//
// SIGMA_CONTROL_STORE=postgres moves strategy profiles, journal entries, and
// performance analytics reads to Postgres. Default behavior remains the
// existing SQLite-backed trading modules.

import { randomUUID } from 'crypto';
import type { QueryResultRow } from 'pg';
import * as sqliteStrategies from '../strategies/index.js';
import * as sqliteJournal from '../journal/index.js';
import * as sqlitePerformance from '../performance/index.js';
import {
  PROP_FIRM_TEMPLATES,
  StrategyError,
  type CreateStrategyInput,
  type PropFirmTemplate,
  type Strategy,
  type StrategyRiskContext,
  type StrategyStatus,
  type UpdateStrategyInput,
} from '../strategies/index.js';
import {
  JournalError,
  type CloseJournalEntryInput,
  type CreateJournalEntryInput,
  type JournalEntry,
  type JournalOutcome,
  type JournalSide,
  type JournalSummary,
} from '../journal/index.js';
import type {
  CalendarDay,
  DrawdownPoint,
  EquityPoint,
  InstrumentBreakdown,
  PerformanceBreakdown,
  PerformanceFilter,
  PerformanceSummary,
  StrategyBreakdown,
} from '../performance/index.js';
import { query, usingPostgresControlStore } from './postgres.js';

interface StrategyRow extends QueryResultRow {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  propFirmTemplate: PropFirmTemplate;
  maxDailyDrawdown: number | string;
  maxPositionSize: number | string;
  allowedInstruments: string;
  defaultRR: number | string;
  status: StrategyStatus;
  createdAt: string;
  updatedAt: string;
}

interface JournalRow extends QueryResultRow {
  id: string;
  workspaceId: string;
  strategyId: string | null;
  symbol: string;
  side: JournalSide;
  entryPrice: number | string;
  exitPrice: number | string | null;
  contracts: number | string;
  pnlDollars: number | string | null;
  outcome: JournalOutcome;
  notes: string | null;
  tags: string | null;
  openedAt: string;
  closedAt: string | null;
}

interface ClosedEntry {
  id: string;
  workspaceId: string;
  strategyId: string | null;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  contracts: number;
  pnlDollars: number;
  outcome: 'win' | 'loss' | 'scratch';
  closedAt: string;
  openedAt: string;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw || raw.trim() === '') return [];
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

function toNum(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function toNumOpt(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}

function toStrategy(row: StrategyRow): Strategy {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    propFirmTemplate: row.propFirmTemplate,
    maxDailyDrawdown: toNum(row.maxDailyDrawdown),
    maxPositionSize: toNum(row.maxPositionSize),
    allowedInstruments: row.allowedInstruments ? row.allowedInstruments.split(',') : ['ES', 'NQ', 'MES', 'MNQ'],
    defaultRR: toNum(row.defaultRR),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toJournalEntry(row: JournalRow): JournalEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    strategyId: row.strategyId ?? undefined,
    symbol: row.symbol,
    side: row.side,
    entryPrice: toNum(row.entryPrice),
    exitPrice: toNumOpt(row.exitPrice),
    contracts: toNum(row.contracts),
    pnlDollars: toNumOpt(row.pnlDollars),
    outcome: row.outcome,
    notes: row.notes ?? undefined,
    tags: parseTags(row.tags),
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? undefined,
  };
}

function toClosedEntry(row: JournalRow): ClosedEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    strategyId: row.strategyId,
    symbol: row.symbol,
    side: row.side,
    entryPrice: toNum(row.entryPrice),
    exitPrice: toNum(row.exitPrice ?? 0),
    contracts: toNum(row.contracts),
    pnlDollars: toNum(row.pnlDollars ?? 0),
    outcome: row.outcome as 'win' | 'loss' | 'scratch',
    closedAt: row.closedAt ?? '',
    openedAt: row.openedAt,
  };
}

function validateStrategyInput(input: CreateStrategyInput): {
  template: PropFirmTemplate;
  slug: string;
  maxDailyDrawdown: number;
  maxPositionSize: number;
  allowedInstruments: string[];
  defaultRR: number;
} {
  if (!input.workspaceId || input.workspaceId.trim().length === 0) {
    throw new StrategyError('INVALID_WORKSPACE', 'workspaceId is required');
  }
  if (!input.name || input.name.trim().length === 0) {
    throw new StrategyError('INVALID_NAME', 'strategy name is required');
  }

  const template = input.propFirmTemplate ?? 'custom';
  const validTemplates: PropFirmTemplate[] = ['apex', 'topstep', 'bulenox', 'custom'];
  if (!validTemplates.includes(template)) {
    throw new StrategyError('INVALID_TEMPLATE', `prop-firm template '${template}' is not valid. Allowed: ${validTemplates.join(', ')}`);
  }

  const defaults = PROP_FIRM_TEMPLATES[template];
  const maxDailyDrawdown = input.maxDailyDrawdown ?? defaults.maxDailyDrawdown;
  const maxPositionSize = input.maxPositionSize ?? defaults.maxPositionSize;
  const allowedInstruments = input.allowedInstruments ?? defaults.allowedInstruments;
  const defaultRR = input.defaultRR ?? defaults.defaultRR;

  if (maxDailyDrawdown <= 0 || maxDailyDrawdown > 100) {
    throw new StrategyError('INVALID_DRAWDOWN', 'maxDailyDrawdown must be between 0 and 100');
  }
  if (maxPositionSize <= 0) {
    throw new StrategyError('INVALID_POSITION_SIZE', 'maxPositionSize must be > 0');
  }
  if (!allowedInstruments || allowedInstruments.length === 0) {
    throw new StrategyError('INVALID_INSTRUMENTS', 'allowedInstruments must not be empty');
  }
  if (defaultRR <= 0) {
    throw new StrategyError('INVALID_RR', 'defaultRR must be > 0');
  }

  const slug = toSlug(input.name);
  if (!slug) {
    throw new StrategyError('INVALID_NAME', 'strategy name produced an empty slug');
  }

  return { template, slug, maxDailyDrawdown, maxPositionSize, allowedInstruments, defaultRR };
}

export async function createStrategy(input: CreateStrategyInput): Promise<Strategy> {
  if (!usingPostgresControlStore()) return sqliteStrategies.createStrategy(input);
  const validated = validateStrategyInput(input);

  const existing = await query<StrategyRow>(
    'SELECT * FROM strategies WHERE "workspaceId" = $1 AND slug = $2',
    [input.workspaceId, validated.slug],
  );
  if (existing.rows.length > 0) {
    throw new StrategyError('SLUG_TAKEN', `strategy slug '${validated.slug}' already exists in this workspace`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await query<StrategyRow>(
    `INSERT INTO strategies
       (id, "workspaceId", name, slug, description, "propFirmTemplate",
        "maxDailyDrawdown", "maxPositionSize", "allowedInstruments", "defaultRR",
        status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $11)
     RETURNING *`,
    [
      id,
      input.workspaceId,
      input.name.trim(),
      validated.slug,
      input.description ?? null,
      validated.template,
      validated.maxDailyDrawdown,
      validated.maxPositionSize,
      validated.allowedInstruments.join(','),
      validated.defaultRR,
      now,
    ],
  );
  return toStrategy(result.rows[0]);
}

export async function getStrategy(id: string): Promise<Strategy | undefined> {
  if (!usingPostgresControlStore()) return sqliteStrategies.getStrategy(id);
  const result = await query<StrategyRow>('SELECT * FROM strategies WHERE id = $1', [id]);
  return result.rows[0] ? toStrategy(result.rows[0]) : undefined;
}

export async function listStrategies(workspaceId: string, includeArchived = false): Promise<Strategy[]> {
  if (!usingPostgresControlStore()) return sqliteStrategies.listStrategies(workspaceId, includeArchived);
  const result = includeArchived
    ? await query<StrategyRow>(
        'SELECT * FROM strategies WHERE "workspaceId" = $1 ORDER BY "createdAt" ASC',
        [workspaceId],
      )
    : await query<StrategyRow>(
        'SELECT * FROM strategies WHERE "workspaceId" = $1 AND status = $2 ORDER BY "createdAt" ASC',
        [workspaceId, 'active'],
      );
  return result.rows.map(toStrategy);
}

export async function updateStrategy(id: string, input: UpdateStrategyInput): Promise<Strategy> {
  if (!usingPostgresControlStore()) return sqliteStrategies.updateStrategy(id, input);
  const existing = await getStrategy(id);
  if (!existing) {
    throw new StrategyError('STRATEGY_NOT_FOUND', `strategy '${id}' not found`);
  }
  if (existing.status === 'archived') {
    throw new StrategyError('STRATEGY_ARCHIVED', 'cannot update an archived strategy');
  }

  if (input.propFirmTemplate !== undefined) {
    const validTemplates: PropFirmTemplate[] = ['apex', 'topstep', 'bulenox', 'custom'];
    if (!validTemplates.includes(input.propFirmTemplate)) {
      throw new StrategyError('INVALID_TEMPLATE', `prop-firm template '${input.propFirmTemplate}' is not valid`);
    }
  }

  const name = input.name ?? existing.name;
  const description = input.description !== undefined ? input.description : existing.description;
  const propFirmTemplate = input.propFirmTemplate ?? existing.propFirmTemplate;
  const maxDailyDrawdown = input.maxDailyDrawdown ?? existing.maxDailyDrawdown;
  const maxPositionSize = input.maxPositionSize ?? existing.maxPositionSize;
  const allowedInstruments = input.allowedInstruments ?? existing.allowedInstruments;
  const defaultRR = input.defaultRR ?? existing.defaultRR;
  const slug = input.name ? toSlug(input.name) : existing.slug;

  if (input.name && slug !== existing.slug) {
    const dupe = await query<StrategyRow>(
      'SELECT * FROM strategies WHERE "workspaceId" = $1 AND slug = $2 AND id != $3',
      [existing.workspaceId, slug, id],
    );
    if (dupe.rows.length > 0) {
      throw new StrategyError('SLUG_TAKEN', `strategy slug '${slug}' already exists in this workspace`);
    }
  }

  const result = await query<StrategyRow>(
    `UPDATE strategies SET
       name = $1, slug = $2, description = $3, "propFirmTemplate" = $4,
       "maxDailyDrawdown" = $5, "maxPositionSize" = $6, "allowedInstruments" = $7,
       "defaultRR" = $8, "updatedAt" = $9
     WHERE id = $10
     RETURNING *`,
    [
      name,
      slug,
      description ?? null,
      propFirmTemplate,
      maxDailyDrawdown,
      maxPositionSize,
      allowedInstruments.join(','),
      defaultRR,
      new Date().toISOString(),
      id,
    ],
  );
  return toStrategy(result.rows[0]);
}

export async function archiveStrategy(id: string): Promise<Strategy> {
  if (!usingPostgresControlStore()) return sqliteStrategies.archiveStrategy(id);
  const existing = await getStrategy(id);
  if (!existing) {
    throw new StrategyError('STRATEGY_NOT_FOUND', `strategy '${id}' not found`);
  }
  if (existing.status === 'archived') {
    throw new StrategyError('ALREADY_ARCHIVED', 'strategy is already archived');
  }

  const result = await query<StrategyRow>(
    'UPDATE strategies SET status = $1, "updatedAt" = $2 WHERE id = $3 RETURNING *',
    ['archived', new Date().toISOString(), id],
  );
  return toStrategy(result.rows[0]);
}

export async function getStrategyRiskContext(strategyId: string): Promise<StrategyRiskContext> {
  if (!usingPostgresControlStore()) return sqliteStrategies.getStrategyRiskContext(strategyId);
  const strategy = await getStrategy(strategyId);
  if (!strategy) {
    throw new StrategyError('STRATEGY_NOT_FOUND', `strategy '${strategyId}' not found`);
  }
  if (strategy.status === 'archived') {
    throw new StrategyError('STRATEGY_ARCHIVED', `strategy '${strategyId}' is archived and cannot be used for trade plans`);
  }

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    propFirmTemplate: strategy.propFirmTemplate,
    maxDailyDrawdown: strategy.maxDailyDrawdown,
    maxPositionSize: strategy.maxPositionSize,
    allowedInstruments: strategy.allowedInstruments,
    defaultRR: strategy.defaultRR,
  };
}

export async function createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntry> {
  if (!usingPostgresControlStore()) return sqliteJournal.createJournalEntry(input);
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

  const now = new Date().toISOString();
  const result = await query<JournalRow>(
    `INSERT INTO journal_entries
       (id, "workspaceId", "strategyId", symbol, side, "entryPrice", contracts,
        outcome, notes, tags, "openedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, $10)
     RETURNING *`,
    [
      randomUUID(),
      input.workspaceId,
      input.strategyId ?? null,
      input.symbol.toUpperCase(),
      input.side,
      input.entryPrice,
      input.contracts,
      input.notes ?? null,
      input.tags ? input.tags.join(',') : '',
      input.openedAt ?? now,
    ],
  );
  return toJournalEntry(result.rows[0]);
}

export async function getJournalEntry(id: string): Promise<JournalEntry | undefined> {
  if (!usingPostgresControlStore()) return sqliteJournal.getJournalEntry(id);
  const result = await query<JournalRow>('SELECT * FROM journal_entries WHERE id = $1', [id]);
  return result.rows[0] ? toJournalEntry(result.rows[0]) : undefined;
}

export async function listJournalEntries(workspaceId: string, strategyId?: string): Promise<JournalEntry[]> {
  if (!usingPostgresControlStore()) return sqliteJournal.listJournalEntries(workspaceId, strategyId);
  const result = strategyId
    ? await query<JournalRow>(
        'SELECT * FROM journal_entries WHERE "workspaceId" = $1 AND "strategyId" = $2 ORDER BY "openedAt" DESC',
        [workspaceId, strategyId],
      )
    : await query<JournalRow>(
        'SELECT * FROM journal_entries WHERE "workspaceId" = $1 ORDER BY "openedAt" DESC',
        [workspaceId],
      );
  return result.rows.map(toJournalEntry);
}

export async function closeJournalEntry(id: string, input: CloseJournalEntryInput): Promise<JournalEntry> {
  if (!usingPostgresControlStore()) return sqliteJournal.closeJournalEntry(id, input);
  const entry = await getJournalEntry(id);
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

  const result = await query<JournalRow>(
    `UPDATE journal_entries
     SET "exitPrice" = $1, "pnlDollars" = $2, outcome = $3,
         notes = COALESCE($4, notes), "closedAt" = $5
     WHERE id = $6
     RETURNING *`,
    [
      input.exitPrice,
      input.pnlDollars,
      input.outcome,
      input.notes ?? null,
      input.closedAt ?? new Date().toISOString(),
      id,
    ],
  );
  return toJournalEntry(result.rows[0]);
}

export async function getJournalSummary(workspaceId: string, strategyId?: string): Promise<JournalSummary> {
  if (!usingPostgresControlStore()) return sqliteJournal.getJournalSummary(workspaceId, strategyId);
  const entries = await listJournalEntries(workspaceId, strategyId);
  const closed = entries.filter(e => e.outcome !== 'open');
  const wins = closed.filter(e => e.outcome === 'win').length;
  const losses = closed.filter(e => e.outcome === 'loss').length;
  const scratches = closed.filter(e => e.outcome === 'scratch').length;
  const openTrades = entries.filter(e => e.outcome === 'open').length;
  const closedWithPnl = closed.filter(e => e.pnlDollars !== undefined);
  const totalPnl = +closedWithPnl.reduce((sum, e) => sum + (e.pnlDollars ?? 0), 0).toFixed(2);
  const averagePnl = closedWithPnl.length > 0 ? +(totalPnl / closedWithPnl.length).toFixed(2) : 0;
  const winRate = closed.length > 0 ? +((wins / closed.length) * 100).toFixed(1) : 0;

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

async function fetchClosed(f: PerformanceFilter): Promise<ClosedEntry[]> {
  const conditions: string[] = ["outcome != 'open'", '"pnlDollars" IS NOT NULL', '"closedAt" IS NOT NULL'];
  const values: unknown[] = [f.workspaceId];
  conditions.push(`"workspaceId" = $${values.length}`);

  if (f.strategyId) {
    values.push(f.strategyId);
    conditions.push(`"strategyId" = $${values.length}`);
  }
  if (f.symbol) {
    values.push(f.symbol.toUpperCase());
    conditions.push(`symbol = $${values.length}`);
  }
  if (f.from) {
    values.push(f.from);
    conditions.push(`"closedAt" >= $${values.length}`);
  }
  if (f.to) {
    values.push(f.to);
    conditions.push(`"closedAt" <= $${values.length}`);
  }

  const result = await query<JournalRow>(
    `SELECT * FROM journal_entries WHERE ${conditions.join(' AND ')} ORDER BY "closedAt" ASC`,
    values,
  );
  return result.rows.map(toClosedEntry);
}

function calcStreaks(entries: ClosedEntry[]): { maxWin: number; maxLoss: number } {
  let maxWin = 0;
  let maxLoss = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const e of entries) {
    if (e.outcome === 'win') {
      curWin++;
      curLoss = 0;
      if (curWin > maxWin) maxWin = curWin;
    } else if (e.outcome === 'loss') {
      curLoss++;
      curWin = 0;
      if (curLoss > maxLoss) maxLoss = curLoss;
    } else {
      curWin = 0;
      curLoss = 0;
    }
  }
  return { maxWin, maxLoss };
}

function calcProfitFactor(entries: ClosedEntry[]): number {
  const grossWins = entries.filter(e => e.pnlDollars > 0).reduce((s, e) => s + e.pnlDollars, 0);
  const grossLosses = Math.abs(entries.filter(e => e.pnlDollars < 0).reduce((s, e) => s + e.pnlDollars, 0));
  if (grossLosses === 0) return grossWins > 0 ? Infinity : 0;
  return +(grossWins / grossLosses).toFixed(2);
}

export async function getPerformanceSummary(f: PerformanceFilter): Promise<PerformanceSummary> {
  if (!usingPostgresControlStore()) return sqlitePerformance.getPerformanceSummary(f);
  const entries = await fetchClosed(f);
  const wins = entries.filter(e => e.outcome === 'win');
  const losses = entries.filter(e => e.outcome === 'loss');
  const scratches = entries.filter(e => e.outcome === 'scratch');

  const totalPnl = +entries.reduce((s, e) => s + e.pnlDollars, 0).toFixed(2);
  const winRate = entries.length > 0 ? +((wins.length / entries.length) * 100).toFixed(1) : 0;
  const grossWinTotal = wins.reduce((s, e) => s + e.pnlDollars, 0);
  const grossLossTotal = losses.reduce((s, e) => s + e.pnlDollars, 0);
  const averageWin = wins.length > 0 ? +(grossWinTotal / wins.length).toFixed(2) : 0;
  const averageLoss = losses.length > 0 ? +(grossLossTotal / losses.length).toFixed(2) : 0;
  const profitFactor = calcProfitFactor(entries);
  const expectancy = entries.length > 0 ? +(totalPnl / entries.length).toFixed(2) : 0;
  const averageRMultiple = averageLoss !== 0 ? +(expectancy / Math.abs(averageLoss)).toFixed(2) : 0;
  const { maxWin: maxWinStreak, maxLoss: maxLossStreak } = calcStreaks(entries);
  const largestWin = wins.length > 0 ? Math.max(...wins.map(e => e.pnlDollars)) : 0;
  const largestLoss = losses.length > 0 ? Math.min(...losses.map(e => e.pnlDollars)) : 0;

  return {
    workspaceId: f.workspaceId,
    totalTrades: entries.length,
    wins: wins.length,
    losses: losses.length,
    scratches: scratches.length,
    winRate,
    totalPnl,
    averageWin,
    averageLoss,
    profitFactor,
    expectancy,
    averageRMultiple,
    maxWinStreak,
    maxLossStreak,
    largestWin,
    largestLoss,
  };
}

export async function getEquityCurve(f: PerformanceFilter): Promise<EquityPoint[]> {
  if (!usingPostgresControlStore()) return sqlitePerformance.getEquityCurve(f);
  const entries = await fetchClosed(f);
  let cumulative = 0;
  return entries.map(e => {
    cumulative = +(cumulative + e.pnlDollars).toFixed(2);
    return {
      date: e.closedAt.slice(0, 10),
      pnl: e.pnlDollars,
      cumulative,
      tradeId: e.id,
    };
  });
}

export async function getDrawdown(f: PerformanceFilter): Promise<DrawdownPoint[]> {
  if (!usingPostgresControlStore()) return sqlitePerformance.getDrawdown(f);
  const curve = await getEquityCurve(f);
  if (curve.length === 0) return [];

  let peak = 0;
  return curve.map(pt => {
    if (pt.cumulative > peak) peak = pt.cumulative;
    const drawdown = +(peak - pt.cumulative).toFixed(2);
    const drawdownPct = peak > 0 ? +((drawdown / peak) * 100).toFixed(2) : 0;
    return { date: pt.date, cumulative: pt.cumulative, peak, drawdown, drawdownPct };
  });
}

export async function getMaxDrawdown(f: PerformanceFilter): Promise<number> {
  if (!usingPostgresControlStore()) return sqlitePerformance.getMaxDrawdown(f);
  const points = await getDrawdown(f);
  if (points.length === 0) return 0;
  return Math.max(...points.map(p => p.drawdown));
}

export async function getCalendar(f: PerformanceFilter): Promise<CalendarDay[]> {
  if (!usingPostgresControlStore()) return sqlitePerformance.getCalendar(f);
  const entries = await fetchClosed(f);
  const byDay = new Map<string, CalendarDay>();

  for (const e of entries) {
    const day = e.closedAt.slice(0, 10);
    const existing = byDay.get(day) ?? { date: day, pnl: 0, trades: 0, wins: 0, losses: 0 };
    existing.pnl = +(existing.pnl + e.pnlDollars).toFixed(2);
    existing.trades++;
    if (e.outcome === 'win') existing.wins++;
    if (e.outcome === 'loss') existing.losses++;
    byDay.set(day, existing);
  }

  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildBreakdownStats(entries: ClosedEntry[]): {
  trades: number; wins: number; winRate: number;
  totalPnl: number; averagePnl: number; profitFactor: number;
} {
  const wins = entries.filter(e => e.outcome === 'win').length;
  const totalPnl = +entries.reduce((s, e) => s + e.pnlDollars, 0).toFixed(2);
  const averagePnl = entries.length > 0 ? +(totalPnl / entries.length).toFixed(2) : 0;
  const winRate = entries.length > 0 ? +((wins / entries.length) * 100).toFixed(1) : 0;
  const profitFactor = calcProfitFactor(entries);
  return { trades: entries.length, wins, winRate, totalPnl, averagePnl, profitFactor };
}

export async function getBreakdown(f: PerformanceFilter): Promise<PerformanceBreakdown> {
  if (!usingPostgresControlStore()) return sqlitePerformance.getBreakdown(f);
  const entries = await fetchClosed(f);
  const stratMap = new Map<string, ClosedEntry[]>();
  for (const e of entries) {
    const key = e.strategyId ?? '__none__';
    const arr = stratMap.get(key) ?? [];
    arr.push(e);
    stratMap.set(key, arr);
  }
  const byStrategy: StrategyBreakdown[] = Array.from(stratMap.entries()).map(([key, es]) => ({
    strategyId: key === '__none__' ? null : key,
    label: key === '__none__' ? 'No Strategy' : key,
    ...buildBreakdownStats(es),
  })).sort((a, b) => b.totalPnl - a.totalPnl);

  const symMap = new Map<string, ClosedEntry[]>();
  for (const e of entries) {
    const arr = symMap.get(e.symbol) ?? [];
    arr.push(e);
    symMap.set(e.symbol, arr);
  }
  const byInstrument: InstrumentBreakdown[] = Array.from(symMap.entries()).map(([sym, es]) => ({
    symbol: sym,
    ...buildBreakdownStats(es),
  })).sort((a, b) => b.totalPnl - a.totalPnl);

  return { byStrategy, byInstrument };
}

export { JournalError, StrategyError };
export type {
  CalendarDay,
  CloseJournalEntryInput,
  CreateJournalEntryInput,
  CreateStrategyInput,
  DrawdownPoint,
  EquityPoint,
  InstrumentBreakdown,
  JournalEntry,
  JournalOutcome,
  JournalSide,
  JournalSummary,
  PerformanceBreakdown,
  PerformanceFilter,
  PerformanceSummary,
  PropFirmTemplate,
  Strategy,
  StrategyBreakdown,
  StrategyRiskContext,
  StrategyStatus,
  UpdateStrategyInput,
};
