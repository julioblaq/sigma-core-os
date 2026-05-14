// tests/audit-search.test.ts
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { searchLog, logOutcome } from '../core/runtime/index.js';
import { requestApproval, resolveApproval } from '../core/policies/index.js';

// RUN suffix prevents collision across test runs on persistent sigma.db
const RUN = randomBytes(4).toString('hex');

// Helper: create and resolve an approval, then log it to outcome_log
function makeOutcome(agent: string, action: string, approved: boolean, resolvedBy = 'tester'): void {
  const approval = requestApproval(agent, action, `Test ${action}`, { run: RUN });
  const resolved = resolveApproval(
    approval.id,
    approved,
    resolvedBy,
    approved ? undefined : 'test denial reason',
  );
  if (resolved) logOutcome(resolved, action);
}

// Seed entries before running search tests
// All agents/actions include RUN so searches can be scoped to this run
// We can't scope by RUN in DB since agent is exact match, so we use unique agent names
const AGENT_A = `agent-a-${RUN}`;
const AGENT_B = `agent-b-${RUN}`;

before(() => {
  // 3 entries for AGENT_A: 2 approved, 1 denied
  makeOutcome(AGENT_A, `trade_plan`, true);
  makeOutcome(AGENT_A, `trade_plan`, true);
  makeOutcome(AGENT_A, `scaffold_file`, false);
  // 2 entries for AGENT_B: 1 approved, 1 denied
  makeOutcome(AGENT_B, `generate_code`, true);
  makeOutcome(AGENT_B, `trade_plan`, false);
});

describe('searchLog', () => {
  it('returns all entries when no filters provided (sanity check)', () => {
    // Just verify searchLog runs without error and returns an array
    const results = searchLog({});
    assert.ok(Array.isArray(results), 'should return array');
  });

  it('filters by agent', () => {
    const results = searchLog({ agent: AGENT_A });
    assert.ok(results.length >= 3, `expected >= 3 entries for AGENT_A, got ${results.length}`);
    for (const r of results) {
      assert.equal(r.agent, AGENT_A);
    }
  });

  it('filters by action (task_type)', () => {
    const results = searchLog({ agent: AGENT_A, action: 'scaffold_file' });
    assert.ok(results.length >= 1, 'expected >= 1 scaffold_file entry for AGENT_A');
    for (const r of results) {
      assert.equal(r.taskType, 'scaffold_file');
      assert.equal(r.agent, AGENT_A);
    }
  });

  it('filters by status (approved)', () => {
    const approved = searchLog({ agent: AGENT_A, status: 'approved' });
    assert.ok(approved.length >= 2, `expected >= 2 approved entries for AGENT_A, got ${approved.length}`);
    for (const r of approved) {
      assert.equal(r.outcome, 'approved');
    }
  });

  it('filters by status (denied)', () => {
    const denied = searchLog({ agent: AGENT_A, status: 'denied' });
    assert.ok(denied.length >= 1, `expected >= 1 denied entry for AGENT_A, got ${denied.length}`);
    for (const r of denied) {
      assert.equal(r.outcome, 'denied');
    }
  });

  it('respects limit param', () => {
    // All entries exist; limit=2 should return exactly 2
    const results = searchLog({ limit: 2 });
    assert.equal(results.length, 2, `expected exactly 2 results with limit=2, got ${results.length}`);
  });

  it('date range filter excludes entries outside range', () => {
    // Set from to a far-future date — no entries should match
    const results = searchLog({ agent: AGENT_A, from: '2099-01-01T00:00:00.000Z' });
    assert.equal(results.length, 0, 'expected 0 results with future from date');
  });

  it('date range filter includes entries within range', () => {
    // Set from to past — all AGENT_A entries should be included
    const results = searchLog({ agent: AGENT_A, from: '2000-01-01T00:00:00.000Z' });
    assert.ok(results.length >= 3, `expected >= 3 results with past from date, got ${results.length}`);
  });

  it('combined agent + action + status filter works', () => {
    const results = searchLog({ agent: AGENT_B, action: 'trade_plan', status: 'denied' });
    assert.ok(results.length >= 1, 'expected >= 1 denied trade_plan for AGENT_B');
    for (const r of results) {
      assert.equal(r.agent, AGENT_B);
      assert.equal(r.taskType, 'trade_plan');
      assert.equal(r.outcome, 'denied');
    }
  });

  it('returns entries in descending logged_at order', () => {
    const results = searchLog({ agent: AGENT_A, limit: 10 });
    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i - 1].loggedAt >= results[i].loggedAt,
        'entries should be ordered newest first',
      );
    }
  });
});
