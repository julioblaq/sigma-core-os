// tests/sigma-bot.test.ts
// SigmaBot market data behavior. No real network calls.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { handleTask } from '../agents/sigma-bot/handler.js';
import { route, type Task } from '../core/router/index.js';

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

let savedFetch: typeof fetch;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedEnv = { ...process.env };
  process.env.MARKET_DATA_PROVIDER = 'massive';
  process.env.MASSIVE_BASE_URL = 'https://api.massive.test';
  process.env.MASSIVE_API_KEY = 'massive-test-key';
  process.env.MASSIVE_TIMEOUT_MS = '5000';
});

afterEach(() => {
  (globalThis as Record<string, unknown>).fetch = savedFetch;
  process.env = savedEnv;
});

function mockFetch(impl: FetchMock) {
  (globalThis as Record<string, unknown>).fetch = impl;
}

function makeTask(type: string, payload: Record<string, unknown>): Task {
  return {
    id: randomUUID(),
    type,
    payload,
    submittedBy: 'test',
    createdAt: '2026-06-13T12:00:00.000Z',
  };
}

describe('sigma-bot market data', () => {
  it('answers NQ market questions from Massive session aggregates without guessing', async () => {
    let capturedUrl = '';
    mockFetch(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({
        status: 'OK',
        count: 1,
        results: [{
          ticker: 'NQM6',
          window_start: 1781298000000000000,
          session_end_date: '2026-06-12',
          open: 21850.25,
          high: 22010.5,
          low: 21790.75,
          close: 21988.25,
          volume: 43210,
          settlement_price: 21990,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await handleTask(makeTask('market_data_query', {
      question: "What was yesterday's high for the NQ?",
      date: '2026-06-12',
    }));

    const url = new URL(capturedUrl);
    assert.equal(url.origin + url.pathname, 'https://api.massive.test/futures/v1/aggs/NQM6');
    assert.equal(url.searchParams.get('resolution'), '1session');
    assert.equal(url.searchParams.get('window_start.gte'), '2026-06-09');
    assert.equal(url.searchParams.get('window_start.lte'), '2026-06-13');
    assert.equal(url.searchParams.get('limit'), '10');
    assert.equal(url.searchParams.get('apiKey'), 'massive-test-key');

    assert.equal(result.status, 'success');
    assert.equal(result.approvalId, undefined);
    assert.equal(result.data.ticker, 'NQM6');
    assert.equal(result.data.inferredContract, true);
    assert.match(String(result.data.message), /high was 22010.5/);
    assert.ok(!JSON.stringify(result).includes('massive-test-key'));
    assert.ok(!String(result.data.message).toLowerCase().includes('around'));
  });

  it('uses exact futures tickers when supplied', async () => {
    mockFetch(async () => new Response(JSON.stringify({
      status: 'OK',
      results: [{
        ticker: 'MNQU6',
        window_start: 1788172200000000000,
        session_end_date: '2026-09-01',
        open: 19000,
        high: 19010,
        low: 18990,
        close: 19005,
        volume: 20,
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await handleTask(makeTask('futures_levels', {
      ticker: 'mnqu6',
      date: '2026-09-01',
    }));

    assert.equal(result.status, 'success');
    assert.equal(result.data.ticker, 'MNQU6');
    assert.equal(result.data.inferredContract, false);
    assert.match(String(result.data.note), /Exact futures contract/);
  });

  it('returns an error instead of estimating when Massive is not configured', async () => {
    delete process.env.MASSIVE_API_KEY;
    delete process.env.MARKET_DATA_API_KEY;

    const result = await handleTask(makeTask('market_data_query', {
      symbol: 'NQ',
      date: '2026-06-12',
    }));

    assert.equal(result.status, 'error');
    assert.match(String(result.data.message), /MASSIVE_API_KEY is not configured/);
    assert.match(String(result.data.message), /cannot answer live or historical market levels safely/);
  });

  it('routes market tasks to SigmaBot and returns market data', async () => {
    mockFetch(async () => new Response(JSON.stringify({
      status: 'OK',
      results: [{
        ticker: 'ESM6',
        window_start: 1781298000000000000,
        session_end_date: '2026-06-12',
        open: 6000,
        high: 6012.25,
        low: 5988.5,
        close: 6008,
        volume: 100,
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await route(makeTask('market_data_query', {
      symbol: 'ES',
      date: '2026-06-12',
    }));

    assert.equal(result.agent, 'sigma-bot');
    assert.equal(result.status, 'success');
    assert.equal((result.result as Record<string, unknown>).ticker, 'ESM6');
  });
});
