import type { RouterResult, Task } from '../router/index.js';
import { RedisConnection, redisUrl } from './redis.js';

export type TaskQueueMode = 'inline' | 'redis';

export interface QueuedTaskResult {
  id: string;
  taskId: string;
  type: string;
  agent: 'agent-worker';
  status: 'queued';
  queue: string;
  created_at: string;
  updated_at: string;
  result_summary: string;
}

export type TaskDispatchResult = RouterResult | QueuedTaskResult;

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface TaskStatusDocument {
  id: string;
  taskId: string;
  type: string;
  status: TaskStatus;
  queue: string;
  agent?: string;
  submitted_by: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  result_summary: string;
  result?: unknown;
  error?: string;
  approvalId?: string;

  // Backwards-compatible aliases used by the existing dashboard.
  completedAt?: string;
  failedAt?: string;
}

interface QueueRedis {
  command(...parts: (string | number)[]): Promise<unknown>;
  close(): void;
}

export function taskQueueMode(): TaskQueueMode {
  const raw = (process.env.TASK_QUEUE_MODE ?? (process.env.REDIS_URL ? 'redis' : 'inline')).trim().toLowerCase();
  if (raw === 'inline' || raw === 'redis') return raw;
  throw new Error(`Invalid TASK_QUEUE_MODE '${raw}'. Use 'inline' or 'redis'.`);
}

export function taskQueueName(): string {
  return process.env.TASK_QUEUE_NAME ?? 'sigma:tasks';
}

function taskResultKey(taskId: string): string {
  return `sigma:task-result:${taskId}`;
}

function taskStatusKey(taskId: string): string {
  return `sigma:task-status:${taskId}`;
}

function taskStatusIndexKey(): string {
  return `${taskQueueName()}:status-index`;
}

function resultSummary(input: { status: TaskStatus; agent?: string; error?: string; result?: unknown }): string {
  if (input.error) return input.error.slice(0, 180);
  if (typeof input.result === 'string') return input.result.slice(0, 180);
  if (input.result && typeof input.result === 'object') {
    const value = input.result as Record<string, unknown>;
    if (typeof value.summary === 'string') return value.summary.slice(0, 180);
    if (typeof value.message === 'string') return value.message.slice(0, 180);
  }
  const agent = input.agent ? `${input.agent} ` : '';
  return `${agent}${input.status}`;
}

function routerStatusToTaskStatus(status: RouterResult['status']): TaskStatus {
  return status === 'error' ? 'failed' : 'succeeded';
}

function taskStatusFromRouterResult(result: RouterResult, existing?: TaskStatusDocument | null): TaskStatusDocument {
  const now = new Date().toISOString();
  const timestamps = result as RouterResult & { completedAt?: string; failedAt?: string };
  const status = routerStatusToTaskStatus(result.status);
  const completedAt = status === 'succeeded' ? timestamps.completedAt ?? now : undefined;
  const failedAt = status === 'failed' ? timestamps.failedAt ?? now : undefined;

  return {
    id: result.taskId,
    taskId: result.taskId,
    type: existing?.type ?? 'unknown',
    status,
    queue: existing?.queue ?? taskQueueName(),
    agent: result.agent,
    submitted_by: existing?.submitted_by ?? 'agent-worker',
    created_at: existing?.created_at ?? completedAt ?? failedAt ?? now,
    updated_at: completedAt ?? failedAt ?? now,
    started_at: existing?.started_at,
    completed_at: completedAt,
    failed_at: failedAt,
    completedAt,
    failedAt,
    result_summary: resultSummary({ status, agent: result.agent, error: result.error, result: result.result }),
    result: result.result,
    error: result.error,
    approvalId: result.approvalId,
  };
}

async function writeTaskStatus(redis: QueueRedis, doc: TaskStatusDocument): Promise<void> {
  const ttl = Number(process.env.TASK_RESULT_TTL_SECONDS ?? 86400);
  await redis.command('SET', taskStatusKey(doc.id), JSON.stringify(doc), 'EX', ttl);
}

async function readTaskStatus(redis: QueueRedis, taskId: string): Promise<TaskStatusDocument | null> {
  const raw = await redis.command('GET', taskStatusKey(taskId));
  if (typeof raw !== 'string') return null;
  return JSON.parse(raw) as TaskStatusDocument;
}

async function readLegacyTaskResult(redis: QueueRedis, taskId: string): Promise<RouterResult | null> {
  const raw = await redis.command('GET', taskResultKey(taskId));
  if (typeof raw !== 'string') return null;
  return JSON.parse(raw) as RouterResult;
}

async function hydrateTaskStatus(redis: QueueRedis, doc: TaskStatusDocument): Promise<TaskStatusDocument> {
  if (doc.status === 'succeeded' || doc.status === 'failed') return doc;

  const legacy = await readLegacyTaskResult(redis, doc.id);
  if (!legacy) return doc;

  const hydrated = taskStatusFromRouterResult(legacy, doc);
  await writeTaskStatus(redis, hydrated);
  return hydrated;
}

