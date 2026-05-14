// tests/strategies.test.ts
// Slice 7b (v0.7.0): Strategy Profiles tests.
// Tests: create, prop-firm template, list, update, archive,
//        invalid template, strategy used in risk calc, archived strategy blocked.
//
// All risk calculations are deterministic - no LLM involved.
// Strategy feeds the Risk Engine: allowedInstruments, maxPositionSize,
// maxDailyDrawdown, defaultRR are applied when strategyId is passed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createStrategy,
  getStrategy,
  listStrategies,
  updateStrategy,
  archiveStrategy,
  getStrategyRiskContext,
  getPropFirmDefaults,
  PROP_FIRM_TEMPLATES,
  StrategyError,
} from '../core/strategies/index.js';
import { createWorkspace } from '../core/operators/index.js';
import { generateTradePlan } from '../core/risk/index.js';

// ---------------------------------------------------------------------------
// Helper: create a workspace for each test group
// ---------------------------------------------------------------------------

function makeWorkspace(name: string): string {
  const { workspace } = createWorkspace(name, 'test-user');
  return workspace.id;
}

// ---------------------------------------------------------------------------
// Strategy creation
// ---------------------------------------------------------------------------

describe('createStrategy', () => {
  it('creates a strategy with correct fields', () => {
    const wsId = makeWorkspace('Create Strategy Workspace');
    const s = createStrategy({
      workspaceId: wsId,
      name: 'My ES Scalp',
      description: 'Short-term ES scalping strategy',
      propFirmTemplate: 'apex',
    });
    assert.ok(s.id, 'should have id');
    assert.equal(s.workspaceId, wsId);
    assert.equal(s.name, 'My ES Scalp');
    assert.equal(s.slug, 'my-es-scalp');
    assert.equal(s.description, 'Short-term ES scalping strategy');
    assert.equal(s.propFirmTemplate, 'apex');
    assert.equal(s.status, 'active');
    assert.ok(s.createdAt, 'should have createdAt');
    assert.ok(s.updatedAt, 'should have updatedAt');

    // Apex defaults applied
    const apex = PROP_FIRM_TEMPLATES['apex'];
    assert.equal(s.maxDailyDrawdown, apex.maxDailyDrawdown);
    assert.equal(s.maxPositionSize, apex.maxPositionSize);
    assert.equal(s.defaultRR, apex.defaultRR);
    assert.deepEqual(s.allowedInstruments, apex.allowedInstruments);

    // Fetch back
    const fetched = getStrategy(s.id);
    assert.ok(fetched, 'should be retrievable');
    assert.equal(fetched!.slug, 'my-es-scalp');
  });

  it('prop-firm template defaults are applied correctly for all templates', () => {
    const wsId = makeWorkspace('Template Defaults Workspace');

    for (const tpl of ['apex', 'topstep', 'bulenox', 'custom'] as const) {
      const defaults = getPropFirmDefaults(tpl);
      const s = createStrategy({ workspaceId: wsId, name: `Strategy ${tpl}`, propFirmTemplate: tpl });
      assert.equal(s.maxDailyDrawdown, defaults.maxDailyDrawdown, `${tpl}: maxDailyDrawdown`);
      assert.equal(s.maxPositionSize, defaults.maxPositionSize, `${tpl}: maxPositionSize`);
      assert.equal(s.defaultRR, defaults.defaultRR, `${tpl}: defaultRR`);
      assert.deepEqual(s.allowedInstruments, defaults.allowedInstruments, `${tpl}: allowedInstruments`);
    }
  });

  it('custom overrides template defaults', () => {
    const wsId = makeWorkspace('Override Defaults Workspace');
    const s = createStrategy({
      workspaceId: wsId,
      name: 'Custom Limits Strategy',
      propFirmTemplate: 'topstep',
      maxDailyDrawdown: 1.0,
      maxPositionSize: 3,
      allowedInstruments: ['MES', 'MNQ'],
      defaultRR: 3.0,
    });
    assert.equal(s.propFirmTemplate, 'topstep');
    assert.equal(s.maxDailyDrawdown, 1.0);
    assert.equal(s.maxPositionSize, 3);
    assert.deepEqual(s.allowedInstruments, ['MES', 'MNQ']);
    assert.equal(s.defaultRR, 3.0);
  });

  it('invalid template rejected with INVALID_TEMPLATE', () => {
    const wsId = makeWorkspace('Invalid Template Workspace');
    assert.throws(
      () => createStrategy({ workspaceId: wsId, name: 'Bad Template', propFirmTemplate: 'ftmo' as 'custom' }),
      (err: unknown) => {
        assert.ok(err instanceof StrategyError);
        assert.equal(err.code, 'INVALID_TEMPLATE');
        return true;
      },
    );
  });

  it('slug uniqueness enforced within workspace', () => {
    const wsId = makeWorkspace('Slug Unique Workspace');
    createStrategy({ workspaceId: wsId, name: 'Duplicate Strategy', propFirmTemplate: 'custom' });
    assert.throws(
      () => createStrategy({ workspaceId: wsId, name: 'Duplicate Strategy', propFirmTemplate: 'apex' }),
      (err: unknown) => {
        assert.ok(err instanceof StrategyError);
        assert.equal(err.code, 'SLUG_TAKEN');
        return true;
      },
    );
  });

  it('same strategy name allowed in different workspaces', () => {
    const ws1 = makeWorkspace('Cross Workspace A');
    const ws2 = makeWorkspace('Cross Workspace B');
    const s1 = createStrategy({ workspaceId: ws1, name: 'Shared Name Strategy', propFirmTemplate: 'apex' });
    const s2 = createStrategy({ workspaceId: ws2, name: 'Shared Name Strategy', propFirmTemplate: 'topstep' });
    assert.equal(s1.slug, s2.slug);
    assert.notEqual(s1.id, s2.id);
    assert.notEqual(s1.workspaceId, s2.workspaceId);
  });
});

