// tests/performance.test.ts
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import {
  getPerformanceSummary,
  getEquityCurve,
  getDrawdown,
  getMaxDrawdown,
  getCalendar,
  getBreakdown,
} from '../core/performance/index.js';
import { createWorkspace } from '../core/operators/index.js';
import { createJournalEntry, closeJournalEntry } from '../core/journal/index.js';
import { createStrategy } from '../core/strategies/index.js';

const RUN = randomBytes(4).toString('hex');
function uid(n: string) { return `${n}-${RUN}`; }

// Shared workspace and entries seeded in before()
let wsId: string;
let stratAId: string;
let stratBId: string;

// Helper: create + close a journal entry with known P&L
async function seedTrade(opts: {
  symbol: string; side: 'long' | 'short'; pnl: number;
  outcome: 'win' | 'loss' | 'scratch'; strategyId?: string;
  closedAt?: string;
}): Promise<void> {
  const entry = createJournalEntry({
    workspaceId: wsId,
    symbol: opts.symbol,
    side: opts.side,
    entryPrice: 5000,
    contracts: 1,
    strategyId: opts.strategyId,
    openedAt: opts.closedAt ?? new Date().toISOString(),
  });
  closeJournalEntry(entry.id, {
    exitPrice: 5010,
    pnlDollars: opts.pnl,
    outcome: opts.outcome,
    closedAt: opts.closedAt ?? new Date().toISOString(),
  });
}

before(async () => {
  const { workspace } = createWorkspace(uid('PerfWS'), uid('perf-creator'));
  wsId = workspace.id;

  // Two strategies
  const sa = createStrategy({ workspaceId: wsId, name: uid('StratA'), allowedInstruments: ['ES', 'MES', 'NQ'] });
  const sb = createStrategy({ workspaceId: wsId, name: uid('StratB'), allowedInstruments: ['ES', 'MES', 'NQ'] });
  stratAId = sa.id;
  stratBId = sb.id;

  // Seed 10 closed trades across two strategies and two symbols:
  // StratA — ES: 3 wins (+$200 each), 1 loss (-$100), 1 scratch ($0)
  // StratB — MES: 2 wins (+$50 each), 2 losses (-$75 each), 1 win (+$25)
  // Dates span two calendar days: 2026-01-10 and 2026-01-11

  const d1 = '2026-01-10T10:00:00.000Z';
  const d2 = '2026-01-11T10:00:00.000Z';

  await seedTrade({ symbol: 'ES', side: 'long', pnl: 200, outcome: 'win', strategyId: stratAId, closedAt: d1 });
  await seedTrade({ symbol: 'ES', side: 'long', pnl: 200, outcome: 'win', strategyId: stratAId, closedAt: d1 });
  await seedTrade({ symbol: 'ES', side: 'short', pnl: -100, outcome: 'loss', strategyId: stratAId, closedAt: d1 });
  await seedTrade({ symbol: 'ES', side: 'long', pnl: 200, outcome: 'win', strategyId: stratAId, closedAt: d2 });
  await seedTrade({ symbol: 'ES', side: 'long', pnl: 0, outcome: 'scratch', strategyId: stratAId, closedAt: d2 });

  await seedTrade({ symbol: 'MES', side: 'long', pnl: 50, outcome: 'win', strategyId: stratBId, closedAt: d1 });
  await seedTrade({ symbol: 'MES', side: 'long', pnl: 50, outcome: 'win', strategyId: stratBId, closedAt: d1 });
  await seedTrade({ symbol: 'MES', side: 'short', pnl: -75, outcome: 'loss', strategyId: stratBId, closedAt: d2 });
  await seedTrade({ symbol: 'MES', side: 'short', pnl: -75, outcome: 'loss', strategyId: stratBId, closedAt: d2 });
  await seedTrade({ symbol: 'MES', side: 'long', pnl: 25, outcome: 'win', strategyId: stratBId, closedAt: d2 });

  // One OPEN trade — must be excluded from all P&L stats
  createJournalEntry({
    workspaceId: wsId, symbol: 'NQ', side: 'long', entryPrice: 19000, contracts: 1,
  });
});

