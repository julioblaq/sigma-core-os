// apps/api/server.ts
// Sigma Core OS - API server
//
// Routes:
// POST /v1/task
// GET /v1/approvals
// GET /v1/approvals/history
// GET /v1/approvals/:id
// POST /v1/approvals/:id
// GET /v1/log
// GET /v1/log/search
// GET /v1/memory
// POST /v1/risk/position-size
// POST /v1/risk/tp-sl
// POST /v1/risk/trade-plan
// GET /v1/risk/contracts
// POST /v1/workspaces
// GET /v1/workspaces/:id
// GET /v1/workspaces/:id/members
// POST /v1/workspaces/:id/members
// GET /v1/workspaces/:id/strategies
// POST /v1/workspaces/:id/strategies
// GET /v1/strategies/:id
// PATCH /v1/strategies/:id
// DELETE /v1/strategies/:id
// GET /v1/workspaces/:id/journal
// POST /v1/workspaces/:id/journal
// GET /v1/journal/:id
// POST /v1/journal/:id/close
// GET /v1/workspaces/:id/journal/summary
// GET /health
//
// v0.7.0d: added GET /v1/log/search — audit search

import Fastify from 'fastify';
import { randomUUID } from 'crypto';
import { route } from '../../core/router/index.js';
import { listPending, getApproval, resolveApproval, listAll, requestApproval } from '../../core/policies/index.js';
import { logOutcome, getLog, searchLog } from '../../core/runtime/index.js';
import { memList } from '../../core/memory/index.js';
import {
  calcPositionSize,
  calcTPSL,
  generateTradePlan,
  listContracts,
  RiskError,
  type TradePlanInput,
} from '../../core/risk/index.js';
import {
  createWorkspace,
  getWorkspace,
  addMember,
  getMembers,
  getMember,
  canApprove,
  canManageMembers,
  OperatorError,
  type WorkspaceRole,
} from '../../core/operators/index.js';
import {
  createStrategy,
  getStrategy,
  listStrategies,
  updateStrategy,
  archiveStrategy,
  getStrategyRiskContext,
  StrategyError,
  type PropFirmTemplate,
} from '../../core/strategies/index.js';
import {
  createJournalEntry,
  getJournalEntry,
  listJournalEntries,
  closeJournalEntry,
  getJournalSummary,
  JournalError,
  type JournalSide,
  type JournalOutcome,
} from '../../core/journal/index.js';

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT ?? 3001);

app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type,x-user-id,x-workspace-id');
  if (req.method === 'OPTIONS') return reply.code(204).send();
});

function getUserId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const h = req.headers['x-user-id'];
  return (Array.isArray(h) ? h[0] : h) ?? 'anonymous';
}

app.get('/health', async () => ({ status: 'ok', service: 'sigma-core-os', version: '0.7.0' }));

app.post<{ Body: { type: string; payload: Record<string, unknown>; submittedBy?: string } }>(
  '/v1/task',
  { schema: { body: { type: 'object', required: ['type', 'payload'],
    properties: { type: { type: 'string' }, payload: { type: 'object' }, submittedBy: { type: 'string' } } } } },
  async (req, reply) => {
    const task = {
      id: randomUUID(), type: req.body.type, payload: req.body.payload,
      submittedBy: req.body.submittedBy ?? 'api', createdAt: new Date().toISOString(),
    };
    const result = await route(task);
    return reply.code(result.status === 'error' ? 400 : 202).send(result);
  },
);

app.get('/v1/approvals', async () => listPending());
app.get('/v1/approvals/history', async () => listAll());

app.get<{ Params: { id: string } }>('/v1/approvals/:id', async (req, reply) => {
  const approval = getApproval(req.params.id);
  if (!approval) return reply.code(404).send({ error: 'not found' });
  return approval;
});

