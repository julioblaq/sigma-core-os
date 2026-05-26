import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildJulesWork, filterJulesPullRequests } from '../core/github/index.js';

describe('MindLyft Jules work selection', () => {
  it('includes an owner-authored PR that fixes a Jules-labeled task', () => {
    const issues = [
      { number: 4, state: 'open', labels: [{ name: 'jules' }] },
    ];
    const pr = {
      number: 5,
      user: { login: 'julioblaq' },
      labels: [],
      body: 'Adds the MindLyft dashboard panel.\n\nFixes #4',
    };

    assert.deepEqual(filterJulesPullRequests(issues, [pr]), [pr]);
  });

  it('does not include an unrelated owner-authored PR', () => {
    const issues = [
      { number: 4, state: 'open', labels: [{ name: 'jules' }] },
    ];
    const pr = {
      number: 6,
      user: { login: 'julioblaq' },
      labels: [],
      body: 'Updates unrelated documentation.',
    };

    assert.deepEqual(filterJulesPullRequests(issues, [pr]), []);
  });

  it('keeps supporting an explicitly Jules-labeled PR', () => {
    const pr = {
      user: { login: 'julioblaq' },
      labels: [{ name: 'jules' }],
      body: null,
    };

    assert.deepEqual(filterJulesPullRequests([], [pr]), [pr]);
  });

  it('marks an open task ready for review when its pull request is open', () => {
    const issues = [
      { number: 4, state: 'open', labels: [{ name: 'jules' }] },
    ];
    const pullRequests = [
      { number: 5, state: 'open', body: 'Fixes #4', user: { login: 'julioblaq' } },
    ];

    const work = buildJulesWork(issues, pullRequests);

    assert.equal(work.issues[0]?.status, 'ready_for_review');
    assert.equal(work.pullRequests[0]?.status, 'ready_for_review');
  });

  it('returns completed Jules tasks and merged pull requests in completion order', () => {
    const issues = [
      {
        number: 4,
        state: 'closed',
        closed_at: '2026-05-26T20:13:35Z',
        labels: [{ name: 'jules' }],
      },
    ];
    const pullRequests = [
      {
        number: 5,
        state: 'closed',
        merged_at: '2026-05-26T20:13:34Z',
        body: 'Fixes #4',
        user: { login: 'julioblaq' },
      },
    ];

    const work = buildJulesWork(issues, pullRequests);

    assert.deepEqual(work.recentlyCompleted.map(item => [item.kind, item.number, item.status]), [
      ['Issue', 4, 'completed'],
      ['PR', 5, 'completed'],
    ]);
  });
});
