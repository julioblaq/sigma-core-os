/**
 * core/router/index.ts
 * Receives a task, calls the right agent handler, returns the result.
 * Only sigma-bot exists right now.
 */

import { handleTask as sigmaBotHandle, SigmaBotResult } from '../../agents/sigma-bot/handler';

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
   status: 'success' | 'pending_approval' | 'error';
   result?: unknown;
   approvalId?: string;
   error?: string;
}

export async function route(task: Task): Promise<RouterResult> {
   console.log(`[router] task=${task.id}  type=${task.type}`);

  const type = task.type.toLowerCase();

  if (type === 'trade_plan' || type.startsWith('market') || type.startsWith('futures')) {
       const botResult: SigmaBotResult = await sigmaBotHandle(task);
       return {
              taskId:     task.id,
              agent:      'sigma-bot',
              status:     botResult.status,
              result:     botResult.data,
              approvalId: botResult.approvalId,
       };
  }

  console.warn(`[router] no agent for type=${task.type}`);
   return {
        taskId: task.id,
        agent:  'none',
        status: 'error',
        error:  `No agent registered for task type: ${task.type}`,
   };
}