app.post<{
  Params: { id: string };
  Body: { approved: boolean; resolvedBy?: string; reason?: string };
}>(
  '/v1/approvals/:id',
  { schema: { body: { type: 'object', required: ['approved'],
    properties: { approved: { type: 'boolean' }, resolvedBy: { type: 'string' }, reason: { type: 'string' } } } } },
  async (req, reply) => {
    const { approved, reason } = req.body;
    const userId = getUserId(req as Parameters<typeof getUserId>[0]);
    const resolvedBy = req.body.resolvedBy ?? userId;

    const workspaceId = req.headers['x-workspace-id'];
    if (workspaceId && typeof workspaceId === 'string') {
      const ws = getWorkspace(workspaceId);
      if (!ws) return reply.code(404).send({ error: 'workspace not found' });
      const member = getMember(workspaceId, userId);
      if (!member) return reply.code(403).send({ error: 'not a member of this workspace' });
      if (!canApprove(member.role)) {
        return reply.code(403).send({ error: `role '${member.role}' cannot approve or deny actions` });
      }
    }

    if (!approved && !reason) {
      return reply.code(400).send({ error: 'reason is required when denying an approval' });
    }
    const updated = resolveApproval(req.params.id, approved, resolvedBy, reason);
    if (!updated) return reply.code(404).send({ error: 'approval not found or already resolved' });
    const outcome = logOutcome(updated, updated.action);
    return reply.code(200).send({ approval: updated, outcome });
  },
);

app.get('/v1/log', async () => getLog());

// GET /v1/log/search — audit log search (read-only)
// Query params: agent, action, status, from, to, limit
app.get<{ Querystring: {
  agent?: string; action?: string; status?: string;
  from?: string; to?: string; limit?: string;
} }>(
  '/v1/log/search',
  async (req) => {
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 500) : 100;
    return searchLog({
      agent: req.query.agent,
      action: req.query.action,
      status: req.query.status as 'approved' | 'denied' | undefined,
      from: req.query.from,
      to: req.query.to,
      limit,
    });
  },
);

app.get<{ Querystring: { namespace?: string } }>('/v1/memory', async (req) => {
  const ns = req.query.namespace;
  if (ns) return memList(ns);
  const namespaces = ['sigma-bot', 'sigma-dev', 'sigma-risk'];
  return namespaces.flatMap(n => memList(n));
});

// ---------------------------------------------------------------------------
// Risk Engine
// ---------------------------------------------------------------------------

app.get('/v1/risk/contracts', async () => listContracts());

app.post<{ Body: {
  symbol: string; accountSize: number; riskDollars: number; stopPoints: number;
  strategyId?: string;
} }>(
  '/v1/risk/position-size',
  { schema: { body: { type: 'object', required: ['symbol', 'accountSize', 'riskDollars', 'stopPoints'],
    properties: {
      symbol: { type: 'string' }, accountSize: { type: 'number' },
      riskDollars: { type: 'number' }, stopPoints: { type: 'number' },
      strategyId: { type: 'string' },
    } } } },
  async (req, reply) => {
    try {
      const { strategyId, ...sizeInput } = req.body;
      const result = calcPositionSize(sizeInput);
      if (strategyId) {
        const ctx = getStrategyRiskContext(strategyId);
        const warnings = [...result.warnings];
        if (!ctx.allowedInstruments.includes(sizeInput.symbol.toUpperCase())) {
          return reply.code(400).send({ error: `instrument '${sizeInput.symbol}' is not allowed by strategy '${ctx.strategyName}'`, code: 'INSTRUMENT_NOT_ALLOWED' });
        }
        if (result.contracts > ctx.maxPositionSize) {
          warnings.push(`contracts (${result.contracts}) exceeds strategy max position size (${ctx.maxPositionSize}) — capped`);
          return reply.code(200).send({ ...result, contracts: ctx.maxPositionSize, warnings, strategyContext: ctx });
        }
        return reply.code(200).send({ ...result, warnings, strategyContext: ctx });
      }
      return result;
    } catch (err) {
      if (err instanceof RiskError) return reply.code(400).send({ error: err.message, code: err.code });
      if (err instanceof StrategyError) return reply.code(err.code === 'STRATEGY_NOT_FOUND' ? 404 : 400).send({ error: err.message, code: err.code });
      throw err;
    }
  },
);

