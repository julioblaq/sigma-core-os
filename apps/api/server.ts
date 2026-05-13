/**
 * apps/api/server.ts
 * Sigma Core OS — API server
 *
 * Routes:
 *   POST   /v1/task                   submit a task → router → sigma-bot
 *   GET    /v1/approvals              list pending approvals
 *   GET    /v1/approvals/:id          get one approval by id
 *   POST   /v1/approvals/:id          resolve an approval {approved: bool, resolvedBy: string}
 *   GET    /v1/log                    outcome log
 *   GET    /health                    liveness check
 */

import Fastify from 'fastify';
import { randomUUID } from 'crypto';
import { route } from '../../core/router/index';
import { listPending, getApproval, resolveApproval } from '../../core/policies/index';
import { logOutcome, getLog } from '../../core/runtime/index';

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT ?? 3001);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', async () => ({ status: 'ok', service: 'sigma-core-os', version: '0.1.0' }));

// ── POST /v1/task ─────────────────────────────────────────────────────────────
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

// ── GET /v1/approvals ─────────────────────────────────────────────────────────
app.get('/v1/approvals', async () => listPending());

// ── GET /v1/approvals/:id ─────────────────────────────────────────────────────
app.get<{ Params: { id: string } }>('/v1/approvals/:id', async (req, reply) => {
   const approval = getApproval(req.params.id);
   if (!approval) return reply.code(404).send({ error: 'not found' });
   return approval;
});

// ── POST /v1/approvals/:id ────────────────────────────────────────────────────
app.post<{
   Params: { id: string };
   Body: { approved: boolean; resolvedBy?: string };
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
                      },
             },
      },
 },
   async (req, reply) => {
        const { approved, resolvedBy = 'human' } = req.body;
        const updated = resolveApproval(req.params.id, approved, resolvedBy);
        if (!updated) return reply.code(404).send({ error: 'approval not found or already resolved' });

     // Log final outcome to runtime
     const outcome = logOutcome(updated, updated.action);

     return reply.code(200).send({ approval: updated, outcome });
   },
 );

// ── GET /v1/log ───────────────────────────────────────────────────────────────
app.get('/v1/log', async () => getLog());

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
   if (err) { app.log.error(err); process.exit(1); }
   app.log.info(`sigma-core-os API listening on :${PORT}`);
});
