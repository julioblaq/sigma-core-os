export type NovaMode = 'tutor' | 'draft' | 'risk_coach' | 'journal';
export type NovaIntentType = 'explain' | 'draft_trade' | 'risk_review' | 'journal_capture' | 'none';
export type NovaRiskState = 'read_only' | 'approval_only' | 'warning' | 'blocked';
export type NovaExecutionState = 'read_only' | 'approval_required' | 'blocked';
export type NovaConfidence = 'low' | 'medium' | 'high';

export interface NovaHighlightSafety {
  avoidCriticalControls: true;
  blocksInteraction: false;
  maxHighlights: number;
  fadeMs: number;
}

export interface NovaStatusModel {
  mode: NovaMode;
  intentType: NovaIntentType;
  riskState: NovaRiskState;
  executionState: NovaExecutionState;
  confidence: NovaConfidence;
  reason: string;
  expiresAt: string;
  highlightSafety: NovaHighlightSafety;
}

export function novaExpiresAt(durationMs = 5200): string {
  return new Date(Date.now() + durationMs).toISOString();
}

export function novaHighlightSafety(fadeMs = 5200, maxHighlights = 2): NovaHighlightSafety {
  return {
    avoidCriticalControls: true,
    blocksInteraction: false,
    maxHighlights,
    fadeMs,
  };
}

export function novaStatus(input: Omit<NovaStatusModel, 'expiresAt' | 'highlightSafety'> & {
  expiresInMs?: number;
  maxHighlights?: number;
}): NovaStatusModel {
  const fadeMs = input.expiresInMs ?? 5200;
  return {
    mode: input.mode,
    intentType: input.intentType,
    riskState: input.riskState,
    executionState: input.executionState,
    confidence: input.confidence,
    reason: input.reason,
    expiresAt: novaExpiresAt(fadeMs),
    highlightSafety: novaHighlightSafety(fadeMs, input.maxHighlights ?? 2),
  };
}
