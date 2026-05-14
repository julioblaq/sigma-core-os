// apps/api/server.ts
// Sigma Core OS - API server
//
// Routes:
//   POST /v1/task                  submit a task -> router -> agent
//   GET  /v1/approvals             list pending approvals
//   GET  /v1/approvals/history     list all resolved approvals
//   GET  /v1/approvals/:id         get one approval by id
//   POST /v1/approvals/:id         resolve an approval
//   GET  /v1/log                   outcome log (approved + denied)
//   GET  /v1/memory                all memory entries (optional ?namespace=)
//   GET  /health                   liveness check
//
// Slice 3a: added /v1/approvals/history and /v1/memory for dashboard

import Fastify from 'fastify';
import { randomUUID } from 'crypto';
import { route } from '../../core/router/index.js';
import { listPending, getApproval, resolveApproval, listAll } from '../../core/policies/index.js';
import { logOutcome, getLog } from '../../core/runtime/index.js';
import { memList } from '../../core/memory/index.js';

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT ?? 3001);

// CORS - allow dashboard on :3000
app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return reply.code(204).send();
});

// -- Health -------------------------------------------------------------------
app.get('/health', async () => ({ status: 'ok', service: 'sigma-core-os', version: '0.3.0' }));

// -- POST /v1/task ------------------------------------------------------------
app.post<{ Body: { type: string; payload: Record<string, unknown>; submittedBy?: string } }>(
  '/v1/task',
  {
    schema: {
      body: {
        type: 'object',
        required: ['type', 'payload'],
        properties: {
          type:        { type: 'string' },
          payload:     { type: 'object' },
          submittedBy: { type: 'string' },
        },
      },
    },
  },
  async (req, reply) => {
    const task = {
      id:          randomUUID(),
      type:        req.body.type,
      payload:     req.body.payload,
      submittedBy: req.body.submittedBy ?? 'api',
      createdAt:   new Date().toISOString(),
    };
    const result = await route(task);
    const statusCode = result.status === 'error' ? 400 : 202;
    return reply.code(statusCode).send(result);
  },
);

// -- GET /v1/approvals (pending) ----------------------------------------------
app.get('/v1/approvals', async () => listPending());

// -- GET /v1/approvals/history (all resolved) ---------------------------------
app.get('/v1/approvals/history', async () => listAll());

// -- GET /v1/approvals/:id ----------------------------------------------------
app.get<{ Params: { id: string } }>('/v1/approvals/:id', async (req, reply) => {
  const approval = getApproval(req.params.id);
  if (!approval) return reply.code(404).send({ error: 'not found' });
  return approval;
});

// -- POST /v1/approvals/:id ---------------------------------------------------
app.post<{
  Params: { id: string };
  Body: { approved: boolean; resolvedBy?: string; reason?: string };
}>(
  '/v1/approvals/:id',
  {
    schema: {
      body: {
        type: 'object',
        required: ['approved'],
        properties: {
          approved:   { type: 'boolean' },
          resolvedBy: { type: 'string' },
          reason:     { type: 'string' },
        },
      },
    },
  },
  async (req, reply) => {
    const { approved, resolvedBy = 'human', reason } = req.body;

    if (!approved && !reason) {
      return reply.code(400).send({ error: 'reason is required when denying an approval' });
    }

    const updated = resolveApproval(req.params.id, approved, resolvedBy, reason);
    if (!updated) {
      return reply.code(404).send({ error: 'approval not found or already resolved' });
    }

    const outcome = logOutcome(updated, updated.action);
    return reply.code(200).send({ approval: updated, outcome });
  },
);

// -- GET /v1/log --------------------------------------------------------------
app.get('/v1/log', async () => getLog());

// -- GET /v1/memory -----------------------------------------------------------
// Optional query: ?namespace=sigma-bot  (omit for all entries)
app.get<{ Querystring: { namespace?: string } }>('/v1/memory', async (req) => {
  const ns = req.query.namespace;
  if (ns) return memList(ns);
  // Return all known namespaces - agents write under their own names
  const namespaces = ['sigma-bot', 'sigma-dev'];
  const allEntries = namespaces.flatMap(n => memList(n));
  return allEntries;
});

// -- Start --------------------------------------------------------------------
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`sigma-core-os API listening on :${PORT}`);
});
