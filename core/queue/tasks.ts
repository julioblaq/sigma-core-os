import type { RouterResult, Task } from '../router/index.js';
import { RedisConnection, redisUrl } from './redis.js';

export type TaskQueueMode = 'inline' | 'redis';

export interface QueuedTaskResult {
  taskId: string;
  agent: 'agent-worker';
  status: 'queued';
  queue: string;
}

export type TaskDispatchResult = RouterResult | QueuedTaskResult;

interface StoredTaskResult extends RouterResult {
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

export async function enqueueTask(task: Task, redis: QueueRedis = new RedisConnection({ url: redisUrl() })): Promise<QueuedTaskResult> {
  const queue = taskQueueName();
  await redis.command('LPUSH', queue, JSON.stringify(task));
  redis.close();
  console.log(`[task-queue] queued task=${task.id} type=${task.type} queue=${queue}`);
  return { taskId: task.id, agent: 'agent-worker', status: 'queued', queue };
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

export async function recordTaskResult(redis: QueueRedis, result: RouterResult): Promise<void> {
  await redis.command('SET', taskResultKey(result.taskId), JSON.stringify({
    ...result,
    completedAt: new Date().toISOString(),
  }), 'EX', Number(process.env.TASK_RESULT_TTL_SECONDS ?? 86400));
}

export async function recordTaskFailure(redis: QueueRedis, task: Task, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const failedAt = new Date().toISOString();
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

export async function getTaskResult(taskId: string, redis: QueueRedis = new RedisConnection({ url: redisUrl() })): Promise<StoredTaskResult | null> {
  try {
    const raw = await redis.command('GET', taskResultKey(taskId));
    if (typeof raw !== 'string') return null;
    return JSON.parse(raw) as StoredTaskResult;
  } finally {
    redis.close();
  }
}
