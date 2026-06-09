// tests/orb-backtest.test.ts
// Deterministic Sigma ORB Runner backtest tests. No network calls.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runSigmaOrbBacktest } from '../core/backtest/orb-runner.js';
import type { FuturesAggBar } from '../core/market-data/index.js';

function ns(iso: string): number {
  return new Date(iso).getTime() * 1_000_000;
}

function bar(
  iso: string,
  open: number,
  high: number,
  low: number,
  close: number,
  sessionEndDate = iso.slice(0, 10),
): FuturesAggBar {
  return {
    ticker: 'ESU6',
    windowStart: ns(iso),
    sessionEndDate,
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

function dayBars(date: string, values: Array<[string, number, number, number, number]>): FuturesAggBar[] {
  return values.map(([time, open, high, low, close]) => bar(`${date}T${time}:00.000Z`, open, high, low, close, date));
}

describe('Sigma ORB Runner backtest', () => {
  it('takes first long close above the opening range and exits at 2R target', () => {
    const bars = dayBars('2026-06-10', [
      ['13:30', 100, 101, 99, 100],
      ['13:35', 100, 102, 100, 101],
      ['13:40', 101, 103, 100, 102],
      ['13:45', 102, 106, 102, 104],
      ['13:50', 104, 113, 103, 112],
    ]);

    const result = runSigmaOrbBacktest('ESU6', bars, { allowedWeekdays: 'all' });

    assert.equal(result.metrics.totalTrades, 1);
    const trade = result.trades[0];
    assert.equal(trade.direction, 'long');
    assert.equal(trade.entry, 104);
    assert.equal(trade.stop, 100);
    assert.equal(trade.target, 112);
    assert.equal(trade.exitReason, 'target');
    assert.equal(trade.pnlDollars, 400);
    assert.equal(result.metrics.winRate, 1);
  });

  it('takes first short close below the opening range and exits at stop', () => {
    const bars = dayBars('2026-06-10', [
      ['13:30', 100, 101, 99, 100],
      ['13:35', 100, 102, 100, 101],
      ['13:40', 101, 103, 100, 102],
      ['13:45', 101, 102, 94, 98],
      ['13:50', 98, 103, 97, 102],
    ]);

    const result = runSigmaOrbBacktest('ESU6', bars, { allowedWeekdays: 'all' });

    assert.equal(result.metrics.totalTrades, 1);
    const trade = result.trades[0];
    assert.equal(trade.direction, 'short');
    assert.equal(trade.entry, 98);
    assert.equal(trade.stop, 102);
    assert.equal(trade.target, 90);
    assert.equal(trade.exitReason, 'stop');
    assert.equal(trade.pnlDollars, -200);
  });

  it('applies the default Wednesday and Friday day filter', () => {
    const bars = dayBars('2026-06-09', [
      ['13:30', 100, 101, 99, 100],
      ['13:35', 100, 102, 100, 101],
      ['13:40', 101, 103, 100, 102],
      ['13:45', 102, 106, 102, 104],
      ['13:50', 104, 113, 103, 112],
    ]);

    const result = runSigmaOrbBacktest('ESU6', bars);

    assert.equal(result.metrics.totalTrades, 0);
    assert.equal(result.days[0].status, 'day_filtered');
    assert.equal(result.metrics.skippedDayFilter, 1);
  });

  it('applies skipped contract month codes', () => {
    const bars = dayBars('2026-02-06', [
      ['14:30', 100, 101, 99, 100],
      ['14:35', 100, 102, 100, 101],
      ['14:40', 101, 103, 100, 102],
      ['14:45', 102, 106, 102, 104],
      ['14:50', 104, 113, 103, 112],
    ]);

    const result = runSigmaOrbBacktest('ESG6', bars, { allowedWeekdays: 'all' });

    assert.equal(result.metrics.totalTrades, 0);
    assert.equal(result.days[0].status, 'month_filtered');
    assert.equal(result.metrics.skippedMonthFilter, 1);
  });

  it('marks same-candle stop and target exits as ambiguous and resolves stop-first', () => {
    const bars = dayBars('2026-06-10', [
      ['13:30', 100, 101, 99, 100],
      ['13:35', 100, 102, 100, 101],
      ['13:40', 101, 103, 100, 102],
      ['13:45', 102, 106, 102, 104],
      ['13:50', 104, 113, 99, 110],
    ]);

    const result = runSigmaOrbBacktest('ESU6', bars, { allowedWeekdays: 'all' });

    assert.equal(result.metrics.totalTrades, 1);
    assert.equal(result.metrics.ambiguousTrades, 1);
    assert.equal(result.trades[0].ambiguousExit, true);
    assert.equal(result.trades[0].exitReason, 'stop');
  });

  it('uses adaptive stop distance after enough range history exists', () => {
    const bars: FuturesAggBar[] = [];
    for (let i = 0; i < 2; i++) {
      const date = i === 0 ? '2026-06-08' : '2026-06-09';
      bars.push(...dayBars(date, [
        ['13:30', 100, 101, 99, 100],
        ['13:35', 100, 102, 100, 101],
        ['13:40', 101, 103, 100, 102],
        ['13:45', 102, 104, 102, 103],
      ]));
    }
    bars.push(...dayBars('2026-06-10', [
      ['13:30', 100, 101, 99, 100],
      ['13:35', 100, 102, 100, 101],
      ['13:40', 101, 120, 100, 118],
      ['13:45', 118, 122, 117, 121],
      ['13:50', 121, 150, 118, 145],
    ]));

    const result = runSigmaOrbBacktest('ESU6', bars, {
      allowedWeekdays: 'all',
      adaptiveLookback: 2,
      adaptiveRangeMultiplier: 1.5,
    });

    assert.equal(result.metrics.totalTrades, 1);
    const adaptiveTrade = result.trades[0];
    assert.equal(adaptiveTrade.adaptiveStopApplied, true);
    assert.equal(adaptiveTrade.averageOrbRange, 4);
    assert.equal(adaptiveTrade.stopDistance, 6);
  });

  it('charges slippage and commission without changing raw gross points', () => {
    const bars = dayBars('2026-06-10', [
      ['13:30', 100, 101, 99, 100],
      ['13:35', 100, 102, 100, 101],
      ['13:40', 101, 103, 100, 102],
      ['13:45', 102, 106, 102, 104],
      ['13:50', 104, 113, 103, 112],
    ]);

    const result = runSigmaOrbBacktest('MESU6', bars, {
      allowedWeekdays: 'all',
      slippageTicks: 1,
      commissionPerContract: 0.55,
    });

    const trade = result.trades[0];
    assert.equal(trade.grossPoints, 8);
    assert.equal(trade.netPoints, 7.5);
    assert.equal(trade.pnlDollars, 36.4);
  });

  it('uses sessionEndDate weekday instead of overnight timestamp weekday', () => {
    const bars = [
      bar('2026-06-08T00:00:00.000Z', 99, 100, 98, 99, '2026-06-08'),
      ...dayBars('2026-06-08', [
        ['13:30', 100, 101, 99, 100],
        ['13:35', 100, 102, 100, 101],
        ['13:40', 101, 103, 100, 102],
        ['13:45', 102, 106, 102, 104],
        ['13:50', 104, 113, 103, 112],
      ]),
    ];

    const result = runSigmaOrbBacktest('ESU6', bars, { allowedWeekdays: ['MON'] });

    assert.equal(result.days[0].weekday, 'MON');
    assert.equal(result.metrics.totalTrades, 1);
  });
});
