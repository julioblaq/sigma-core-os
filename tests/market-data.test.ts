// tests/market-data.test.ts
// Massive futures market data adapter tests. No real network calls.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getMarketDataConfig,
  listFuturesAggs,
  MarketDataConfigError,
  MarketDataProviderError,
} from '../core/market-data/index.js';

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

describe('market data config', () => {
  it('returns safe Massive config without exposing the API key', () => {
    const cfg = getMarketDataConfig();
    assert.equal(cfg.provider, 'massive');
    assert.equal(cfg.baseUrl, 'https://api.massive.test');
    assert.equal(cfg.timeoutMs, 5000);
    assert.equal(cfg.apiKeySet, true);
    assert.ok(!('apiKey' in cfg));
  });

  it('rejects unsupported providers', () => {
    process.env.MARKET_DATA_PROVIDER = 'opend';
    assert.throws(() => getMarketDataConfig(), MarketDataConfigError);
  });
});

describe('listFuturesAggs', () => {
  it('calls the Massive futures aggregates endpoint with bearer auth', async () => {
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    mockFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({
        status: 'OK',
        count: 1,
        next_url: 'https://api.massive.test/futures/v1/aggs/ESU6?apiKey=secret&cursor=abc',
        results: [{
          ticker: 'ESU6',
          window_start: 1788172200000000000,
          session_end_date: '2026-09-01',
          open: 5400.25,
          high: 5402.5,
          low: 5399.75,
          close: 5401,
          volume: 1200,
          dollar_volume: 6481200,
          transactions: 340,
          settlement_price: 5401.25,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await listFuturesAggs({
      ticker: 'esu6',
      resolution: '5min',
      windowStartGte: '2026-09-01',
      windowStartLte: '2026-09-02',
      limit: 500,
      sort: 'window_start.asc',
    });

    const url = new URL(capturedUrl);
    assert.equal(url.origin + url.pathname, 'https://api.massive.test/futures/v1/aggs/ESU6');
    assert.equal(url.searchParams.get('resolution'), '5min');
    assert.equal(url.searchParams.get('window_start.gte'), '2026-09-01');
    assert.equal(url.searchParams.get('window_start.lte'), '2026-09-02');
    assert.equal(url.searchParams.get('limit'), '500');
    assert.equal(url.searchParams.get('sort'), 'window_start.asc');
    assert.equal((capturedHeaders as Record<string, string>).Authorization, 'Bearer massive-test-key');

    assert.equal(result.provider, 'massive');
    assert.equal(result.ticker, 'ESU6');
    assert.equal(result.resolution, '5min');
    assert.equal(result.count, 1);
    assert.equal(result.bars[0].open, 5400.25);
    assert.equal(result.bars[0].settlementPrice, 5401.25);
    assert.equal(result.nextUrl, 'https://api.massive.test/futures/v1/aggs/ESU6?cursor=abc');
    assert.ok(!JSON.stringify(result).includes('massive-test-key'));
  });

  it('supports exact window_start and descending sort', async () => {
    let capturedUrl = '';
    mockFetch(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({
        status: 'OK',
        results: [{
          ticker: 'MNQU6',
          window_start: 1788172200000000000,
          open: 19000,
          high: 19010,
          low: 18990,
          close: 19005,
          volume: 20,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await listFuturesAggs({
      ticker: 'MNQU6',
      resolution: '1session',
      windowStart: '2026-09-01',
      sort: 'window_start.desc',
    });

    const url = new URL(capturedUrl);
    assert.equal(url.searchParams.get('window_start'), '2026-09-01');
    assert.equal(url.searchParams.get('resolution'), '1session');
    assert.equal(url.searchParams.get('sort'), 'window_start.desc');
  });

  it('requires a Massive API key', async () => {
    delete process.env.MASSIVE_API_KEY;
    delete process.env.MARKET_DATA_API_KEY;
    await assert.rejects(
      () => listFuturesAggs({ ticker: 'ESU6' }),
      MarketDataConfigError,
    );
  });

  it('rejects invalid query inputs before network calls', async () => {
    await assert.rejects(
      () => listFuturesAggs({ ticker: 'ES/U6' }),
      MarketDataConfigError,
    );
    await assert.rejects(
      () => listFuturesAggs({ ticker: 'ESU6', resolution: '60min' }),
      MarketDataConfigError,
    );
    await assert.rejects(
      () => listFuturesAggs({ ticker: 'ESU6', limit: 50001 }),
      MarketDataConfigError,
    );
  });

  it('surfaces Massive provider errors', async () => {
    mockFetch(async () => new Response('bad key', { status: 401 }));
    await assert.rejects(
      () => listFuturesAggs({ ticker: 'ESU6' }),
      (err: unknown) => err instanceof MarketDataProviderError && err.status === 401,
    );
  });

  it('rejects malformed aggregate rows', async () => {
    mockFetch(async () => new Response(JSON.stringify({
      status: 'OK',
      results: [{ ticker: 'ESU6', window_start: 1, open: 1, high: 2, low: 1, close: 2 }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await assert.rejects(
      () => listFuturesAggs({ ticker: 'ESU6' }),
      (err: unknown) => err instanceof MarketDataProviderError && err.status === 502,
    );
  });
});
