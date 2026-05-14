// core/broker/index.ts
// Slice 3b: broker integration stub - paper trading only.
//
// CRITICAL SAFETY RULES:
//   - Only 'paper' mode is permitted. Live mode is structurally rejected.
//   - No real broker credentials, no Tradovate/IBKR/Alpaca connections.
//   - Live adapter does not exist. This is intentional.
//   - All submitted orders require a valid approved Approval ID.
//   - Orders without complete risk fields (entry, stop, target) are rejected.
//
// Flow:
//   approved trade_plan -> runtime calls executeTrade() -> validateOrder()
//   -> submitPaperOrder() -> paper_orders audit table -> PaperOrderResult
//
// Allowlisted symbols: MES, MNQ, ES, NQ
// Mode: paper only. Any other mode throws BrokerModeError.

import { randomUUID } from 'crypto';
import { db } from '../db.js';

// ---------------------------------------------------------------------------
// DB schema - append-only paper order audit log
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS paper_orders (
    id              TEXT PRIMARY KEY,
    approval_id     TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL,
    quantity        REAL NOT NULL,
    entry           REAL NOT NULL,
    stop            REAL NOT NULL,
    target          REAL NOT NULL,
    mode            TEXT NOT NULL,
    broker_adapter  TEXT NOT NULL,
    resolved_by     TEXT,
    simulated_fill  REAL,
    submitted_at    TEXT NOT NULL,
    outcome         TEXT NOT NULL
  )
