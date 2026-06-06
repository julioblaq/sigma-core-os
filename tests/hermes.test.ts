// tests/hermes.test.ts
// Hermes Railway adapter tests. No real network calls.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getHermesConfig,
  getHermesStatus,
  listHermesModels,
  HermesConfigError,
  HermesProviderError,
} from '../core/hermes/index.js';

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

let savedFetch: typeof fetch;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedEnv = { ...process.env };
  process.env.HERMES_API_URL = 'https://hermes.example.com';
  process.env.HERMES_API_KEY = 'hermes-test-key';
  process.env.HERMES_TIMEOUT_MS = '5000';
});

afterEach(() => {
  (globalThis as Record<string, unknown>).fetch = savedFetch;
  process.env = savedEnv;
});

function mockFetch(impl: FetchMock) {
  (globalThis as Record<string, unknown>).fetch = impl;
}

describe('Hermes config', () => {
  it('returns safe config without exposing the API key', () => {
    const cfg = getHermesConfig();
    assert.equal(cfg.baseUrl, 'https://hermes.example.com');
    assert.equal(cfg.model, 'hermes-agent');
    assert.equal(cfg.timeoutMs, 5000);
    assert.equal(cfg.apiKeySet, true);
    assert.ok(!('apiKey' in cfg));
  });
});

describe('Hermes status', () => {
  it('checks the public health endpoint', async () => {
    let capturedUrl = '';
    mockFetch(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ status: 'ok', platform: 'hermes-agent' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const status = await getHermesStatus();
    assert.equal(capturedUrl, 'https://hermes.example.com/health');
    assert.equal(status.configured, true);
    assert.equal(status.ok, true);
    assert.equal(status.statusCode, 200);
    assert.equal(status.platform, 'hermes-agent');
  });

  it('reports unconfigured status without throwing', async () => {
    delete process.env.HERMES_API_URL;
    const status = await getHermesStatus();
    assert.equal(status.configured, false);
    assert.equal(status.ok, false);
    assert.equal(status.statusCode, null);
  });
});

describe('Hermes models', () => {
  it('lists models using the server-side API key', async () => {
    let capturedHeaders: HeadersInit | undefined;
    mockFetch(async (_url, init) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'hermes-agent', object: 'model', owned_by: 'hermes' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await listHermesModels();
    assert.deepEqual(result.models, [{ id: 'hermes-agent', object: 'model', ownedBy: 'hermes' }]);
    assert.equal((capturedHeaders as Record<string, string>).Authorization, 'Bearer hermes-test-key');
  });

  it('requires an API key for model access', async () => {
    delete process.env.HERMES_API_KEY;
    delete process.env.API_SERVER_KEY;
    await assert.rejects(() => listHermesModels(), HermesConfigError);
  });

  it('surfaces Hermes provider errors', async () => {
    mockFetch(async () => new Response('bad key', { status: 401 }));
    await assert.rejects(
      () => listHermesModels(),
      (err: unknown) => err instanceof HermesProviderError && err.status === 401,
    );
  });
});
