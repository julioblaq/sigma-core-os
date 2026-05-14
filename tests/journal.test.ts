// tests/journal.test.ts
// Slice 7c (v0.7.0): Trade Journal tests.
// Tests: create entry, list by workspace, filter by strategy, close entry,
//        double close blocked, P&L calculation, summary stats,
//        archived strategy journal visibility.
//
// Uses RUN suffix on all workspace names to prevent SLUG_TAKEN on persistent DB.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';

import {
  createJournalEntry,
  getJournalEntry,
  listJournalEntries,
  closeJournalEntry,
  getJournalSummary,
  JournalError,
} from '../core/journal/index.js';
import { createWorkspace } from '../core/operators/index.js';
import { createStrategy, archiveStrategy } from '../core/strategies/index.js';

const RUN = randomBytes(4).toString('hex');

function makeWorkspace(name: string): string {
  const { workspace } = createWorkspace(`${name}-${RUN}`, 'test-user');
  return workspace.id;
}

function makeStrategy(workspaceId: string, name: string): string {
  const s = createStrategy({ workspaceId, name, propFirmTemplate: 'custom' });
  return s.id;
}

// ---------------------------------------------------------------------------
// createJournalEntry
// ---------------------------------------------------------------------------

describe('createJournalEntry', () => {
  it('creates an open journal entry with correct fields', () => {
    const wsId = makeWorkspace('Journal Create Workspace');
    const entry = createJournalEntry({
      workspaceId: wsId,
      symbol: 'ES',
      side: 'long',
      entryPrice: 5000,
      contracts: 2,
      notes: 'Breakout trade',
      tags: ['momentum', 'breakout'],
    });

    assert.ok(entry.id, 'should have id');
    assert.equal(entry.workspaceId, wsId);
    assert.equal(entry.symbol, 'ES');
    assert.equal(entry.side, 'long');
    assert.equal(entry.entryPrice, 5000);
    assert.equal(entry.contracts, 2);
    assert.equal(entry.outcome, 'open');
    assert.equal(entry.notes, 'Breakout trade');
    assert.deepEqual(entry.tags, ['momentum', 'breakout']);
    assert.ok(entry.openedAt, 'should have openedAt');
    assert.equal(entry.exitPrice, undefined);
    assert.equal(entry.pnlDollars, undefined);
    assert.equal(entry.closedAt, undefined);

    // Fetch back
    const fetched = getJournalEntry(entry.id);
    assert.ok(fetched, 'should be retrievable');
    assert.equal(fetched!.symbol, 'ES');
  });

  it('creates entry with strategyId attached', () => {
    const wsId = makeWorkspace('Journal Strategy Workspace');
    const stratId = makeStrategy(wsId, 'MES Day Strategy');

    const entry = createJournalEntry({
      workspaceId: wsId,
      strategyId: stratId,
      symbol: 'MES',
      side: 'short',
      entryPrice: 5100,
      contracts: 5,
    });

    assert.equal(entry.strategyId, stratId);
    assert.equal(entry.symbol, 'MES');
    assert.equal(entry.side, 'short');
  });

  it('symbol is uppercased automatically', () => {
    const wsId = makeWorkspace('Symbol Case Workspace');
    const entry = createJournalEntry({ workspaceId: wsId, symbol: 'mnq', side: 'long', entryPrice: 18000, contracts: 1 });
    assert.equal(entry.symbol, 'MNQ');
  });

  it('rejects invalid side', () => {
    const wsId = makeWorkspace('Invalid Side Workspace');
    assert.throws(
      () => createJournalEntry({ workspaceId: wsId, symbol: 'ES', side: 'buy' as 'long', entryPrice: 5000, contracts: 1 }),
      (err: unknown) => { assert.ok(err instanceof JournalError); assert.equal(err.code, 'INVALID_SIDE'); return true; },
    );
  });

  it('rejects zero contracts', () => {
    const wsId = makeWorkspace('Zero Contracts Workspace');
    assert.throws(
      () => createJournalEntry({ workspaceId: wsId, symbol: 'ES', side: 'long', entryPrice: 5000, contracts: 0 }),
      (err: unknown) => { assert.ok(err instanceof JournalError); assert.equal(err.code, 'INVALID_CONTRACTS'); return true; },
    );
  });
});

// ---------------------------------------------------------------------------
// listJournalEntries
// ---------------------------------------------------------------------------

