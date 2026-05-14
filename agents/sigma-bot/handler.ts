// agents/sigma-bot/handler.ts
// Sigma Bot - trade plan agent.
// Builds deterministic trade signals and queues them for human approval.
// Uses core/llm for reasoning/narrative output only.
// Trading calculations are deterministic - never delegated to LLM.
// NEVER executes a trade - that requires an approved Approval record.

import { requestApproval, Approval } from '../../core/policies/index.js';
import { memSet } from '../../core/memory/index.js';
import { generateResponse } from '../../core/llm/index.js';
import type { Task } from '../../core/router/index.js';

export interface SigmaBotResult {
  status: 'pending_approval' | 'error';
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

export async function handleTask(task: Task): Promise<SigmaBotResult> {
  console.log(`[sigma-bot] received task=${task.id} type=${task.type}`);

  if (task.type !== 'trade_plan') {
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
  memSet('sigma-bot', `signal:${task.id}`, fullSignal, 'sigma-bot');

  // -------------------------------------------------------------------------
  // Queue for human approval
  // -------------------------------------------------------------------------
  const approval: Approval = requestApproval(
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
