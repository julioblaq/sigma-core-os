/**
 * MoomooAdapter
 *
 * Gate architecture:
 *   liveEnabled   - hardcoded false. Never driven by env alone.
 *                   Requires explicit code change + review to unlock.
 *   shadowEnabled - env-gated. Mirrors orders to Moomoo sandbox,
 *                   no real fills. Safe to enable for shadow testing.
 *
 * Unlock sequence:
 *   Stage 1: shadowEnabled=true  -> sandbox orders only, compare vs paper
 *   Stage 2: N-day shadow review -> manual sign-off required
 *   Stage 3: liveEnabled=true    -> explicit code change, not env flip
 */

import type { TradePlanResult } from '../risk/index.js';

const LIVE_ENABLED = false;

export type MoomooOrderSide = 'BUY' | 'SELL';
export type MoomooOrderMode = 'sandbox' | 'live';

export interface MoomooTradePlan extends TradePlanResult {
  id?: string;
}

export interface MoomooOrderRequest {
  symbol: string;
  side: MoomooOrderSide;
  quantity: number;
  orderType: 'MARKET';
  mode: MoomooOrderMode;
}

export interface MoomooOrderResponse {
  orderId: string;
  status: string;
  filledAt?: string;
  fillPrice?: number;
}

export interface MoomooShadowResult {
  attempted: boolean;
  submitted: boolean;
  orderId?: string;
  status?: string;
  error?: string;
}

export interface MoomooTradeExecution {
  planId?: string;
  symbol: string;
  side: 'long' | 'short';
  contracts: number;
  fillPrice: number;
  executedAt: string;
  mode: 'paper';
  brokerAdapter: 'moomoo_shadow';
  outcome: 'filled_paper';
  shadow: MoomooShadowResult;
}

export function moomooLiveEnabled(): boolean {
  return LIVE_ENABLED;
}

export function moomooShadowEnabled(): boolean {
  return process.env.MOOMOO_SHADOW_ENABLED === 'true';
}

async function submitToMoomoo(order: MoomooOrderRequest): Promise<MoomooOrderResponse> {
  const baseUrl = process.env.MOOMOO_API_URL;
  const apiKey = process.env.MOOMOO_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error('Moomoo env not configured: MOOMOO_API_URL or MOOMOO_API_KEY missing');
  }

  const res = await fetch(`${baseUrl}/v1/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(order),
  });

  if (!res.ok) {
    throw new Error(`Moomoo API error: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<MoomooOrderResponse>;
}

function toMoomooSide(side: 'long' | 'short'): MoomooOrderSide {
  return side === 'long' ? 'BUY' : 'SELL';
}

export async function executeMoomooTrade(plan: MoomooTradePlan): Promise<MoomooTradeExecution> {
  if (LIVE_ENABLED) {
    throw new Error(
      'Moomoo live execution not yet unlocked. Complete shadow review and explicit code review first.',
    );
  }

  const order: MoomooOrderRequest = {
    symbol: plan.symbol,
    side: toMoomooSide(plan.side),
    quantity: plan.contracts,
    orderType: 'MARKET',
    mode: 'sandbox',
  };

  let shadow: MoomooShadowResult = {
    attempted: false,
    submitted: false,
  };

  if (moomooShadowEnabled()) {
    shadow = {
      attempted: true,
      submitted: false,
    };

    try {
      const sandboxResult = await submitToMoomoo(order);
      shadow = {
        attempted: true,
        submitted: true,
        orderId: sandboxResult.orderId,
        status: sandboxResult.status,
      };
      console.info('[moomoo:shadow]', {
        symbol: plan.symbol,
        side: plan.side,
        contracts: plan.contracts,
        sandboxOrderId: sandboxResult.orderId,
        status: sandboxResult.status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      shadow = {
        attempted: true,
        submitted: false,
        error: message,
      };
      console.error('[moomoo:shadow] sandbox submission failed, paper fill continues', err);
    }
  }

  return {
    planId: plan.id,
    symbol: plan.symbol,
    side: plan.side,
    contracts: plan.contracts,
    fillPrice: plan.entry,
    executedAt: new Date().toISOString(),
    mode: 'paper',
    brokerAdapter: 'moomoo_shadow',
    outcome: 'filled_paper',
    shadow,
  };
}
