// core/backtest/orb-runner.ts
// Deterministic Sigma ORB Runner research backtester. No broker execution.

import type { FuturesAggBar } from '../market-data/index.js';

export type OrbDirection = 'long' | 'short';
export type OrbExitReason = 'target' | 'stop' | 'eod';
export type OrbOutcome = 'win' | 'loss' | 'scratch';
export type OrbWeekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

export interface OrbBacktestSettings {
  orbStartTime?: string;
  orbMinutes?: number;
  eodExitTime?: string;
  rewardRisk?: number;
  adaptiveLookback?: number;
  adaptiveRangeMultiplier?: number;
  abnormalRangeMinRatio?: number;
  abnormalRangeMaxRatio?: number;
  allowedWeekdays?: OrbWeekday[] | 'all';
  skipMonthCodes?: string[];
  contracts?: number;
  commissionPerContract?: number;
  slippageTicks?: number;
}

export interface OrbTrade {
  id: string;
  ticker: string;
  sessionDate: string;
  weekday: OrbWeekday;
  monthCode: string | null;
  direction: OrbDirection;
  signalTime: string;
  entryTime: string;
  exitTime: string;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  exitReason: OrbExitReason;
  outcome: OrbOutcome;
  contracts: number;
  grossPoints: number;
  netPoints: number;
  pnlDollars: number;
  orbHigh: number;
  orbLow: number;
  orbRange: number;
  stopDistance: number;
  adaptiveStopApplied: boolean;
  averageOrbRange?: number;
  ambiguousExit: boolean;
  barsHeld: number;
}

export interface OrbDayResult {
  sessionDate: string;
  weekday: OrbWeekday;
  monthCode: string | null;
  status: 'traded' | 'missing_orb' | 'day_filtered' | 'month_filtered' | 'no_signal';
  orbHigh?: number;
  orbLow?: number;
  orbRange?: number;
  tradeId?: string;
  reason?: string;
}

export interface OrbBacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number;
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  averageTrade: number;
  medianTrade: number;
  maxDrawdown: number;
  ambiguousTrades: number;
  testedDays: number;
  eligibleDays: number;
  skippedDayFilter: number;
  skippedMonthFilter: number;
  missingOrbDays: number;
  noSignalDays: number;
}

export interface OrbBreakdownRow {
  key: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  averageTrade: number;
  profitFactor: number | null;
}

export interface OrbBacktestResult {
  strategyId: 'sigma-orb-runner';
  ticker: string;
  settings: Required<OrbBacktestSettings> & { allowedWeekdays: OrbWeekday[] | 'all' };
  metrics: OrbBacktestMetrics;
  trades: OrbTrade[];
  days: OrbDayResult[];
  breakdown: {
    weekday: OrbBreakdownRow[];
    monthCode: OrbBreakdownRow[];
  };
  notes: string[];
}

interface LocalBar extends FuturesAggBar {
  iso: string;
  date: string;
  weekday: OrbWeekday;
  minuteOfDay: number;
}

interface DayBucket {
  sessionDate: string;
  weekday: OrbWeekday;
  monthCode: string | null;
  bars: LocalBar[];
}

const WEEKDAY_MAP: Record<string, OrbWeekday> = {
  Sun: 'SUN',
  Mon: 'MON',
  Tue: 'TUE',
  Wed: 'WED',
  Thu: 'THU',
  Fri: 'FRI',
  Sat: 'SAT',
};

const CONTRACT_SPECS: Record<string, { pointValue: number; tickSize: number }> = {
  ES: { pointValue: 50, tickSize: 0.25 },
  MES: { pointValue: 5, tickSize: 0.25 },
  NQ: { pointValue: 20, tickSize: 0.25 },
  MNQ: { pointValue: 2, tickSize: 0.25 },
};

const MONTH_CODES = new Set(['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z']);

function defaultSettings(): Required<OrbBacktestSettings> & { allowedWeekdays: OrbWeekday[] | 'all' } {
  return {
    orbStartTime: '09:30',
    orbMinutes: 15,
    eodExitTime: '15:55',
    rewardRisk: 2,
    adaptiveLookback: 30,
    adaptiveRangeMultiplier: 1.5,
    abnormalRangeMinRatio: 0.5,
    abnormalRangeMaxRatio: 2,
    allowedWeekdays: ['WED', 'FRI'],
    skipMonthCodes: ['F', 'G', 'H'],
    contracts: 1,
    commissionPerContract: 0,
    slippageTicks: 0,
  };
}

