// core/llm/index.ts
// Shared LLM client for all Sigma agents.
// Slice 3c: Multi-model routing - provider-agnostic chain with automatic failover.
//
// Agents call ONLY: generateResponse(req: LLMRequest): Promise<LLMResponse>
// No provider SDKs in agents. No hardcoded model names in agents.
//
// Env vars:
//   LLM_MODELS           Comma-separated ordered chain (default: gpt-5.5,claude-3,ollama)
//   LLM_API_KEY          Shared API key for hosted providers
//   LLM_BASE_URL         Override base URL for primary provider
//   LLM_TIMEOUT_MS       Per-provider request timeout ms (default: 30000)
//
// Per-provider overrides (model id uppercased, non-alphanumeric stripped):
//   LLM_GPT55_BASE_URL     LLM_GPT55_API_KEY     LLM_GPT55_TIMEOUT_MS
//   LLM_CLAUDE3_BASE_URL   LLM_CLAUDE3_API_KEY
//   LLM_OLLAMA_BASE_URL    (no key needed for local)
//
// Routing behavior:
//   - Failover on 429, 5xx, timeout
//   - Non-retryable (400, 401, 403) stops chain for that provider only
//   - All providers fail -> ChainExhaustionError (never silently hallucinate)
//   - Full failure chain preserved for auditability
//
// Config read lazily per call - test-friendly, no ESM module cache issues.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  providerIndex: number;
}

export interface ProviderConfig {
  id: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export interface ProviderStatus {
  id: string;
  model: string;
  baseUrl: string;
  available: boolean;
  lastFailureReason: string | undefined;
  failureCount: number;
}

export interface ProviderFailure {
  providerIndex: number;
  providerId: string;
  reason: string;
  status: number;
}

// Thrown when every provider in the chain fails.
// Never silently return a hallucinated response.
export class ChainExhaustionError extends Error {
  public readonly failures: ProviderFailure[];
  constructor(failures: ProviderFailure[]) {
    const summary = failures
      .map(f => `[${f.providerId}:${f.status || 'timeout'}] ${f.reason}`)
      .join(' | ');
    super(`[llm] All providers exhausted: ${summary}`);
    this.name = 'ChainExhaustionError';
    this.failures = failures;
  }
}

// ---------------------------------------------------------------------------
// Provider registry - env-driven, built fresh per call
// ---------------------------------------------------------------------------

interface ProviderDefaults {
  baseUrl: string;
  requiresKey: boolean;
}

const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  'gpt-5.5':    { baseUrl: 'https://api.openai.com/v1',    requiresKey: true  },
  'gpt-4o':     { baseUrl: 'https://api.openai.com/v1',    requiresKey: true  },
  'claude-3':   { baseUrl: 'https://api.anthropic.com/v1', requiresKey: true  },
  'claude-3-5': { baseUrl: 'https://api.anthropic.com/v1', requiresKey: true  },
  'ollama':     { baseUrl: 'http://localhost:11434/v1',     requiresKey: false },
  'openclaw':   { baseUrl: 'http://localhost:11434/v1',     requiresKey: false },
};

// gpt-5.5 -> GPT55, claude-3 -> CLAUDE3
function modelToEnvKey(modelId: string): string {
  return modelId.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function deriveProvider(baseUrl: string): string {
  if (baseUrl.includes('openai.com'))    return 'openai';
  if (baseUrl.includes('anthropic.com')) return 'anthropic';
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) return 'local';
  return 'litellm';
}

function buildProviderConfig(modelId: string, isPrimary: boolean): ProviderConfig {
  const envKey  = modelToEnvKey(modelId);
  const defs    = PROVIDER_DEFAULTS[modelId] ?? { baseUrl: 'https://api.openai.com/v1', requiresKey: true };

  // Base URL: per-model override > global override (primary only) > provider default
  const baseUrl = (
    process.env[`LLM_${envKey}_BASE_URL`] ??
    (isPrimary ? process.env.LLM_BASE_URL : undefined) ??
    defs.baseUrl
  ).replace(/\/$/, '');

  const apiKey =
    process.env[`LLM_${envKey}_API_KEY`] ??
    process.env.LLM_API_KEY ??
    '';

  const timeoutMs = parseInt(
    process.env[`LLM_${envKey}_TIMEOUT_MS`] ??
    process.env.LLM_TIMEOUT_MS ??
    '30000',
    10,
  );

  return { id: modelId, baseUrl, model: modelId, apiKey, timeoutMs };
}

function readChain(): ProviderConfig[] {
  const models = (process.env.LLM_MODELS ?? 'gpt-5.5,claude-3,ollama')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
  return models.map((m, i) => buildProviderConfig(m, i === 0));
}

// ---------------------------------------------------------------------------
// Per-provider status (in-memory, reset on restart)
// ---------------------------------------------------------------------------

const _providerStatus: Map<string, ProviderStatus> = new Map();

function getStatus(cfg: ProviderConfig): ProviderStatus {
  if (!_providerStatus.has(cfg.id)) {
    _providerStatus.set(cfg.id, {
      id:                cfg.id,
      model:             cfg.model,
      baseUrl:           cfg.baseUrl,
      available:         true,
      lastFailureReason: undefined,
      failureCount:      0,
    });
  }
  return _providerStatus.get(cfg.id)!;
}

