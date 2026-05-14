// tests/risk.test.ts
// v0.6.0: Sigma Risk Engine tests — all calculations deterministic, no LLM, no mocks needed.
// v0.6.1: Added rationale integration tests — LLM mocked, non-blocking guarantees verified.
// Tests: contract specs, position sizing, ATR stop, TP/SL, daily loss guard,
// prop drawdown guard, trade plan generator, approval flow, LLM rationale.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

import {
  getContractSpec,
  listContracts,
  calcPositionSize,
  calcATRStop,
  calcTPSL,
  checkDailyLoss,
  checkPropDrawdown,
  generateTradePlan,
  generateTradePlanWithRationale,
  generateRationale,
  RiskError,
  CONTRACT_SPECS,
} from '../core/risk/index.js';
import { requestApproval, resolveApproval, getApproval } from '../core/policies/index.js';

// ---------------------------------------------------------------------------
// Fetch mock for LLM rationale tests
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalFetch = (globalThis as any).fetch;

function mockFetchSuccess(responseText: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    // Listen for abort so timeout fallback works correctly
    if (init?.signal) {
      init.signal.addEventListener('abort', () => {});
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: responseText } }],
        model: 'gpt-5.5',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    };
  };
}

function mockFetchFailure(status: number, message: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    if (init?.signal) {
      init.signal.addEventListener('abort', () => {});
    }
    return {
      ok: false,
      status,
      text: async () => message,
    };
  };
}

function restoreFetch() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// Contract Specs
// ---------------------------------------------------------------------------

describe('contract specs', () => {
  it('MNQ: tickSize=0.25, tickValue=0.50, pointValue=2.00', () => {
    const spec = getContractSpec('MNQ');
    assert.equal(spec.tickSize, 0.25);
    assert.equal(spec.tickValue, 0.50);
    assert.equal(spec.pointValue, 2.00);
    assert.equal(spec.exchange, 'CME');
  });

  it('MES: tickSize=0.25, tickValue=1.25, pointValue=5.00', () => {
    const spec = getContractSpec('MES');
    assert.equal(spec.tickSize, 0.25);
    assert.equal(spec.tickValue, 1.25);
    assert.equal(spec.pointValue, 5.00);
  });

  it('ES: tickSize=0.25, tickValue=12.50, pointValue=50.00', () => {
    const spec = getContractSpec('ES');
    assert.equal(spec.tickSize, 0.25);
    assert.equal(spec.tickValue, 12.50);
    assert.equal(spec.pointValue, 50.00);
  });

  it('NQ: tickSize=0.25, tickValue=5.00, pointValue=20.00', () => {
    const spec = getContractSpec('NQ');
    assert.equal(spec.tickSize, 0.25);
    assert.equal(spec.tickValue, 5.00);
    assert.equal(spec.pointValue, 20.00);
  });

  it('case-insensitive symbol lookup', () => {
    const spec = getContractSpec('mes');
    assert.equal(spec.symbol, 'MES');
  });

  it('unsupported symbol throws RiskError', () => {
    assert.throws(
      () => getContractSpec('AAPL'),
      (err: unknown) => {
        assert.ok(err instanceof RiskError);
        assert.equal(err.code, 'UNSUPPORTED_SYMBOL');
        return true;
      },
    );
  });

  it('listContracts returns all 4 instruments', () => {
    const contracts = listContracts();
    assert.equal(contracts.length, 4);
    const symbols = contracts.map(c => c.symbol);
    assert.ok(symbols.includes('ES'));
    assert.ok(symbols.includes('NQ'));
    assert.ok(symbols.includes('MES'));
    assert.ok(symbols.includes('MNQ'));
  });
});

// ---------------------------------------------------------------------------
// Position Sizing
// ---------------------------------------------------------------------------

