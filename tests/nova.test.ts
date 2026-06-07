import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { answerNovaQuery, createNovaJournalEntry } from '../core/nova/index.js';
import { memList } from '../core/store/control.js';

describe('Nova safe operator endpoints', () => {
  it('answers context queries without executable intent', () => {
    const result = answerNovaQuery({
      sessionId: 'session-1',
      transcript: 'What am I looking at?',
      screenshotBase64: 'ZmFrZQ==',
      activeApp: 'TradingView',
      activeWindowTitle: 'MNQ chart',
      context: { symbol: 'MNQ' },
    });

    assert.equal(result.intent, null);
    assert.match(result.answer, /No executable action/);
    assert.equal(result.voiceText, result.answer);
    assert.deepEqual(result.highlights.map(item => item.label), [
      'activeApp',
      'activeWindowTitle',
      'sessionId',
      'screenshot',
    ]);
  });

  it('creates durable Nova journal memory entries', async () => {
    const entry = await createNovaJournalEntry({
      sessionId: 'session-2',
      transcript: 'Capture this chart note.',
      screenshotBase64: 'ZmFrZS1zY3JlZW5zaG90',
      activeApp: 'TradingView',
      activeWindowTitle: 'MES chart',
      tags: ['chart', 'review'],
      notes: 'Potential setup forming.',
      context: { symbol: 'MES' },
    }, 'nova-test');

    assert.equal(entry.tags.length, 2);
    assert.equal(entry.notes, 'Potential setup forming.');
    assert.match(entry.screenshotPointer ?? '', /^memory:\/\/nova-screenshot\//);

    const entries = await memList('nova-journal');
    assert.equal(entries.some(item => item.key === entry.id), true);
  });
});
