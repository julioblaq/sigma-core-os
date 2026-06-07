import type { SimulatedAlertInput } from '../webhooks/simulated.js';

export interface VoiceTradeDefaults {
  accountSize?: number;
  riskDollars?: number;
  rrRatio?: number;
}

export interface VoiceTradeDraft {
  input: SimulatedAlertInput;
  transcript: string;
  assumptions: string[];
}

export class VoiceTradeParseError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'VoiceTradeParseError';
    this.code = code;
  }
}

const SYMBOLS = ['MNQ', 'MES', 'NQ', 'ES'] as const;

function compactTranscript(transcript: string): string {
  return transcript
    .replace(/\$/g, ' dollars ')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findNumber(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] !== undefined) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function parseSymbol(text: string): string {
  const found = SYMBOLS.find(symbol => new RegExp(`\\b${symbol.toLowerCase()}\\b`).test(text));
  if (!found) {
    throw new VoiceTradeParseError('MISSING_SYMBOL', `Say one of ${SYMBOLS.join(', ')}`);
  }
  return found;
}

function parseSide(text: string): 'long' | 'short' {
  if (/\b(long|buy|bullish)\b/.test(text)) return 'long';
  if (/\b(short|sell|bearish)\b/.test(text)) return 'short';
  throw new VoiceTradeParseError('MISSING_SIDE', 'Say long or short');
}

function withDefault(
  value: number | undefined,
  fallback: number | undefined,
  label: string,
  assumptions: string[],
): number {
  if (value !== undefined) return value;
  if (fallback !== undefined) {
    assumptions.push(`${label} defaulted to ${fallback}`);
    return fallback;
  }
  throw new VoiceTradeParseError('MISSING_FIELD', `${label} is required`);
}

export function parseVoiceTradeDraft(
  transcript: string,
  defaults: VoiceTradeDefaults = {},
): VoiceTradeDraft {
  const clean = compactTranscript(transcript);
  if (!clean) throw new VoiceTradeParseError('EMPTY_TRANSCRIPT', 'Transcript is required');

  const text = clean.toLowerCase();
  const assumptions: string[] = [];

  const symbol = parseSymbol(text);
  const side = parseSide(text);
  const entry = findNumber(text, [
    /\b(?:at|entry|price|around)\s+(\d+(?:\.\d+)?)/,
    /\b(?:long|short|buy|sell)\s+(?:at\s+)?(\d+(?:\.\d+)?)/,
  ]);
  if (entry === undefined) throw new VoiceTradeParseError('MISSING_ENTRY', 'Say an entry price');

  const stopPoints = findNumber(text, [
    /\b(\d+(?:\.\d+)?)\s*(?:point|points|pt|pts)\s+(?:stop|sl)\b/,
    /\b(?:stop|sl)\s+(?:is\s+|at\s+|of\s+)?(\d+(?:\.\d+)?)\s*(?:point|points|pt|pts)?\b/,
  ]);
  if (stopPoints === undefined) {
    throw new VoiceTradeParseError('MISSING_STOP', 'Say a stop distance in points');
  }

  const rrRatio = withDefault(
    findNumber(text, [
      /\b(\d+(?:\.\d+)?)\s*(?:r|rr|r:r)\b/,
      /\b(?:rr|risk reward|reward risk)\s+(?:of\s+)?(\d+(?:\.\d+)?)/,
    ]),
    defaults.rrRatio,
    'R:R',
    assumptions,
  );

  const accountSize = withDefault(
    findNumber(text, [
      /\b(?:account|balance)\s+(?:size\s+)?(?:is\s+)?(\d+(?:\.\d+)?)/,
      /\b(\d+(?:\.\d+)?)\s+dollar\s+account\b/,
    ]),
    defaults.accountSize,
    'account size',
    assumptions,
  );

  const riskDollars = withDefault(
    findNumber(text, [
      /\b(?:risk|risking)\s+(\d+(?:\.\d+)?)(?:\s+dollars?)?\b/,
      /\b(\d+(?:\.\d+)?)\s+dollars?\s+(?:risk|risking)\b/,
    ]),
    defaults.riskDollars,
    'risk dollars',
    assumptions,
  );

  const dailyLossDollars = findNumber(text, [
    /\b(?:daily loss|today'?s loss|down today)\s+(?:is\s+)?(\d+(?:\.\d+)?)/,
    /\bdown\s+(\d+(?:\.\d+)?)\s+(?:today|on the day)\b/,
  ]);

  return {
    transcript: clean,
    assumptions,
    input: {
      symbol,
      side,
      entry,
      stopPoints,
      rrRatio,
      accountSize,
      riskDollars,
      dailyLossDollars,
      maxDailyLossPct: dailyLossDollars === undefined ? undefined : 2,
      submittedBy: 'nova-voice',
    },
  };
}

