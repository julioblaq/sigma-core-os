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

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  context?: Record<string, unknown>;  // optional structured context injected as JSON
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
// Config - read once at module load, fail fast if misconfigured
// -------------------------------------------------------------------------

interface LLMConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
}

function loadConfig(): LLMConfig {
  const apiKey = process.env.LLM_API_KEY ?? '';
  if (!apiKey) {
    console.warn('[llm] WARNING: LLM_API_KEY is not set - generateResponse() will throw at call time');
  }
  return {
    baseUrl:    (process.env.LLM_BASE_URL    ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    model:      process.env.LLM_MODEL        ?? 'gpt-4o',
    apiKey,
    timeoutMs:  parseInt(process.env.LLM_TIMEOUT_MS   ?? '30000', 10),
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES   ?? '2',     10),
  };
}

const config: LLMConfig = loadConfig();

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

// Build the messages array - inject context as a JSON system block if provided
function buildMessages(req: LLMRequest): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  let system = req.systemPrompt;
  if (req.context && Object.keys(req.context).length > 0) {
    system += '\n\nContext:\n' + JSON.stringify(req.context, null, 2);
  }
  messages.push({ role: 'system', content: system });
  messages.push({ role: 'user',   content: req.userPrompt });
  return messages;
}

// Single attempt - throws on non-2xx after reading body for error detail
async function attempt(req: LLMRequest, cfg: LLMConfig): Promise<LLMResponse> {
  if (!cfg.apiKey) {
    throw new Error('[llm] LLM_API_KEY is not set');
  }

  const url      = `${cfg.baseUrl}/chat/completions`;
  const messages = buildMessages(req);
  const body     = JSON.stringify({ model: cfg.model, messages });
  const controller = new AbortController();
  const timer    = setTimeout(() => controller.abort(), cfg.timeoutMs);

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
  const retryableStatus = new Set([429, 500, 502, 503, 504]);
  let lastError: unknown;

  for (let attempt_n = 0; attempt_n <= config.maxRetries; attempt_n++) {
    if (attempt_n > 0) {
      const backoffMs = 1000 * Math.pow(2, attempt_n - 1); // 1s, 2s, 4s...
      console.log(`[llm] retry ${attempt_n}/${config.maxRetries} after ${backoffMs}ms`);
      await sleep(backoffMs);
    }

    try {
      console.log(
        `[llm] request model=${config.model} provider=${deriveProvider(config.baseUrl)} ` +
        `systemLen=${req.systemPrompt.length} userLen=${req.userPrompt.length}`
      );
      return await attempt(req, config);
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);

      // Check if it's a retryable HTTP error
      const statusMatch = msg.match(/HTTP (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const isRetryable = retryableStatus.has(status) || msg.includes('abort');

      console.error(`[llm] error attempt=${attempt_n}: ${msg}`);

      if (!isRetryable || attempt_n >= config.maxRetries) break;
    }
  }

  throw lastError;
}

// -------------------------------------------------------------------------
// Config introspection - for health checks, never exposes apiKey
// -------------------------------------------------------------------------

export function getLLMConfig(): Omit<LLMConfig, 'apiKey'> & { apiKeySet: boolean } {
  return {
    baseUrl:    config.baseUrl,
    model:      config.model,
    timeoutMs:  config.timeoutMs,
    maxRetries: config.maxRetries,
    apiKeySet:  config.apiKey.length > 0,
  };
}
