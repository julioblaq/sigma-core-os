import type { TradePlanInput } from '../risk/index.js';

export interface SimulatedAlertInput extends TradePlanInput {
  submittedBy?: string;
}

export interface SimulatedAlertPlan {
  planInput: TradePlanInput;
  submittedBy: string;
  source: 'simulated';
  rawAlert: Record<string, unknown>;
}

export class SimulatedAlertError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SimulatedAlertError';
    this.code = code;
  }
}

function requireFinite(value: unknown, field: string): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new SimulatedAlertError('INVALID_NUMBER', `${field} must be a number`);
  }
  return numberValue;
}

function normalizeSide(value: unknown): 'long' | 'short' {
  if (value === 'long' || value === 'short') return value;
  throw new SimulatedAlertError('INVALID_SIDE', 'side must be long or short');
}

export function buildSimulatedAlertPlan(input: SimulatedAlertInput): SimulatedAlertPlan {
  if (!input.symbol?.trim()) {
    throw new SimulatedAlertError('MISSING_FIELD', 'symbol is required');
  }

  const planInput: TradePlanInput = {
    symbol: input.symbol.trim().toUpperCase(),
    side: normalizeSide(input.side),
    entry: requireFinite(input.entry, 'entry'),
    stopPoints: requireFinite(input.stopPoints, 'stopPoints'),
    rrRatio: requireFinite(input.rrRatio, 'rrRatio'),
    accountSize: requireFinite(input.accountSize, 'accountSize'),
    riskDollars: requireFinite(input.riskDollars, 'riskDollars'),
    dailyLossDollars: input.dailyLossDollars === undefined
      ? undefined
      : requireFinite(input.dailyLossDollars, 'dailyLossDollars'),
    maxDailyLossPct: input.maxDailyLossPct === undefined
      ? undefined
      : requireFinite(input.maxDailyLossPct, 'maxDailyLossPct'),
    propStartBalance: input.propStartBalance === undefined
      ? undefined
      : requireFinite(input.propStartBalance, 'propStartBalance'),
    propMaxDrawdownPct: input.propMaxDrawdownPct === undefined
      ? undefined
      : requireFinite(input.propMaxDrawdownPct, 'propMaxDrawdownPct'),
  };

  return {
    planInput,
    submittedBy: input.submittedBy?.trim() || 'dashboard-simulated-alert',
    source: 'simulated',
    rawAlert: {
      symbol: planInput.symbol,
      side: planInput.side,
      entry: planInput.entry,
      stopPoints: planInput.stopPoints,
      rrRatio: planInput.rrRatio,
      accountSize: planInput.accountSize,
      riskDollars: planInput.riskDollars,
      dailyLossDollars: planInput.dailyLossDollars,
      maxDailyLossPct: planInput.maxDailyLossPct,
      propStartBalance: planInput.propStartBalance,
      propMaxDrawdownPct: planInput.propMaxDrawdownPct,
    },
  };
}

