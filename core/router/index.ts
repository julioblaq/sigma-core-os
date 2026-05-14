// core/router/index.ts
// Routes tasks to the appropriate agent handler.
// Slice 2d: added dev_task -> sigma-dev routing.

import { handleTask as sigmaBotHandle, SigmaBotResult } from '../../agents/sigma-bot/handler.js';
import { handleTask as sigmaDevHandle, SigmaDevResult } from '../../agents/sigma-dev/handler.js';

export interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  submittedBy: string;
  createdAt: string;
}

export interface RouterResult {
  taskId: string;
  agent: string;
  status: 'success' | 'pending_approval' | 'complete' | 'error';
  result?: unknown;
  approvalId?: string;
  error?: string;
}

export async function route(task: Task): Promise<RouterResult> {
  console.log(`[router] task=${task.id} type=${task.type}`);

  const type = task.type.toLowerCase();

  // -- Sigma Bot: trade/market/futures tasks ----------------------------------
  if (type === 'trade_plan' || type.startsWith('market') || type.startsWith('futures')) {
    const result: SigmaBotResult = await sigmaBotHandle(task);
    return {
      taskId:     task.id,
      agent:      'sigma-bot',
      status:     result.status,
      result:     result.data,
      approvalId: result.approvalId,
    };
  }

  // -- Sigma Dev: development tasks ------------------------------------------
  if (type === 'dev_task') {
    const result: SigmaDevResult = await sigmaDevHandle(task);
    return {
      taskId:     task.id,
      agent:      'sigma-dev',
      status:     result.status,
      result:     result.data,
      approvalId: result.approvalId,
    };
  }

  // -- No agent registered ---------------------------------------------------
  console.warn(`[router] no agent for type=${task.type}`);
  return {
    taskId: task.id,
    agent:  'none',
    status: 'error',
    error:  `No agent registered for task type: ${task.type}`,
  };
}