app.post<{ Body: {
  symbol: string; entry: number; stop: number; rr?: number; side: 'long' | 'short';
  strategyId?: string;
} }>(
  '/v1/risk/tp-sl',
  { schema: { body: { type: 'object', required: ['symbol', 'entry', 'stop', 'side'],
    properties: {
      symbol: { type: 'string' }, entry: { type: 'number' },
      stop: { type: 'number' }, rr: { type: 'number' }, side: { type: 'string' },
      strategyId: { type: 'string' },
    } } } },
  async (req, reply) => {
    try {
      const { strategyId, rr: rrOverride, ...tpslBase } = req.body;
      let rr = rrOverride;
      let strategyContext: ReturnType<typeof getStrategyRiskContext> | undefined;
      if (strategyId) {
        strategyContext = getStrategyRiskContext(strategyId);
        if (!strategyContext.allowedInstruments.includes(tpslBase.symbol.toUpperCase())) {
          return reply.code(400).send({ error: `instrument '${tpslBase.symbol}' is not allowed by strategy '${strategyContext.strategyName}'`, code: 'INSTRUMENT_NOT_ALLOWED' });
        }
        if (rr === undefined) rr = strategyContext.defaultRR;
      }
      if (rr === undefined) {
        return reply.code(400).send({ error: 'rr is required when no strategyId is provided', code: 'INVALID_RR' });
      }
      const result = calcTPSL({ ...tpslBase, rr });
      return strategyContext ? { ...result, strategyContext } : result;
    } catch (err) {
      if (err instanceof RiskError) return reply.code(400).send({ error: err.message, code: err.code });
      if (err instanceof StrategyError) return reply.code(err.code === 'STRATEGY_NOT_FOUND' ? 404 : 400).send({ error: err.message, code: err.code });
      throw err;
    }
  },
);

