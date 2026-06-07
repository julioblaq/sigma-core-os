import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTradingViewWebhookPlan,
  TradingViewWebhookError,
} from '../core/webhooks/tradingview.js';

describe('TradingView webhook normalization', () => {
  it('normalizes a TradingView alert into a trade plan input', () => {
    const alert = buildTradingViewWebhookPlan({
      secret: 'redacted',
      ticker: 'mnq',
      action: 'buy',
      price: '19000',
      stop_points: '10',
      rr: '2',
      account_size: '5000',
      risk_dollars: '100',
    });

    assert.equal(alert.source, 'tradingview');
    assert.equal(alert.submittedBy, 'tradingview-webhook');
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
    assert.equal(alert.rawAlert.secret, undefined);
  });

  it('uses safe Railway defaults for sizing fields', () => {
    const alert = buildTradingViewWebhookPlan(
      {
        symbol: 'MES',
        side: 'short',
        entry: 5000,
        stopPoints: 4,
      },
      {
        rrRatio: 2,
        accountSize: 10000,
        riskDollars: 200,
      },
    );

    assert.equal(alert.planInput.side, 'short');
    assert.equal(alert.planInput.rrRatio, 2);
    assert.equal(alert.planInput.accountSize, 10000);
    assert.equal(alert.planInput.riskDollars, 200);
  });

  it('rejects invalid sides', () => {
    assert.throws(
      () => buildTradingViewWebhookPlan({
        symbol: 'ES',
        side: 'hold',
        entry: 5000,
        stopPoints: 4,
        rrRatio: 2,
        accountSize: 10000,
        riskDollars: 200,
      }),
      (err: unknown) => {
        assert.ok(err instanceof TradingViewWebhookError);
        assert.equal(err.code, 'INVALID_SIDE');
        return true;
      },
    );
  });

  it('requires sizing fields when defaults are absent', () => {
    assert.throws(
      () => buildTradingViewWebhookPlan({
        symbol: 'ES',
        side: 'long',
        entry: 5000,
        stopPoints: 4,
        rrRatio: 2,
      }),
      (err: unknown) => {
        assert.ok(err instanceof TradingViewWebhookError);
        assert.equal(err.code, 'MISSING_FIELD');
        assert.match(err.message, /accountSize/);
        return true;
      },
    );
  });
});