describe('calcPositionSize', () => {
  it('MES: $200 risk, 4pt stop -> 10 contracts ($200 / $20/contract)', () => {
    const result = calcPositionSize({ symbol: 'MES', accountSize: 10000, riskDollars: 200, stopPoints: 4 });
    assert.equal(result.contracts, 10);
    assert.equal(result.riskPerContract, 20);
    assert.equal(result.totalRisk, 200);
    assert.equal(result.riskPercent, 2);
  });

  it('MNQ: $100 risk, 10pt stop -> 5 contracts ($100 / $20/contract)', () => {
    const result = calcPositionSize({ symbol: 'MNQ', accountSize: 10000, riskDollars: 100, stopPoints: 10 });
    assert.equal(result.contracts, 5);
    assert.equal(result.riskPerContract, 20);
    assert.equal(result.totalRisk, 100);
  });

  it('ES: $500 risk, 2pt stop -> 5 contracts ($500 / $100/contract)', () => {
    const result = calcPositionSize({ symbol: 'ES', accountSize: 50000, riskDollars: 500, stopPoints: 2 });
    assert.equal(result.contracts, 5);
    assert.equal(result.riskPerContract, 100);
  });

  it('NQ: $400 risk, 5pt stop -> 4 contracts ($400 / $100/contract)', () => {
    const result = calcPositionSize({ symbol: 'NQ', accountSize: 20000, riskDollars: 400, stopPoints: 5 });
    assert.equal(result.contracts, 4);
    assert.equal(result.riskPerContract, 100);
  });

  it('throws ZERO_CONTRACTS when riskDollars < riskPerContract', () => {
    assert.throws(
      () => calcPositionSize({ symbol: 'MES', accountSize: 10000, riskDollars: 50, stopPoints: 20 }),
      (err: unknown) => {
        assert.ok(err instanceof RiskError);
        assert.equal(err.code, 'ZERO_CONTRACTS');
        return true;
      },
    );
  });

  it('warns when risk > 2% of account', () => {
    const result = calcPositionSize({ symbol: 'MES', accountSize: 10000, riskDollars: 500, stopPoints: 4 });
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0].includes('above 2%'));
  });
});

// ---------------------------------------------------------------------------
// ATR Stop Calculator
// ---------------------------------------------------------------------------

describe('calcATRStop', () => {
  it('long: stop below entry by ATR * multiplier', () => {
    const result = calcATRStop({ symbol: 'ES', atr: 10, multiplier: 1.5, entry: 5000, side: 'long' });
    assert.equal(result.stopPoints, 15);
    assert.equal(result.stopPrice, 4985);
  });

  it('short: stop above entry by ATR * multiplier', () => {
    const result = calcATRStop({ symbol: 'NQ', atr: 20, multiplier: 2, entry: 18000, side: 'short' });
    assert.equal(result.stopPoints, 40);
    assert.equal(result.stopPrice, 18040);
  });

  it('throws on ATR <= 0', () => {
    assert.throws(
      () => calcATRStop({ symbol: 'MES', atr: 0, multiplier: 1, entry: 5000, side: 'long' }),
      (err: unknown) => { assert.ok(err instanceof RiskError); assert.equal(err.code, 'INVALID_ATR'); return true; },
    );
  });
});

// ---------------------------------------------------------------------------
// TP/SL Calculator
// ---------------------------------------------------------------------------

describe('calcTPSL', () => {
  it('long 2:1 R:R: target is 2x stop distance above entry', () => {
    const result = calcTPSL({ symbol: 'ES', entry: 5000, stop: 4990, rr: 2, side: 'long' });
    assert.equal(result.stopPoints, 10);
    assert.equal(result.targetPoints, 20);
    assert.equal(result.target, 5020);
    assert.equal(result.stop, 4990);
  });

  it('short 3:1 R:R: target is 3x stop distance below entry', () => {
    const result = calcTPSL({ symbol: 'NQ', entry: 18000, stop: 18010, rr: 3, side: 'short' });
    assert.equal(result.stopPoints, 10);
    assert.equal(result.targetPoints, 30);
    assert.equal(result.target, 17970);
  });

  it('throws on R:R <= 0', () => {
    assert.throws(
      () => calcTPSL({ symbol: 'ES', entry: 5000, stop: 4990, rr: 0, side: 'long' }),
      (err: unknown) => { assert.ok(err instanceof RiskError); assert.equal(err.code, 'INVALID_RR'); return true; },
    );
  });
});

// ---------------------------------------------------------------------------
// Max Daily Loss Guard
// ---------------------------------------------------------------------------

