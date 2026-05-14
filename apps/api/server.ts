// apps/api/server.ts
// Sigma Core OS - API server
//
// Routes:
// POST /v1/task               submit a task -> router -> agent
// GET  /v1/approvals          list pending approvals
// GET  /v1/approvals/history  list all resolved approvals
// GET  /v1/approvals/:id      get one approval by id
// POST /v1/approvals/:id      resolve an approval (role-checked if workspaceId provided)
// GET  /v1/log                outcome log (approved + denied)
// GET  /v1/memory             all memory entries (optional ?namespace=)
// POST /v1/risk/position-size calculate position size
// POST /v1/risk/tp-sl         calculate TP/SL from entry, stop, R:R
// POST /v1/risk/trade-plan    generate full trade plan (approval-gated)
// GET  /v1/risk/contracts     list supported instrument specs
// POST /v1/workspaces         create workspace (createdBy from x-user-id header)
// GET  /v1/workspaces/:id     get workspace
// GET  /v1/workspaces/:id/members  list members
// POST /v1/workspaces/:id/members  add member (admin only)
// GET  /health                liveness check
//
// v0.5.0: added /v1/approvals/history and /v1/memory for dashboard
// v0.6.0: added /v1/risk/* endpoints for Sigma Risk Engine
// v0.7.0: added /v1/workspaces/* endpoints, role-checked approval resolution

import Fastify from 'fastify';
import { randomUUID } from 'crypto';
import { route } from '../../core/router/index.js';
import { listPending, getApproval, resolveApproval, listAll, requestApproval } from '../../core/policies/index.js';
import { logOutcome, getLog } from '../../core/runtime/index.js';
import { memList } from '../../core/memory/index.js';
import {
  calcPositionSize,
  calcTPSL,
  generateTradePlan,
  listContracts,
  RiskError,
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

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT ?? 3001);

// CORS - allow dashboard on :3000
app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type,x-user-id,x-workspace-id');
  if (req.method === 'OPTIONS') return reply.code(204).send();
});

// Helper: extract userId stub from header (no auth provider yet)
function getUserId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const h = req.headers['x-user-id'];
  return (Array.isArray(h) ? h[0] : h) ?? 'anonymous';
}

// -- Health ------------------------------------------------------------------
app.get('/health', async () => ({ status: 'ok', service: 'sigma-core-os', version: '0.7.0' }));

// -- POST /v1/task -----------------------------------------------------------
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

// -- GET /v1/approvals (pending) ---------------------------------------------
app.get('/v1/approvals', async () => listPending());

// -- GET /v1/approvals/history -----------------------------------------------
app.get('/v1/approvals/history', async () => listAll());

// -- GET /v1/approvals/:id ---------------------------------------------------
app.get<{ Params: { id: string } }>('/v1/approvals/:id', async (req, reply) => {
  const approval = getApproval(req.params.id);
  if (!approval) return reply.code(404).send({ error: 'not found' });
  return approval;
});

// -- POST /v1/approvals/:id --------------------------------------------------
// If x-workspace-id header provided, enforces workspace role:
// - viewer: cannot approve -> 403
// - approver: can approve/deny
// - admin: can approve/deny
// Without workspace header: legacy behavior (no role check)
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

    // Role enforcement when workspace context provided
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

// -- GET /v1/log -------------------------------------------------------------
app.get('/v1/log', async () => getLog());

// -- GET /v1/memory ----------------------------------------------------------
app.get<{ Querystring: { namespace?: string } }>('/v1/memory', async (req) => {
  const ns = req.query.namespace;
  if (ns) return memList(ns);
  const namespaces = ['sigma-bot', 'sigma-dev', 'sigma-risk'];
  return namespaces.flatMap(n => memList(n));
});

// ---------------------------------------------------------------------------
// Risk Engine endpoints (v0.6.0)
// ---------------------------------------------------------------------------

app.get('/v1/risk/contracts', async () => listContracts());

app.post<{ Body: { symbol: string; accountSize: number; riskDollars: number; stopPoints: number } }>(
  '/v1/risk/position-size',
  { schema: { body: { type: 'object', required: ['symbol', 'accountSize', 'riskDollars', 'stopPoints'],
    properties: { symbol: { type: 'string' }, accountSize: { type: 'number' },
      riskDollars: { type: 'number' }, stopPoints: { type: 'number' } } } } },
  async (req, reply) => {
    try { return calcPositionSize(req.body); }
    catch (err) {
      if (err instanceof RiskError) return reply.code(400).send({ error: err.message, code: err.code });
      throw err;
    }
  },
);

