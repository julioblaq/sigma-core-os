import { RedisConnection, redisUrl } from '../../core/queue/redis.js';
import { popTask, recordTaskFailure, recordTaskResult } from '../../core/queue/tasks.js';
import { route } from '../../core/router/index.js';

let running = true;

process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

async function main(): Promise<void> {
  const redis = new RedisConnection({ url: redisUrl() });
  const timeoutSeconds = Number(process.env.TASK_WORKER_POLL_SECONDS ?? 5);
  console.log(`[agent-worker] starting queue=${process.env.TASK_QUEUE_NAME ?? 'sigma:tasks'}`);

  while (running) {
    const task = await popTask(redis, timeoutSeconds);
    if (!task) continue;
    console.log(`[agent-worker] received task=${task.id} type=${task.type}`);
    try {
      const result = await route(task);
      await recordTaskResult(redis, result);
      console.log(`[agent-worker] completed task=${task.id} status=${result.status}`);
    } catch (err) {
      await recordTaskFailure(redis, task, err);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[agent-worker] failed task=${task.id}: ${message}`);
    }
  }

  redis.close();
  console.log('[agent-worker] stopped');
}

main().catch((err) => {
  console.error(`[agent-worker] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
