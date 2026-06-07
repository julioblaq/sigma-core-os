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
  recordTaskRunning,
  listTaskStatuses,
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
  nextResponses: unknown[] = [];

  async command(...parts: (string | number)[]): Promise<unknown> {
    this.commands.push(parts);
    if (this.nextResponses.length > 0) return this.nextResponses.shift();
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

  it('enqueueTask writes a queued status document and task JSON to Redis queue', async () => {
    process.env.TASK_QUEUE_NAME = 'sigma:test-tasks';
    const redis = new FakeRedis();
    const task = makeTask('dev_task');
    const result = await enqueueTask(task, redis);

    assert.equal(result.status, 'queued');
    assert.equal(result.queue, 'sigma:test-tasks');
    assert.equal(result.id, task.id);
    assert.equal(result.type, 'dev_task');
    assert.equal(redis.closed, true);
    assert.deepEqual(redis.commands[0].slice(0, 2), ['SET', `sigma:task-status:${task.id}`]);
    assert.equal(JSON.parse(redis.commands[0][2] as string).status, 'queued');
    assert.deepEqual(redis.commands[1].slice(0, 2), ['LPUSH', 'sigma:test-tasks:status-index']);
    assert.deepEqual(redis.commands[3].slice(0, 2), ['LPUSH', 'sigma:test-tasks']);
    assert.equal(JSON.parse(redis.commands[3][2] as string).id, task.id);
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

    assert.deepEqual(redis.commands[0], ['GET', `sigma:task-status:${task.id}`]);
    assert.deepEqual(redis.commands[1].slice(0, 2), ['SET', `sigma:task-status:${task.id}`]);
    assert.equal(JSON.parse(redis.commands[1][2] as string).status, 'succeeded');
    assert.deepEqual(redis.commands[2].slice(0, 2), ['SET', `sigma:task-result:${task.id}`]);
    assert.deepEqual(redis.commands[3], ['GET', `sigma:task-status:${task.id}`]);
    assert.deepEqual(redis.commands[4].slice(0, 2), ['SET', `sigma:task-status:${task.id}`]);
    assert.equal(JSON.parse(redis.commands[4][2] as string).status, 'failed');
    assert.equal(redis.commands[6][0], 'LPUSH');
    assert.equal(redis.commands[6][1], 'sigma:test-tasks:dead');
  });

  it('records running state and lists recent task statuses', async () => {
    process.env.TASK_QUEUE_NAME = 'sigma:test-tasks';
    const redis = new FakeRedis();
    const task = makeTask('dev_task');

    redis.nextResponses = [null];
    await recordTaskRunning(redis, task);

    const runningDoc = JSON.parse(redis.commands[1][2] as string);
    assert.equal(runningDoc.status, 'running');
    assert.equal(runningDoc.type, 'dev_task');

    const listRedis = new FakeRedis();
    listRedis.nextResponses = [
      [task.id],
      JSON.stringify(runningDoc),
      null,
    ];

    const tasks = await listTaskStatuses(50, listRedis);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, task.id);
    assert.equal(tasks[0].status, 'running');
    assert.deepEqual(listRedis.commands[0], ['LRANGE', 'sigma:test-tasks:status-index', 0, 49]);
  });

  it('hydrates queued status from a legacy worker result during mixed deploys', async () => {
    const redis = new FakeRedis();
    const task = makeTask('unknown_task');
    redis.nextResponses = [
      JSON.stringify({
        id: task.id,
        taskId: task.id,
        type: 'unknown_task',
        agent: 'agent-worker',
        queue: 'sigma:tasks',
        status: 'queued',
        submitted_by: 'test',
        result_summary: 'queued for agent-worker',
        created_at: task.createdAt,
        updated_at: task.createdAt,
      }),
      JSON.stringify({
        taskId: task.id,
        agent: 'none',
        status: 'error',
        error: 'No agent registered for task type: unknown_task',
        failedAt: new Date().toISOString(),
      }),
      1,
    ];

    const result = await getTaskResult(task.id, redis);

    assert.equal(result?.taskId, task.id);
    assert.equal(result?.status, 'failed');
    assert.equal('result_summary' in result!, true);
    assert.deepEqual(redis.commands[0], ['GET', `sigma:task-status:${task.id}`]);
    assert.deepEqual(redis.commands[1], ['GET', `sigma:task-result:${task.id}`]);
    assert.deepEqual(redis.commands[2].slice(0, 2), ['SET', `sigma:task-status:${task.id}`]);
  });

  it('reads recorded task results by id', async () => {
    const redis = new FakeRedis();
    const task = makeTask('dev_task');
    redis.nextResponses = [
      JSON.stringify({
        id: task.id,
        taskId: task.id,
        type: 'dev_task',
        agent: 'sigma-dev',
        queue: 'sigma:tasks',
        status: 'succeeded',
        submitted_by: 'test',
        result_summary: 'sigma-dev succeeded',
        result: { ok: true },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ];

    const result = await getTaskResult(task.id, redis);

    assert.equal(result?.taskId, task.id);
    assert.equal(result?.status, 'succeeded');
    assert.equal(redis.closed, true);
    assert.deepEqual(redis.commands[0], ['GET', `sigma:task-status:${task.id}`]);
  });

  it('returns null for missing task result', async () => {
    const redis = new FakeRedis();
    redis.nextResponses = [null, null];

    const result = await getTaskResult('missing-task', redis);

    assert.equal(result, null);
    assert.equal(redis.closed, true);
  });
});
