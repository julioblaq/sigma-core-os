// core/llm/index.ts
// Shared LLM client for all Sigma agents.
// Slice 2c: LiteLLM integration - environment-driven, provider-agnostic.
//
// Agents call ONLY: generateResponse(req: LLMRequest): Promise<LLMResponse>
// No provider SDKs in agents. No hardcoded model names in agents.
//
// Env vars (all optional except LLM_API_KEY):
//   LLM_BASE_URL     LiteLLM proxy base URL  (default: https://api.openai.com/v1)
//   LLM_MODEL        Model name              (default: gpt-4o)
//   LLM_API_KEY      API key                 (required)
//   LLM_TIMEOUT_MS   Request timeout ms      (default: 30000)
//   LLM_MAX_RETRIES  Retry count on 429/5xx  (default: 2)
//
// NOTE: Config is read lazily on each call so tests can override env vars
// without fighting ESM module cache. getLLMConfig() also reads live env.

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  context?: Record<string, unknown>;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  usage: LLMUsage;
  latencyMs: number;
}

// -------------------------------------------------------------------------
// Config - read lazily from env on every call (test-friendly)
// -------------------------------------------------------------------------

interface LLMConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
}

function readConfig(): LLMConfig {
  return {
    baseUrl:    (process.env.LLM_BASE_URL    ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    model:      process.env.LLM_MODEL        ?? 'gpt-4o',
    apiKey:     process.env.LLM_API_KEY      ?? '',
    timeoutMs:  parseInt(process.env.LLM_TIMEOUT_MS   ?? '30000', 10),
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES   ?? '2',     10),
  };
}

// -------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deriveProvider(baseUrl: string): string {
  if (baseUrl.includes('openai.com'))     return 'openai';
  if (baseUrl.includes('anthropic.com'))  return 'anthropic';
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) return 'local';
  return 'litellm';
}

function buildMessages(req: LLMRequest): Array<{ role: string; content: string }> {
  let system = req.systemPrompt;
  if (req.context && Object.keys(req.context).length > 0) {
    system += '\n\nContext:\n' + JSON.stringify(req.context, null, 2);
  }
  return [
    { role: 'system', content: system },
    { role: 'user',   content: req.userPrompt },
  ];
}

async function callOnce(req: LLMRequest, cfg: LLMConfig): Promise<LLMResponse> {
  const url      = `${cfg.baseUrl}/chat/completions`;
  const messages = buildMessages(req);
  const body     = JSON.stringify({ model: cfg.model, messages });

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), cfg.timeoutMs);

  const startMs = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - startMs;

  if (!res.ok) {
    const errText = await res.text().catch(() => '(unreadable)');
    throw new Error(`[llm] HTTP ${res.status} from ${url}: ${errText}`);
  }

  const json = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const content = json.choices?.[0]?.message?.content ?? '';
  const usage: LLMUsage = {
    promptTokens:     json.usage?.prompt_tokens     ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    totalTokens:      json.usage?.total_tokens      ?? 0,
  };
  const provider = deriveProvider(cfg.baseUrl);

  console.log(
    `[llm] ok model=${json.model} provider=${provider} ` +
    `tokens=${usage.totalTokens} latency=${latencyMs}ms`
  );

  return { content, model: json.model ?? cfg.model, provider, usage, latencyMs };
}

// -------------------------------------------------------------------------
// Public API - the ONLY function agents should call
// -------------------------------------------------------------------------

export async function generateResponse(req: LLMRequest): Promise<LLMResponse> {
  // Read config fresh on every call - env vars may be overridden in tests
  const cfg = readConfig();

  if (!cfg.apiKey) {
    throw new Error('[llm] LLM_API_KEY is not set');
  }

  const retryable = new Set([429, 500, 502, 503, 504]);
  let lastError: unknown;

  for (let n = 0; n <= cfg.maxRetries; n++) {
    if (n > 0) {
      const backoffMs = 1000 * Math.pow(2, n - 1);
      console.log(`[llm] retry ${n}/${cfg.maxRetries} after ${backoffMs}ms`);
      await sleep(backoffMs);
    }

    console.log(
      `[llm] request model=${cfg.model} provider=${deriveProvider(cfg.baseUrl)} ` +
      `systemLen=${req.systemPrompt.length} userLen=${req.userPrompt.length}`
    );

    try {
      return await callOnce(req, cfg);
    } catch (err: unknown) {
      lastError = err;
      const msg         = err instanceof Error ? err.message : String(err);
      const statusMatch = msg.match(/HTTP (\d+)/);
      const status      = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const isRetryable = retryable.has(status) || msg.includes('abort');

      console.error(`[llm] error attempt=${n}: ${msg}`);

      if (!isRetryable || n >= cfg.maxRetries) break;
    }
  }

  throw lastError;
}

// -------------------------------------------------------------------------
// Config introspection - never exposes apiKey value
// -------------------------------------------------------------------------

export function getLLMConfig(): Omit<LLMConfig, 'apiKey'> & { apiKeySet: boolean } {
  const cfg = readConfig();
  return {
    baseUrl:    cfg.baseUrl,
    model:      cfg.model,
    timeoutMs:  cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
    apiKeySet:  cfg.apiKey.length > 0,
  };
}