describe('listJournalEntries', () => {
  it('lists all entries for a workspace', () => {
    const wsId = makeWorkspace('List All Workspace');
    createJournalEntry({ workspaceId: wsId, symbol: 'ES', side: 'long', entryPrice: 5000, contracts: 1 });
    createJournalEntry({ workspaceId: wsId, symbol: 'NQ', side: 'short', entryPrice: 18000, contracts: 2 });

    const entries = listJournalEntries(wsId);
    assert.equal(entries.length, 2);
  });

  it('filters by strategyId', () => {
    const wsId = makeWorkspace('Filter Strategy Workspace');
    const stratId = makeStrategy(wsId, 'Filter Strategy');
    const otherStratId = makeStrategy(wsId, 'Other Filter Strategy');

    createJournalEntry({ workspaceId: wsId, strategyId: stratId, symbol: 'ES', side: 'long', entryPrice: 5000, contracts: 1 });
    createJournalEntry({ workspaceId: wsId, strategyId: stratId, symbol: 'ES', side: 'short', entryPrice: 5010, contracts: 1 });
    createJournalEntry({ workspaceId: wsId, strategyId: otherStratId, symbol: 'NQ', side: 'long', entryPrice: 18000, contracts: 1 });
    createJournalEntry({ workspaceId: wsId, symbol: 'MES', side: 'long', entryPrice: 5000, contracts: 3 });

    const filtered = listJournalEntries(wsId, stratId);
    assert.equal(filtered.length, 2, 'should only return entries for stratId');
    assert.ok(filtered.every(e => e.strategyId === stratId), 'all should match stratId');

    const all = listJournalEntries(wsId);
    assert.equal(all.length, 4, 'all should return 4');
  });

  it('returns empty array for workspace with no entries', () => {
    const wsId = makeWorkspace('Empty Journal Workspace');
    const entries = listJournalEntries(wsId);
    assert.equal(entries.length, 0);
  });
});

// ---------------------------------------------------------------------------
// closeJournalEntry
// ---------------------------------------------------------------------------

describe('closeJournalEntry', () => {
  it('closes an entry and records exit data', () => {
    const wsId = makeWorkspace('Close Entry Workspace');
    const entry = createJournalEntry({ workspaceId: wsId, symbol: 'ES', side: 'long', entryPrice: 5000, contracts: 1 });

    const closed = closeJournalEntry(entry.id, {
      exitPrice: 5010,
      pnlDollars: 500,
      outcome: 'win',
      notes: 'Clean breakout',
    });

    assert.equal(closed.outcome, 'win');
    assert.equal(closed.exitPrice, 5010);
    assert.equal(closed.pnlDollars, 500);
    assert.equal(closed.notes, 'Clean breakout');
    assert.ok(closed.closedAt, 'should have closedAt');

    // Fetch back
    const fetched = getJournalEntry(entry.id);
    assert.equal(fetched!.outcome, 'win');
    assert.equal(fetched!.pnlDollars, 500);
  });

  it('correctly records a loss', () => {
    const wsId = makeWorkspace('Loss Entry Workspace');
    const entry = createJournalEntry({ workspaceId: wsId, symbol: 'NQ', side: 'short', entryPrice: 18000, contracts: 2 });

    const closed = closeJournalEntry(entry.id, {
      exitPrice: 18050,
      pnlDollars: -200,
      outcome: 'loss',
    });

    assert.equal(closed.outcome, 'loss');
    assert.equal(closed.pnlDollars, -200);
  });

  it('double-close throws ALREADY_CLOSED', () => {
    const wsId = makeWorkspace('Double Close Workspace');
    const entry = createJournalEntry({ workspaceId: wsId, symbol: 'MES', side: 'long', entryPrice: 5000, contracts: 3 });
    closeJournalEntry(entry.id, { exitPrice: 5005, pnlDollars: 75, outcome: 'win' });

    assert.throws(
      () => closeJournalEntry(entry.id, { exitPrice: 5008, pnlDollars: 200, outcome: 'win' }),
      (err: unknown) => { assert.ok(err instanceof JournalError); assert.equal(err.code, 'ALREADY_CLOSED'); return true; },
    );
  });

  it('P&L calculation: scratch entry with zero pnl', () => {
    const wsId = makeWorkspace('Scratch Entry Workspace');
    const entry = createJournalEntry({ workspaceId: wsId, symbol: 'MNQ', side: 'long', entryPrice: 19000, contracts: 1 });
    const closed = closeJournalEntry(entry.id, { exitPrice: 19000, pnlDollars: 0, outcome: 'scratch' });
    assert.equal(closed.outcome, 'scratch');
    assert.equal(closed.pnlDollars, 0);
    assert.equal(closed.exitPrice, 19000);
  });
});

// ---------------------------------------------------------------------------
// getJournalSummary
// ---------------------------------------------------------------------------

