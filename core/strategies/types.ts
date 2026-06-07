// Lightweight strategy types/errors/defaults with no database side effects.

export type PropFirmTemplate = 'apex' | 'topstep' | 'bulenox' | 'custom';

export interface PropFirmDefaults {
  maxDailyDrawdown: number;
  maxPositionSize: number;
  allowedInstruments: string[];
  defaultRR: number;
}

export const PROP_FIRM_TEMPLATES: Record<PropFirmTemplate, PropFirmDefaults> = {
  apex: {
    maxDailyDrawdown: 2.0,
    maxPositionSize: 10,
    allowedInstruments: ['ES', 'NQ', 'MES', 'MNQ'],
    defaultRR: 2.0,
  },
  topstep: {
    maxDailyDrawdown: 2.0,
    maxPositionSize: 5,
    allowedInstruments: ['ES', 'NQ', 'MES', 'MNQ'],
    defaultRR: 2.0,
  },
  bulenox: {
    maxDailyDrawdown: 1.5,
    maxPositionSize: 5,
    allowedInstruments: ['ES', 'NQ', 'MES', 'MNQ'],
    defaultRR: 2.0,
  },
  custom: {
    maxDailyDrawdown: 2.0,
    maxPositionSize: 10,
    allowedInstruments: ['ES', 'NQ', 'MES', 'MNQ'],
    defaultRR: 2.0,
  },
};

export function getPropFirmDefaults(template: PropFirmTemplate): PropFirmDefaults {
  const defaults = PROP_FIRM_TEMPLATES[template];
  if (!defaults) {
    throw new StrategyError('INVALID_TEMPLATE', `prop-firm template '${template}' is not valid. Allowed: ${Object.keys(PROP_FIRM_TEMPLATES).join(', ')}`);
  }
  return defaults;
}

export type StrategyStatus = 'active' | 'archived';

export interface Strategy {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | undefined;
  propFirmTemplate: PropFirmTemplate;
  maxDailyDrawdown: number;
  maxPositionSize: number;
  allowedInstruments: string[];
  defaultRR: number;
  status: StrategyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyRiskContext {
  strategyId: string;
  strategyName: string;
  propFirmTemplate: PropFirmTemplate;
  maxDailyDrawdown: number;
  maxPositionSize: number;
  allowedInstruments: string[];
  defaultRR: number;
}

export interface CreateStrategyInput {
  workspaceId: string;
  name: string;
  description?: string;
  propFirmTemplate?: PropFirmTemplate;
  maxDailyDrawdown?: number;
  maxPositionSize?: number;
  allowedInstruments?: string[];
  defaultRR?: number;
}

export interface UpdateStrategyInput {
  name?: string;
  description?: string;
  propFirmTemplate?: PropFirmTemplate;
  maxDailyDrawdown?: number;
  maxPositionSize?: number;
  allowedInstruments?: string[];
  defaultRR?: number;
}

export class StrategyError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`[strategies] ${message}`);
    this.name = 'StrategyError';
    this.code = code;
  }
}
