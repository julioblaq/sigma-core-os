// core/market-data/index.ts
// Cloud-safe futures market data adapter. Broker/session gateways stay local.

export type MarketDataProvider = 'massive';

export interface MarketDataConfig {
  provider: MarketDataProvider;
  baseUrl: string;
  timeoutMs: number;
  apiKeySet: boolean;
}

export interface FuturesAggBar {
  ticker: string;
  windowStart: number;
  sessionEndDate?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dollarVolume?: number;
  transactions?: number;
  settlementPrice?: number;
}

export interface FuturesAggsRequest {
  ticker: string;
  resolution?: string;
  windowStart?: string;
  windowStartGte?: string;
  windowStartGt?: string;
  windowStartLte?: string;
  windowStartLt?: string;
  limit?: number;
  sort?: string;
}

export interface FuturesAggsResult {
  provider: MarketDataProvider;
  ticker: string;
  resolution: string;
  status: string;
  count: number;
  bars: FuturesAggBar[];
  nextUrl?: string;
  latencyMs: number;
}

export class MarketDataConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketDataConfigError';
  }
}

export class MarketDataProviderError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MarketDataProviderError';
    this.status = status;
  }
}

interface MassiveAggRow {
  ticker?: unknown;
  window_start?: unknown;
  session_end_date?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
  dollar_volume?: unknown;
  transactions?: unknown;
  settlement_price?: unknown;
}

function readProvider(): MarketDataProvider {
  const raw = (process.env.MARKET_DATA_PROVIDER ?? 'massive').toLowerCase();
  if (raw === 'massive') return raw;
  throw new MarketDataConfigError(`Unsupported market data provider: ${raw}`);
}

function readBaseUrl(): string {
  return (process.env.MASSIVE_BASE_URL ?? 'https://api.massive.com').replace(/\/$/, '');
}

function readApiKey(): string {
  return process.env.MASSIVE_API_KEY ?? process.env.MARKET_DATA_API_KEY ?? '';
}

function readTimeoutMs(): number {
  const parsed = Number(process.env.MASSIVE_TIMEOUT_MS ?? process.env.MARKET_DATA_TIMEOUT_MS ?? '30000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

function buildConfig(): MarketDataConfig & { apiKey: string } {
  const apiKey = readApiKey();
  return {
    provider: readProvider(),
    baseUrl: readBaseUrl(),
    timeoutMs: readTimeoutMs(),
    apiKeySet: apiKey.length > 0,
    apiKey,
  };
}

export function getMarketDataConfig(): MarketDataConfig {
  const { apiKey: _apiKey, ...safe } = buildConfig();
  return safe;
}

function requireApiKey(cfg: MarketDataConfig & { apiKey: string }): void {
  if (!cfg.apiKey) throw new MarketDataConfigError('MASSIVE_API_KEY is not configured');
}

function normalizeTicker(value: string): string {
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(ticker)) {
    throw new MarketDataConfigError('Futures ticker must be an alphanumeric contract symbol such as ESU6');
  }
  return ticker;
}

function normalizeResolution(value: string | undefined): string {
  const resolution = (value ?? '1min').trim();
  const match = resolution.match(/^([1-9][0-9]*)(sec|min|hour|session|week|month|quarter|year)$/);
  if (!match) {
    throw new MarketDataConfigError('resolution must look like 1min, 5min, 1hour, or 1session');
  }
  const multiplier = Number(match[1]);
  const unit = match[2];
  if ((unit === 'sec' || unit === 'min') && multiplier > 59) {
    throw new MarketDataConfigError('sec and min resolutions must use a multiplier from 1 through 59');
  }
  return resolution;
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 1000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50000) {
    throw new MarketDataConfigError('limit must be an integer between 1 and 50000');
  }
  return limit;
}

function normalizeSort(value: string | undefined): string {
  const sort = value ?? 'window_start.asc';
  if (!/^[a-z_]+\.(asc|desc)$/.test(sort)) {
    throw new MarketDataConfigError('sort must use dotted notation such as window_start.asc');
  }
  return sort;
}

function appendOptional(params: URLSearchParams, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) params.set(key, trimmed);
}

function sanitizeNextUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    url.searchParams.delete('apiKey');
    return url.toString();
  } catch {
    return value.replace(/([?&]apiKey=)[^&]+/i, '$1[redacted]');
  }
}

function numberValue(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new MarketDataProviderError(`Massive aggregate row missing numeric ${field}`, 502);
}

function optionalNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapBar(row: MassiveAggRow, fallbackTicker: string): FuturesAggBar {
  return {
    ticker: typeof row.ticker === 'string' ? row.ticker : fallbackTicker,
    windowStart: numberValue(row.window_start, 'window_start'),
    sessionEndDate: typeof row.session_end_date === 'string' ? row.session_end_date : undefined,
    open: numberValue(row.open, 'open'),
    high: numberValue(row.high, 'high'),
    low: numberValue(row.low, 'low'),
    close: numberValue(row.close, 'close'),
    volume: numberValue(row.volume, 'volume'),
    dollarVolume: optionalNumberValue(row.dollar_volume),
    transactions: optionalNumberValue(row.transactions),
    settlementPrice: optionalNumberValue(row.settlement_price),
  };
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

export async function listFuturesAggs(req: FuturesAggsRequest): Promise<FuturesAggsResult> {
  const cfg = buildConfig();
  requireApiKey(cfg);

  const ticker = normalizeTicker(req.ticker);
  const resolution = normalizeResolution(req.resolution);
  const params = new URLSearchParams({
    resolution,
    limit: String(normalizeLimit(req.limit)),
    sort: normalizeSort(req.sort),
  });
  appendOptional(params, 'window_start', req.windowStart);
  appendOptional(params, 'window_start.gte', req.windowStartGte);
  appendOptional(params, 'window_start.gt', req.windowStartGt);
  appendOptional(params, 'window_start.lte', req.windowStartLte);
  appendOptional(params, 'window_start.lt', req.windowStartLt);
  params.set('apiKey', cfg.apiKey);

  const url = `${cfg.baseUrl}/futures/v1/aggs/${encodeURIComponent(ticker)}?${params.toString()}`;
  const { response, latencyMs } = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
    cfg.timeoutMs,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new MarketDataProviderError(`Massive futures aggregates failed: HTTP ${response.status} ${text}`, response.status);
  }

  const payload = await response.json() as {
    status?: unknown;
    count?: unknown;
    next_url?: unknown;
    results?: MassiveAggRow[];
  };

  const rows = Array.isArray(payload.results) ? payload.results : [];
  const bars = rows.map(row => mapBar(row, ticker));

  return {
    provider: cfg.provider,
    ticker,
    resolution,
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    count: typeof payload.count === 'number' ? payload.count : bars.length,
    bars,
    nextUrl: sanitizeNextUrl(payload.next_url),
    latencyMs,
  };
}