describe('getJournalSummary', () => {
  it('computes correct summary stats', () => {
    const wsId = makeWorkspace('Summary Stats Workspace');

    // Create 4 entries: 2 wins, 1 loss, 1 open
    const e1 = createJournalEntry({ workspaceId: wsId, symbol: 'ES', side: 'long', entryPrice: 5000, contracts: 1 });
    const e2 = createJournalEntry({ workspaceId: wsId, symbol: 'ES', side: 'short', entryPrice: 5010, contracts: 1 });
    const e3 = createJournalEntry({ workspaceId: wsId, symbol: 'NQ', side: 'long', entryPrice: 18000, contracts: 2 });
    createJournalEntry({ workspaceId: wsId, symbol: 'MES', side: 'long', entryPrice: 5000, contracts: 5 }); // stays open

    closeJournalEntry(e1.id, { exitPrice: 5010, pnlDollars: 500, outcome: 'win' });
    closeJournalEntry(e2.id, { exitPrice: 5000, pnlDollars: 500, outcome: 'win' });
    closeJournalEntry(e3.id, { exitPrice: 17990, pnlDollars: -200, outcome: 'loss' });

    const summary = getJournalSummary(wsId);
    assert.equal(summary.totalTrades, 4);
    assert.equal(summary.openTrades, 1);
    assert.equal(summary.closedTrades, 3);
    assert.equal(summary.wins, 2);
    assert.equal(summary.losses, 1);
    assert.equal(summary.scratches, 0);
    assert.equal(summary.winRate, +(2 / 3 * 100).toFixed(1));
    assert.equal(summary.totalPnl, 800);
    assert.ok(summary.averagePnl > 0, 'average pnl should be positive');
  });

  it('summary filtered by strategyId shows only that strategy trades', () => {
    const wsId = makeWorkspace('Summary Filter Workspace');
    const stratId = makeStrategy(wsId, 'Summary Filter Strategy');

    // 2 entries for strategy, 1 untagged
    const e1 = createJournalEntry({ workspaceId: wsId, strategyId: stratId, symbol: 'ES', side: 'long', entryPrice: 5000, contracts: 1 });
    const e2 = createJournalEntry({ workspaceId: wsId, strategyId: stratId, symbol: 'ES', side: 'short', entryPrice: 5010, contracts: 1 });
    createJournalEntry({ workspaceId: wsId, symbol: 'NQ', side: 'long', entryPrice: 18000, contracts: 1 }); // different strategy

    closeJournalEntry(e1.id, { exitPrice: 5010, pnlDollars: 500, outcome: 'win' });
    closeJournalEntry(e2.id, { exitPrice: 5020, pnlDollars: -200, outcome: 'loss' });

    const summary = getJournalSummary(wsId, stratId);
    assert.equal(summary.totalTrades, 2, 'should only count strategy entries');
    assert.equal(summary.wins, 1);
    assert.equal(summary.losses, 1);
    assert.equal(summary.totalPnl, 300);
  });

  it('empty workspace summary returns zeros', () => {
    const wsId = makeWorkspace('Empty Summary Workspace');
    const summary = getJournalSummary(wsId);
    assert.equal(summary.totalTrades, 0);
    assert.equal(summary.winRate, 0);
    assert.equal(summary.totalPnl, 0);
    assert.equal(summary.averagePnl, 0);
    assert.equal(summary.openTrades, 0);
  });

  it('archived strategy entries remain visible in journal', () => {
    const wsId = makeWorkspace('Archived Strategy Journal Workspace');
    const stratId = makeStrategy(wsId, 'Archived Strategy Journal');

    // Create entry, then archive the strategy
    const e1 = createJournalEntry({ workspaceId: wsId, strategyId: stratId, symbol: 'ES', side: 'long', entryPrice: 5000, contracts: 1 });
    archiveStrategy(stratId);

    // Journal entry should still exist and be listable after strategy archived
    const entries = listJournalEntries(wsId, stratId);
    assert.equal(entries.length, 1, 'archived strategy entries still visible');
    assert.equal(entries[0].id, e1.id);
    assert.equal(entries[0].strategyId, stratId);

    // Can still close it — journal entries are independent of strategy status
    const closed = closeJournalEntry(e1.id, { exitPrice: 5010, pnlDollars: 500, outcome: 'win' });
    assert.equal(closed.outcome, 'win');
    assert.equal(closed.strategyId, stratId);

    // Summary still counts it
    const summary = getJournalSummary(wsId, stratId);
    assert.equal(summary.totalTrades, 1);
    assert.equal(summary.wins, 1);
  });
});
