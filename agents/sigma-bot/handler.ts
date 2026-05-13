/**
 * agents/sigma-bot/handler.ts
   * TypeScript bridge called by core/router.
   * Builds the trade plan signal and queues it for human approval.
 * Never executes a trade — that requires an approved Approval record.
   */

import { requestApproval, Approval } from '../../core/policies/index';
import { memSet } from '../../core/memory/index';
import type { Task } from '../../core/router/index';

export interface SigmaBotResult {
    status: 'pending_approval' | 'error';
  data: Record<string, unknown>;
  approvalId?: string;
}

export async function handleTask(task: Task): Promise<SigmaBotResult> {
  console.log(`[sigma-bot] received task=${task.id}  type=${task.type}`);

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

  // Build the signal — no execution, just a structured plan for human review
  const signal = {
        symbol,
              direction,       // 'long' | 'short'
              quantity,
              rationale:       rationale ?? 'none provided',
              generatedAt:     new Date().toISOString(),
              executionStatus: 'awaiting_human_approval',
          };

  // Persist signal in memory so it survives beyond the HTTP response
  memSet('sigma-bot', `signal:${task.id}`, signal, 'sigma-bot');

  // Queue for human approval
  const approval: Approval = requestApproval(
    'sigma-bot',
    'trade_plan',
    `Trade plan: ${direction.toUpperCase()} ${quantity}x ${symbol}`,
    { taskId: task.id, signal },
  );

  console.log(`[sigma-bot] approval queued  id=${approval.id}  signal=${JSON.stringify(signal)}`);

  return {
        status:     'pending_approval',
        data:       signal,
        approvalId: approval.id,
    };
                           }
    
