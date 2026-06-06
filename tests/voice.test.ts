// tests/voice.test.ts
// Voice provider adapter tests. No real network calls.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getVoiceConfig,
  transcribeAudio,
  synthesizeSpeech,
  VoiceConfigError,
  VoiceProviderError,
} from '../core/voice/index.js';

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

let savedFetch: typeof fetch;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedEnv = { ...process.env };
  process.env.VOICE_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  process.env.VOICE_TIMEOUT_MS = '5000';
});

afterEach(() => {
  (globalThis as Record<string, unknown>).fetch = savedFetch;
  process.env = savedEnv;
});

function mockFetch(impl: FetchMock) {
  (globalThis as Record<string, unknown>).fetch = impl;
}

describe('voice config', () => {
  it('defaults to OpenRouter Microsoft MAI models without exposing the key', () => {
    const cfg = getVoiceConfig();
    assert.equal(cfg.provider, 'openrouter');
    assert.equal(cfg.baseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(cfg.sttModel, 'microsoft/mai-transcribe-1.5');
    assert.equal(cfg.ttsModel, 'microsoft/mai-voice-2');
    assert.equal(cfg.ttsVoice, 'nova');
    assert.equal(cfg.apiKeySet, true);
    assert.ok(!('apiKey' in cfg));
  });

  it('can switch to OpenAI voice defaults', () => {
    process.env.VOICE_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    delete process.env.OPENROUTER_API_KEY;

    const cfg = getVoiceConfig();
    assert.equal(cfg.provider, 'openai');
    assert.equal(cfg.baseUrl, 'https://api.openai.com/v1');
    assert.equal(cfg.sttModel, 'gpt-4o-mini-transcribe');
    assert.equal(cfg.ttsModel, 'gpt-4o-mini-tts');
    assert.equal(cfg.apiKeySet, true);
  });

  it('rejects unsupported providers', () => {
    process.env.VOICE_PROVIDER = 'bogus';
    assert.throws(() => getVoiceConfig(), VoiceConfigError);
  });
});

describe('transcribeAudio', () => {
  it('posts audio to the configured transcription endpoint', async () => {
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;
    let sawBody = false;

    mockFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      sawBody = init?.body instanceof FormData;
      return new Response(JSON.stringify({ text: 'Create a task from this voice command.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await transcribeAudio({
      audioBase64: Buffer.from('fake-audio').toString('base64'),
      mimeType: 'audio/webm',
    });

    assert.equal(result.text, 'Create a task from this voice command.');
    assert.equal(result.provider, 'openrouter');
    assert.equal(result.model, 'microsoft/mai-transcribe-1.5');
    assert.equal(capturedUrl, 'https://openrouter.ai/api/v1/audio/transcriptions');
    assert.equal((capturedHeaders as Record<string, string>).Authorization, 'Bearer sk-or-test');
    assert.equal(sawBody, true);
  });

  it('requires an API key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(
      () => transcribeAudio({ audioBase64: Buffer.from('x').toString('base64') }),
      VoiceConfigError,
    );
  });

  it('surfaces provider errors', async () => {
    mockFetch(async () => new Response('bad auth', { status: 401 }));
    await assert.rejects(
      () => transcribeAudio({ audioBase64: Buffer.from('x').toString('base64') }),
      (err: unknown) => err instanceof VoiceProviderError && err.status === 401,
    );
  });
});

describe('synthesizeSpeech', () => {
  it('returns base64 audio from the speech endpoint', async () => {
    let capturedBody: { model?: string; voice?: string; input?: string; response_format?: string } | null = null;

    mockFetch(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(Buffer.from('audio-bytes'), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    });

    const result = await synthesizeSpeech({ text: 'Ready for approval.' });

    assert.equal(result.audioBase64, Buffer.from('audio-bytes').toString('base64'));
    assert.equal(result.mimeType, 'audio/mpeg');
    assert.equal(result.provider, 'openrouter');
    assert.equal(result.model, 'microsoft/mai-voice-2');
    assert.equal(result.voice, 'nova');
    assert.deepEqual(capturedBody, {
      model: 'microsoft/mai-voice-2',
      voice: 'nova',
      input: 'Ready for approval.',
      response_format: 'mp3',
    });
  });
});
