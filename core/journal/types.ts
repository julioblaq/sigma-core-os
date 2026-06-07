// Lightweight journal types/errors with no database side effects.

export type JournalSide = 'long' | 'short';
export type JournalOutcome = 'open' | 'win' | 'loss' | 'scratch';

export interface JournalEntry {
  id: string;
  workspaceId: string;
  strategyId: string | undefined;
  symbol: string;
  side: JournalSide;
  entryPrice: number;
  exitPrice: number | undefined;
  contracts: number;
  pnlDollars: number | undefined;
  outcome: JournalOutcome;
  notes: string | undefined;
  tags: string[];
  openedAt: string;
  closedAt: string | undefined;
}

export interface JournalSummary {
  workspaceId: string;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number;
  totalPnl: number;
  averagePnl: number;
}

export interface CreateJournalEntryInput {
  workspaceId: string;
  strategyId?: string;
  symbol: string;
  side: JournalSide;
  entryPrice: number;
  contracts: number;
  notes?: string;
  tags?: string[];
  openedAt?: string;
}

export interface CloseJournalEntryInput {
  exitPrice: number;
  pnlDollars: number;
  outcome: Exclude<JournalOutcome, 'open'>;
  notes?: string;
  closedAt?: string;
}

export class JournalError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`[journal] ${message}`);
    this.name = 'JournalError';
    this.code = code;
  }
}
