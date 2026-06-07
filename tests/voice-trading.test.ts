import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVoiceTradeDraft,
  VoiceTradeParseError,
} from '../core/voice/trading.js';

describe('Nova voice trading draft parser', () => {
  it('parses a plain simulated futures trade phrase', () => {
    const draft = parseVoiceTradeDraft(
      'Draft a simulated MNQ long at 19000 with a 10 point stop, risk 100 dollars, 2R.',
      { accountSize: 5000, riskDollars: 50, rrRatio: 1.5 },
    );

    assert.equal(draft.input.symbol, 'MNQ');
    assert.equal(draft.input.side, 'long');
    assert.equal(draft.input.entry, 19000);
    assert.equal(draft.input.stopPoints, 10);
    assert.equal(draft.input.riskDollars, 100);
    assert.equal(draft.input.rrRatio, 2);
    assert.equal(draft.input.accountSize, 5000);
    assert.deepEqual(draft.assumptions, ['account size defaulted to 5000']);
  });

  it('uses safe defaults when risk/account/RR are not spoken', () => {
    const draft = parseVoiceTradeDraft(
      'Nova, make MES short at 5000 stop 4 points',
      { accountSize: 10000, riskDollars: 200, rrRatio: 2 },
    );

    assert.equal(draft.input.symbol, 'MES');
    assert.equal(draft.input.side, 'short');
    assert.equal(draft.input.entry, 5000);
    assert.equal(draft.input.stopPoints, 4);
    assert.equal(draft.input.accountSize, 10000);
    assert.equal(draft.input.riskDollars, 200);
    assert.equal(draft.input.rrRatio, 2);
    assert.equal(draft.assumptions.length, 3);
  });

  it('parses daily loss context when spoken', () => {
    const draft = parseVoiceTradeDraft(
      'NQ buy at 18000 with a 20 point stop risk 400 dollars 2R account 30000 down today 500',
    );

    assert.equal(draft.input.symbol, 'NQ');
    assert.equal(draft.input.side, 'long');
    assert.equal(draft.input.dailyLossDollars, 500);
    assert.equal(draft.input.maxDailyLossPct, 2);
  });

  it('requires a supported symbol', () => {
    assert.throws(
      () => parseVoiceTradeDraft('Draft AAPL long at 200 stop 4 points risk 100 2R account 10000'),
      (err: unknown) => {
        assert.ok(err instanceof VoiceTradeParseError);
        assert.equal(err.code, 'MISSING_SYMBOL');
        return true;
      },
    );
  });

  it('requires an entry price', () => {
    assert.throws(
      () => parseVoiceTradeDraft('Draft MNQ long with a 10 point stop risk 100 2R account 5000'),
      (err: unknown) => {
        assert.ok(err instanceof VoiceTradeParseError);
        assert.equal(err.code, 'MISSING_ENTRY');
        return true;
      },
    );
  });
});

