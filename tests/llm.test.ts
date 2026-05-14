// tests/llm.test.ts
// Slice 2c: core/llm tests - mocks globalThis.fetch, no real API calls.
// Config is read lazily per-call so env vars set here are always picked up.

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { generateResponse, getLLMConfig } from '../core/llm/index.js';

// -------------------------------------------------------------------------
// Test env config - set once before all tests, read lazily by core/llm
// -------------------------------------------------------------------------

before(() => {
  process.env.LLM_BASE_URL    = 'https://test-litellm.example.com/v1';
  process.env.LLM_MODEL       = 'gpt-test';
  process.env.LLM_API_KEY     = 'sk-test-key';
  process.env.LLM_TIMEOUT_MS  = '5000';
  process.env.LLM_MAX_RETRIES = '1';
});

// -------------------------------------------------------------------------
// Fetch mock helpers
// -------------------------------------------------------------------------

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

let savedFetch: typeof fetch;

function mockFetch(impl: FetchMock) {
  (globalThis as Record<string, unknown>).fetch = impl;
}

function makeFetchOk(body: object): FetchMock {
  return async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
}

function makeFetchStatus(status: number, body = ''): FetchMock {
  return async () => new Response(body, { status });
}

beforeEach(() => { savedFetch = globalThis.fetch; });
afterEach(() => { (globalThis as Record<string, unknown>).fetch = savedFetch; });

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('core/llm', () => {

  // -------------------------------------------------------------------------
  // getLLMConfig
  // -------------------------------------------------------------------------
  describe('getLLMConfig', () => {
    it('returns config without exposing apiKey', () => {
      const cfg = getLLMConfig();
      assert.equal(cfg.model, 'gpt-test');
      assert.equal(cfg.baseUrl, 'https://test-litellm.example.com/v1');
      assert.equal(cfg.apiKeySet, true);
      assert.ok(!('apiKey' in cfg), 'apiKey must not be exposed');
    });

    it('apiKeySet is true when LLM_API_KEY is set', () => {
      assert.equal(getLLMConfig().apiKeySet, true);
    });
  });

  // -------------------------------------------------------------------------
  // generateResponse - happy path
  // -------------------------------------------------------------------------
  describe('generateResponse - success', () => {
    it('calls /chat/completions and returns structured LLMResponse', async () => {
      mockFetch(makeFetchOk({
        choices: [{ message: { content: 'This is a test narrative.' } }],
        model: 'gpt-test',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }));

      const res = await generateResponse({
        systemPrompt: 'You are a test assistant.',
        userPrompt:   'Write a test rationale.',
      });

      assert.equal(res.content, 'This is a test narrative.');
      assert.equal(res.model, 'gpt-test');
      assert.equal(res.usage.totalTokens, 30);
      assert.equal(res.usage.promptTokens, 10);
      assert.equal(res.usage.completionTokens, 20);
      assert.ok(res.latencyMs >= 0);
      assert.equal(res.provider, 'litellm');
    });

    it('includes context as JSON in the system message', async () => {
      let capturedBody: Record<string, unknown> | null = null;

      mockFetch(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          model: 'gpt-test',
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      await generateResponse({
        systemPrompt: 'System.',
        userPrompt:   'User.',
        context: { symbol: 'ES', qty: 1 },
      });

      assert.ok(capturedBody, 'fetch body should have been captured');
      const messages = capturedBody!.messages as Array<{ role: string; content: string }>;
      const systemMsg = messages.find(m => m.role === 'system');
      assert.ok(systemMsg?.content.includes('"symbol": "ES"'), 'context should be in system message');
    });

    it('sends Authorization header with Bearer token', async () => {
      let capturedHeaders: Record<string, string> | null = null;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          model: 'gpt-test',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      await generateResponse({ systemPrompt: 'sys', userPrompt: 'user' });

      assert.ok(capturedHeaders, 'headers should have been captured');
      assert.equal(capturedHeaders!['Authorization'], 'Bearer sk-test-key');
    });

    it('derives provider correctly for litellm host', async () => {
      mockFetch(makeFetchOk({
        choices: [{ message: { content: 'ok' } }],
        model: 'gpt-test',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));

      const res = await generateResponse({ systemPrompt: 'sys', userPrompt: 'user' });
      assert.equal(res.provider, 'litellm');
    });
  });

  // -------------------------------------------------------------------------
  // generateResponse - error handling
  // -------------------------------------------------------------------------
  describe('generateResponse - errors', () => {
    it('throws on non-retryable 400 error', async () => {
      mockFetch(makeFetchStatus(400, 'Bad Request'));

      await assert.rejects(
        () => generateResponse({ systemPrompt: 'sys', userPrompt: 'user' }),
        (err: Error) => {
          assert.ok(err.message.includes('400'), 'error should mention status 400');
          return true;
        },
      );
    });

    it('throws on 401 unauthorized', async () => {
      mockFetch(makeFetchStatus(401, 'Unauthorized'));

      await assert.rejects(
        () => generateResponse({ systemPrompt: 'sys', userPrompt: 'user' }),
        (err: Error) => {
          assert.ok(err.message.includes('401'), 'error should mention status 401');
          return true;
        },
      );
    });

    it('retries on 429 and eventually throws', async () => {
      let callCount = 0;
      mockFetch(async () => {
        callCount++;
        return new Response('rate limited', { status: 429 });
      });

      await assert.rejects(
        () => generateResponse({ systemPrompt: 'sys', userPrompt: 'user' }),
      );

      // LLM_MAX_RETRIES=1: initial attempt + 1 retry = 2 calls
      assert.equal(callCount, 2, `expected 2 calls (1 + 1 retry), got ${callCount}`);
    });

    it('retries on 503 and succeeds on second attempt', async () => {
      let callCount = 0;
      mockFetch(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('service unavailable', { status: 503 });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'recovered' } }],
          model: 'gpt-test',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      const res = await generateResponse({ systemPrompt: 'sys', userPrompt: 'user' });
      assert.equal(res.content, 'recovered');
      assert.equal(callCount, 2, `expected 2 calls (fail + retry), got ${callCount}`);
    });
  });

});