describe('checkDailyLoss', () => {
  it('not breached when loss is below limit', () => {
    const result = checkDailyLoss({ accountSize: 10000, dailyLossDollars: 100, maxDailyLossPct: 2 });
    assert.equal(result.breached, false);
    assert.equal(result.maxAllowedDollars, 200);
    assert.equal(result.remainingDollars, 100);
  });

  it('breached when loss equals or exceeds limit', () => {
    const result = checkDailyLoss({ accountSize: 10000, dailyLossDollars: 200, maxDailyLossPct: 2 });
    assert.equal(result.breached, true);
    assert.ok(result.warning?.includes('breached'));
  });

  it('warns when approaching limit (>= 80%)', () => {
    const result = checkDailyLoss({ accountSize: 10000, dailyLossDollars: 170, maxDailyLossPct: 2 });
    assert.equal(result.breached, false);
    assert.ok(result.warning?.includes('approaching'));
  });

  it('invalid account throws RiskError', () => {
    assert.throws(
      () => checkDailyLoss({ accountSize: 0, dailyLossDollars: 100, maxDailyLossPct: 2 }),
      (err: unknown) => { assert.ok(err instanceof RiskError); return true; },
    );
  });
});

// ---------------------------------------------------------------------------
// Prop Firm Drawdown Guard
// ---------------------------------------------------------------------------

describe('checkPropDrawdown', () => {
  it('not breached within drawdown limit', () => {
    const result = checkPropDrawdown({ startingBalance: 50000, currentBalance: 48000, maxDrawdownPct: 5 });
    assert.equal(result.breached, false);
    assert.equal(result.maxAllowedDrawdown, 2500);
    assert.equal(result.drawdownDollars, 2000);
  });

  it('breached when drawdown exceeds limit', () => {
    const result = checkPropDrawdown({ startingBalance: 50000, currentBalance: 47400, maxDrawdownPct: 5 });
    assert.equal(result.breached, true);
    assert.ok(result.warning?.includes('breached'));
  });

  it('warns when approaching limit (>= 75%)', () => {
    const result = checkPropDrawdown({ startingBalance: 50000, currentBalance: 48100, maxDrawdownPct: 5 });
    assert.equal(result.breached, false);
    assert.ok(result.warning?.includes('approaching'));
  });

  it('throws on invalid starting balance', () => {
    assert.throws(
      () => checkPropDrawdown({ startingBalance: 0, currentBalance: 1000, maxDrawdownPct: 5 }),
      (err: unknown) => { assert.ok(err instanceof RiskError); return true; },
    );
  });
});

// ---------------------------------------------------------------------------
// generateTradePlan
// ---------------------------------------------------------------------------

describe('generateTradePlan', () => {
  it('generates complete plan for MES long 2:1', () => {
    const plan = generateTradePlan({
      symbol: 'MES', side: 'long', entry: 5000, stopPoints: 4,
      rrRatio: 2, accountSize: 10000, riskDollars: 200,
    });
    assert.equal(plan.symbol, 'MES');
    assert.equal(plan.side, 'long');
    assert.equal(plan.entry, 5000);
    assert.equal(plan.stop, 4996);
    assert.equal(plan.target, 5008);
    assert.equal(plan.contracts, 10);
    assert.equal(plan.rr, 2);
    assert.equal(plan.blocked, false);
    assert.equal(plan.blockReasons.length, 0);
  });

  it('blocks plan when daily loss limit breached', () => {
    const plan = generateTradePlan({
      symbol: 'MES', side: 'long', entry: 5000, stopPoints: 4,
      rrRatio: 2, accountSize: 10000, riskDollars: 100,
      dailyLossDollars: 250, maxDailyLossPct: 2,
    });
    assert.equal(plan.blocked, true);
    assert.ok(plan.blockReasons.some(r => r.includes('Daily loss limit breached')));
  });

  it('blocks plan when prop drawdown breached', () => {
    const plan = generateTradePlan({
      symbol: 'ES', side: 'long', entry: 5000, stopPoints: 2,
      rrRatio: 2, accountSize: 47000, riskDollars: 200,
      propStartBalance: 50000, propMaxDrawdownPct: 5,
    });
    assert.equal(plan.blocked, true);
    assert.ok(plan.blockReasons.some(r => r.includes('Prop firm drawdown')));
  });

  it('includes warnings but not blocked when below limits', () => {
    const plan = generateTradePlan({
      symbol: 'MES', side: 'short', entry: 5000, stopPoints: 4,
      rrRatio: 3, accountSize: 10000, riskDollars: 500,
    });
    assert.equal(plan.blocked, false);
    assert.ok(plan.warnings.length > 0);
    assert.ok(plan.warnings[0].includes('above 2%'));
  });
});