// ---------------------------------------------------------------------------
// listStrategies
// ---------------------------------------------------------------------------

describe('listStrategies', () => {
  it('lists active strategies for a workspace', () => {
    const wsId = makeWorkspace('List Active Workspace');
    createStrategy({ workspaceId: wsId, name: 'Strategy One', propFirmTemplate: 'apex' });
    createStrategy({ workspaceId: wsId, name: 'Strategy Two', propFirmTemplate: 'topstep' });
    const list = listStrategies(wsId);
    assert.equal(list.length, 2);
    assert.ok(list.every(s => s.status === 'active'), 'all should be active');
  });

  it('excludes archived strategies by default', () => {
    const wsId = makeWorkspace('Archived Excluded Workspace');
    const s1 = createStrategy({ workspaceId: wsId, name: 'Keep Active', propFirmTemplate: 'custom' });
    const s2 = createStrategy({ workspaceId: wsId, name: 'To Archive', propFirmTemplate: 'custom' });
    archiveStrategy(s2.id);

    const active = listStrategies(wsId);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, s1.id);

    const all = listStrategies(wsId, true);
    assert.equal(all.length, 2);
  });
});

// ---------------------------------------------------------------------------
// updateStrategy
// ---------------------------------------------------------------------------

describe('updateStrategy', () => {
  it('updates strategy fields', () => {
    const wsId = makeWorkspace('Update Strategy Workspace');
    const s = createStrategy({ workspaceId: wsId, name: 'Update Me', propFirmTemplate: 'apex' });

    const updated = updateStrategy(s.id, {
      name: 'Updated Name',
      maxDailyDrawdown: 1.5,
      defaultRR: 3.0,
    });
    assert.equal(updated.name, 'Updated Name');
    assert.equal(updated.slug, 'updated-name');
    assert.equal(updated.maxDailyDrawdown, 1.5);
    assert.equal(updated.defaultRR, 3.0);
    assert.ok(updated.updatedAt > s.updatedAt || updated.updatedAt === s.updatedAt, 'updatedAt should be set');
  });

  it('cannot update archived strategy', () => {
    const wsId = makeWorkspace('Update Archived Workspace');
    const s = createStrategy({ workspaceId: wsId, name: 'Archive Then Update', propFirmTemplate: 'custom' });
    archiveStrategy(s.id);

    assert.throws(
      () => updateStrategy(s.id, { name: 'New Name' }),
      (err: unknown) => {
        assert.ok(err instanceof StrategyError);
        assert.equal(err.code, 'STRATEGY_ARCHIVED');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// archiveStrategy
// ---------------------------------------------------------------------------

describe('archiveStrategy', () => {
  it('archives a strategy — status becomes archived', () => {
    const wsId = makeWorkspace('Archive Workspace');
    const s = createStrategy({ workspaceId: wsId, name: 'Archive This', propFirmTemplate: 'bulenox' });
    assert.equal(s.status, 'active');

    const archived = archiveStrategy(s.id);
    assert.equal(archived.status, 'archived');

    const fetched = getStrategy(s.id);
    assert.equal(fetched!.status, 'archived');
  });

  it('double-archive throws ALREADY_ARCHIVED', () => {
    const wsId = makeWorkspace('Double Archive Workspace');
    const s = createStrategy({ workspaceId: wsId, name: 'Double Archive', propFirmTemplate: 'apex' });
    archiveStrategy(s.id);

    assert.throws(
      () => archiveStrategy(s.id),
      (err: unknown) => {
        assert.ok(err instanceof StrategyError);
        assert.equal(err.code, 'ALREADY_ARCHIVED');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getStrategyRiskContext — integration with Risk Engine
// ---------------------------------------------------------------------------

describe('getStrategyRiskContext', () => {
  it('returns risk context for active strategy', () => {
    const wsId = makeWorkspace('Risk Context Workspace');
    const s = createStrategy({
      workspaceId: wsId,
      name: 'Risk Context Strategy',
      propFirmTemplate: 'apex',
      maxPositionSize: 5,
      defaultRR: 2.5,
    });

    const ctx = getStrategyRiskContext(s.id);
    assert.equal(ctx.strategyId, s.id);
    assert.equal(ctx.strategyName, s.name);
    assert.equal(ctx.maxPositionSize, 5);
    assert.equal(ctx.defaultRR, 2.5);
    assert.equal(ctx.propFirmTemplate, 'apex');
    assert.ok(Array.isArray(ctx.allowedInstruments));
  });

  it('archived strategy throws STRATEGY_ARCHIVED from getStrategyRiskContext', () => {
    const wsId = makeWorkspace('Archived Risk Context Workspace');
    const s = createStrategy({ workspaceId: wsId, name: 'Archived Strategy Risk', propFirmTemplate: 'topstep' });
    archiveStrategy(s.id);

    assert.throws(
      () => getStrategyRiskContext(s.id),
      (err: unknown) => {
        assert.ok(err instanceof StrategyError);
        assert.equal(err.code, 'STRATEGY_ARCHIVED');
        return true;
      },
    );
  });

  it('strategy used in risk engine: defaultRR and maxPositionSize applied', () => {
    const wsId = makeWorkspace('Risk Engine Integration Workspace');
    const s = createStrategy({
      workspaceId: wsId,
      name: 'MES Strategy',
      propFirmTemplate: 'custom',
      maxPositionSize: 2,
      defaultRR: 3.0,
      allowedInstruments: ['MES', 'MNQ'],
    });

    const ctx = getStrategyRiskContext(s.id);

    // Strategy says defaultRR=3.0 and maxPositionSize=2
    // Risk engine: MES, entry=4500, stopPoints=10, riskDollars=500, accountSize=50000
    // riskPerContract = 10 * 5.0 = $50, contracts = floor(500/50) = 10
    // But strategy caps at 2 — this cap is applied at the API layer, not the core calc
    // Core calc returns 10 contracts — API layer caps to ctx.maxPositionSize
    const plan = generateTradePlan({
      symbol: 'MES',
      side: 'long',
      entry: 4500,
      stopPoints: 10,
      rrRatio: ctx.defaultRR,
      accountSize: 50000,
      riskDollars: 500,
    });
    // defaultRR from strategy (3.0) should produce target 30 points above entry
    assert.equal(plan.rr, 3.0, 'rr should use strategy defaultRR');
    assert.equal(plan.targetPoints, 30.0, 'target points should be stopPoints * rr = 10 * 3.0 = 30');
    assert.equal(plan.contracts, 10, 'core returns 10 before strategy cap');

    // Simulate API cap: strategy.maxPositionSize = 2
    const cappedContracts = Math.min(plan.contracts, ctx.maxPositionSize);
    assert.equal(cappedContracts, 2, 'capped contracts should be 2 (strategy maxPositionSize)');

    // Instrument check: MNQ is allowed, but ES is not
    assert.ok(ctx.allowedInstruments.includes('MES'), 'MES allowed');
    assert.ok(ctx.allowedInstruments.includes('MNQ'), 'MNQ allowed');
    assert.ok(!ctx.allowedInstruments.includes('ES'), 'ES not allowed');
  });

  it('archived strategy cannot be used for trade plan (STRATEGY_ARCHIVED)', () => {
    const wsId = makeWorkspace('Blocked Risk Workspace');
    const s = createStrategy({
      workspaceId: wsId,
      name: 'Archive Before Use',
      propFirmTemplate: 'apex',
    });
    archiveStrategy(s.id);

    // getStrategyRiskContext must throw before risk engine runs
    let threw = false;
    try {
      getStrategyRiskContext(s.id);
    } catch (err) {
      threw = true;
      assert.ok(err instanceof StrategyError);
      assert.equal((err as StrategyError).code, 'STRATEGY_ARCHIVED');
    }
    assert.ok(threw, 'should throw STRATEGY_ARCHIVED before risk calc');
  });
});
