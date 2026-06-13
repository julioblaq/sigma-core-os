// agents/sigma-bot/handler.ts
// Sigma Bot - trade plan agent.
// Builds deterministic trade signals and queues them for human approval.
// Uses core/llm for reasoning/narrative output only.
// Trading calculations are deterministic - never delegated to LLM.
// NEVER executes a trade - that requires an approved Approval record.

import type { Approval } from '../../core/policies/index.js';
import { requestApproval, memSet } from '../../core/store/control.js';
import { generateResponse } from '../../core/llm/index.js';
import type { Task } from '../../core/router/index.js';
import {
  listFuturesAggs,
  MarketDataConfigError,
  MarketDataProviderError,
  type FuturesAggBar,
} from '../../core/market-data/index.js';

export interface SigmaBotResult {
  status: 'success' | 'pending_approval' | 'error';
  data: Record<string, unknown>;
  approvalId?: string;
}

// System prompt for the LLM rationale call.
// Keeps the LLM scoped to narrative output only - no numbers, no execution.
const SIGMA_BOT_SYSTEM = `You are Sigma Bot, a futures trading assistant.
Your role is to write a concise human-readable rationale for a proposed trade plan.
You receive the trade signal details and produce a 2-3 sentence narrative explaining
the intent of the trade for the human approver to review.
Do not recommend approving or rejecting the trade.
Do not include price targets, stop losses, or execution details.
Keep the tone professional and factual.`;

const EQUITY_INDEX_ROOTS = new Set(['ES', 'MES', 'NQ', 'MNQ', 'YM', 'MYM', 'RTY', 'M2K']);
const QUARTERLY_CONTRACTS = [
  { month: 3, code: 'H' },
  { month: 6, code: 'M' },
  { month: 9, code: 'U' },
  { month: 12, code: 'Z' },
] as const;
type QuarterlyContract = (typeof QUARTERLY_CONTRACTS)[number];

export async function handleTask(task: Task): Promise<SigmaBotResult> {
  console.log(`[sigma-bot] received task=${task.id} type=${task.type}`);

  const taskType = task.type.toLowerCase();
  if (taskType.startsWith('market') || taskType.startsWith('futures')) {
    return handleMarketDataTask(task);
  }

  if (taskType !== 'trade_plan') {
    return {
      status: 'error',
      data: { message: `sigma-bot does not handle task type: ${task.type}` },
    };
  }

  const { symbol, direction, quantity, rationale } = task.payload as {
    symbol?: string;
    direction?: string;
    quantity?: number;
    rationale?: string;
  };

  if (!symbol || !direction || !quantity) {
    return {
      status: 'error',
      data: { message: 'trade_plan requires: symbol, direction, quantity' },
    };
  }

  // -------------------------------------------------------------------------
  // Deterministic signal - no LLM involved in trading math
  // -------------------------------------------------------------------------
  const signal = {
    symbol,
    direction,           // 'long' | 'short'
    quantity,
    generatedAt: new Date().toISOString(),
    executionStatus: 'awaiting_human_approval',
  };

  // -------------------------------------------------------------------------
  // LLM narrative - reasoning/description only, non-blocking on failure
  // -------------------------------------------------------------------------
  let llmNarrative: string = rationale ?? 'none provided';

  try {
    const llmRes = await generateResponse({
      systemPrompt: SIGMA_BOT_SYSTEM,
      userPrompt: `Write a rationale for this trade plan: ${direction.toUpperCase()} ${quantity}x ${symbol}`,
      context: { signal, userRationale: rationale ?? null },
    });
    llmNarrative = llmRes.content;
    console.log(`[sigma-bot] llm rationale tokens=${llmRes.usage.totalTokens} latency=${llmRes.latencyMs}ms`);
  } catch (err) {
    // LLM failure is non-fatal - fall back to user-provided rationale or default
    console.warn(`[sigma-bot] llm call failed, using fallback rationale: ${(err as Error).message}`);
  }

  const fullSignal = { ...signal, rationale: llmNarrative };

  // -------------------------------------------------------------------------
  // Persist signal in memory
  // -------------------------------------------------------------------------
  await memSet('sigma-bot', `signal:${task.id}`, fullSignal, 'sigma-bot');

  // -------------------------------------------------------------------------
  // Queue for human approval
  // -------------------------------------------------------------------------
  const approval: Approval = await requestApproval(
    'sigma-bot',
    'trade_plan',
    `Trade plan: ${direction.toUpperCase()} ${quantity}x ${symbol}`,
    { taskId: task.id, signal: fullSignal },
  );

  console.log(`[sigma-bot] approval queued id=${approval.id} signal=${JSON.stringify(fullSignal)}`);

  return {
    status: 'pending_approval',
    data: fullSignal,
    approvalId: approval.id,
  };
}

