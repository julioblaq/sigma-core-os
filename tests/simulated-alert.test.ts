import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSimulatedAlertPlan,
  SimulatedAlertError,
} from '../core/webhooks/simulated.js';

describe('simulated trading alerts', () => {
  it('normalizes a dashboard alert into an approval-only trade plan input', () => {
    const alert = buildSimulatedAlertPlan({
      symbol: 'mnq',
      side: 'long',
      entry: 19000,
      stopPoints: 10,
      rrRatio: 2,
      accountSize: 5000,
      riskDollars: 100,
      submittedBy: 'dashboard',
    });

    assert.equal(alert.source, 'simulated');
    assert.equal(alert.submittedBy, 'dashboard');
    assert.deepEqual(alert.planInput, {
      symbol: 'MNQ',
      side: 'long',
      entry: 19000,
      stopPoints: 10,
      rrRatio: 2,
      accountSize: 5000,
      riskDollars: 100,
      dailyLossDollars: undefined,
      maxDailyLossPct: undefined,
      propStartBalance: undefined,
      propMaxDrawdownPct: undefined,
    });
  });

  it('defaults submittedBy for dashboard-generated alerts', () => {
    const alert = buildSimulatedAlertPlan({
      symbol: 'MES',
      side: 'short',
      entry: 5000,
      stopPoints: 4,
      rrRatio: 2,
      accountSize: 10000,
      riskDollars: 200,
    });

    assert.equal(alert.submittedBy, 'dashboard-simulated-alert');
  });

  it('rejects invalid sides', () => {
    assert.throws(
      () => buildSimulatedAlertPlan({
        symbol: 'ES',
        side: 'buy' as 'long',
        entry: 5000,
        stopPoints: 4,
        rrRatio: 2,
        accountSize: 10000,
        riskDollars: 200,
      }),
      (err: unknown) => {
        assert.ok(err instanceof SimulatedAlertError);
        assert.equal(err.code, 'INVALID_SIDE');
        return true;
      },
    );
  });

  it('rejects non-numeric risk fields', () => {
    assert.throws(
      () => buildSimulatedAlertPlan({
        symbol: 'ES',
        side: 'long',
        entry: Number.NaN,
        stopPoints: 4,
        rrRatio: 2,
        accountSize: 10000,
        riskDollars: 200,
      }),
      (err: unknown) => {
        assert.ok(err instanceof SimulatedAlertError);
        assert.equal(err.code, 'INVALID_NUMBER');
        return true;
      },
    );
  });
});