app.post<{ Body: { symbol: string; entry: number; stop: number; rr: number; side: 'long' | 'short' } }>(
  '/v1/risk/tp-sl',
  { schema: { body: { type: 'object', required: ['symbol', 'entry', 'stop', 'rr', 'side'],
    properties: { symbol: { type: 'string' }, entry: { type: 'number' },
      stop: { type: 'number' }, rr: { type: 'number' }, side: { type: 'string' } } } } },
  async (req, reply) => {
    try { return calcTPSL(req.body); }
    catch (err) {
      if (err instanceof RiskError) return reply.code(400).send({ error: err.message, code: err.code });
      throw err;
    }
  },
);

app.post<{ Body: {
  symbol: string; side: 'long' | 'short'; entry: number; stopPoints: number;
  rrRatio: number; accountSize: number; riskDollars: number;
  dailyLossDollars?: number; maxDailyLossPct?: number;
  propStartBalance?: number; propMaxDrawdownPct?: number;
  submittedBy?: string;
} }>(
  '/v1/risk/trade-plan',
  { schema: { body: { type: 'object',
    required: ['symbol', 'side', 'entry', 'stopPoints', 'rrRatio', 'accountSize', 'riskDollars'],
    properties: {
      symbol: { type: 'string' }, side: { type: 'string' }, entry: { type: 'number' },
      stopPoints: { type: 'number' }, rrRatio: { type: 'number' },
      accountSize: { type: 'number' }, riskDollars: { type: 'number' },
      dailyLossDollars: { type: 'number' }, maxDailyLossPct: { type: 'number' },
      propStartBalance: { type: 'number' }, propMaxDrawdownPct: { type: 'number' },
      submittedBy: { type: 'string' },
    } } } },
  async (req, reply) => {
    try {
      const { submittedBy = 'dashboard', ...planInput } = req.body;
      const plan = generateTradePlan(planInput);
      if (plan.blocked) {
        return reply.code(422).send({ plan, queued: false, blockReasons: plan.blockReasons });
      }
      const approval = requestApproval(
        'sigma-risk', 'trade_plan',
        `Risk plan: ${plan.side.toUpperCase()} ${plan.contracts}x ${plan.symbol} @ ${plan.entry}`,
        { plan, taskId: randomUUID(), submittedBy },
      );
      return reply.code(202).send({ plan, queued: true, approvalId: approval.id });
    } catch (err) {
      if (err instanceof RiskError) return reply.code(400).send({ error: err.message, code: err.code });
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Workspace endpoints (v0.7.0)
// userId comes from x-user-id header (stub, no OAuth yet)
// ---------------------------------------------------------------------------

// -- POST /v1/workspaces -----------------------------------------------------
app.post<{ Body: { name: string } }>(
  '/v1/workspaces',
  { schema: { body: { type: 'object', required: ['name'],
    properties: { name: { type: 'string' } } } } },
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

// -- GET /v1/workspaces/:id --------------------------------------------------
app.get<{ Params: { id: string } }>('/v1/workspaces/:id', async (req, reply) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return reply.code(404).send({ error: 'workspace not found' });
  return ws;
});

// -- GET /v1/workspaces/:id/members ------------------------------------------
app.get<{ Params: { id: string } }>('/v1/workspaces/:id/members', async (req, reply) => {
  try {
    return getMembers(req.params.id);
  } catch (err) {
    if (err instanceof OperatorError) {
      return reply.code(404).send({ error: err.message, code: err.code });
    }
    throw err;
  }
});

// -- POST /v1/workspaces/:id/members -----------------------------------------
// Admin-only: enforced via x-user-id header role check
app.post<{
  Params: { id: string };
  Body: { userId: string; role: WorkspaceRole };
}>(
  '/v1/workspaces/:id/members',
  { schema: { body: { type: 'object', required: ['userId', 'role'],
    properties: { userId: { type: 'string' }, role: { type: 'string' } } } } },
  async (req, reply) => {
    try {
      const requesterId = getUserId(req as Parameters<typeof getUserId>[0]);
      const ws = getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: 'workspace not found' });

      // Enforce admin-only
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

// -- Start -------------------------------------------------------------------
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`sigma-core-os API listening on :${PORT}`);
});
