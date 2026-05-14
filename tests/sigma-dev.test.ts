// tests/sigma-dev.test.ts
// Slice 2d: Sigma Dev agent tests.
// Mocks LLM fetch so no real API calls are made.
// Tests: scaffold request, deny write, approve write, double-resolution prevention.

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

// Set LLM env before any module loads
before(() => {
  process.env.LLM_BASE_URL    = 'https://test-litellm.example.com/v1';
  process.env.LLM_MODEL       = 'gpt-test';
  process.env.LLM_API_KEY     = 'sk-test-key';
  process.env.LLM_TIMEOUT_MS  = '5000';
  process.env.LLM_MAX_RETRIES = '0';
});

import { handleTask } from '../agents/sigma-dev/handler.js';
import { resolveApproval, getApproval } from '../core/policies/index.js';
import { memGet } from '../core/memory/index.js';
import type { Task } from '../core/router/index.js';

// -------------------------------------------------------------------------
// Fetch mock - returns a canned LLM response for all tests
// -------------------------------------------------------------------------

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;
let savedFetch: typeof fetch;

function mockFetch(impl: FetchMock) {
  (globalThis as Record<string, unknown>).fetch = impl;
}

function makeLLMOk(content: string): FetchMock {
  return async () => new Response(JSON.stringify({
    choices: [{ message: { content } }],
    model: 'gpt-test',
    usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => { savedFetch = globalThis.fetch; });
afterEach(() => { (globalThis as Record<string, unknown>).fetch = savedFetch; });

// -------------------------------------------------------------------------
// Task factory
// -------------------------------------------------------------------------

function makeTask(payload: Record<string, unknown>): Task {
  return {
    id:          randomUUID(),
    type:        'dev_task',
    payload,
    submittedBy: 'test',
    createdAt:   new Date().toISOString(),
  };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('Sigma Dev agent', () => {

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  describe('validation', () => {
    it('rejects wrong task type', async () => {
      const task: Task = { id: randomUUID(), type: 'trade_plan', payload: {}, submittedBy: 'test', createdAt: new Date().toISOString() };
      const res = await handleTask(task);
      assert.equal(res.status, 'error');
      assert.ok((res.data.message as string).includes('sigma-dev does not handle'));
    });

    it('rejects missing action', async () => {
      const res = await handleTask(makeTask({ filePath: 'foo.ts', spec: 'make a thing' }));
      assert.equal(res.status, 'error');
      assert.ok((res.data.message as string).includes('action to be one of'));
    });

    it('rejects invalid action name', async () => {
      const res = await handleTask(makeTask({ action: 'hack_everything', spec: 'bad' }));
      assert.equal(res.status, 'error');
    });

    it('rejects generate_code without filePath', async () => {
      const res = await handleTask(makeTask({ action: 'generate_code', spec: 'make a util' }));
      assert.equal(res.status, 'error');
      assert.ok((res.data.message as string).includes('filePath'));
    });

    it('rejects explain_code without code', async () => {
      const res = await handleTask(makeTask({ action: 'explain_code' }));
      assert.equal(res.status, 'error');
      assert.ok((res.data.message as string).includes('code'));
    });
  });

  // -------------------------------------------------------------------------
  // Scaffold file - write action, requires approval
  // -------------------------------------------------------------------------
  describe('scaffold_file flow', () => {
    it('returns pending_approval with approvalId', async () => {
      mockFetch(makeLLMOk('export const foo = 42;'));

      const task = makeTask({
        action: 'scaffold_file',
        filePath: 'core/utils/foo.ts',
        spec: 'A simple utility exporting foo constant',
        language: 'typescript',
      });

      const res = await handleTask(task);

      assert.equal(res.status, 'pending_approval');
      assert.ok(res.approvalId, 'approvalId must be set');
      assert.ok(res.data.artifact, 'artifact must be in result data');
    });

    it('stores artifact in memory before approval', async () => {
      mockFetch(makeLLMOk('export const bar = 99;'));

      const task = makeTask({
        action: 'scaffold_file',
        filePath: 'core/utils/bar.ts',
        spec: 'A simple utility exporting bar constant',
      });

      await handleTask(task);

      const entry = memGet('sigma-dev', `artifact:${task.id}`);
      assert.ok(entry, 'artifact must be stored in memory');
      const artifact = (entry as Record<string, unknown>).value as Record<string, unknown>;
      assert.equal(artifact.action, 'scaffold_file');
      assert.equal(artifact.filePath, 'core/utils/bar.ts');
      assert.equal(artifact.content, 'export const bar = 99;');
      assert.equal(artifact.requiresWrite, true);
    });

    it('queues approval with action=scaffold_file', async () => {
      mockFetch(makeLLMOk('// scaffold content'));

      const task = makeTask({
        action: 'scaffold_file',
        filePath: 'core/utils/baz.ts',
        spec: 'Baz utility',
      });

      const res = await handleTask(task);
      assert.ok(res.approvalId);

      const approval = getApproval(res.approvalId!);
      assert.ok(approval);
      assert.equal(approval.status, 'pending');
      assert.equal(approval.action, 'scaffold_file');
      assert.equal(approval.agent, 'sigma-dev');
    });
  });

  // -------------------------------------------------------------------------
  // Approve write
  // -------------------------------------------------------------------------
  describe('approve write', () => {
    it('resolveApproval approved sets status to approved', async () => {
      mockFetch(makeLLMOk('export function myFn() {}'));

      const task = makeTask({
        action: 'generate_code',
        filePath: 'core/utils/myFn.ts',
        spec: 'Generate a utility function',
      });

      const res = await handleTask(task);
      assert.ok(res.approvalId);

      const resolved = resolveApproval(res.approvalId!, true, 'julio');
      assert.ok(resolved);
      assert.equal(resolved.status, 'approved');
      assert.equal(resolved.resolvedBy, 'julio');
      assert.equal(resolved.reason, undefined);
    });

    it('approval payload contains the artifact', async () => {
      mockFetch(makeLLMOk('# My Docs'));

      const task = makeTask({
        action: 'write_docs',
        filePath: 'docs/my-module.md',
        spec: 'Document the my-module API',
      });

      const res = await handleTask(task);
      assert.ok(res.approvalId);

      const approval = getApproval(res.approvalId!);
      assert.ok(approval);
      const payload = approval.payload as Record<string, unknown>;
      const artifact = payload.artifact as Record<string, unknown>;
      assert.equal(artifact.action, 'write_docs');
      assert.equal(artifact.filePath, 'docs/my-module.md');
      assert.equal(artifact.content, '# My Docs');
    });
  });

  // -------------------------------------------------------------------------
  // Deny write
  // -------------------------------------------------------------------------
  describe('deny write', () => {
    it('resolveApproval denied sets status to denied with reason', async () => {
      mockFetch(makeLLMOk('const x = 1;'));

      const task = makeTask({
        action: 'generate_code',
        filePath: 'core/utils/x.ts',
        spec: 'Generate x utility',
      });

      const res = await handleTask(task);
      assert.ok(res.approvalId);

      const resolved = resolveApproval(res.approvalId!, false, 'julio', 'not needed yet');
      assert.ok(resolved);
      assert.equal(resolved.status, 'denied');
      assert.equal(resolved.reason, 'not needed yet');
    });

    it('denied approval is retrievable with reason', async () => {
      mockFetch(makeLLMOk('const y = 2;'));

      const task = makeTask({
        action: 'scaffold_file',
        filePath: 'core/utils/y.ts',
        spec: 'Generate y utility',
      });

      const res = await handleTask(task);
      assert.ok(res.approvalId);

      resolveApproval(res.approvalId!, false, 'julio', 'out of scope');

      const fetched = getApproval(res.approvalId!);
      assert.ok(fetched);
      assert.equal(fetched.status, 'denied');
      assert.equal(fetched.reason, 'out of scope');
    });
  });

  // -------------------------------------------------------------------------
  // Double-resolution prevention (immutability)
  // -------------------------------------------------------------------------
  describe('immutability', () => {
    it('cannot approve an already-approved artifact', async () => {
      mockFetch(makeLLMOk('const z = 3;'));

      const task = makeTask({
        action: 'generate_code',
        filePath: 'core/utils/z.ts',
        spec: 'Generate z utility',
      });

      const res = await handleTask(task);
      assert.ok(res.approvalId);

      resolveApproval(res.approvalId!, true, 'julio');
      const second = resolveApproval(res.approvalId!, true, 'julio');
      assert.equal(second, null, 'second resolve must return null');
    });

    it('cannot deny an already-approved artifact', async () => {
      mockFetch(makeLLMOk('const w = 4;'));

      const task = makeTask({
        action: 'generate_code',
        filePath: 'core/utils/w.ts',
        spec: 'Generate w utility',
      });

      const res = await handleTask(task);
      assert.ok(res.approvalId);

      resolveApproval(res.approvalId!, true, 'julio');
      const second = resolveApproval(res.approvalId!, false, 'julio', 'changed mind');
      assert.equal(second, null, 'second resolve must return null');
    });

    it('status is immutable after denial', async () => {
      mockFetch(makeLLMOk('const v = 5;'));

      const task = makeTask({
        action: 'scaffold_file',
        filePath: 'core/utils/v.ts',
        spec: 'Generate v utility',
      });

      const res = await handleTask(task);
      assert.ok(res.approvalId);

      resolveApproval(res.approvalId!, false, 'julio', 'denied first');
      resolveApproval(res.approvalId!, true, 'julio'); // no-op

      const fetched = getApproval(res.approvalId!);
      assert.ok(fetched);
      assert.equal(fetched.status, 'denied', 'status must remain denied');
    });
  });

  // -------------------------------------------------------------------------
  // Read-only actions (no approval needed)
  // -------------------------------------------------------------------------
  describe('read-only actions', () => {
    it('explain_code returns complete immediately without approval', async () => {
      mockFetch(makeLLMOk('This function sorts an array using bubble sort.'));

      const task = makeTask({
        action: 'explain_code',
        code: 'function sort(arr) { return arr.sort(); }',
      });

      const res = await handleTask(task);
      assert.equal(res.status, 'complete');
      assert.equal(res.approvalId, undefined);
      const artifact = res.data.artifact as Record<string, unknown>;
      assert.equal(artifact.requiresWrite, false);
    });

    it('analyze_repo returns complete immediately without approval', async () => {
      mockFetch(makeLLMOk('# Architecture Report\n\nThis is a monorepo...'));

      const task = makeTask({
        action: 'analyze_repo',
        spec: 'Analyze the overall structure of this repository',
      });

      const res = await handleTask(task);
      assert.equal(res.status, 'complete');
      assert.equal(res.approvalId, undefined);
    });
  });

});
