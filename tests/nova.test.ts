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
    assert.equal(result.statusModel.mode, 'tutor');
    assert.equal(result.statusModel.intentType, 'explain');
    assert.equal(result.statusModel.riskState, 'read_only');
    assert.equal(result.statusModel.highlightSafety.blocksInteraction, false);
    assert.match(result.answer, /Read-only/);
    assert.match(result.answer, /trend, key level, then risk/);
    assert.equal(result.voiceText, result.answer);
    assert.deepEqual(result.highlights.map(item => item.label), ['Chart', 'Screenshot']);
    assert.equal(result.highlights[0].avoidCriticalControls, true);
    assert.equal(result.highlights[0].blocksInteraction, false);
  });

  it('uses direct trader-native language for risk and order questions', () => {
    const result = answerNovaQuery({
      transcript: 'Where is my stop loss on this ticket?',
      activeApp: 'TradingView',
      activeWindowTitle: 'MNQ order ticket',
    });

    assert.equal(result.intent, null);
    assert.equal(result.statusModel.mode, 'risk_coach');
    assert.equal(result.statusModel.intentType, 'risk_review');
    assert.match(result.voiceText, /Check the stop field/);
    assert.match(result.voiceText, /No broker order sent/);
    assert.deepEqual(result.highlights.map(item => item.label), ['Risk', 'Chart']);
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
