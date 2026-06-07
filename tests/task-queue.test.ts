import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

import {
  dispatchTask,
  enqueueTask,
  getTaskResult,
  popTask,
  recordTaskFailure,
  recordTaskResult,
  taskQueueMode,
} from '../core/queue/tasks.js';
import type { Task } from '../core/router/index.js';

const originalMode = process.env.TASK_QUEUE_MODE;
const originalRedisUrl = process.env.REDIS_URL;
const originalQueueName = process.env.TASK_QUEUE_NAME;

afterEach(() => {
  if (originalMode === undefined) delete process.env.TASK_QUEUE_MODE;
  else process.env.TASK_QUEUE_MODE = originalMode;
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
  if (originalQueueName === undefined) delete process.env.TASK_QUEUE_NAME;
  else process.env.TASK_QUEUE_NAME = originalQueueName;
});

class FakeRedis {
  commands: (string | number)[][] = [];
  closed = false;
  nextResponse: unknown = 1;

  async command(...parts: (string | number)[]): Promise<unknown> {
    this.commands.push(parts);
    return this.nextResponse;
  }

  close(): void {
    this.closed = true;
  }
}

function makeTask(type = 'unknown_task'): Task {
  return {
    id: randomUUID(),
    type,
    payload: { ok: true },
    submittedBy: 'test',
    createdAt: new Date().toISOString(),
  };
}

describe('task queue', () => {
  it('defaults to inline mode without Redis', () => {
    delete process.env.TASK_QUEUE_MODE;
    delete process.env.REDIS_URL;
    assert.equal(taskQueueMode(), 'inline');
  });

  it('defaults to redis mode when REDIS_URL is present', () => {
    delete process.env.TASK_QUEUE_MODE;
    process.env.REDIS_URL = 'redis://localhost:6379';
    assert.equal(taskQueueMode(), 'redis');
  });

  it('inline dispatch keeps current router behavior', async () => {
    process.env.TASK_QUEUE_MODE = 'inline';
    const result = await dispatchTask(makeTask());
    assert.equal(result.status, 'error');
    assert.equal(result.agent, 'none');
  });

  it('enqueueTask writes task JSON to Redis queue', async () => {
    process.env.TASK_QUEUE_NAME = 'sigma:test-tasks';
    const redis = new FakeRedis();
    const task = makeTask('dev_task');
    const result = await enqueueTask(task, redis);

    assert.equal(result.status, 'queued');
    assert.equal(result.queue, 'sigma:test-tasks');
    assert.equal(redis.closed, true);
    assert.deepEqual(redis.commands[0].slice(0, 2), ['LPUSH', 'sigma:test-tasks']);
    assert.equal(JSON.parse(redis.commands[0][2] as string).id, task.id);
  });

  it('popTask parses Redis BRPOP payload', async () => {
    process.env.TASK_QUEUE_NAME = 'sigma:test-tasks';
    const redis = new FakeRedis();
    const task = makeTask('trade_plan');
    redis.nextResponse = ['sigma:test-tasks', JSON.stringify(task)];

    const popped = await popTask(redis, 1);
    assert.equal(popped?.id, task.id);
    assert.deepEqual(redis.commands[0], ['BRPOP', 'sigma:test-tasks', 1]);
  });

  it('records result and failures for worker audit', async () => {
    process.env.TASK_QUEUE_NAME = 'sigma:test-tasks';
    const redis = new FakeRedis();
    const task = makeTask('dev_task');

    await recordTaskResult(redis, {
      taskId: task.id,
      agent: 'sigma-dev',
      status: 'complete',
      result: { ok: true },
    });
    await recordTaskFailure(redis, task, new Error('boom'));

    assert.equal(redis.commands[0][0], 'SET');
    assert.equal(redis.commands[0][1], `sigma:task-result:${task.id}`);
    assert.equal(redis.commands[1][0], 'SET');
    assert.equal(redis.commands[1][1], `sigma:task-result:${task.id}`);
    assert.equal(redis.commands[2][0], 'LPUSH');
    assert.equal(redis.commands[2][1], 'sigma:test-tasks:dead');
  });

  it('reads recorded task results by id', async () => {
    const redis = new FakeRedis();
    const task = makeTask('dev_task');
    redis.nextResponse = JSON.stringify({
      taskId: task.id,
      agent: 'sigma-dev',
      status: 'complete',
      result: { ok: true },
      completedAt: new Date().toISOString(),
    });

    const result = await getTaskResult(task.id, redis);

    assert.equal(result?.taskId, task.id);
    assert.equal(result?.status, 'complete');
    assert.equal(redis.closed, true);
    assert.deepEqual(redis.commands[0], ['GET', `sigma:task-result:${task.id}`]);
  });

  it('returns null for missing task result', async () => {
    const redis = new FakeRedis();
    redis.nextResponse = null;

    const result = await getTaskResult('missing-task', redis);

    assert.equal(result, null);
    assert.equal(redis.closed, true);
  });
});
