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
  const session = clean(input.sessionId);

  if (app) highlights.push({ label: 'activeApp', value: app });
  if (title) highlights.push({ label: 'activeWindowTitle', value: title });
  if (session) highlights.push({ label: 'sessionId', value: session });
  if (input.screenshotBase64) highlights.push({ label: 'screenshot', value: 'received' });
  return highlights;
}

export function answerNovaQuery(input: NovaQueryInput): NovaQueryResult {
  const transcript = clean(input.transcript);
  if (!transcript) throw new Error('transcript is required');

  const app = clean(input.activeApp);
  const title = clean(input.activeWindowTitle);
  const location = [app, title].filter(Boolean).join(' / ');
  const contextLine = location ? ` I can see context from ${location}.` : '';
  const answer = `Nova received the request and will keep this in review mode.${contextLine} No executable action was produced.`;

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