`);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Supported futures symbols - add here before any agent can submit them
export const ALLOWED_SYMBOLS = new Set(['MES', 'MNQ', 'ES', 'NQ']);

export type OrderSide = 'long' | 'short' | 'buy' | 'sell';
export type BrokerMode = 'paper';

export interface BrokerOrder {
  approvalId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entry: number;
  stop: number;
  target: number;
  resolvedBy?: string;
  mode?: BrokerMode;
}

export interface PaperOrderResult {
  id: string;
  approvalId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entry: number;
  stop: number;
  target: number;
  mode: 'paper';
  brokerAdapter: 'paper';
  resolvedBy: string | undefined;
  simulatedFill: number;
  submittedAt: string;
  outcome: 'filled_paper';
}

export interface BrokerStatus {
  mode: 'paper';
  adapter: 'paper';
  live: false;
  allowedSymbols: string[];
  ready: true;
}

export interface OrderValidationError {
  field: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BrokerModeError extends Error {
  constructor(mode: string) {
    super(`[broker] live trading is not permitted. Only 'paper' mode is supported. Received: '${mode}'`);
    this.name = 'BrokerModeError';
  }
}

export class OrderValidationError extends Error {
  public readonly field: string;
  constructor(field: string, reason: string) {
    super(`[broker] order validation failed - ${field}: ${reason}`);
    this.name = 'OrderValidationError';
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// validateOrder - structural guard before any submission
// ---------------------------------------------------------------------------

export function validateOrder(order: Partial<BrokerOrder>): void {
  // Mode guard - live trading is structurally rejected
  if (order.mode && order.mode !== 'paper') {
    throw new BrokerModeError(order.mode);
  }

  // Required fields
  if (!order.approvalId) {
    throw new OrderValidationError('approvalId', 'required - orders must reference an approved trade_plan');
  }
  if (!order.symbol) {
    throw new OrderValidationError('symbol', 'required');
  }
  if (!order.side) {
    throw new OrderValidationError('side', 'required');
  }
  if (order.quantity === undefined || order.quantity === null) {
    throw new OrderValidationError('quantity', 'required');
  }
  if (order.entry === undefined || order.entry === null) {
    throw new OrderValidationError('entry', 'required');
  }
  if (order.stop === undefined || order.stop === null) {
    throw new OrderValidationError('stop', 'required - no orders without a stop loss');
  }
  if (order.target === undefined || order.target === null) {
    throw new OrderValidationError('target', 'required - no orders without a profit target');
  }

  // Symbol allowlist
  const sym = order.symbol.toUpperCase();
  if (!ALLOWED_SYMBOLS.has(sym)) {
    throw new OrderValidationError(
      'symbol',
      `'${order.symbol}' is not on the allowlist. Allowed: ${[...ALLOWED_SYMBOLS].join(', ')}`,
    );
  }

  // Quantity must be positive
  if (order.quantity <= 0) {
    throw new OrderValidationError('quantity', `must be > 0, got ${order.quantity}`);
  }

  // Risk field sanity - stop and target must differ from entry
  if (order.stop === order.entry) {
    throw new OrderValidationError('stop', 'stop loss cannot equal entry price');
  }
  if (order.target === order.entry) {
    throw new OrderValidationError('target', 'profit target cannot equal entry price');
  }
}

// ---------------------------------------------------------------------------
// submitPaperOrder - simulates an order fill, records audit entry
// ---------------------------------------------------------------------------

export function submitPaperOrder(order: BrokerOrder): PaperOrderResult {
  // Validate first - throws on any violation
  validateOrder(order);

  const id          = randomUUID();
  const now         = new Date().toISOString();
  const sym         = order.symbol.toUpperCase();

  // Paper fill simulation: fill at entry price (deterministic, not random)
  const simulatedFill = order.entry;

  // Persist to audit log
  db.run(
    `INSERT INTO paper_orders
       (id, approval_id, symbol, side, quantity, entry, stop, target,
        mode, broker_adapter, resolved_by, simulated_fill, submitted_at, outcome)
     VALUES
       (:id, :aid, :sym, :side, :qty, :entry, :stop, :target,
        'paper', 'paper', :by, :fill, :at, 'filled_paper')`,
    {
      ':id':    id,
      ':aid':   order.approvalId,
      ':sym':   sym,
      ':side':  order.side,
      ':qty':   order.quantity,
      ':entry': order.entry,
      ':stop':  order.stop,
      ':target':order.target,
      ':by':    order.resolvedBy ?? null,
      ':fill':  simulatedFill,
      ':at':    now,
    },
  );

  console.log(
    `[broker] paper order submitted id=${id} symbol=${sym} side=${order.side} " +
    "qty=${order.quantity} entry=${order.entry} fill=${simulatedFill} approval=${order.approvalId}`,
  );

  return {
    id,
    approvalId:    order.approvalId,
    symbol:        sym,
    side:          order.side,
    quantity:      order.quantity,
    entry:         order.entry,
    stop:          order.stop,
    target:        order.target,
    mode:          'paper',
    brokerAdapter: 'paper',
    resolvedBy:    order.resolvedBy,
    simulatedFill,
    submittedAt:   now,
    outcome:       'filled_paper',
  };
}

// ---------------------------------------------------------------------------
// getBrokerStatus - health/config introspection
// ---------------------------------------------------------------------------

export function getBrokerStatus(): BrokerStatus {
  return {
    mode:           'paper',
    adapter:        'paper',
    live:           false,
    allowedSymbols: [...ALLOWED_SYMBOLS],
    ready:          true,
  };
}

// ---------------------------------------------------------------------------
// getPaperOrders - audit log reader
// ---------------------------------------------------------------------------

export function getPaperOrders(): PaperOrderResult[] {
  return db
    .all('SELECT * FROM paper_orders ORDER BY submitted_at DESC')
    .map(r => ({
      id:            r['id']            as string,
      approvalId:    r['approval_id']   as string,
      symbol:        r['symbol']        as string,
      side:          r['side']          as OrderSide,
      quantity:      r['quantity']      as number,
      entry:         r['entry']         as number,
      stop:          r['stop']          as number,
      target:        r['target']        as number,
      mode:          'paper'            as const,
      brokerAdapter: 'paper'            as const,
      resolvedBy:    r['resolved_by']   as string | undefined,
      simulatedFill: r['simulated_fill']as number,
      submittedAt:   r['submitted_at']  as string,
      outcome:       r['outcome']       as 'filled_paper',
    }));
}