app.post<{ Body: {
  symbol: string; side: 'long' | 'short'; entry: number; stopPoints: number;
  rrRatio?: number; accountSize: number; riskDollars: number;
  dailyLossDollars?: number; maxDailyLossPct?: number;
  propStartBalance?: number; propMaxDrawdownPct?: number;
  strategyId?: string; submittedBy?: string;
} }>(
  '/v1/risk/trade-plan',
  { schema: { body: { type: 'object',
    required: ['symbol', 'side', 'entry', 'stopPoints', 'accountSize', 'riskDollars'],
    properties: {
      symbol: { type: 'string' }, side: { type: 'string' }, entry: { type: 'number' },
      stopPoints: { type: 'number' }, rrRatio: { type: 'number' },
      accountSize: { type: 'number' }, riskDollars: { type: 'number' },
      dailyLossDollars: { type: 'number' }, maxDailyLossPct: { type: 'number' },
      propStartBalance: { type: 'number' }, propMaxDrawdownPct: { type: 'number' },
      strategyId: { type: 'string' }, submittedBy: { type: 'string' },
    } } } },
  async (req, reply) => {
    try {
      const { submittedBy = 'dashboard', strategyId, ...planBase } = req.body;
      let planInput: TradePlanInput = planBase as TradePlanInput;
      let strategyContext: ReturnType<typeof getStrategyRiskContext> | undefined;
      if (strategyId) {
        strategyContext = getStrategyRiskContext(strategyId);
        if (!strategyContext.allowedInstruments.includes(planBase.symbol.toUpperCase())) {
          return reply.code(400).send({ error: `instrument '${planBase.symbol}' is not allowed by strategy '${strategyContext.strategyName}'`, code: 'INSTRUMENT_NOT_ALLOWED' });
        }
        const rrRatio = planBase.rrRatio ?? strategyContext.defaultRR;
        const maxDailyLossPct = planBase.maxDailyLossPct ?? strategyContext.maxDailyDrawdown;
        const propMaxDrawdownPct = planBase.propMaxDrawdownPct ?? strategyContext.maxDailyDrawdown;
        planInput = { ...planBase, rrRatio, maxDailyLossPct, propMaxDrawdownPct: planBase.propStartBalance ? propMaxDrawdownPct : undefined };
      }
      if (!planInput.rrRatio) {
        return reply.code(400).send({ error: 'rrRatio is required when no strategyId is provided', code: 'INVALID_RR' });
      }
      const plan = generateTradePlan(planInput);
      if (strategyContext && plan.contracts > strategyContext.maxPositionSize) {
        plan.warnings.push(`contracts (${plan.contracts}) exceeds strategy max position size (${strategyContext.maxPositionSize}) — capped`);
        (plan as { contracts: number }).contracts = strategyContext.maxPositionSize;
      }
      if (plan.blocked) {
        return reply.code(422).send({ plan, queued: false, blockReasons: plan.blockReasons, strategyContext: strategyContext ?? null });
      }
      const approval = requestApproval(
        'sigma-risk', 'trade_plan',
        `Risk plan: ${plan.side.toUpperCase()} ${plan.contracts}x ${plan.symbol} @ ${plan.entry}`,
        { plan, taskId: randomUUID(), submittedBy, strategyId: strategyId ?? null },
      );
      return reply.code(202).send({ plan, queued: true, approvalId: approval.id, strategyContext: strategyContext ?? null });
    } catch (err) {
      if (err instanceof RiskError) return reply.code(400).send({ error: err.message, code: err.code });
      if (err instanceof StrategyError) return reply.code(err.code === 'STRATEGY_NOT_FOUND' ? 404 : 400).send({ error: err.message, code: err.code });
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Workspace endpoints
// ---------------------------------------------------------------------------

app.post<{ Body: { name: string } }>(
  '/v1/workspaces',
  { schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
  async (req, reply) => {
    try {
      const userId = getUserId(req as Parameters<typeof getUserId>[0]);
      const result = createWorkspace(req.body.name, userId);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof OperatorError) {
        return reply.code(err.code === 'SLUG_TAKEN' ? 409 : 400).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  },
);

app.get<{ Params: { id: string } }>('/v1/workspaces/:id', async (req, reply) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return reply.code(404).send({ error: 'workspace not found' });
  return ws;
});

app.get<{ Params: { id: string } }>('/v1/workspaces/:id/members', async (req, reply) => {
  try {
    return getMembers(req.params.id);
  } catch (err) {
    if (err instanceof OperatorError) return reply.code(404).send({ error: err.message, code: err.code });
    throw err;
  }
});

app.post<{ Params: { id: string }; Body: { userId: string; role: WorkspaceRole } }>(
  '/v1/workspaces/:id/members',
  { schema: { body: { type: 'object', required: ['userId', 'role'],
    properties: { userId: { type: 'string' }, role: { type: 'string' } } } } },
  async (req, reply) => {
    try {
      const requesterId = getUserId(req as Parameters<typeof getUserId>[0]);
      const ws = getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: 'workspace not found' });
      const requester = getMember(req.params.id, requesterId);
      if (!requester || !canManageMembers(requester.role)) {
        return reply.code(403).send({ error: 'only admins can manage workspace members' });
      }
      const member = addMember(req.params.id, req.body.userId, req.body.role);
      return reply.code(201).send(member);
    } catch (err) {
      if (err instanceof OperatorError) {
        const statusMap: Record<string, number> = {
          WORKSPACE_NOT_FOUND: 404, MEMBER_NOT_FOUND: 404,
          ALREADY_MEMBER: 409, INVALID_ROLE: 400, INVALID_USER: 400, LAST_ADMIN: 409,
        };
        return reply.code(statusMap[err.code] ?? 400).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Strategy endpoints
// ---------------------------------------------------------------------------

app.get<{ Params: { id: string }; Querystring: { includeArchived?: string } }>(
  '/v1/workspaces/:id/strategies',
  async (req, reply) => {
    try {
      const ws = getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: 'workspace not found' });
      return listStrategies(req.params.id, req.query.includeArchived === 'true');
    } catch (err) {
      if (err instanceof StrategyError) return reply.code(404).send({ error: err.message, code: err.code });
      throw err;
    }
  },
);

app.post<{ Params: { id: string }; Body: {
  name: string; description?: string; propFirmTemplate?: PropFirmTemplate;
  maxDailyDrawdown?: number; maxPositionSize?: number;
  allowedInstruments?: string[]; defaultRR?: number;
} }>(
  '/v1/workspaces/:id/strategies',
  { schema: { body: { type: 'object', required: ['name'],
    properties: {
      name: { type: 'string' }, description: { type: 'string' },
      propFirmTemplate: { type: 'string' }, maxDailyDrawdown: { type: 'number' },
      maxPositionSize: { type: 'number' },
      allowedInstruments: { type: 'array', items: { type: 'string' } },
      defaultRR: { type: 'number' },
    } } } },
  async (req, reply) => {
    try {
      const requesterId = getUserId(req as Parameters<typeof getUserId>[0]);
      const ws = getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: 'workspace not found' });
      const requester = getMember(req.params.id, requesterId);
      if (!requester || requester.role === 'viewer') {
        return reply.code(403).send({ error: 'viewers cannot create strategies' });
      }
      const strategy = createStrategy({ workspaceId: req.params.id, ...req.body });
      return reply.code(201).send(strategy);
    } catch (err) {
      if (err instanceof StrategyError) {
        const statusMap: Record<string, number> = { INVALID_TEMPLATE: 400, SLUG_TAKEN: 409, INVALID_NAME: 400 };
        return reply.code(statusMap[err.code] ?? 400).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  },
);

app.get<{ Params: { id: string } }>('/v1/strategies/:id', async (req, reply) => {
  const strategy = getStrategy(req.params.id);
  if (!strategy) return reply.code(404).send({ error: 'strategy not found' });
  return strategy;
});

app.patch<{ Params: { id: string }; Body: {
  name?: string; description?: string; propFirmTemplate?: PropFirmTemplate;
  maxDailyDrawdown?: number; maxPositionSize?: number;
  allowedInstruments?: string[]; defaultRR?: number;
} }>(
  '/v1/strategies/:id',
  { schema: { body: { type: 'object',
    properties: {
      name: { type: 'string' }, description: { type: 'string' },
      propFirmTemplate: { type: 'string' }, maxDailyDrawdown: { type: 'number' },
      maxPositionSize: { type: 'number' },
      allowedInstruments: { type: 'array', items: { type: 'string' } },
      defaultRR: { type: 'number' },
    } } } },
  async (req, reply) => {
    try {
      const requesterId = getUserId(req as Parameters<typeof getUserId>[0]);
      const strategy = getStrategy(req.params.id);
      if (!strategy) return reply.code(404).send({ error: 'strategy not found' });
      const requester = getMember(strategy.workspaceId, requesterId);
      if (!requester || requester.role === 'viewer') {
        return reply.code(403).send({ error: 'viewers cannot update strategies' });
      }
      return updateStrategy(req.params.id, req.body);
    } catch (err) {
      if (err instanceof StrategyError) {
        const statusMap: Record<string, number> = {
          STRATEGY_NOT_FOUND: 404, INVALID_TEMPLATE: 400, STRATEGY_ARCHIVED: 400, SLUG_TAKEN: 409,
        };
        return reply.code(statusMap[err.code] ?? 400).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  },
);

app.delete<{ Params: { id: string } }>('/v1/strategies/:id', async (req, reply) => {
  try {
    const requesterId = getUserId(req as Parameters<typeof getUserId>[0]);
    const strategy = getStrategy(req.params.id);
    if (!strategy) return reply.code(404).send({ error: 'strategy not found' });
    const requester = getMember(strategy.workspaceId, requesterId);
    if (!requester || !canManageMembers(requester.role)) {
      return reply.code(403).send({ error: 'only admins can archive strategies' });
    }
    return archiveStrategy(req.params.id);
  } catch (err) {
    if (err instanceof StrategyError) {
      const statusMap: Record<string, number> = { STRATEGY_NOT_FOUND: 404, ALREADY_ARCHIVED: 409 };
      return reply.code(statusMap[err.code] ?? 400).send({ error: err.message, code: err.code });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Journal endpoints (v0.7.0c)
// Role enforcement: all members can create/view journal entries
// Closing a trade requires approver or admin role
// ---------------------------------------------------------------------------

// GET /v1/workspaces/:id/journal — list entries, optional ?strategyId=
app.get<{ Params: { id: string }; Querystring: { strategyId?: string } }>(
  '/v1/workspaces/:id/journal',
  async (req, reply) => {
    try {
      const ws = getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: 'workspace not found' });
      return listJournalEntries(req.params.id, req.query.strategyId);
    } catch (err) {
      if (err instanceof JournalError) return reply.code(400).send({ error: err.message, code: err.code });
      throw err;
    }
  },
);

// POST /v1/workspaces/:id/journal — create entry (any member)
app.post<{ Params: { id: string }; Body: {
  symbol: string; side: JournalSide; entryPrice: number; contracts: number;
  strategyId?: string; notes?: string; tags?: string[]; openedAt?: string;
} }>(
  '/v1/workspaces/:id/journal',
  { schema: { body: { type: 'object', required: ['symbol', 'side', 'entryPrice', 'contracts'],
    properties: {
      symbol: { type: 'string' }, side: { type: 'string' },
      entryPrice: { type: 'number' }, contracts: { type: 'number' },
      strategyId: { type: 'string' }, notes: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } }, openedAt: { type: 'string' },
    } } } },
  async (req, reply) => {
    try {
      const requesterId = getUserId(req as Parameters<typeof getUserId>[0]);
      const ws = getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: 'workspace not found' });
      // Any workspace member can log a trade
      const requester = getMember(req.params.id, requesterId);
      if (!requester) return reply.code(403).send({ error: 'not a member of this workspace' });
      const entry = createJournalEntry({ workspaceId: req.params.id, ...req.body });
      return reply.code(201).send(entry);
    } catch (err) {
      if (err instanceof JournalError) {
        const statusMap: Record<string, number> = { INVALID_WORKSPACE: 404, INVALID_SYMBOL: 400, INVALID_SIDE: 400, INVALID_PRICE: 400, INVALID_CONTRACTS: 400 };
        return reply.code(statusMap[err.code] ?? 400).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  },
);

// GET /v1/journal/:id — get single entry
app.get<{ Params: { id: string } }>('/v1/journal/:id', async (req, reply) => {
  const entry = getJournalEntry(req.params.id);
  if (!entry) return reply.code(404).send({ error: 'journal entry not found' });
  return entry;
});

// POST /v1/journal/:id/close — close a trade (approver or admin)
app.post<{ Params: { id: string }; Body: {
  exitPrice: number; pnlDollars: number;
  outcome: Exclude<JournalOutcome, 'open'>;
  notes?: string; closedAt?: string;
} }>(
  '/v1/journal/:id/close',
  { schema: { body: { type: 'object', required: ['exitPrice', 'pnlDollars', 'outcome'],
    properties: {
      exitPrice: { type: 'number' }, pnlDollars: { type: 'number' },
      outcome: { type: 'string' }, notes: { type: 'string' }, closedAt: { type: 'string' },
    } } } },
  async (req, reply) => {
    try {
      const requesterId = getUserId(req as Parameters<typeof getUserId>[0]);
      const entry = getJournalEntry(req.params.id);
      if (!entry) return reply.code(404).send({ error: 'journal entry not found' });

      // Approver or admin required to close a trade
      const workspaceId = req.headers['x-workspace-id'];
      if (workspaceId && typeof workspaceId === 'string') {
        const member = getMember(workspaceId, requesterId);
        if (!member) return reply.code(403).send({ error: 'not a member of this workspace' });
        if (!canApprove(member.role)) {
          return reply.code(403).send({ error: `role '${member.role}' cannot close journal entries` });
        }
      }

      return closeJournalEntry(req.params.id, req.body);
    } catch (err) {
      if (err instanceof JournalError) {
        const statusMap: Record<string, number> = { ENTRY_NOT_FOUND: 404, ALREADY_CLOSED: 409, INVALID_PRICE: 400, INVALID_PNL: 400, INVALID_OUTCOME: 400 };
        return reply.code(statusMap[err.code] ?? 400).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  },
);

// GET /v1/workspaces/:id/journal/summary — aggregate stats
app.get<{ Params: { id: string }; Querystring: { strategyId?: string } }>(
  '/v1/workspaces/:id/journal/summary',
  async (req, reply) => {
    try {
      const ws = getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: 'workspace not found' });
      return getJournalSummary(req.params.id, req.query.strategyId);
    } catch (err) {
      if (err instanceof JournalError) return reply.code(400).send({ error: err.message, code: err.code });
      throw err;
    }
  },
);

// -- Start -------------------------------------------------------------------
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`sigma-core-os API listening on :${PORT}`);
});
