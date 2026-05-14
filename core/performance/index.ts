// core/performance/index.ts
// Sigma Core OS v0.9.0 — Performance analytics engine
// Computes equity curve, drawdown, streaks, calendar P&L,
// strategy/instrument breakdown, and summary stats.
// Source: closed journal_entries only (open trades excluded from P&L stats).

import { db } from '../db.js';

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface PerformanceFilter {
  workspaceId: string;
  strategyId?: string;
  symbol?: string;
  from?: string;   // ISO date string, inclusive
  to?: string;     // ISO date string, inclusive
}

// ---------------------------------------------------------------------------
// Row type from journal_entries
// ---------------------------------------------------------------------------

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
  closedAt: string;  // ISO string
  openedAt: string;
}

// ---------------------------------------------------------------------------
// Internal query helper — returns closed entries matching filters
// ---------------------------------------------------------------------------

function fetchClosed(f: PerformanceFilter): ClosedEntry[] {
  const conditions: string[] = ["outcome != 'open'", "pnlDollars IS NOT NULL"];
  const bindings: Record<string, string | number> = {};

  conditions.push('workspaceId = :wid');
  bindings[':wid'] = f.workspaceId;

  if (f.strategyId) {
    conditions.push('strategyId = :sid');
    bindings[':sid'] = f.strategyId;
  }
  if (f.symbol) {
    conditions.push('symbol = :sym');
    bindings[':sym'] = f.symbol.toUpperCase();
  }
  if (f.from) {
    conditions.push('closedAt >= :from');
    bindings[':from'] = f.from;
  }
  if (f.to) {
    conditions.push('closedAt <= :to');
    bindings[':to'] = f.to;
  }

  const sql = `SELECT * FROM journal_entries WHERE ${conditions.join(' AND ')} ORDER BY closedAt ASC`;
  return db.all(sql, bindings).map(r => ({
    id: r['id'] as string,
    workspaceId: r['workspaceId'] as string,
    strategyId: r['strategyId'] as string | null,
    symbol: r['symbol'] as string,
    side: r['side'] as string,
    entryPrice: Number(r['entryPrice']),
    exitPrice: Number(r['exitPrice']),
    contracts: Number(r['contracts']),
    pnlDollars: Number(r['pnlDollars']),
    outcome: r['outcome'] as 'win' | 'loss' | 'scratch',
    closedAt: r['closedAt'] as string,
    openedAt: r['openedAt'] as string,
  }));
}

// ---------------------------------------------------------------------------
// Types — exported analytics shapes
// ---------------------------------------------------------------------------

export interface PerformanceSummary {
  workspaceId: string;
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number;           // 0–100
  totalPnl: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;      // grossWins / |grossLosses| — Infinity if no losses
  expectancy: number;        // average P&L per trade
  averageRMultiple: number;  // average pnl / |average loss|, 0 if no losses
  maxWinStreak: number;
  maxLossStreak: number;
  largestWin: number;
  largestLoss: number;
}

export interface EquityPoint {
  date: string;     // ISO date (YYYY-MM-DD)
  pnl: number;      // P&L for that close
  cumulative: number;
  tradeId: string;
}

export interface DrawdownPoint {
  date: string;
  cumulative: number;
  peak: number;
  drawdown: number;       // absolute dollars from peak
  drawdownPct: number;    // percent from peak
}

export interface CalendarDay {
  date: string;         // YYYY-MM-DD
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
}

export interface StrategyBreakdown {
  strategyId: string | null;
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  averagePnl: number;
  profitFactor: number;
}

export interface InstrumentBreakdown {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  averagePnl: number;
  profitFactor: number;
}

// ---------------------------------------------------------------------------
// Streak calculation helper
// ---------------------------------------------------------------------------

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
      // scratch resets neither streak — counts as neutral
      curWin = 0;
      curLoss = 0;
    }
  }
  return { maxWin, maxLoss };
}

// ---------------------------------------------------------------------------
// Profit factor helper
// ---------------------------------------------------------------------------

function calcProfitFactor(entries: ClosedEntry[]): number {
  const grossWins = entries.filter(e => e.pnlDollars > 0).reduce((s, e) => s + e.pnlDollars, 0);
  const grossLosses = Math.abs(entries.filter(e => e.pnlDollars < 0).reduce((s, e) => s + e.pnlDollars, 0));
  if (grossLosses === 0) return grossWins > 0 ? Infinity : 0;
  return +(grossWins / grossLosses).toFixed(2);
}

// ---------------------------------------------------------------------------
// getPerformanceSummary
// ---------------------------------------------------------------------------

export function getPerformanceSummary(f: PerformanceFilter): PerformanceSummary {
  const entries = fetchClosed(f);
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

// ---------------------------------------------------------------------------
// getEquityCurve — cumulative P&L over time (per closed trade)
// ---------------------------------------------------------------------------

export function getEquityCurve(f: PerformanceFilter): EquityPoint[] {
  const entries = fetchClosed(f);
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

// ---------------------------------------------------------------------------
// getDrawdown — drawdown series from equity curve peak
// ---------------------------------------------------------------------------

export function getDrawdown(f: PerformanceFilter): DrawdownPoint[] {
  const curve = getEquityCurve(f);
  if (curve.length === 0) return [];

  let peak = 0;
  return curve.map(pt => {
    if (pt.cumulative > peak) peak = pt.cumulative;
    const drawdown = +(peak - pt.cumulative).toFixed(2);
    const drawdownPct = peak > 0 ? +((drawdown / peak) * 100).toFixed(2) : 0;
    return { date: pt.date, cumulative: pt.cumulative, peak, drawdown, drawdownPct };
  });
}

// ---------------------------------------------------------------------------
// getMaxDrawdown — single max drawdown value
// ---------------------------------------------------------------------------

export function getMaxDrawdown(f: PerformanceFilter): number {
  const points = getDrawdown(f);
  if (points.length === 0) return 0;
  return Math.max(...points.map(p => p.drawdown));
}

// ---------------------------------------------------------------------------
// getCalendar — daily P&L aggregation
// ---------------------------------------------------------------------------

export function getCalendar(f: PerformanceFilter): CalendarDay[] {
  const entries = fetchClosed(f);
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

// ---------------------------------------------------------------------------
// getBreakdown — by strategy and instrument
// ---------------------------------------------------------------------------

export interface PerformanceBreakdown {
  byStrategy: StrategyBreakdown[];
  byInstrument: InstrumentBreakdown[];
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

export function getBreakdown(f: PerformanceFilter): PerformanceBreakdown {
  const entries = fetchClosed(f);

  // Group by strategy
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

  // Group by symbol
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