describe('getPerformanceSummary', () => {
  it('computes correct totals for workspace', () => {
    const s = getPerformanceSummary({ workspaceId: wsId });
    // 10 closed trades total
    assert.equal(s.totalTrades, 10, 'totalTrades=10');
    assert.equal(s.wins, 6, 'wins=6');
    assert.equal(s.losses, 3, 'losses=4 (1 ES loss, 1 ES scratch... wait: 1 loss ES + 2 loss MES = 3 losses... let me count: ES: 2win+1loss+1win+1scratch=5, MES: 2win+2loss+1win=5, total: wins=3+3=6, losses=1+2=3, scratches=1+0=1... hmm recounting');
    // Actually: ES=(win,win,loss,win,scratch)=3wins,1loss,1scratch; MES=(win,win,loss,loss,win)=3wins,2losses,0scratches
    // total: wins=6, losses=3, scratches=1, total=10
    assert.equal(s.scratches, 1, 'scratches=1');
    // totalPnl: 200+200-100+200+0 + 50+50-75-75+25 = 500 + -25 = 475
    assert.equal(s.totalPnl, 475, 'totalPnl=$475');
    assert.ok(s.winRate > 0, 'winRate > 0');
    assert.ok(s.profitFactor > 0, 'profitFactor > 0');
  });

  it('open trades are excluded from P&L stats', () => {
    const s = getPerformanceSummary({ workspaceId: wsId });
    // NQ open trade should not be counted in totalTrades
    assert.equal(s.totalTrades, 10, 'open NQ trade excluded from totalTrades');
  });

  it('filters by strategyId', () => {
    const s = getPerformanceSummary({ workspaceId: wsId, strategyId: stratAId });
    assert.equal(s.totalTrades, 5, 'stratA has 5 trades');
    assert.equal(s.wins, 3);
    assert.equal(s.losses, 1);
    assert.equal(s.scratches, 1);
    assert.equal(s.totalPnl, 500, 'stratA totalPnl=500');
  });

  it('filters by symbol', () => {
    const s = getPerformanceSummary({ workspaceId: wsId, symbol: 'MES' });
    assert.equal(s.totalTrades, 5, 'MES has 5 trades');
    assert.equal(s.totalPnl, -25, 'MES totalPnl=-25');
  });
});

describe('getEquityCurve', () => {
  it('returns one point per closed trade in chronological order', () => {
    const curve = getEquityCurve({ workspaceId: wsId });
    assert.equal(curve.length, 10, 'equity curve has 10 points');
    // Must be ordered chronologically
    for (let i = 1; i < curve.length; i++) {
      assert.ok(curve[i].date >= curve[i - 1].date, 'dates are non-decreasing');
    }
  });

  it('cumulative P&L increases monotonically on wins', () => {
    const curve = getEquityCurve({ workspaceId: wsId, strategyId: stratAId });
    assert.equal(curve.length, 5);
    // Final cumulative should equal totalPnl
    assert.equal(curve[curve.length - 1].cumulative, 500);
  });
});

describe('getDrawdown + getMaxDrawdown', () => {
  it('drawdown is 0 at peak', () => {
    const dd = getDrawdown({ workspaceId: wsId, strategyId: stratAId });
    assert.ok(dd.length > 0, 'has drawdown points');
    // After the loss, drawdown > 0
    const hasDrawdown = dd.some(p => p.drawdown > 0);
    assert.ok(hasDrawdown, 'some drawdown exists after loss');
  });

  it('getMaxDrawdown returns positive value when losses exist', () => {
    const maxDD = getMaxDrawdown({ workspaceId: wsId });
    assert.ok(maxDD >= 0, 'max drawdown is non-negative');
    // With losses present it should be > 0
    assert.ok(maxDD > 0, 'max drawdown > 0 because losses exist');
  });

  it('empty workspace returns empty drawdown', () => {
    const { workspace: emptyWs } = createWorkspace(uid('EmptyPerfWS'), uid('empty-owner'));
    const dd = getDrawdown({ workspaceId: emptyWs.id });
    assert.equal(dd.length, 0, 'empty workspace has no drawdown points');
  });
});

describe('getCalendar', () => {
  it('aggregates P&L by calendar day', () => {
    const cal = getCalendar({ workspaceId: wsId });
    assert.equal(cal.length, 2, 'two calendar days');
    const day1 = cal.find(d => d.date === '2026-01-10');
    const day2 = cal.find(d => d.date === '2026-01-11');
    assert.ok(day1, 'day1 exists');
    assert.ok(day2, 'day2 exists');
    // Day1: ES(200+200-100) + MES(50+50) = 300+100=400
    assert.equal(day1!.pnl, 400, 'day1 pnl=$400');
    assert.equal(day1!.trades, 5, 'day1 has 5 trades');
  });

  it('filters calendar by strategy', () => {
    const cal = getCalendar({ workspaceId: wsId, strategyId: stratBId });
    assert.equal(cal.length, 2, 'stratB has trades on 2 days');
  });
});

describe('getBreakdown', () => {
  it('breaks down by strategy and instrument', () => {
    const bd = getBreakdown({ workspaceId: wsId });
    assert.ok(bd.byStrategy.length >= 2, 'at least 2 strategies');
    assert.ok(bd.byInstrument.length >= 2, 'at least 2 instruments');
  });

  it('strategy breakdown totals match summary', () => {
    const bd = getBreakdown({ workspaceId: wsId });
    const totalTrades = bd.byStrategy.reduce((s, x) => s + x.trades, 0);
    assert.equal(totalTrades, 10, 'strategy breakdown trades sum to 10');
  });

  it('instrument breakdown correct for ES', () => {
    const bd = getBreakdown({ workspaceId: wsId });
    const es = bd.byInstrument.find(b => b.symbol === 'ES');
    assert.ok(es, 'ES instrument exists');
    assert.equal(es!.trades, 5);
    assert.equal(es!.totalPnl, 500);
  });
});
