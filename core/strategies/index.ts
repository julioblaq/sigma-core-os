// core/strategies/index.ts
// Slice 7b (v0.7.0): Strategy Profiles.
// Strategies belong to a workspace and feed the Risk Engine directly.
//
// Prop-firm templates: apex, topstep, bulenox, custom
// Strategy rules:
// - workspaceId required
// - slug unique within workspace
// - no hard delete (archive only)
// - archived strategy cannot be used for new trade plans
// - invalid template rejected
// - role enforcement happens in the API layer (server-side only)

import { randomUUID } from 'crypto';
import { db } from '../db.js';

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

export function migrateStrategies(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      propFirmTemplate TEXT NOT NULL DEFAULT 'custom',
      maxDailyDrawdown REAL NOT NULL,
      maxPositionSize INTEGER NOT NULL,
      allowedInstruments TEXT NOT NULL,
      defaultRR REAL NOT NULL DEFAULT 2.0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(workspaceId, slug)
    );
  `);
}

// Run migration on import
migrateStrategies();

// ---------------------------------------------------------------------------
// Prop-firm templates
// ---------------------------------------------------------------------------

export type PropFirmTemplate = 'apex' | 'topstep' | 'bulenox' | 'custom';

export interface PropFirmDefaults {
  maxDailyDrawdown: number;
  maxPositionSize: number;
  allowedInstruments: string[];
  defaultRR: number;
}

export const PROP_FIRM_TEMPLATES: Record<PropFirmTemplate, PropFirmDefaults> = {
  apex: {
    maxDailyDrawdown: 2.0,    // 2% daily drawdown limit
    maxPositionSize: 10,       // 10 contracts max
    allowedInstruments: ['ES', 'NQ', 'MES', 'MNQ'],
    defaultRR: 2.0,
  },
  topstep: {
    maxDailyDrawdown: 2.0,    // 2% daily loss limit
    maxPositionSize: 5,        // 5 contracts max
    allowedInstruments: ['ES', 'NQ', 'MES', 'MNQ'],
    defaultRR: 2.0,
  },
  bulenox: {
    maxDailyDrawdown: 1.5,    // 1.5% daily drawdown
    maxPositionSize: 5,        // 5 contracts max
    allowedInstruments: ['ES', 'NQ', 'MES', 'MNQ'],
    defaultRR: 2.0,
  },
  custom: {
    maxDailyDrawdown: 2.0,    // Default 2%
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// What the Risk Engine pulls from a strategy
export interface StrategyRiskContext {
  strategyId: string;
  strategyName: string;
  propFirmTemplate: PropFirmTemplate;
  maxDailyDrawdown: number;
  maxPositionSize: number;
  allowedInstruments: string[];
  defaultRR: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StrategyError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`[strategies] ${message}`);
    this.name = 'StrategyError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/, '');
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function orStr(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function orNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function rowToStrategy(row: Record<string, unknown>): Strategy {
  const instruments = orStr(row['allowedInstruments']);
  return {
    id: orStr(row['id']),
    workspaceId: orStr(row['workspaceId']),
    name: orStr(row['name']),
    slug: orStr(row['slug']),
    description: row['description'] != null ? orStr(row['description']) : undefined,
    propFirmTemplate: orStr(row['propFirmTemplate']) as PropFirmTemplate,
    maxDailyDrawdown: orNum(row['maxDailyDrawdown'], 2.0),
    maxPositionSize: orNum(row['maxPositionSize'], 10),
    allowedInstruments: instruments ? instruments.split(',') : ['ES', 'NQ', 'MES', 'MNQ'],
    defaultRR: orNum(row['defaultRR'], 2.0),
    status: orStr(row['status']) as StrategyStatus,
    createdAt: orStr(row['createdAt']),
    updatedAt: orStr(row['updatedAt']),
  };
}

// ---------------------------------------------------------------------------
// createStrategy
// ---------------------------------------------------------------------------

export interface CreateStrategyInput {
  workspaceId: string;
  name: string;
  description?: string;
  propFirmTemplate?: PropFirmTemplate;
  // Override template defaults if provided:
  maxDailyDrawdown?: number;
  maxPositionSize?: number;
  allowedInstruments?: string[];
  defaultRR?: number;
}

export function createStrategy(input: CreateStrategyInput): Strategy {
  if (!input.workspaceId || input.workspaceId.trim().length === 0) {
    throw new StrategyError('INVALID_WORKSPACE', 'workspaceId is required');
  }
  if (!input.name || input.name.trim().length === 0) {
    throw new StrategyError('INVALID_NAME', 'strategy name is required');
  }

  const template = input.propFirmTemplate ?? 'custom';

  // Validate template
  const validTemplates: PropFirmTemplate[] = ['apex', 'topstep', 'bulenox', 'custom'];
  if (!validTemplates.includes(template)) {
    throw new StrategyError('INVALID_TEMPLATE', `prop-firm template '${template}' is not valid. Allowed: ${validTemplates.join(', ')}`);
  }

  // Load template defaults, then apply overrides
  const defaults = PROP_FIRM_TEMPLATES[template];
  const maxDailyDrawdown = input.maxDailyDrawdown ?? defaults.maxDailyDrawdown;
  const maxPositionSize = input.maxPositionSize ?? defaults.maxPositionSize;
  const allowedInstruments = input.allowedInstruments ?? defaults.allowedInstruments;
  const defaultRR = input.defaultRR ?? defaults.defaultRR;

  if (maxDailyDrawdown <= 0 || maxDailyDrawdown > 100) {
    throw new StrategyError('INVALID_DRAWDOWN', 'maxDailyDrawdown must be between 0 and 100');
  }
  if (maxPositionSize <= 0) {
    throw new StrategyError('INVALID_POSITION_SIZE', 'maxPositionSize must be > 0');
  }
  if (!allowedInstruments || allowedInstruments.length === 0) {
    throw new StrategyError('INVALID_INSTRUMENTS', 'allowedInstruments must not be empty');
  }
  if (defaultRR <= 0) {
    throw new StrategyError('INVALID_RR', 'defaultRR must be > 0');
  }

  const slug = toSlug(input.name);
  if (!slug) {
    throw new StrategyError('INVALID_NAME', 'strategy name produced an empty slug');
  }

  // Slug must be unique within the workspace
  const existing = db.get(
    'SELECT id FROM strategies WHERE workspaceId = :wid AND slug = :slug',
    { ':wid': input.workspaceId, ':slug': slug },
  );
  if (existing) {
    throw new StrategyError('SLUG_TAKEN', `strategy slug '${slug}' already exists in this workspace`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const instrumentsStr = allowedInstruments.join(',');

  db.run(
    `INSERT INTO strategies
       (id, workspaceId, name, slug, description, propFirmTemplate,
        maxDailyDrawdown, maxPositionSize, allowedInstruments, defaultRR,
        status, createdAt, updatedAt)
     VALUES (:id, :wid, :name, :slug, :desc, :tpl, :dd, :ps, :inst, :rr, 'active', :now, :now)`,
    {
      ':id': id, ':wid': input.workspaceId, ':name': input.name.trim(),
      ':slug': slug, ':desc': input.description ?? null, ':tpl': template,
      ':dd': maxDailyDrawdown, ':ps': maxPositionSize,
      ':inst': instrumentsStr, ':rr': defaultRR, ':now': now,
    },
  );

  return rowToStrategy(db.get('SELECT * FROM strategies WHERE id = :id', { ':id': id })!);
}

// ---------------------------------------------------------------------------
// getStrategy
// ---------------------------------------------------------------------------

export function getStrategy(id: string): Strategy | undefined {
  const row = db.get('SELECT * FROM strategies WHERE id = :id', { ':id': id });
  return row ? rowToStrategy(row) : undefined;
}

// ---------------------------------------------------------------------------
// listStrategies — by workspaceId, active only by default
// ---------------------------------------------------------------------------

export function listStrategies(workspaceId: string, includeArchived = false): Strategy[] {
  const rows = includeArchived
    ? db.all(
        'SELECT * FROM strategies WHERE workspaceId = :wid ORDER BY createdAt ASC',
        { ':wid': workspaceId },
      )
    : db.all(
        'SELECT * FROM strategies WHERE workspaceId = :wid AND status = :st ORDER BY createdAt ASC',
        { ':wid': workspaceId, ':st': 'active' },
      );
  return rows.map(rowToStrategy);
}

// ---------------------------------------------------------------------------
// updateStrategy — partial update of mutable fields
// ---------------------------------------------------------------------------

export interface UpdateStrategyInput {
  name?: string;
  description?: string;
  propFirmTemplate?: PropFirmTemplate;
  maxDailyDrawdown?: number;
  maxPositionSize?: number;
  allowedInstruments?: string[];
  defaultRR?: number;
}

export function updateStrategy(id: string, input: UpdateStrategyInput): Strategy {
  const existing = getStrategy(id);
  if (!existing) {
    throw new StrategyError('STRATEGY_NOT_FOUND', `strategy '${id}' not found`);
  }
  if (existing.status === 'archived') {
    throw new StrategyError('STRATEGY_ARCHIVED', 'cannot update an archived strategy');
  }

  if (input.propFirmTemplate !== undefined) {
    const validTemplates: PropFirmTemplate[] = ['apex', 'topstep', 'bulenox', 'custom'];
    if (!validTemplates.includes(input.propFirmTemplate)) {
      throw new StrategyError('INVALID_TEMPLATE', `prop-firm template '${input.propFirmTemplate}' is not valid`);
    }
  }

  const name = input.name ?? existing.name;
  const description = input.description !== undefined ? input.description : existing.description;
  const propFirmTemplate = input.propFirmTemplate ?? existing.propFirmTemplate;
  const maxDailyDrawdown = input.maxDailyDrawdown ?? existing.maxDailyDrawdown;
  const maxPositionSize = input.maxPositionSize ?? existing.maxPositionSize;
  const allowedInstruments = input.allowedInstruments ?? existing.allowedInstruments;
  const defaultRR = input.defaultRR ?? existing.defaultRR;
  const slug = input.name ? toSlug(input.name) : existing.slug;
  const now = new Date().toISOString();

  if (input.name && slug !== existing.slug) {
    const dupe = db.get(
      'SELECT id FROM strategies WHERE workspaceId = :wid AND slug = :slug AND id != :id',
      { ':wid': existing.workspaceId, ':slug': slug, ':id': id },
    );
    if (dupe) {
      throw new StrategyError('SLUG_TAKEN', `strategy slug '${slug}' already exists in this workspace`);
    }
  }

  db.run(
    `UPDATE strategies SET
       name = :name, slug = :slug, description = :desc, propFirmTemplate = :tpl,
       maxDailyDrawdown = :dd, maxPositionSize = :ps, allowedInstruments = :inst,
       defaultRR = :rr, updatedAt = :now
     WHERE id = :id`,
    {
      ':name': name, ':slug': slug, ':desc': description ?? null, ':tpl': propFirmTemplate,
      ':dd': maxDailyDrawdown, ':ps': maxPositionSize,
      ':inst': allowedInstruments.join(','), ':rr': defaultRR,
      ':now': now, ':id': id,
    },
  );

  return rowToStrategy(db.get('SELECT * FROM strategies WHERE id = :id', { ':id': id })!);
}

// ---------------------------------------------------------------------------
// archiveStrategy — no hard delete
// ---------------------------------------------------------------------------

export function archiveStrategy(id: string): Strategy {
  const existing = getStrategy(id);
  if (!existing) {
    throw new StrategyError('STRATEGY_NOT_FOUND', `strategy '${id}' not found`);
  }
  if (existing.status === 'archived') {
    throw new StrategyError('ALREADY_ARCHIVED', 'strategy is already archived');
  }

  const now = new Date().toISOString();
  db.run(
    'UPDATE strategies SET status = :st, updatedAt = :now WHERE id = :id',
    { ':st': 'archived', ':now': now, ':id': id },
  );

  return rowToStrategy(db.get('SELECT * FROM strategies WHERE id = :id', { ':id': id })!);
}

// ---------------------------------------------------------------------------
// getStrategyRiskContext
// Used by the Risk Engine to load a strategy and apply its constraints.
// Throws if strategy not found or archived.
// ---------------------------------------------------------------------------

export function getStrategyRiskContext(strategyId: string): StrategyRiskContext {
  const strategy = getStrategy(strategyId);
  if (!strategy) {
    throw new StrategyError('STRATEGY_NOT_FOUND', `strategy '${strategyId}' not found`);
  }
  if (strategy.status === 'archived') {
    throw new StrategyError('STRATEGY_ARCHIVED', `strategy '${strategyId}' is archived and cannot be used for trade plans`);
  }

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    propFirmTemplate: strategy.propFirmTemplate,
    maxDailyDrawdown: strategy.maxDailyDrawdown,
    maxPositionSize: strategy.maxPositionSize,
    allowedInstruments: strategy.allowedInstruments,
    defaultRR: strategy.defaultRR,
  };
}