export async function recordTaskQueued(task: Task, queue: string, redis: QueueRedis): Promise<TaskStatusDocument> {
  const now = new Date().toISOString();
  const doc: TaskStatusDocument = {
    id: task.id,
    taskId: task.id,
    type: task.type,
    status: 'queued',
    queue,
    agent: 'agent-worker',
    submitted_by: task.submittedBy,
    created_at: task.createdAt,
    updated_at: now,
    result_summary: 'queued for agent-worker',
  };
  await writeTaskStatus(redis, doc);
  await redis.command('LPUSH', taskStatusIndexKey(), task.id);
  await redis.command('LTRIM', taskStatusIndexKey(), 0, 499);
  return doc;
}

export async function enqueueTask(task: Task, redis: QueueRedis = new RedisConnection({ url: redisUrl() })): Promise<QueuedTaskResult> {
  const queue = taskQueueName();
  try {
    await recordTaskQueued(task, queue, redis);
    await redis.command('LPUSH', queue, JSON.stringify(task));
    console.log(`[task-queue] queued task=${task.id} type=${task.type} queue=${queue}`);
    return {
      id: task.id,
      taskId: task.id,
      type: task.type,
      agent: 'agent-worker',
      status: 'queued',
      queue,
      created_at: task.createdAt,
      updated_at: new Date().toISOString(),
      result_summary: 'queued for agent-worker',
    };
  } finally {
    redis.close();
  }
}

export async function dispatchTask(task: Task): Promise<TaskDispatchResult> {
  if (taskQueueMode() === 'redis') return enqueueTask(task);
  const { route } = await import('../router/index.js');
  return route(task);
}

export async function popTask(redis: QueueRedis, timeoutSeconds: number): Promise<Task | null> {
  const result = await redis.command('BRPOP', taskQueueName(), timeoutSeconds);
  if (!Array.isArray(result)) return null;
  const payload = result[1];
  if (typeof payload !== 'string') return null;
  return JSON.parse(payload) as Task;
}

export async function recordTaskRunning(redis: QueueRedis, task: Task): Promise<void> {
  const existing = await readTaskStatus(redis, task.id);
  const now = new Date().toISOString();
  await writeTaskStatus(redis, {
    id: task.id,
    taskId: task.id,
    type: task.type,
    status: 'running',
    queue: existing?.queue ?? taskQueueName(),
    agent: 'agent-worker',
    submitted_by: existing?.submitted_by ?? task.submittedBy,
    created_at: existing?.created_at ?? task.createdAt,
    updated_at: now,
    started_at: existing?.started_at ?? now,
    result_summary: 'running in agent-worker',
  });
}

export async function recordTaskResult(redis: QueueRedis, result: RouterResult): Promise<void> {
  const existing = await readTaskStatus(redis, result.taskId);
  const doc = taskStatusFromRouterResult(result, existing);
  await writeTaskStatus(redis, doc);
  await redis.command('SET', taskResultKey(result.taskId), JSON.stringify({
    ...result,
    completedAt: doc.completedAt,
    failedAt: doc.failedAt,
  }), 'EX', Number(process.env.TASK_RESULT_TTL_SECONDS ?? 86400));
}

export async function recordTaskFailure(redis: QueueRedis, task: Task, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const failedAt = new Date().toISOString();
  const existing = await readTaskStatus(redis, task.id);
  await writeTaskStatus(redis, {
    id: task.id,
    taskId: task.id,
    type: task.type,
    status: 'failed',
    queue: existing?.queue ?? taskQueueName(),
    agent: 'agent-worker',
    submitted_by: existing?.submitted_by ?? task.submittedBy,
    created_at: existing?.created_at ?? task.createdAt,
    updated_at: failedAt,
    started_at: existing?.started_at,
    failed_at: failedAt,
    failedAt,
    result_summary: message.slice(0, 180),
    error: message,
  });
  await redis.command('SET', taskResultKey(task.id), JSON.stringify({
    taskId: task.id,
    agent: 'agent-worker',
    status: 'error',
    error: message,
    failedAt,
  }), 'EX', Number(process.env.TASK_RESULT_TTL_SECONDS ?? 86400));
  await redis.command('LPUSH', `${taskQueueName()}:dead`, JSON.stringify({
    task,
    error: message,
    failedAt,
  }));
}

export async function getTaskResult(taskId: string, redis: QueueRedis = new RedisConnection({ url: redisUrl() })): Promise<TaskStatusDocument | RouterResult | null> {
  try {
    const statusDoc = await readTaskStatus(redis, taskId);
    if (statusDoc) return hydrateTaskStatus(redis, statusDoc);

    return readLegacyTaskResult(redis, taskId);
  } finally {
    redis.close();
  }
}

export async function listTaskStatuses(limit = 50, redis: QueueRedis = new RedisConnection({ url: redisUrl() })): Promise<TaskStatusDocument[]> {
  try {
    const bounded = Math.max(1, Math.min(limit, 200));
    const ids = await redis.command('LRANGE', taskStatusIndexKey(), 0, bounded - 1);
    if (!Array.isArray(ids)) return [];

    const docs: TaskStatusDocument[] = [];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const doc = await readTaskStatus(redis, id);
      if (doc) docs.push(await hydrateTaskStatus(redis, doc));
    }
    return docs;
  } finally {
    redis.close();
  }
}