function recordFailure(cfg: ProviderConfig, reason: string): void {
  const s    = getStatus(cfg);
  s.failureCount++;
  s.lastFailureReason = reason;
}

function recordSuccess(cfg: ProviderConfig): void {
  const s               = getStatus(cfg);
  s.available           = true;
  s.lastFailureReason   = undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

// Status codes that trigger failover to next provider
const FAILOVER_STATUSES = new Set([429, 500, 502, 503, 504]);

// ---------------------------------------------------------------------------
// Single provider attempt
// ---------------------------------------------------------------------------

async function callProvider(
  req: LLMRequest,
  cfg: ProviderConfig,
  providerIndex: number,
): Promise<LLMResponse> {
  const url  = `${cfg.baseUrl}/chat/completions`;
  const body = JSON.stringify({ model: cfg.model, messages: buildMessages(req) });

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const startMs    = Date.now();

  console.log(
    `[llm] attempt provider=${cfg.id} index=${providerIndex} baseUrl=${cfg.baseUrl}`,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
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
    const err     = new Error(`HTTP ${res.status} from ${cfg.id}: ${errText}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }

  // Parse response
  let json: {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    json = await res.json();
  } catch {
    throw new Error(`[llm] malformed JSON from provider ${cfg.id}`);
  }

  // Validate shape - never silently return garbage
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error(
      `[llm] malformed response from provider ${cfg.id}: missing choices[0].message.content`,
    );
  }

  const usage: LLMUsage = {
    promptTokens:     json.usage?.prompt_tokens     ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    totalTokens:      json.usage?.total_tokens      ?? 0,
  };

  const provider = deriveProvider(cfg.baseUrl);
  recordSuccess(cfg);

  console.log(
    `[llm] ok provider=${cfg.id} model=${json.model ?? cfg.model} " +
    "type=${provider} tokens=${usage.totalTokens} latency=${latencyMs}ms`,
  );

  return { content, model: json.model ?? cfg.model, provider, usage, latencyMs, providerIndex };
}

// ---------------------------------------------------------------------------
// Chain routing - walks providers, failover on 429/5xx/timeout
// ---------------------------------------------------------------------------

async function routeRequest(req: LLMRequest): Promise<LLMResponse> {
  const chain    = readChain();
  const failures: ProviderFailure[] = [];

  for (let i = 0; i < chain.length; i++) {
    const cfg = chain[i];

    try {
      return await callProvider(req, cfg, i);
    } catch (err: unknown) {
      const msg      = err instanceof Error ? err.message : String(err);
      const status   = (err as Error & { status?: number }).status ?? 0;
      const isTimeout  = msg.includes('abort') || msg.toLowerCase().includes('aborterror');
      const isFailover = FAILOVER_STATUSES.has(status) || isTimeout;

      recordFailure(cfg, msg);
      failures.push({ providerIndex: i, providerId: cfg.id, reason: msg, status });

      const hasNext = i < chain.length - 1;

      if (isFailover && hasNext) {
        const backoffMs = 200 * (i + 1);
        console.warn(
          `[llm] provider ${cfg.id} failed status=${status || 'timeout'} " +
          "-> failover to ${chain[i + 1].id} after ${backoffMs}ms`,
        );
        await sleep(backoffMs);
        continue;
      }

      // Non-retryable error (400/401/403) or last provider - stop
      if (!isFailover) {
        console.error(`[llm] non-retryable ${status} from ${cfg.id}: ${msg}`);
      }
      break;
    }
  }

  // Full chain exhausted - log and throw structured error
  console.error(
    '[llm] chain exhausted: ' +
    failures.map(f => `${f.providerId}[${f.status || 'timeout'}]`).join(' -> '),
  );
  throw new ChainExhaustionError(failures);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateResponse(req: LLMRequest): Promise<LLMResponse> {
  // Require at least one provider in chain with a key (or key-free local provider)
  const chain = readChain();
  const hasUsableProvider = chain.some(cfg => {
    const defs = PROVIDER_DEFAULTS[cfg.id];
    if (!defs || !defs.requiresKey) return true; // local providers always usable
    return cfg.apiKey.length > 0;
  });

  if (!hasUsableProvider) {
    throw new Error('[llm] No API key configured for any provider in chain');
  }

  return routeRequest(req);
}

// Returns chain config - never exposes key values
export function getLLMConfig(): {
  chain: Array<{
    id: string;
    model: string;
    baseUrl: string;
    apiKeySet: boolean;
    timeoutMs: number;
  }>;
  primaryModel: string;
} {
  const chain = readChain();
  return {
    chain: chain.map(cfg => ({
      id:        cfg.id,
      model:     cfg.model,
      baseUrl:   cfg.baseUrl,
      apiKeySet: cfg.apiKey.length > 0,
      timeoutMs: cfg.timeoutMs,
    })),
    primaryModel: chain[0]?.model ?? 'none',
  };
}

// Returns per-provider runtime health since last process start
export function getLLMHealth(): ProviderStatus[] {
  const chain = readChain();
  return chain.map(cfg => ({ ...getStatus(cfg), model: cfg.model, baseUrl: cfg.baseUrl }));
}
