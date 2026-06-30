// tests/broker.moomoo.test.ts
// Moomoo adapter gate tests - no live orders, no real network calls.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeMoomooTrade,
  moomooLiveEnabled,
  type MoomooTradePlan,
} from '../core/broker/moomoo.js';

let savedFetch: typeof fetch;
let savedEnv: NodeJS.ProcessEnv;
let savedConsoleInfo: typeof console.info;
let savedConsoleError: typeof console.error;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedEnv = { ...process.env };
  savedConsoleInfo = console.info;
  savedConsoleError = console.error;
  console.info = () => undefined;
  console.error = () => undefined;
  delete process.env.MOOMOO_SHADOW_ENABLED;
  delete process.env.MOOMOO_API_URL;
  delete process.env.MOOMOO_API_KEY;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).fetch = savedFetch;
  process.env = savedEnv;
  console.info = savedConsoleInfo;
  console.error = savedConsoleError;
});

function mockFetch(impl: typeof fetch): void {
  (globalThis as Record<string, unknown>).fetch = impl;
}

function makePlan(overrides: Partial<MoomooTradePlan> = {}): MoomooTradePlan {
  return {
    id: 'plan-test-1',
    symbol: 'MNQ',
    side: 'long',
    entry: 19000,
    stop: 18990,
    target: 19020,
    contracts: 5,
    stopPoints: 10,
    targetPoints: 20,
    rr: 2,
    riskDollars: 100,
    riskPercent: 2,
    pointValue: 2,
    warnings: [],
    blocked: false,
    blockReasons: [],
    ...overrides,
  };
}

describe('MoomooAdapter gate', () => {
  it('shadowEnabled=false returns paper fill and does not call Moomoo', async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    });

    const result = await executeMoomooTrade(makePlan());

    assert.equal(calls, 0);
    assert.equal(result.mode, 'paper');
    assert.equal(result.brokerAdapter, 'moomoo_shadow');
    assert.equal(result.outcome, 'filled_paper');
    assert.equal(result.fillPrice, 19000);
    assert.deepEqual(result.shadow, { attempted: false, submitted: false });
  });

  it('shadowEnabled=true submits sandbox order and still returns paper fill', async () => {
    process.env.MOOMOO_SHADOW_ENABLED = 'true';
    process.env.MOOMOO_API_URL = 'https://moomoo-sandbox.test';
    process.env.MOOMOO_API_KEY = 'moomoo-test-key';

    let calls = 0;
    let requestBody: unknown;
    mockFetch(async (input, init) => {
      calls += 1;
      assert.equal(String(input), 'https://moomoo-sandbox.test/v1/orders');
      assert.equal(init?.method, 'POST');
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ orderId: 'sandbox-123', status: 'accepted' }), { status: 200 });
    });

    const result = await executeMoomooTrade(makePlan({ side: 'short', contracts: 2 }));

    assert.equal(calls, 1);
    assert.deepEqual(requestBody, {
      symbol: 'MNQ',
      side: 'SELL',
      quantity: 2,
      orderType: 'MARKET',
      mode: 'sandbox',
    });
    assert.equal(result.mode, 'paper');
    assert.equal(result.outcome, 'filled_paper');
    assert.deepEqual(result.shadow, {
      attempted: true,
      submitted: true,
      orderId: 'sandbox-123',
      status: 'accepted',
    });
  });

  it('sandbox throw is caught and paper fill still returns', async () => {
    process.env.MOOMOO_SHADOW_ENABLED = 'true';
    process.env.MOOMOO_API_URL = 'https://moomoo-sandbox.test';
    process.env.MOOMOO_API_KEY = 'moomoo-test-key';

    mockFetch(async () => {
      throw new Error('sandbox unavailable');
    });

    const result = await executeMoomooTrade(makePlan());

    assert.equal(result.mode, 'paper');
    assert.equal(result.outcome, 'filled_paper');
    assert.equal(result.shadow.attempted, true);
    assert.equal(result.shadow.submitted, false);
    assert.match(result.shadow.error ?? '', /sandbox unavailable/);
  });

  it('LIVE_ENABLED=false keeps live path unreachable regardless of env', async () => {
    process.env.MOOMOO_LIVE_ENABLED = 'true';
    process.env.MOOMOO_MODE = 'live';
    process.env.MOOMOO_SHADOW_ENABLED = 'false';

    const result = await executeMoomooTrade(makePlan());

    assert.equal(moomooLiveEnabled(), false);
    assert.equal(result.mode, 'paper');
    assert.equal(result.brokerAdapter, 'moomoo_shadow');
    assert.deepEqual(result.shadow, { attempted: false, submitted: false });
  });

  it('missing Moomoo env is caught and paper fill still returns', async () => {
    process.env.MOOMOO_SHADOW_ENABLED = 'true';
    delete process.env.MOOMOO_API_URL;
    delete process.env.MOOMOO_API_KEY;

    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    });

    const result = await executeMoomooTrade(makePlan());

    assert.equal(calls, 0);
    assert.equal(result.mode, 'paper');
    assert.equal(result.outcome, 'filled_paper');
    assert.equal(result.shadow.attempted, true);
    assert.equal(result.shadow.submitted, false);
    assert.match(result.shadow.error ?? '', /MOOMOO_API_URL or MOOMOO_API_KEY missing/);
  });
});
