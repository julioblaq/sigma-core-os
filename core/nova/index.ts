import { createHash, randomUUID } from 'crypto';
import { memSet } from '../store/control.js';

export interface NovaQueryInput {
  sessionId?: string;
  transcript: string;
  screenshotBase64?: string;
  activeApp?: string;
  activeWindowTitle?: string;
  context?: Record<string, unknown>;
}

export interface NovaHighlight {
  label: string;
  value: string;
  target?: 'chart' | 'dom' | 'order-ticket' | 'risk-panel' | 'context';
  placement?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'side-panel';
  tone?: 'neutral' | 'info' | 'warning';
  priority?: number;
  durationMs?: number;
  avoidCriticalControls?: boolean;
  blocksInteraction?: false;
}

export interface NovaQueryResult {
  answer: string;
  voiceText: string;
  highlights: NovaHighlight[];
  intent: null;
}

export interface NovaJournalInput {
  sessionId?: string;
  transcript?: string;
  screenshotBase64?: string;
  screenshotPointer?: string;
  activeApp?: string;
  activeWindowTitle?: string;
  tags?: string[];
  notes?: string;
  context?: Record<string, unknown>;
}

export interface NovaJournalEntry {
  id: string;
  sessionId?: string;
  transcript?: string;
  screenshotPointer?: string;
  screenshotHash?: string;
  activeApp?: string;
  activeWindowTitle?: string;
  tags: string[];
  notes: string;
  context: Record<string, unknown>;
  createdAt: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function overlayHighlight(
  label: string,
  value: string,
  target: NovaHighlight['target'],
  placement: NovaHighlight['placement'],
  priority: number,
  tone: NovaHighlight['tone'] = 'info',
): NovaHighlight {
  return {
    label,
    value,
    target,
    placement,
    tone,
    priority,
    durationMs: 5200,
    avoidCriticalControls: true,
    blocksInteraction: false,
  };
}

function screenshotRef(input: { screenshotBase64?: string; screenshotPointer?: string }): { screenshotPointer?: string; screenshotHash?: string } {
  const pointer = clean(input.screenshotPointer);
  if (pointer) return { screenshotPointer: pointer };

  const base64 = clean(input.screenshotBase64);
  if (!base64) return {};

  const screenshotHash = createHash('sha256').update(base64).digest('hex');
  return {
    screenshotHash,
    screenshotPointer: `memory://nova-screenshot/${screenshotHash}`,
  };
}

function safeHighlights(input: NovaQueryInput): NovaHighlight[] {
  const highlights: NovaHighlight[] = [];
  const app = clean(input.activeApp);
  const title = clean(input.activeWindowTitle);
  const transcript = clean(input.transcript)?.toLowerCase() ?? '';

  if (/\b(dom|ladder|bid|bids|ask|asks|stacked|liquidity)\b/.test(transcript)) {
    highlights.push(overlayHighlight('DOM', 'Watch bid/ask stack', 'dom', 'side-panel', 1));
  }
  if (/\b(stop|sl|risk|ticket|order)\b/.test(transcript)) {
    highlights.push(overlayHighlight('Risk', 'Check stop and size', 'risk-panel', 'bottom-right', 1, 'warning'));
  }
  if (/\b(chart|setup|looking|screen|price|level)\b/.test(transcript) || /tradingview/i.test(`${app} ${title}`)) {
    highlights.push(overlayHighlight('Chart', 'Focus active price area', 'chart', 'top-left', highlights.length + 1));
  }
  if (highlights.length === 0 && (app || title)) {
    highlights.push(overlayHighlight('Context', [app, title].filter(Boolean).join(' / '), 'context', 'top-left', 1, 'neutral'));
  }
  if (input.screenshotBase64 && highlights.length < 2) {
    highlights.push(overlayHighlight('Screenshot', 'Screen captured', 'context', 'bottom-left', highlights.length + 1, 'neutral'));
  }

  return highlights.slice(0, 2);
}

function traderAnswer(input: NovaQueryInput): string {
  const transcript = clean(input.transcript)?.toLowerCase() ?? '';
  const app = clean(input.activeApp);
  const title = clean(input.activeWindowTitle);
  const location = [app, title].filter(Boolean).join(' / ');
  const prefix = location ? `${location}: ` : '';

  if (/\b(dom|ladder|bid|bids|ask|asks|stacked|liquidity)\b/.test(transcript)) {
    return `${prefix}Read-only. Focus the ladder first: stacked bids show demand, stacked asks show supply. No order action taken.`;
  }
  if (/\b(stop|sl|risk|ticket|order)\b/.test(transcript)) {
    return `${prefix}Read-only. Check the stop field, position size, and target before approval. No broker order sent.`;
  }
  if (/\b(journal|capture|save|tag)\b/.test(transcript)) {
    return `${prefix}Captured for review. I can tag the setup and keep the note, but execution stays off.`;
  }
  if (/\b(chart|setup|looking|screen|price|level)\b/.test(transcript)) {
    return `${prefix}Read-only. Start with trend, key level, then risk. I can explain the setup without touching orders.`;
  }

  return `${prefix}Read-only. I can explain the screen, risk, or journal the setup. No executable action was produced.`;
}

export function answerNovaQuery(input: NovaQueryInput): NovaQueryResult {
  const transcript = clean(input.transcript);
  if (!transcript) throw new Error('transcript is required');

  const answer = traderAnswer(input);

  return {
    answer,
    voiceText: answer,
    highlights: safeHighlights(input),
    intent: null,
  };
}

export async function createNovaJournalEntry(input: NovaJournalInput, writtenBy: string): Promise<NovaJournalEntry> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const screenshot = screenshotRef(input);
  const entry: NovaJournalEntry = {
    id,
    sessionId: clean(input.sessionId),
    transcript: clean(input.transcript),
    ...screenshot,
    activeApp: clean(input.activeApp),
    activeWindowTitle: clean(input.activeWindowTitle),
    tags: Array.isArray(input.tags) ? input.tags.map(tag => tag.trim()).filter(Boolean).slice(0, 20) : [],
    notes: clean(input.notes) ?? '',
    context: input.context && typeof input.context === 'object' ? input.context : {},
    createdAt,
  };

  await memSet('nova-journal', id, entry, writtenBy);
  return entry;
}