function timeToMinutes(value: string): number {
  const match = value.match(/^([01][0-9]|2[0-3]):([0-5][0-9])$/);
  if (!match) throw new Error(`invalid time '${value}', expected HH:MM`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function dateFromNs(ns: number): Date {
  return new Date(Math.floor(ns / 1_000_000));
}

function localParts(bar: FuturesAggBar): LocalBar {
  const date = dateFromNs(bar.windowStart);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  const weekday = WEEKDAY_MAP[get('weekday')];
  if (!weekday) throw new Error(`unsupported weekday '${get('weekday')}'`);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return {
    ...bar,
    iso: date.toISOString(),
    date: bar.sessionEndDate ?? `${year}-${month}-${day}`,
    weekday,
    minuteOfDay: hour * 60 + minute,
  };
}

function productCode(ticker: string): string {
  const upper = ticker.toUpperCase();
  if (upper.startsWith('MNQ')) return 'MNQ';
  if (upper.startsWith('MES')) return 'MES';
  if (upper.startsWith('NQ')) return 'NQ';
  if (upper.startsWith('ES')) return 'ES';
  return upper.replace(/[^A-Z].*$/, '');
}

function monthCode(ticker: string): string | null {
  const letters = ticker.toUpperCase().replace(/[^A-Z]/g, '');
  for (let i = letters.length - 1; i >= 0; i--) {
    if (MONTH_CODES.has(letters[i])) return letters[i];
  }
  return null;
}

function groupBySession(bars: FuturesAggBar[], ticker: string): DayBucket[] {
  const grouped = new Map<string, LocalBar[]>();
  for (const bar of bars) {
    const local = localParts(bar);
    const key = local.date;
    grouped.set(key, [...(grouped.get(key) ?? []), local]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sessionDate, dayBars]) => {
      const sorted = dayBars.sort((a, b) => a.windowStart - b.windowStart);
      return {
        sessionDate,
        weekday: weekdayForSessionDate(sessionDate, sorted[0].weekday),
        monthCode: monthCode(ticker),
        bars: sorted,
      };
    });
}

function weekdayForSessionDate(sessionDate: string, fallback: OrbWeekday): OrbWeekday {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return fallback;
  const date = new Date(`${sessionDate}T12:00:00.000Z`);
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(date);
  return WEEKDAY_MAP[label] ?? fallback;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function profitFactor(trades: OrbTrade[]): number | null {
  const grossProfit = trades.filter(t => t.pnlDollars > 0).reduce((sum, t) => sum + t.pnlDollars, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnlDollars < 0).reduce((sum, t) => sum + t.pnlDollars, 0));
  if (grossLoss === 0) return grossProfit > 0 ? null : 0;
  return grossProfit / grossLoss;
}

function maxDrawdown(trades: OrbTrade[]): number {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const trade of trades) {
    equity += trade.pnlDollars;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return maxDd;
}

function rowFor(key: string, trades: OrbTrade[]): OrbBreakdownRow {
  const wins = trades.filter(trade => trade.outcome === 'win').length;
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnlDollars, 0);
  return {
    key,
    trades: trades.length,
    wins,
    winRate: trades.length === 0 ? 0 : wins / trades.length,
    totalPnl,
    averageTrade: trades.length === 0 ? 0 : totalPnl / trades.length,
    profitFactor: profitFactor(trades),
  };
}

function buildBreakdown(trades: OrbTrade[], keyFn: (trade: OrbTrade) => string): OrbBreakdownRow[] {
  const grouped = new Map<string, OrbTrade[]>();
  for (const trade of trades) {
    const key = keyFn(trade);
    grouped.set(key, [...(grouped.get(key) ?? []), trade]);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => rowFor(key, rows));
}

function classifyOutcome(pnlDollars: number): OrbOutcome {
  if (pnlDollars > 0) return 'win';
  if (pnlDollars < 0) return 'loss';
  return 'scratch';
}