async function handleMarketDataTask(task: Task): Promise<SigmaBotResult> {
  const payload = task.payload as {
    ticker?: unknown;
    symbol?: unknown;
    product?: unknown;
    question?: unknown;
    prompt?: unknown;
    date?: unknown;
    resolution?: unknown;
  };

  const requestedDate = readString(payload.date) ?? previousSessionDate();
  const tickerInput = readString(payload.ticker);
  const symbolInput = readString(payload.symbol)
    ?? readString(payload.product)
    ?? extractKnownSymbol(readString(payload.question) ?? readString(payload.prompt) ?? '');
  const ticker = tickerInput?.toUpperCase() ?? inferFrontMonthTicker(symbolInput, requestedDate);

  if (!ticker) {
    return {
      status: 'error',
      data: {
        type: 'market_data',
        message: 'market data request requires an exact futures ticker such as NQM6, or a supported root symbol such as NQ.',
      },
    };
  }

  try {
    const sessionWindow = sessionSearchWindow(requestedDate);
    const result = await listFuturesAggs({
      ticker,
      resolution: readString(payload.resolution) ?? '1session',
      windowStartGte: sessionWindow.gte,
      windowStartLte: sessionWindow.lte,
      sort: 'window_start.desc',
      limit: 10,
    });

    const bar = result.bars.find(item => item.sessionEndDate === requestedDate) ?? result.bars[0];
    if (!bar) {
      return {
        status: 'error',
        data: {
          type: 'market_data',
          provider: result.provider,
          ticker: result.ticker,
          date: requestedDate,
          message: `Massive returned no futures session bar for ${result.ticker} on ${requestedDate}. SigmaBot will not estimate market levels.`,
        },
      };
    }

    const session = formatSessionBar(bar);
    const inferredContract = !tickerInput && Boolean(symbolInput);

    return {
      status: 'success',
      data: {
        type: 'market_data',
        provider: result.provider,
        ticker: result.ticker,
        symbol: symbolInput?.toUpperCase() ?? result.ticker,
        date: requestedDate,
        resolution: result.resolution,
        inferredContract,
        session,
        message: `${result.ticker} ${session.sessionEndDate ?? requestedDate} high was ${session.high}; low was ${session.low}; close was ${session.close}. Source: Massive futures aggregates.`,
        note: inferredContract
          ? `Contract inferred from ${symbolInput?.toUpperCase()} front-month quarterly cycle; pass an exact ticker if you want a different contract.`
          : 'Exact futures contract ticker supplied by request.',
        caveat: 'Market-data recency depends on the connected Massive futures plan. This is data retrieval, not trade advice.',
      },
    };
  } catch (err) {
    if (err instanceof MarketDataConfigError) {
      return {
        status: 'error',
        data: {
          type: 'market_data',
          provider: 'massive',
          ticker,
          date: requestedDate,
          message: `${err.message}; SigmaBot cannot answer live or historical market levels safely without configured market data.`,
        },
      };
    }

    if (err instanceof MarketDataProviderError) {
      return {
        status: 'error',
        data: {
          type: 'market_data',
          provider: 'massive',
          ticker,
          date: requestedDate,
          statusCode: err.status,
          message: `${err.message}. SigmaBot will not estimate market levels.`,
        },
      };
    }

    return {
      status: 'error',
      data: {
        type: 'market_data',
        provider: 'massive',
        ticker,
        date: requestedDate,
        message: `Market data lookup failed: ${(err as Error).message}. SigmaBot will not estimate market levels.`,
      },
    };
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function extractKnownSymbol(text: string): string | undefined {
  const normalized = text.toUpperCase();
  for (const root of EQUITY_INDEX_ROOTS) {
    const pattern = new RegExp(`\\b${root}\\b`);
    if (pattern.test(normalized)) return root;
  }
  if (normalized.includes('NASDAQ')) return 'NQ';
  if (normalized.includes('S&P') || normalized.includes('SP500') || normalized.includes('S AND P')) return 'ES';
  if (normalized.includes('DOW')) return 'YM';
  if (normalized.includes('RUSSELL')) return 'RTY';
  return undefined;
}

function inferFrontMonthTicker(symbol: string | undefined, dateText: string): string | undefined {
  const root = symbol?.trim().toUpperCase();
  if (!root || !EQUITY_INDEX_ROOTS.has(root)) return undefined;

  const date = parseDateOnly(dateText);
  let year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  let contract: QuarterlyContract | undefined = QUARTERLY_CONTRACTS.find(item => item.month >= month);

  if (!contract) {
    year += 1;
    contract = QUARTERLY_CONTRACTS[0]!;
  }

  if (contract.month === month && day > thirdFridayUtcDay(year, month)) {
    const contractMonth = contract.month;
    const index = QUARTERLY_CONTRACTS.findIndex(item => item.month === contractMonth);
    const next = QUARTERLY_CONTRACTS[index + 1];
    if (next) {
      contract = next;
    } else {
      year += 1;
      contract = QUARTERLY_CONTRACTS[0]!;
    }
  }

  return `${root}${contract.code}${year % 10}`;
}

function previousSessionDate(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return toDateOnly(date);
}

function sessionSearchWindow(sessionDate: string): { gte: string; lte: string } {
  const date = parseDateOnly(sessionDate);
  const gte = new Date(date);
  gte.setUTCDate(gte.getUTCDate() - 3);
  const lte = new Date(date);
  lte.setUTCDate(lte.getUTCDate() + 1);
  return { gte: toDateOnly(gte), lte: toDateOnly(lte) };
}

function parseDateOnly(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(value);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function thirdFridayUtcDay(year: number, month: number): number {
  let fridayCount = 0;
  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1) break;
    if (date.getUTCDay() === 5) {
      fridayCount += 1;
      if (fridayCount === 3) return day;
    }
  }
  return 31;
}

function formatSessionBar(bar: FuturesAggBar): Record<string, unknown> {
  return {
    ticker: bar.ticker,
    windowStart: bar.windowStart,
    sessionEndDate: bar.sessionEndDate,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    settlementPrice: bar.settlementPrice,
  };
}
