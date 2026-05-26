import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterJulesPullRequests } from '../core/github/index.js';

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
});
