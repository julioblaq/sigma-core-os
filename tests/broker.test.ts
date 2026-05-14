// tests/broker.test.ts
// Slice 3b: broker integration tests - paper only, no real orders.
// Tests: approved trade submits, denied skips, live mode rejected,
//        unsupported symbol rejected, invalid quantity rejected,
//        missing risk fields rejected, broker status, audit log, immutability.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

import {
  validateOrder,
  submitPaperOrder,
  getBrokerStatus,
  getPaperOrders,
  BrokerModeError,
  OrderValidationError,
} from '../core/broker/index.js';
import { requestApproval, resolveApproval } from '../core/policies/index.js';
import { executeTrade } from '../core/runtime/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTradeApproval(
  symbol = 'ES',
  side: string = 'long',
  quantity = 1,
  entry = 5000,
  stop = 4980,
  target = 5040,
) {
  const signal = { symbol, direction: side, quantity, entry, stop, target };
  return requestApproval('sigma-bot', 'trade_plan', `Trade plan: ${side.toUpperCase()} ${quantity}x ${symbol}`, {
    taskId: randomUUID(),
    signal,
  });
}

// ---------------------------------------------------------------------------
// getBrokerStatus
// ---------------------------------------------------------------------------

describe('getBrokerStatus', () => {
  it('returns paper mode only - live is false', () => {
    const status = getBrokerStatus();
    assert.equal(status.mode, 'paper');
    assert.equal(status.adapter, 'paper');
    assert.equal(status.live, false);
    assert.equal(status.ready, true);
    assert.ok(Array.isArray(status.allowedSymbols));
    assert.ok(status.allowedSymbols.includes('ES'));
    assert.ok(status.allowedSymbols.includes('NQ'));
    assert.ok(status.allowedSymbols.includes('MES'));
    assert.ok(status.allowedSymbols.includes('MNQ'));
  });
});

// ---------------------------------------------------------------------------
// validateOrder
// ---------------------------------------------------------------------------

describe('validateOrder', () => {
  const validOrder = {
    approvalId: randomUUID(),
    symbol: 'ES',
    side: 'long' as const,
    quantity: 1,
    entry: 5000,
    stop: 4980,
    target: 5040,
    mode: 'paper' as const,
  };

  it('passes for a valid paper order', () => {
    assert.doesNotThrow(() => validateOrder(validOrder));
  });

  it('rejects live mode', () => {
    assert.throws(
      () => validateOrder({ ...validOrder, mode: 'live' as never }),
      (err: unknown) => {
        assert.ok(err instanceof BrokerModeError);
        assert.ok(err.message.includes('live trading is not permitted'));
        return true;
      },
    );
  });

  it('rejects unsupported symbol', () => {
    assert.throws(
      () => validateOrder({ ...validOrder, symbol: 'AAPL' }),
      (err: unknown) => {
        assert.ok(err instanceof OrderValidationError);
        assert.equal((err as OrderValidationError).field, 'symbol');
        assert.ok(err.message.includes('allowlist'));
        return true;
      },
    );
  });

  it('rejects quantity <= 0', () => {
    assert.throws(
      () => validateOrder({ ...validOrder, quantity: 0 }),
      (err: unknown) => {
        assert.ok(err instanceof OrderValidationError);
        assert.equal((err as OrderValidationError).field, 'quantity');
        return true;
      },
    );
  });

  it('rejects negative quantity', () => {
    assert.throws(
      () => validateOrder({ ...validOrder, quantity: -2 }),
      (err: unknown) => {
        assert.ok(err instanceof OrderValidationError);
        assert.equal((err as OrderValidationError).field, 'quantity');
        return true;
      },
    );
  });

  it('rejects missing stop loss', () => {
    const { stop: _stop, ...noStop } = validOrder;
    assert.throws(
      () => validateOrder(noStop),
      (err: unknown) => {
        assert.ok(err instanceof OrderValidationError);
        assert.equal((err as OrderValidationError).field, 'stop');
        return true;
      },
    );
  });

  it('rejects missing profit target', () => {
    const { target: _target, ...noTarget } = validOrder;
    assert.throws(
      () => validateOrder(noTarget),
      (err: unknown) => {
        assert.ok(err instanceof OrderValidationError);
        assert.equal((err as OrderValidationError).field, 'target');
        return true;
      },
    );
  });

  it('rejects missing entry price', () => {
    const { entry: _entry, ...noEntry } = validOrder;
    assert.throws(
      () => validateOrder(noEntry),
      (err: unknown) => {
        assert.ok(err instanceof OrderValidationError);
        assert.equal((err as OrderValidationError).field, 'entry');
        return true;
      },
    );
  });

  it('rejects missing approvalId', () => {
    const { approvalId: _id, ...noId } = validOrder;
    assert.throws(
      () => validateOrder(noId),
      (err: unknown) => {
        assert.ok(err instanceof OrderValidationError);
        assert.equal((err as OrderValidationError).field, 'approvalId');
        return true;
      },
    );
  });

  it('accepts all allowed symbols', () => {
    for (const sym of ['ES', 'NQ', 'MES', 'MNQ']) {
      assert.doesNotThrow(() => validateOrder({ ...validOrder, symbol: sym }));
    }
  });
});