function calcMetrics(trades: OrbTrade[], days: OrbDayResult[]): OrbBacktestMetrics {
  const wins = trades.filter(t => t.outcome === 'win').length;
  const losses = trades.filter(t => t.outcome === 'loss').length;
  const scratches = trades.filter(t => t.outcome === 'scratch').length;
  const pnls = trades.map(t => t.pnlDollars);
  const totalPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);
  return {
    totalTrades: trades.length,
    wins,
    losses,
    scratches,
    winRate: trades.length === 0 ? 0 : wins / trades.length,
    totalPnl,
    grossProfit: pnls.filter(pnl => pnl > 0).reduce((sum, pnl) => sum + pnl, 0),
    grossLoss: Math.abs(pnls.filter(pnl => pnl < 0).reduce((sum, pnl) => sum + pnl, 0)),
    profitFactor: profitFactor(trades),
    averageTrade: trades.length === 0 ? 0 : totalPnl / trades.length,
    medianTrade: median(pnls),
    maxDrawdown: maxDrawdown(trades),
    ambiguousTrades: trades.filter(t => t.ambiguousExit).length,
    testedDays: days.length,
    eligibleDays: days.filter(day => !['missing_orb', 'day_filtered', 'month_filtered'].includes(day.status)).length,
    skippedDayFilter: days.filter(day => day.status === 'day_filtered').length,
    skippedMonthFilter: days.filter(day => day.status === 'month_filtered').length,
    missingOrbDays: days.filter(day => day.status === 'missing_orb').length,
    noSignalDays: days.filter(day => day.status === 'no_signal').length,
  };
}