// ---------------------------------------------------------------------------
// Trade plan approval flow
// ---------------------------------------------------------------------------

describe('trade plan approval flow', () => {
  it('generated trade plan can be queued for approval', () => {
    const plan = generateTradePlan({
      symbol: 'MNQ', side: 'long', entry: 19000, stopPoints: 10,
      rrRatio: 2, accountSize: 5000, riskDollars: 100,
    });
    assert.equal(plan.blocked, false);

    const approval = requestApproval('sigma-risk', 'trade_plan',
      `Risk plan: ${plan.side.toUpperCase()} ${plan.contracts}x ${plan.symbol}`,
      { plan, taskId: randomUUID() },
    );

    assert.equal(approval.status, 'pending');
    assert.equal(approval.agent, 'sigma-risk');
    assert.equal(approval.action, 'trade_plan');

    const payload = approval.payload as Record<string, unknown>;
    const storedPlan = payload.plan as typeof plan;
    assert.equal(storedPlan.symbol, 'MNQ');
    assert.equal(storedPlan.contracts, plan.contracts);
  });

  it('blocked plan should not be submitted for approval', () => {
    const plan = generateTradePlan({
      symbol: 'MES', side: 'long', entry: 5000, stopPoints: 4,
      rrRatio: 2, accountSize: 10000, riskDollars: 100,
      dailyLossDollars: 300, maxDailyLossPct: 2,
    });
    assert.equal(plan.blocked, true);
    assert.ok(plan.blockReasons.length > 0);
  });

  it('approved risk plan resolves correctly', () => {
    const plan = generateTradePlan({
      symbol: 'ES', side: 'short', entry: 5100, stopPoints: 5,
      rrRatio: 2, accountSize: 25000, riskDollars: 250,
    });

    const approval = requestApproval('sigma-risk', 'trade_plan',
      `Risk plan: SHORT ${plan.contracts}x ES`,
      { plan, taskId: randomUUID() },
    );

    const resolved = resolveApproval(approval.id, true, 'julio');
    assert.ok(resolved);
    assert.equal(resolved.status, 'approved');
    assert.equal(resolved.resolvedBy, 'julio');

    const fetched = getApproval(approval.id);
    assert.ok(fetched);
    assert.equal(fetched.status, 'approved');
  });
});

// ---------------------------------------------------------------------------
// LLM Rationale Integration (v0.6.1)
// ---------------------------------------------------------------------------

