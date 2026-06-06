// core/hermes/index.ts
// Server-side adapter for the Railway-hosted Hermes API server.

export interface HermesConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKeySet: boolean;
}

export interface HermesStatus {
  configured: boolean;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  platform?: string;
  error?: string;
}

export interface HermesModel {
  id: string;
  object?: string;
  ownedBy?: string;
}

export class HermesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HermesConfigError';
  }
}

export class HermesProviderError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HermesProviderError';
    this.status = status;
  }
}

function readTimeoutMs(): number {
  const parsed = Number(process.env.HERMES_TIMEOUT_MS ?? '30000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

function readBaseUrl(): string {
  return (process.env.HERMES_API_URL ?? '').replace(/\/$/, '');
}

function readApiKey(): string {
  return process.env.HERMES_API_KEY ?? process.env.API_SERVER_KEY ?? '';
}

function buildConfig(): HermesConfig & { apiKey: string } {
  const baseUrl = readBaseUrl();
  const apiKey = readApiKey();
  return {
    baseUrl,
    model: process.env.HERMES_MODEL ?? 'hermes-agent',
    timeoutMs: readTimeoutMs(),
    apiKeySet: apiKey.length > 0,
    apiKey,
  };
}

export function getHermesConfig(): HermesConfig {
  const { apiKey: _apiKey, ...safe } = buildConfig();
  return safe;
}

function requireBaseUrl(cfg: HermesConfig): void {
  if (!cfg.baseUrl) throw new HermesConfigError('HERMES_API_URL is not configured');
}

function requireApiKey(cfg: HermesConfig & { apiKey: string }): void {
  if (!cfg.apiKey) throw new HermesConfigError('HERMES_API_KEY is not configured');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<{ response: Response; latencyMs: number }> {
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

export async function getHermesStatus(): Promise<HermesStatus> {
  const cfg = buildConfig();
  if (!cfg.baseUrl) {
    return { configured: false, ok: false, statusCode: null, latencyMs: 0, error: 'HERMES_API_URL is not configured' };
  }

  try {
    const { response, latencyMs } = await fetchWithTimeout(
      `${cfg.baseUrl}/health`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      cfg.timeoutMs,
    );
    const payload = await response.json().catch(() => ({})) as { status?: unknown; platform?: unknown };
    return {
      configured: true,
      ok: response.ok && payload.status === 'ok',
      statusCode: response.status,
      latencyMs,
      platform: typeof payload.platform === 'string' ? payload.platform : undefined,
      error: response.ok ? undefined : `Hermes health returned HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      statusCode: null,
      latencyMs: 0,
      error: err instanceof Error ? err.message : 'Hermes health check failed',
    };
  }
}

export async function listHermesModels(): Promise<{ models: HermesModel[]; latencyMs: number }> {
  const cfg = buildConfig();
  requireBaseUrl(cfg);
  requireApiKey(cfg);

  const { response, latencyMs } = await fetchWithTimeout(
    `${cfg.baseUrl}/v1/models`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
    },
    cfg.timeoutMs,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HermesProviderError(`Hermes models failed: HTTP ${response.status} ${text}`, response.status);
  }

  const payload = await response.json() as { data?: Array<{ id?: unknown; object?: unknown; owned_by?: unknown }> };
  const models = Array.isArray(payload.data)
    ? payload.data
        .filter(item => typeof item.id === 'string')
        .map(item => ({
          id: item.id as string,
          object: typeof item.object === 'string' ? item.object : undefined,
          ownedBy: typeof item.owned_by === 'string' ? item.owned_by : undefined,
        }))
    : [];

  return { models, latencyMs };
}
