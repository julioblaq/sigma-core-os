// core/risk/index.ts
// Slice 3e (v0.6.0): Sigma Risk Engine - deterministic calculations only.
// v0.6.1: Added LLM rationale integration via generateTradePlanWithRationale().
//
// CRITICAL: All math here is deterministic. No LLM involved in any calculation.
// LLM is used downstream ONLY for explaining the plan in plain language.
// If LLM rationale fails, the plan is returned WITHOUT rationale - never blocked.
//
// Supported instruments: MNQ, MES, ES, NQ

// ---------------------------------------------------------------------------
// Contract Specifications
// ---------------------------------------------------------------------------

export interface ContractSpec {
  symbol: string;
  name: string;
  tickSize: number;
  tickValue: number;
  pointValue: number;
  exchange: string;
}

export const CONTRACT_SPECS: Record<string, ContractSpec> = {
  ES: {
    symbol: 'ES',
    name: 'E-mini S&P 500',
    tickSize: 0.25,
    tickValue: 12.50,
    pointValue: 50.00,
    exchange: 'CME',
  },
  NQ: {
    symbol: 'NQ',
    name: 'E-mini NASDAQ-100',
    tickSize: 0.25,
    tickValue: 5.00,
    pointValue: 20.00,
    exchange: 'CME',
  },
  MES: {
    symbol: 'MES',
    name: 'Micro E-mini S&P 500',
    tickSize: 0.25,
    tickValue: 1.25,
    pointValue: 5.00,
    exchange: 'CME',
  },
  MNQ: {
    symbol: 'MNQ',
    name: 'Micro E-mini NASDAQ-100',
    tickSize: 0.25,
    tickValue: 0.50,
    pointValue: 2.00,
    exchange: 'CME',
  },
};

export function getContractSpec(symbol: string): ContractSpec {
  const spec = CONTRACT_SPECS[symbol.toUpperCase()];
  if (!spec) {
    throw new RiskError('UNSUPPORTED_SYMBOL', `Symbol '${symbol}' is not supported. Allowed: ${Object.keys(CONTRACT_SPECS).join(', ')}`);
  }
  return spec;
}