describe('LLM rationale integration', () => {
  // Set LLM env so the chain has a "usable" provider
  before(() => {
    process.env.LLM_MODELS = 'gpt-5.5';
    process.env.LLM_API_KEY = 'test-key-rationale';
  });

  after(() => {
    restoreFetch();
    delete process.env.LLM_MODELS;
    delete process.env.LLM_API_KEY;
  });

  it('rationale generation success: returns rationale with provider metadata', async () => {
    mockFetchSuccess('This trade risks $200 on a 4-point stop in MES, targeting 8 points at 2:1 R:R. The position size is conservative at 2% of account. No guards breached.');

    const plan = generateTradePlan({
      symbol: 'MES', side: 'long', entry: 5000, stopPoints: 4,
      rrRatio: 2, accountSize: 10000, riskDollars: 200,
    });

    const result = await generateRationale(plan);
    assert.ok(result !== undefined, 'rationale should be returned on success');
    assert.ok(result!.rationale.length > 10, 'rationale should be non-empty');
    assert.ok(typeof result!.provider === 'string', 'provider should be a string');
    assert.ok(result!.latencyMs >= 0, 'latencyMs should be non-negative');

    // Verify deterministic values unchanged
    assert.equal(plan.contracts, 10);
    assert.equal(plan.stop, 4996);
    assert.equal(plan.target, 5008);
    assert.equal(plan.blocked, false);
  });

  it('rationale: provider fallback works (primary 429 -> secondary)', async () => {
    // Primary fails with 429, secondary succeeds
    process.env.LLM_MODELS = 'gpt-5.5,claude-3';
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      callCount++;
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {});
      }
      if (callCount === 1) {
        // Primary: 429
        return { ok: false, status: 429, text: async () => 'rate limited' };
      }
      // Secondary: success
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Fallback rationale from secondary provider.' } }],
          model: 'claude-3',
          usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
        }),
      };
    };

    const plan = generateTradePlan({
      symbol: 'ES', side: 'long', entry: 5000, stopPoints: 5,
      rrRatio: 2, accountSize: 25000, riskDollars: 250,
    });

    const result = await generateRationale(plan);
    assert.ok(result !== undefined, 'rationale should be returned via fallback');
    assert.ok(result!.rationale.includes('Fallback'), 'should be the secondary response');

    // Deterministic values preserved
    assert.equal(plan.contracts, 1);
    assert.equal(plan.blocked, false);

    process.env.LLM_MODELS = 'gpt-5.5';
  });

  it('malformed provider response handled safely: returns undefined, plan unaffected', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      if (init?.signal) init.signal.addEventListener('abort', () => {});
      return {
        ok: true,
        status: 200,
        // Malformed: missing choices
        json: async () => ({ model: 'gpt-5.5' }),
      };
    };

    const plan = generateTradePlan({
      symbol: 'MNQ', side: 'short', entry: 19000, stopPoints: 10,
      rrRatio: 2, accountSize: 5000, riskDollars: 100,
    });

    const result = await generateRationale(plan);
    assert.equal(result, undefined, 'malformed response should return undefined');

    // Deterministic values still correct
    assert.equal(plan.contracts, 5);
    assert.equal(plan.blocked, false);
  });

  it('rationale generation failure is non-blocking: plan always returned', async () => {
    // All providers fail
    process.env.LLM_MODELS = 'gpt-5.5';
    mockFetchFailure(500, 'internal server error');

    const input = {
      symbol: 'NQ', side: 'long' as const, entry: 18000, stopPoints: 10,
      rrRatio: 3, accountSize: 30000, riskDollars: 300,
    };

    // generateTradePlanWithRationale must return plan even when LLM fails
    const plan = await generateTradePlanWithRationale(input);

    // Plan deterministic values preserved regardless
    assert.equal(plan.symbol, 'NQ');
    assert.equal(plan.side, 'long');
    assert.equal(plan.blocked, false);
    assert.equal(typeof plan.contracts, 'number');
    assert.ok(plan.contracts > 0);

    // Rationale is undefined (not present) — plan not blocked
    assert.equal(plan.rationale, undefined);
    assert.equal(plan.rationaleProvider, undefined);
  });

  it('deterministic values preserved when rationale succeeds', async () => {
    mockFetchSuccess('Good risk management. The trade targets a 2:1 reward on a small MES position.');

    const input = {
      symbol: 'MES', side: 'long' as const, entry: 5000, stopPoints: 4,
      rrRatio: 2, accountSize: 10000, riskDollars: 200,
    };

    const plan = await generateTradePlanWithRationale(input);

    // All deterministic values exact
    assert.equal(plan.symbol, 'MES');
    assert.equal(plan.entry, 5000);
    assert.equal(plan.stop, 4996);
    assert.equal(plan.target, 5008);
    assert.equal(plan.contracts, 10);
    assert.equal(plan.rr, 2);
    assert.equal(plan.riskDollars, 200);
    assert.equal(plan.blocked, false);

    // Rationale present
    assert.ok(typeof plan.rationale === 'string' && plan.rationale.length > 0);
    assert.ok(typeof plan.rationaleProvider === 'string');
    assert.ok(typeof plan.rationaleLatencyMs === 'number');
  });
});
