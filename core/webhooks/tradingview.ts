import type { TradePlanInput } from '../risk/index.js';

export interface TradingViewWebhookDefaults {
  accountSize?: number;
  riskDollars?: number;
  rrRatio?: number;
}

export interface TradingViewWebhookPlan {
  planInput: TradePlanInput;
  submittedBy: string;
  source: 'tradingview';
  rawAlert: Record<string, unknown>;
}

export class TradingViewWebhookError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TradingViewWebhookError';
    this.code = code;
  }
}

function pick(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') return payload[key];
  }
  return undefined;
}

function parseNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new TradingViewWebhookError('INVALID_NUMBER', `${field} must be a number`);
  }
  return numberValue;
}

function requireNumber(value: unknown, field: string): number {
  const numberValue = parseNumber(value, field);
  if (numberValue === undefined) {
    throw new TradingViewWebhookError('MISSING_FIELD', `${field} is required`);
  }
  return numberValue;
}

function normalizeSide(value: unknown): 'long' | 'short' {
  if (typeof value !== 'string') {
    throw new TradingViewWebhookError('MISSING_FIELD', 'side is required');
  }
  const side = value.toLowerCase().trim();
  if (['long', 'buy', 'bullish'].includes(side)) return 'long';
  if (['short', 'sell', 'bearish'].includes(side)) return 'short';
  throw new TradingViewWebhookError('INVALID_SIDE', 'side must be long/short or buy/sell');
}

function stripSecrets(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  delete copy.secret;
  delete copy.webhookSecret;
  delete copy.webhook_secret;
  return copy;
}

export function buildTradingViewWebhookPlan(
  payload: Record<string, unknown>,
  defaults: TradingViewWebhookDefaults = {},
): TradingViewWebhookPlan {
  const symbol = pick(payload, ['symbol', 'ticker', 'syminfo.ticker']);
  if (typeof symbol !== 'string' || !symbol.trim()) {
    throw new TradingViewWebhookError('MISSING_FIELD', 'symbol is required');
  }

  const side = normalizeSide(pick(payload, ['side', 'direction', 'action', 'strategy.order.action']));
  const entry = requireNumber(pick(payload, ['entry', 'price', 'close']), 'entry');
  const stopPoints = requireNumber(pick(payload, ['stopPoints', 'stop_points', 'stopDistance', 'stop_distance']), 'stopPoints');
  const rrRatio = parseNumber(pick(payload, ['rrRatio', 'rr_ratio', 'rr']), 'rrRatio') ?? defaults.rrRatio;
  const accountSize = parseNumber(pick(payload, ['accountSize', 'account_size']), 'accountSize') ?? defaults.accountSize;
  const riskDollars = parseNumber(pick(payload, ['riskDollars', 'risk_dollars']), 'riskDollars') ?? defaults.riskDollars;
  const dailyLossDollars = parseNumber(pick(payload, ['dailyLossDollars', 'daily_loss_dollars']), 'dailyLossDollars');
  const maxDailyLossPct = parseNumber(pick(payload, ['maxDailyLossPct', 'max_daily_loss_pct']), 'maxDailyLossPct');
  const propStartBalance = parseNumber(pick(payload, ['propStartBalance', 'prop_start_balance']), 'propStartBalance');
  const propMaxDrawdownPct = parseNumber(pick(payload, ['propMaxDrawdownPct', 'prop_max_drawdown_pct']), 'propMaxDrawdownPct');

  if (rrRatio === undefined) throw new TradingViewWebhookError('MISSING_FIELD', 'rrRatio is required');
  if (accountSize === undefined) throw new TradingViewWebhookError('MISSING_FIELD', 'accountSize is required');
  if (riskDollars === undefined) throw new TradingViewWebhookError('MISSING_FIELD', 'riskDollars is required');

  return {
    planInput: {
      symbol: symbol.trim().toUpperCase(),
      side,
      entry,
      stopPoints,
      rrRatio,
      accountSize,
      riskDollars,
      dailyLossDollars,
      maxDailyLossPct,
      propStartBalance,
      propMaxDrawdownPct,
    },
    submittedBy: typeof payload.submittedBy === 'string' && payload.submittedBy.trim()
      ? payload.submittedBy.trim()
      : 'tradingview-webhook',
    source: 'tradingview',
    rawAlert: stripSecrets(payload),
  };
}