export function listContracts(): ContractSpec[] {
  return Object.values(CONTRACT_SPECS);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type RiskErrorCode =
  | 'UNSUPPORTED_SYMBOL'
  | 'INVALID_QUANTITY'
  | 'INVALID_ATR'
  | 'INVALID_ACCOUNT'
  | 'INVALID_RISK_PERCENT'
  | 'MAX_DAILY_LOSS_BREACHED'
  | 'PROP_DRAWDOWN_BREACHED'
  | 'INVALID_RR'
  | 'INVALID_STOP_POINTS'
  | 'ZERO_CONTRACTS';

export class RiskError extends Error {
  public readonly code: RiskErrorCode;
  constructor(code: RiskErrorCode, message: string) {
    super(`[risk] ${message}`);
    this.name = 'RiskError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Position Sizing
// ---------------------------------------------------------------------------

export interface PositionSizeInput {
  symbol: string;
  accountSize: number;
  riskDollars: number;
  stopPoints: number;
}

export interface PositionSizeResult {
  symbol: string;
  contracts: number;
  riskPerContract: number;
  totalRisk: number;
  riskPercent: number;
  stopPoints: number;
  pointValue: number;
  warnings: string[];
}

export function calcPositionSize(input: PositionSizeInput): PositionSizeResult {
  const spec = getContractSpec(input.symbol);

  if (input.accountSize <= 0) {
    throw new RiskError('INVALID_ACCOUNT', 'accountSize must be > 0');
  }
  if (input.riskDollars <= 0) {
    throw new RiskError('INVALID_ACCOUNT', 'riskDollars must be > 0');
  }
  if (input.stopPoints <= 0) {
    throw new RiskError('INVALID_STOP_POINTS', 'stopPoints must be > 0');
  }

  const riskPerContract = input.stopPoints * spec.pointValue;

  if (riskPerContract <= 0) {
    throw new RiskError('INVALID_STOP_POINTS', 'riskPerContract calculation resulted in zero or negative');
  }

  const contracts = Math.floor(input.riskDollars / riskPerContract);

  const warnings: string[] = [];

  if (contracts <= 0) {
    throw new RiskError(
      'ZERO_CONTRACTS',
      `Cannot size position: riskDollars=${input.riskDollars} is less than riskPerContract=${riskPerContract.toFixed(2)} for ${input.symbol}`,
    );
  }

  const totalRisk = riskPerContract * contracts;
  const riskPercent = (totalRisk / input.accountSize) * 100;

  if (riskPercent > 2) {
    warnings.push(`Risk is ${riskPercent.toFixed(2)}% of account — above 2% guideline`);
  }

  return {
    symbol: spec.symbol,
    contracts,
    riskPerContract,
    totalRisk,
    riskPercent,
    stopPoints: input.stopPoints,
    pointValue: spec.pointValue,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// ATR-Based Stop Calculator
// ---------------------------------------------------------------------------

export interface ATRStopInput {
  symbol: string;
  atr: number;
  multiplier: number;
  entry: number;
  side: 'long' | 'short';
}

export interface ATRStopResult {
  symbol: string;
  atr: number;
  multiplier: number;
  stopPoints: number;
  stopPrice: number;
  entry: number;
  side: 'long' | 'short';
}

export function calcATRStop(input: ATRStopInput): ATRStopResult {
  getContractSpec(input.symbol);

  if (input.atr <= 0) {
    throw new RiskError('INVALID_ATR', 'ATR must be > 0');
  }
  if (input.multiplier <= 0) {
    throw new RiskError('INVALID_ATR', 'ATR multiplier must be > 0');
  }

  const stopPoints = +(input.atr * input.multiplier).toFixed(4);
  const stopPrice = input.side === 'long'
    ? +(input.entry - stopPoints).toFixed(4)
    : +(input.entry + stopPoints).toFixed(4);

  return {
    symbol: input.symbol.toUpperCase(),
    atr: input.atr,
    multiplier: input.multiplier,
    stopPoints,
    stopPrice,
    entry: input.entry,
    side: input.side,
  };
}

// ---------------------------------------------------------------------------
// TP/SL Calculator (R:R ratio)
// ---------------------------------------------------------------------------

export interface TPSLInput {
  symbol: string;
  entry: number;
  stop: number;
  rr: number;
  side: 'long' | 'short';
}

export interface TPSLResult {
  symbol: string;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  stopPoints: number;
  targetPoints: number;
  side: 'long' | 'short';
}

export function calcTPSL(input: TPSLInput): TPSLResult {
  getContractSpec(input.symbol);

  if (input.rr <= 0) {
    throw new RiskError('INVALID_RR', 'R:R ratio must be > 0');
  }

  const stopPoints = Math.abs(input.entry - input.stop);
  const targetPoints = +(stopPoints * input.rr).toFixed(4);

  if (stopPoints === 0) {
    throw new RiskError('INVALID_STOP_POINTS', 'stop price cannot equal entry price');
  }

  const target = input.side === 'long'
    ? +(input.entry + targetPoints).toFixed(4)
    : +(input.entry - targetPoints).toFixed(4);

  return {
    symbol: input.symbol.toUpperCase(),
    entry: input.entry,
    stop: input.stop,
    target,
    rr: input.rr,
    stopPoints: +stopPoints.toFixed(4),
    targetPoints,
    side: input.side,
  };
}

// ---------------------------------------------------------------------------
// Max Daily Loss Guard
// ---------------------------------------------------------------------------

export interface DailyLossInput {
  accountSize: number;
  dailyLossDollars: number;
  maxDailyLossPct: number;
}

export interface DailyLossResult {
  breached: boolean;
  dailyLossDollars: number;
  maxAllowedDollars: number;
  remainingDollars: number;
  utilizationPct: number;
  warning: string | undefined;
}

export function checkDailyLoss(input: DailyLossInput): DailyLossResult {
  if (input.accountSize <= 0) {
    throw new RiskError('INVALID_ACCOUNT', 'accountSize must be > 0');
  }
  if (input.maxDailyLossPct <= 0 || input.maxDailyLossPct > 100) {
    throw new RiskError('INVALID_RISK_PERCENT', 'maxDailyLossPct must be between 0 and 100');
  }

  const maxAllowedDollars = +(input.accountSize * (input.maxDailyLossPct / 100)).toFixed(2);
  const breached = input.dailyLossDollars >= maxAllowedDollars;
  const remainingDollars = +Math.max(0, maxAllowedDollars - input.dailyLossDollars).toFixed(2);
  const utilizationPct = +((input.dailyLossDollars / maxAllowedDollars) * 100).toFixed(2);

  let warning: string | undefined;
  if (breached) {
    warning = `Daily loss limit breached: lost $${input.dailyLossDollars.toFixed(2)} of max $${maxAllowedDollars.toFixed(2)}`;
  } else if (utilizationPct >= 80) {
    warning = `Daily loss at ${utilizationPct.toFixed(1)}% of limit — approaching max`;
  }

  return { breached, dailyLossDollars: input.dailyLossDollars, maxAllowedDollars, remainingDollars, utilizationPct, warning };
}

// ---------------------------------------------------------------------------
// Prop Firm Drawdown Guard
// ---------------------------------------------------------------------------

export interface PropDrawdownInput {
  startingBalance: number;
  currentBalance: number;
  maxDrawdownPct: number;
  trailingHighWater?: number;
}

export interface PropDrawdownResult {
  breached: boolean;
  drawdownDollars: number;
  maxAllowedDrawdown: number;
  remainingDollars: number;
  utilizationPct: number;
  warning: string | undefined;
}

export function checkPropDrawdown(input: PropDrawdownInput): PropDrawdownResult {
  if (input.startingBalance <= 0) {
    throw new RiskError('INVALID_ACCOUNT', 'startingBalance must be > 0');
  }
  if (input.maxDrawdownPct <= 0 || input.maxDrawdownPct > 100) {
    throw new RiskError('INVALID_RISK_PERCENT', 'maxDrawdownPct must be between 0 and 100');
  }

  const highWater = input.trailingHighWater ?? input.startingBalance;
  const drawdownDollars = +Math.max(0, highWater - input.currentBalance).toFixed(2);
  const maxAllowedDrawdown = +(input.startingBalance * (input.maxDrawdownPct / 100)).toFixed(2);
  const breached = drawdownDollars >= maxAllowedDrawdown;
  const remainingDollars = +Math.max(0, maxAllowedDrawdown - drawdownDollars).toFixed(2);
  const utilizationPct = +((drawdownDollars / maxAllowedDrawdown) * 100).toFixed(2);

  let warning: string | undefined;
  if (breached) {
    warning = `Prop firm drawdown limit breached: down $${drawdownDollars.toFixed(2)} of max $${maxAllowedDrawdown.toFixed(2)}`;
  } else if (utilizationPct >= 75) {
    warning = `Prop drawdown at ${utilizationPct.toFixed(1)}% of limit — approaching violation`;
  }

  return { breached, drawdownDollars, maxAllowedDrawdown, remainingDollars, utilizationPct, warning };
}

// ---------------------------------------------------------------------------
// Trade Plan Generator
// ---------------------------------------------------------------------------

export interface TradePlanInput {
  symbol: string;
  side: 'long' | 'short';
  entry: number;
  stopPoints: number;
  rrRatio: number;
  accountSize: number;
  riskDollars: number;
  dailyLossDollars?: number;
  maxDailyLossPct?: number;
  propStartBalance?: number;
  propMaxDrawdownPct?: number;
  atr?: number;
}

export interface TradePlanResult {
  symbol: string;
  side: 'long' | 'short';
  entry: number;
  stop: number;
  target: number;
  contracts: number;
  stopPoints: number;
  targetPoints: number;
  rr: number;
  riskDollars: number;
  riskPercent: number;
  pointValue: number;
  dailyLossCheck?: DailyLossResult;
  propCheck?: PropDrawdownResult;
  warnings: string[];
  blocked: boolean;
  blockReasons: string[];
  // v0.6.1 LLM rationale fields - only set by generateTradePlanWithRationale()
  rationale?: string;
  rationaleProvider?: string;
  rationaleLatencyMs?: number;
  rationaleTokens?: number;
}

export function generateTradePlan(input: TradePlanInput): TradePlanResult {
  const spec = getContractSpec(input.symbol);
  const warnings: string[] = [];
  const blockReasons: string[] = [];

  const tpsl = calcTPSL({
    symbol: input.symbol,
    entry: input.entry,
    stop: input.side === 'long'
      ? input.entry - input.stopPoints
      : input.entry + input.stopPoints,
    rr: input.rrRatio,
    side: input.side,
  });

  const sizing = calcPositionSize({
    symbol: input.symbol,
    accountSize: input.accountSize,
    riskDollars: input.riskDollars,
    stopPoints: input.stopPoints,
  });

  if (sizing.warnings.length) warnings.push(...sizing.warnings);

  let dailyLossCheck: DailyLossResult | undefined;
  if (input.dailyLossDollars !== undefined) {
    dailyLossCheck = checkDailyLoss({
      accountSize: input.accountSize,
      dailyLossDollars: input.dailyLossDollars,
      maxDailyLossPct: input.maxDailyLossPct ?? 2,
    });
    if (dailyLossCheck.breached) {
      blockReasons.push(dailyLossCheck.warning ?? 'Daily loss limit breached');
    } else if (dailyLossCheck.warning) {
      warnings.push(dailyLossCheck.warning);
    }
  }

  let propCheck: PropDrawdownResult | undefined;
  if (input.propStartBalance !== undefined) {
    propCheck = checkPropDrawdown({
      startingBalance: input.propStartBalance,
      currentBalance: input.accountSize,
      maxDrawdownPct: input.propMaxDrawdownPct ?? 5,
    });
    if (propCheck.breached) {
      blockReasons.push(propCheck.warning ?? 'Prop firm drawdown limit breached');
    } else if (propCheck.warning) {
      warnings.push(propCheck.warning);
    }
  }

  return {
    symbol: spec.symbol,
    side: input.side,
    entry: input.entry,
    stop: tpsl.stop,
    target: tpsl.target,
    contracts: sizing.contracts,
    stopPoints: tpsl.stopPoints,
    targetPoints: tpsl.targetPoints,
    rr: input.rrRatio,
    riskDollars: sizing.totalRisk,
    riskPercent: sizing.riskPercent,
    pointValue: spec.pointValue,
    dailyLossCheck,
    propCheck,
    warnings,
    blocked: blockReasons.length > 0,
    blockReasons,
  };
}

// ---------------------------------------------------------------------------
// LLM Rationale Generator (v0.6.1)
//
// CRITICAL RULES:
// - LLM NEVER performs calculations — deterministic plan is already complete
// - LLM ONLY explains: risk, R:R rationale, ATR context, prop-firm implications, sizing rationale
// - Rationale generation failure NEVER blocks trade plan creation
// - Provider metadata stored for audit
// ---------------------------------------------------------------------------

export interface RationaleResult {
  rationale: string;
  provider: string;
  latencyMs: number;
  tokens?: number;
}

export async function generateRationale(plan: TradePlanResult): Promise<RationaleResult | undefined> {
  // Lazy import — avoids circular deps and ESM cache issues
  const { generateResponse } = await import('../llm/index.js');

  const userPrompt = [
    `Trade Plan Summary:`,
    `- Instrument: ${plan.symbol} (${plan.side.toUpperCase()})`,
    `- Entry: ${plan.entry} | Stop: ${plan.stop} (${plan.stopPoints} pts) | Target: ${plan.target} (${plan.targetPoints} pts)`,
    `- Contracts: ${plan.contracts} | Point Value: $${plan.pointValue}`,
    `- Dollar Risk: $${plan.riskDollars.toFixed(2)} (${plan.riskPercent.toFixed(2)}% of account)`,
    `- R:R Ratio: ${plan.rr}:1`,
    plan.dailyLossCheck ? `- Daily Loss Used: ${plan.dailyLossCheck.utilizationPct.toFixed(1)}% of limit` : null,
    plan.propCheck ? `- Prop Drawdown Used: ${plan.propCheck.utilizationPct.toFixed(1)}% of limit` : null,
    plan.warnings.length ? `- Warnings: ${plan.warnings.join('; ')}` : null,
    plan.blocked ? `- STATUS: BLOCKED — ${plan.blockReasons.join('; ')}` : `- STATUS: UNBLOCKED`,
    ``,
    `Write a concise (3-5 sentence) plain-language explanation of this trade plan.`,
    `Focus on what the trader risks, what they stand to gain, and any notable risk context.`,
    `Do not recalculate anything. Do not output JSON.`,
  ].filter(Boolean).join('\n');

  const t0 = Date.now();
  try {
    const result = await generateResponse({
      systemPrompt: 'You are a risk management assistant explaining futures trade plans to traders. You never perform calculations — you only explain plans already calculated.',
      userPrompt,
    });
    const latencyMs = Date.now() - t0;

    // Validate non-empty string content
    if (!result || typeof result.content !== 'string' || result.content.trim().length === 0) {
      return undefined;
    }

    return {
      rationale: result.content.trim(),
      provider: result.provider ?? 'unknown',
      latencyMs,
      tokens: result.usage?.totalTokens,
    };
  } catch {
    // Any failure (provider error, chain exhaustion, timeout) is non-blocking
    return undefined;
  }
}

// generateTradePlanWithRationale: async wrapper that adds LLM explanation.
// Deterministic plan is ALWAYS returned. Rationale is best-effort.
export async function generateTradePlanWithRationale(input: TradePlanInput): Promise<TradePlanResult> {
  // Step 1: deterministic calculation — always runs, always source of truth
  const plan = generateTradePlan(input);

  // Step 2: LLM rationale — best-effort, never blocks plan
  const rationaleResult = await generateRationale(plan);

  if (rationaleResult) {
    plan.rationale = rationaleResult.rationale;
    plan.rationaleProvider = rationaleResult.provider;
    plan.rationaleLatencyMs = rationaleResult.latencyMs;
    plan.rationaleTokens = rationaleResult.tokens;
  }

  return plan;
}