export function runSigmaOrbBacktest(
  ticker: string,
  bars: FuturesAggBar[],
  overrides: OrbBacktestSettings = {},
): OrbBacktestResult {
  const settings = { ...defaultSettings(), ...overrides };
  const orbStart = timeToMinutes(settings.orbStartTime);
  const orbEnd = orbStart + settings.orbMinutes;
  const eodExit = timeToMinutes(settings.eodExitTime);
  const product = productCode(ticker);
  const spec = CONTRACT_SPECS[product] ?? { pointValue: 1, tickSize: 0.01 };
  const sortedBars = [...bars].sort((a, b) => a.windowStart - b.windowStart);
  const buckets = groupBySession(sortedBars, ticker);
  const trades: OrbTrade[] = [];
  const days: OrbDayResult[] = [];
  const rangeHistory: number[] = [];
  const skippedMonths = new Set(settings.skipMonthCodes.map(code => code.toUpperCase()));

  for (const day of buckets) {
    const orbBars = day.bars.filter(bar => bar.minuteOfDay >= orbStart && bar.minuteOfDay < orbEnd);
    if (orbBars.length === 0) {
      days.push({ sessionDate: day.sessionDate, weekday: day.weekday, monthCode: day.monthCode, status: 'missing_orb', reason: 'No bars inside ORB window' });
      continue;
    }

    const orbHigh = Math.max(...orbBars.map(bar => bar.high));
    const orbLow = Math.min(...orbBars.map(bar => bar.low));
    const orbRange = orbHigh - orbLow;
    if (orbRange <= 0) {
      days.push({ sessionDate: day.sessionDate, weekday: day.weekday, monthCode: day.monthCode, status: 'missing_orb', reason: 'ORB range was not positive' });
      continue;
    }

    const recentRanges = rangeHistory.slice(-settings.adaptiveLookback);
    const averageOrbRange = recentRanges.length >= settings.adaptiveLookback ? average(recentRanges) : undefined;
    const rangeRatio = averageOrbRange ? orbRange / averageOrbRange : undefined;
    const adaptiveStopApplied = Boolean(
      averageOrbRange &&
      rangeRatio &&
      (rangeRatio < settings.abnormalRangeMinRatio || rangeRatio > settings.abnormalRangeMaxRatio),
    );
    const stopDistance = adaptiveStopApplied ? averageOrbRange! * settings.adaptiveRangeMultiplier : orbRange;
    rangeHistory.push(orbRange);

    const baseDay = { sessionDate: day.sessionDate, weekday: day.weekday, monthCode: day.monthCode, orbHigh, orbLow, orbRange };
    if (settings.allowedWeekdays !== 'all' && !settings.allowedWeekdays.includes(day.weekday)) {
      days.push({ ...baseDay, status: 'day_filtered', reason: `${day.weekday} is not allowed` });
      continue;
    }
    if (day.monthCode && skippedMonths.has(day.monthCode)) {
      days.push({ ...baseDay, status: 'month_filtered', reason: `${day.monthCode} contract month is skipped` });
      continue;
    }

    const tradeWindow = day.bars.filter(bar => bar.minuteOfDay >= orbEnd && bar.minuteOfDay <= eodExit);
    const signalIndex = tradeWindow.findIndex(bar => bar.close > orbHigh || bar.close < orbLow);
    if (signalIndex === -1) {
      days.push({ ...baseDay, status: 'no_signal', reason: 'No close outside ORB' });
      continue;
    }

    const signalBar = tradeWindow[signalIndex];
    const direction: OrbDirection = signalBar.close > orbHigh ? 'long' : 'short';
    const entry = (signalBar.high + signalBar.low) / 2;
    const stop = direction === 'long' ? entry - stopDistance : entry + stopDistance;
    const target = direction === 'long' ? entry + stopDistance * settings.rewardRisk : entry - stopDistance * settings.rewardRisk;
    let exit = signalBar.close;
    let exitReason: OrbExitReason = 'eod';
    let exitTime = signalBar.iso;
    let ambiguousExit = false;
    let barsHeld = 0;

    const exitBars = tradeWindow.slice(signalIndex + 1);
    for (const [offset, bar] of exitBars.entries()) {
      const targetHit = direction === 'long' ? bar.high >= target : bar.low <= target;
      const stopHit = direction === 'long' ? bar.low <= stop : bar.high >= stop;
      if (!targetHit && !stopHit) continue;

      ambiguousExit = targetHit && stopHit;
      exitReason = stopHit ? 'stop' : 'target';
      exit = exitReason === 'stop' ? stop : target;
      exitTime = bar.iso;
      barsHeld = offset + 1;
      break;
    }

    if (exitReason === 'eod') {
      const lastBar = exitBars.at(-1) ?? signalBar;
      exit = lastBar.close;
      exitTime = lastBar.iso;
      barsHeld = exitBars.length;
    }

    const grossPoints = direction === 'long' ? exit - entry : entry - exit;
    const slippageCostPoints = settings.slippageTicks * spec.tickSize * 2;
    const netPoints = grossPoints - slippageCostPoints;
    const pnlDollars = netPoints * spec.pointValue * settings.contracts - settings.commissionPerContract * settings.contracts * 2;
    const id = `${ticker.toUpperCase()}-${day.sessionDate}-${trades.length + 1}`;
    const trade: OrbTrade = {
      id,
      ticker: ticker.toUpperCase(),
      sessionDate: day.sessionDate,
      weekday: day.weekday,
      monthCode: day.monthCode,
      direction,
      signalTime: signalBar.iso,
      entryTime: signalBar.iso,
      exitTime,
      entry,
      stop,
      target,
      exit,
      exitReason,
      outcome: classifyOutcome(pnlDollars),
      contracts: settings.contracts,
      grossPoints,
      netPoints,
      pnlDollars,
      orbHigh,
      orbLow,
      orbRange,
      stopDistance,
      adaptiveStopApplied,
      averageOrbRange,
      ambiguousExit,
      barsHeld,
    };
    trades.push(trade);
    days.push({ ...baseDay, status: 'traded', tradeId: id });
  }

  return {
    strategyId: 'sigma-orb-runner',
    ticker: ticker.toUpperCase(),
    settings,
    metrics: calcMetrics(trades, days),
    trades,
    days,
    breakdown: {
      weekday: buildBreakdown(trades, trade => trade.weekday),
      monthCode: buildBreakdown(trades, trade => trade.monthCode ?? 'unknown'),
    },
    notes: [
      'Research-only deterministic backtest. No broker orders are created.',
      'Signal bar closes outside ORB; entry is modeled at the breakout candle midpoint with exits evaluated from the next bar.',
      'If stop and target are inside the same later candle, the result is marked ambiguous and resolved stop-first.',
    ],
  };
}