// ---------------------------------------------------------------------------
// submitPaperOrder
// ---------------------------------------------------------------------------

describe('submitPaperOrder', () => {
  it('returns filled_paper outcome with simulated fill at entry', () => {
    const result = submitPaperOrder({
      approvalId: randomUUID(),
      symbol: 'NQ',
      side: 'short',
      quantity: 2,
      entry: 18000,
      stop: 18050,
      target: 17900,
      resolvedBy: 'julio',
      mode: 'paper',
    });

    assert.equal(result.outcome, 'filled_paper');
    assert.equal(result.mode, 'paper');
    assert.equal(result.brokerAdapter, 'paper');
    assert.equal(result.symbol, 'NQ');
    assert.equal(result.side, 'short');
    assert.equal(result.quantity, 2);
    assert.equal(result.simulatedFill, 18000);
    assert.equal(result.resolvedBy, 'julio');
    assert.ok(result.id);
    assert.ok(result.submittedAt);
    assert.ok(result.approvalId);
  });

  it('records paper order in audit log', () => {
    const approvalId = randomUUID();
    submitPaperOrder({
      approvalId,
      symbol: 'MES',
      side: 'long',
      quantity: 3,
      entry: 5010,
      stop: 4990,
      target: 5050,
      resolvedBy: 'audit-test',
      mode: 'paper',
    });

    const orders = getPaperOrders();
    const found  = orders.find(o => o.approvalId === approvalId);
    assert.ok(found, 'paper order must appear in audit log');
    assert.equal(found.symbol, 'MES');
    assert.equal(found.quantity, 3);
    assert.equal(found.resolvedBy, 'audit-test');
    assert.equal(found.outcome, 'filled_paper');
  });
});

// ---------------------------------------------------------------------------
// executeTrade - full runtime flow via approval
// ---------------------------------------------------------------------------

describe('executeTrade - runtime flow', () => {
  it('approved trade_plan submits paper order', () => {
    const pending  = makeTradeApproval('ES', 'long', 1, 5000, 4980, 5040);
    const resolved = resolveApproval(pending.id, true, 'julio');
    assert.ok(resolved);
    assert.equal(resolved.status, 'approved');

    const result = executeTrade(resolved);
    assert.equal(result.outcome, 'submitted');
    if (result.outcome === 'submitted') {
      assert.equal(result.orderResult.symbol, 'ES');
      assert.equal(result.orderResult.side, 'long');
      assert.equal(result.orderResult.quantity, 1);
      assert.equal(result.orderResult.entry, 5000);
      assert.equal(result.orderResult.stop, 4980);
      assert.equal(result.orderResult.target, 5040);
      assert.equal(result.orderResult.mode, 'paper');
      assert.equal(result.orderResult.brokerAdapter, 'paper');
      assert.equal(result.orderResult.simulatedFill, 5000);
      assert.equal(result.orderResult.resolvedBy, 'julio');
      assert.equal(result.orderResult.approvalId, pending.id);
    }
  });

  it('denied approval submits nothing', () => {
    const pending  = makeTradeApproval('NQ', 'short', 1, 18000, 18050, 17900);
    const resolved = resolveApproval(pending.id, false, 'julio', 'market closed');
    assert.ok(resolved);

    const result = executeTrade(resolved);
    assert.equal(result.outcome, 'denied');
    if (result.outcome === 'denied') {
      assert.equal(result.reason, 'market closed');
    }

    // Verify no paper order was created for this approval
    const orders = getPaperOrders();
    assert.ok(!orders.some(o => o.approvalId === pending.id), 'no order for denied approval');
  });

  it('immutability enforced - second resolve returns null', () => {
    const pending  = makeTradeApproval('MNQ', 'long', 2, 19000, 18950, 19100);
    const resolved = resolveApproval(pending.id, true, 'julio');
    assert.ok(resolved);

    executeTrade(resolved);

    const second = resolveApproval(pending.id, true, 'julio');
    assert.equal(second, null, 'second resolve must be null - immutability enforced');
  });

  it('blocked when signal missing risk fields', () => {
    // Create approval with signal missing stop/target
    const badSignal = { symbol: 'ES', direction: 'long', quantity: 1 }; // no entry/stop/target
    const pending = requestApproval('sigma-bot', 'trade_plan', 'bad signal', { taskId: randomUUID(), signal: badSignal });
    const resolved = resolveApproval(pending.id, true, 'julio');
    assert.ok(resolved);

    const result = executeTrade(resolved);
    assert.equal(result.outcome, 'blocked');
    assert.ok((result as { outcome: 'blocked'; error: string }).error.length > 0);
  });
});
