// core/voice/index.ts
// Provider-neutral voice adapter for Sigma voice commands.
//
// First pass supports OpenAI and OpenRouter-compatible audio endpoints.
// Voice input creates transcripts and approval-gated drafts; it never executes
// commands directly.

export type VoiceProvider = 'openai' | 'openrouter';

export interface VoiceConfig {
  provider: VoiceProvider;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
  timeoutMs: number;
  apiKeySet: boolean;
}

export interface VoiceTranscriptionRequest {
  audioBase64: string;
  mimeType?: string;
  language?: string;
  prompt?: string;
  provider?: VoiceProvider;
}

export interface VoiceTranscriptionResult {
  text: string;
  provider: VoiceProvider;
  model: string;
  latencyMs: number;
}

export interface VoiceSpeechRequest {
  text: string;
  voice?: string;
  format?: string;
  provider?: VoiceProvider;
}

export interface VoiceSpeechResult {
  audioBase64: string;
  mimeType: string;
  provider: VoiceProvider;
  model: string;
  voice: string;
  format: string;
  latencyMs: number;
}

export class VoiceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceConfigError';
  }
}

export class VoiceProviderError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'VoiceProviderError';
    this.status = status;
  }
}

function readProvider(override?: VoiceProvider): VoiceProvider {
  const raw = (override ?? process.env.VOICE_PROVIDER ?? 'openrouter').toLowerCase();
  if (raw === 'openai' || raw === 'openrouter') return raw;
  throw new VoiceConfigError(`Unsupported voice provider: ${raw}`);
}

function readApiKey(provider: VoiceProvider): string {
  return (
    process.env.VOICE_API_KEY ??
    (provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY) ??
    ''
  );
}

function readBaseUrl(provider: VoiceProvider): string {
  return (
    process.env.VOICE_BASE_URL ??
    (provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')
  ).replace(/\/$/, '');
}

function defaultSttModel(provider: VoiceProvider): string {
  return provider === 'openrouter' ? 'microsoft/mai-transcribe-1.5' : 'gpt-4o-mini-transcribe';
}

function defaultTtsModel(provider: VoiceProvider): string {
  return provider === 'openrouter' ? 'microsoft/mai-voice-2' : 'gpt-4o-mini-tts';
}

function defaultTtsVoice(provider: VoiceProvider): string {
  return provider === 'openrouter' ? 'en-US-Harper:MAI-Voice-2' : 'nova';
}

function readTimeoutMs(): number {
  const parsed = Number(process.env.VOICE_TIMEOUT_MS ?? '30000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

function buildConfig(providerOverride?: VoiceProvider): VoiceConfig & { apiKey: string } {
  const provider = readProvider(providerOverride);
  const apiKey = readApiKey(provider);
  return {
    provider,
    baseUrl: process.env[`VOICE_${provider.toUpperCase()}_BASE_URL`] ?? readBaseUrl(provider),
    sttModel: process.env.VOICE_STT_MODEL ?? defaultSttModel(provider),
    ttsModel: process.env.VOICE_TTS_MODEL ?? defaultTtsModel(provider),
    ttsVoice: process.env.VOICE_TTS_VOICE ?? defaultTtsVoice(provider),
    ttsFormat: process.env.VOICE_TTS_FORMAT ?? 'mp3',
    timeoutMs: readTimeoutMs(),
    apiKeySet: apiKey.length > 0,
    apiKey,
  };
}

export function getVoiceConfig(providerOverride?: VoiceProvider): VoiceConfig {
  const { apiKey: _apiKey, ...safe } = buildConfig(providerOverride);
  return safe;
}

function requireApiKey(cfg: VoiceConfig & { apiKey: string }): void {
  if (!cfg.apiKey) {
    throw new VoiceConfigError(`No API key configured for voice provider ${cfg.provider}`);
  }
}

function audioExtension(mimeType: string | undefined): string {
  if (!mimeType) return 'webm';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function formatMimeType(format: string): string {
  if (format === 'wav') return 'audio/wav';
  if (format === 'opus') return 'audio/ogg';
  if (format === 'aac') return 'audio/aac';
  return 'audio/mpeg';
}

async function postWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, latencyMs: Date.now() - startMs };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(cfg: VoiceConfig & { apiKey: string }): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = process.env.DASHBOARD_ORIGIN ?? 'https://sigma-core-os.local';
    headers['X-Title'] = 'Sigma Core OS';
  }
  return headers;
}

export async function transcribeAudio(req: VoiceTranscriptionRequest): Promise<VoiceTranscriptionResult> {
  const cfg = buildConfig(req.provider);
  requireApiKey(cfg);

  const audio = Buffer.from(req.audioBase64, 'base64');
  if (audio.length === 0) throw new VoiceConfigError('Audio payload is empty');

  const form = new FormData();
  form.append('model', cfg.sttModel);
  form.append(
    'file',
    new Blob([audio], { type: req.mimeType ?? 'audio/webm' }),
    `sigma-voice.${audioExtension(req.mimeType)}`,
  );
  if (req.language) form.append('language', req.language);
  if (req.prompt) form.append('prompt', req.prompt);

  const { response, latencyMs } = await postWithTimeout(
    `${cfg.baseUrl}/audio/transcriptions`,
    { method: 'POST', headers: authHeaders(cfg), body: form },
    cfg.timeoutMs,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new VoiceProviderError(`Transcription failed: HTTP ${response.status} ${text}`, response.status);
  }

  const json = await response.json() as { text?: unknown; transcript?: unknown };
  const text = typeof json.text === 'string'
    ? json.text
    : typeof json.transcript === 'string'
      ? json.transcript
      : '';

  if (!text.trim()) throw new VoiceProviderError('Transcription response did not include text', 502);

  return { text: text.trim(), provider: cfg.provider, model: cfg.sttModel, latencyMs };
}

export async function synthesizeSpeech(req: VoiceSpeechRequest): Promise<VoiceSpeechResult> {
  const cfg = buildConfig(req.provider);
  requireApiKey(cfg);

  const text = req.text.trim();
  if (!text) throw new VoiceConfigError('Speech text is required');

  const voice = req.voice ?? cfg.ttsVoice;
  const format = req.format ?? cfg.ttsFormat;

  const { response, latencyMs } = await postWithTimeout(
    `${cfg.baseUrl}/audio/speech`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
      body: JSON.stringify({
        model: cfg.ttsModel,
        voice,
        input: text,
        response_format: format,
      }),
    },
    cfg.timeoutMs,
  );

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new VoiceProviderError(`Speech synthesis failed: HTTP ${response.status} ${err}`, response.status);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return {
    audioBase64: audio.toString('base64'),
    mimeType: formatMimeType(format),
    provider: cfg.provider,
    model: cfg.ttsModel,
    voice,
    format,
    latencyMs,
  };
}
