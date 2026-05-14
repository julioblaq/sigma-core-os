// core/risk/index.ts
// Slice 3e (v0.6.0): Sigma Risk Engine - deterministic calculations only.
//
// CRITICAL: All math here is deterministic. No LLM involved in any calculation.
// LLM is used downstream ONLY for explaining the plan in plain language.
//
// Supported instruments: MNQ, MES, ES, NQ
// Features:
//   - Contract specs (tick size, tick value, point value)
//   - ATR-based stop calculator
//   - Position sizing by dollar risk
//   - TP/SL calculator (R:R ratio based)
//   - Max daily loss guard
//   - Prop firm drawdown guard
//   - Trade plan generator (feeds into approval spine)

// ---------------------------------------------------------------------------
// Contract Specifications
// ---------------------------------------------------------------------------

export interface ContractSpec {
  symbol:       string;
  name:         string;
  tickSize:     number;  // minimum price move
  tickValue:    number;  // dollar value per tick
  pointValue:   number;  // dollar value per full point (1.0)
  exchange:     string;
}

// Exact CME contract specs - deterministic, hardcoded from exchange specs
export const CONTRACT_SPECS: Record<string, ContractSpec> = {
  ES: {
    symbol:     'ES',
    name:       'E-mini S&P 500',
    tickSize:   0.25,
    tickValue:  12.50,
    pointValue: 50.00,
    exchange:   'CME',
  },
  NQ: {
    symbol:     'NQ',
    name:       'E-mini NASDAQ-100',
    tickSize:   0.25,
    tickValue:  5.00,
    pointValue: 20.00,
    exchange:   'CME',
  },
  MES: {
    symbol:     'MES',
    name:       'Micro E-mini S&P 500',
    tickSize:   0.25,
    tickValue:  1.25,
    pointValue: 5.00,
    exchange:   'CME',
  },
  MNQ: {
    symbol:     'MNQ',
    name:       'Micro E-mini NASDAQ-100',
    tickSize:   0.25,
    tickValue:  0.50,
    pointValue: 2.00,
    exchange:   'CME',
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
  symbol:       string;
  accountSize:  number;  // total account equity in dollars
  riskDollars:  number;  // dollar amount willing to risk on this trade
  stopPoints:   number;  // stop distance in points (not ticks)
}

export interface PositionSizeResult {
  symbol:        string;
  contracts:     number;
  riskPerContract: number;  // dollar risk per contract
  totalRisk:     number;    // riskPerContract * contracts
  riskPercent:   number;    // totalRisk / accountSize * 100
  stopPoints:    number;
  pointValue:    number;
  warnings:      string[];
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

  const totalRisk   = riskPerContract * contracts;
  const riskPercent = (totalRisk / input.accountSize) * 100;

  if (riskPercent > 2) {
    warnings.push(`Risk is ${riskPercent.toFixed(2)}% of account — above 2% guideline`);
  }

  return {
    symbol:          spec.symbol,
    contracts,
    riskPerContract,
    totalRisk,
    riskPercent,
    stopPoints:      input.stopPoints,
    pointValue:      spec.pointValue,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// ATR-Based Stop Calculator
// ---------------------------------------------------------------------------

export interface ATRStopInput {
  symbol:     string;
  atr:        number;  // Average True Range in points
  multiplier: number;  // e.g. 1.5 = stop at 1.5x ATR
  entry:      number;  // entry price
  side:       'long' | 'short';
}

export interface ATRStopResult {
  symbol:     string;
  atr:        number;
  multiplier: number;
  stopPoints: number;  // ATR * multiplier
  stopPrice:  number;  // entry +/- stopPoints
  entry:      number;
  side:       'long' | 'short';
}

export function calcATRStop(input: ATRStopInput): ATRStopResult {
  getContractSpec(input.symbol); // validate symbol

  if (input.atr <= 0) {
    throw new RiskError('INVALID_ATR', 'ATR must be > 0');
  }
  if (input.multiplier <= 0) {
    throw new RiskError('INVALID_ATR', 'ATR multiplier must be > 0');
  }

  const stopPoints = +(input.atr * input.multiplier).toFixed(4);
  const stopPrice  = input.side === 'long'
    ? +(input.entry - stopPoints).toFixed(4)
    : +(input.entry + stopPoints).toFixed(4);

  return {
    symbol:     input.symbol.toUpperCase(),
    atr:        input.atr,
    multiplier: input.multiplier,
    stopPoints,
    stopPrice,
    entry:      input.entry,
    side:       input.side,
  };
}

// ---------------------------------------------------------------------------
// TP/SL Calculator (R:R ratio)
// ---------------------------------------------------------------------------

export interface TPSLInput {
  symbol: string;
  entry:  number;
  stop:   number;   // stop price
  rr:     number;   // reward:risk ratio (e.g. 2 = 2:1)
  side:   'long' | 'short';
}

export interface TPSLResult {
  symbol:    string;
  entry:     number;
  stop:      number;
  target:    number;
  rr:        number;
  stopPoints:   number;
  targetPoints: number;
  side:      'long' | 'short';
}

export function calcTPSL(input: TPSLInput): TPSLResult {
  getContractSpec(input.symbol); // validate symbol

  if (input.rr <= 0) {
    throw new RiskError('INVALID_RR', 'R:R ratio must be > 0');
  }

  const stopPoints   = Math.abs(input.entry - input.stop);
  const targetPoints = +(stopPoints * input.rr).toFixed(4);

  if (stopPoints === 0) {
    throw new RiskError('INVALID_STOP_POINTS', 'stop price cannot equal entry price');
  }

  const target = input.side === 'long'
    ? +(input.entry + targetPoints).toFixed(4)
    : +(input.entry - targetPoints).toFixed(4);

  return {
    symbol:       input.symbol.toUpperCase(),
    entry:        input.entry,
    stop:         input.stop,
    target,
    rr:           input.rr,
    stopPoints:   +stopPoints.toFixed(4),
    targetPoints,
    side:         input.side,
  };
}

// ---------------------------------------------------------------------------
// Max Daily Loss Guard
// ---------------------------------------------------------------------------

export interface DailyLossInput {
  accountSize:      number;
  dailyLossDollars: number;  // current day's realized + unrealized loss
  maxDailyLossPct:  number;  // max allowed daily loss as % of account (e.g. 2 = 2%)
}

export interface DailyLossResult {
  breached:        boolean;
  dailyLossDollars: number;
  maxAllowedDollars: number;
  remainingDollars: number;
  utilizationPct:  number;
  warning:         string | undefined;
}

export function checkDailyLoss(input: DailyLossInput): DailyLossResult {
  if (input.accountSize <= 0) {
    throw new RiskError('INVALID_ACCOUNT', 'accountSize must be > 0');
  }
  if (input.maxDailyLossPct <= 0 || input.maxDailyLossPct > 100) {
    throw new RiskError('INVALID_RISK_PERCENT', 'maxDailyLossPct must be between 0 and 100');
  }

  const maxAllowedDollars  = +(input.accountSize * (input.maxDailyLossPct / 100)).toFixed(2);
  const breached           = input.dailyLossDollars >= maxAllowedDollars;
  const remainingDollars   = +Math.max(0, maxAllowedDollars - input.dailyLossDollars).toFixed(2);
  const utilizationPct     = +((input.dailyLossDollars / maxAllowedDollars) * 100).toFixed(2);

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
  startingBalance:   number;  // account balance at start of evaluation
  currentBalance:    number;  // current balance
  maxDrawdownPct:    number;  // prop firm max drawdown % (e.g. 5 = 5%)
  trailingHighWater?: number; // optional: highest balance reached (for trailing DD)
}

export interface PropDrawdownResult {
  breached:          boolean;
  drawdownDollars:   number;
  maxAllowedDrawdown: number;
  remainingDollars:  number;
  utilizationPct:    number;
  warning:           string | undefined;
}

export function checkPropDrawdown(input: PropDrawdownInput): PropDrawdownResult {
  if (input.startingBalance <= 0) {
    throw new RiskError('INVALID_ACCOUNT', 'startingBalance must be > 0');
  }
  if (input.maxDrawdownPct <= 0 || input.maxDrawdownPct > 100) {
    throw new RiskError('INVALID_RISK_PERCENT', 'maxDrawdownPct must be between 0 and 100');
  }

  const highWater         = input.trailingHighWater ?? input.startingBalance;
  const drawdownDollars   = +Math.max(0, highWater - input.currentBalance).toFixed(2);
  const maxAllowedDrawdown = +(input.startingBalance * (input.maxDrawdownPct / 100)).toFixed(2);
  const breached          = drawdownDollars >= maxAllowedDrawdown;
  const remainingDollars  = +Math.max(0, maxAllowedDrawdown - drawdownDollars).toFixed(2);
  const utilizationPct    = +((drawdownDollars / maxAllowedDrawdown) * 100).toFixed(2);

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
// Combines all calculations and produces a complete trade plan for approval.
// Does NOT submit or approve anything - that is handled by the API layer.
// ---------------------------------------------------------------------------

export interface TradePlanInput {
  symbol:          string;
  side:            'long' | 'short';
  entry:           number;
  stopPoints:      number;       // stop distance in points
  rrRatio:         number;       // reward:risk
  accountSize:     number;
  riskDollars:     number;
  dailyLossDollars?: number;     // current day loss (for guard check)
  maxDailyLossPct?: number;      // default: 2%
  propStartBalance?: number;     // for prop drawdown guard
  propMaxDrawdownPct?: number;   // default: 5%
  atr?:            number;       // optional: if provided, validates stop is ATR-reasonable
}

export interface TradePlanResult {
  symbol:        string;
  side:          'long' | 'short';
  entry:         number;
  stop:          number;
  target:        number;
  contracts:     number;
  stopPoints:    number;
  targetPoints:  number;
  rr:            number;
  riskDollars:   number;
  riskPercent:   number;
  pointValue:    number;
  dailyLossCheck?: DailyLossResult;
  propCheck?:    PropDrawdownResult;
  warnings:      string[];
  blocked:       boolean;
  blockReasons:  string[];
}

export function generateTradePlan(input: TradePlanInput): TradePlanResult {
  const spec     = getContractSpec(input.symbol);
  const warnings: string[] = [];
  const blockReasons: string[] = [];

  // TP/SL calc
  const tpsl = calcTPSL({
    symbol: input.symbol,
    entry:  input.entry,
    stop:   input.side === 'long'
              ? input.entry - input.stopPoints
              : input.entry + input.stopPoints,
    rr:     input.rrRatio,
    side:   input.side,
  });

  // Position size
  const sizing = calcPositionSize({
    symbol:      input.symbol,
    accountSize: input.accountSize,
    riskDollars: input.riskDollars,
    stopPoints:  input.stopPoints,
  });

  if (sizing.warnings.length) warnings.push(...sizing.warnings);

  // Daily loss guard (optional)
  let dailyLossCheck: DailyLossResult | undefined;
  if (input.dailyLossDollars !== undefined) {
    dailyLossCheck = checkDailyLoss({
      accountSize:      input.accountSize,
      dailyLossDollars: input.dailyLossDollars,
      maxDailyLossPct:  input.maxDailyLossPct ?? 2,
    });
    if (dailyLossCheck.breached) {
      blockReasons.push(dailyLossCheck.warning ?? 'Daily loss limit breached');
    } else if (dailyLossCheck.warning) {
      warnings.push(dailyLossCheck.warning);
    }
  }

  // Prop drawdown guard (optional)
  let propCheck: PropDrawdownResult | undefined;
  if (input.propStartBalance !== undefined) {
    propCheck = checkPropDrawdown({
      startingBalance:  input.propStartBalance,
      currentBalance:   input.accountSize,
      maxDrawdownPct:   input.propMaxDrawdownPct ?? 5,
    });
    if (propCheck.breached) {
      blockReasons.push(propCheck.warning ?? 'Prop firm drawdown limit breached');
    } else if (propCheck.warning) {
      warnings.push(propCheck.warning);
    }
  }

  return {
    symbol:        spec.symbol,
    side:          input.side,
    entry:         input.entry,
    stop:          tpsl.stop,
    target:        tpsl.target,
    contracts:     sizing.contracts,
    stopPoints:    tpsl.stopPoints,
    targetPoints:  tpsl.targetPoints,
    rr:            input.rrRatio,
    riskDollars:   sizing.totalRisk,
    riskPercent:   sizing.riskPercent,
    pointValue:    spec.pointValue,
    dailyLossCheck,
    propCheck,
    warnings,
    blocked:       blockReasons.length > 0,
    blockReasons,
  };
}
