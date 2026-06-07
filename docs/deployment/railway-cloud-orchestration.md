# Railway Cloud Orchestration

Owner: Jerry Hicks Jr.
Date: 2026-06-06
Status: Initial Railway cutover completed for Sigma API, dashboard, and secured Hermes API server.

## Goal

Use Codex as the main orchestration layer for moving cloud-safe Sigma Core OS and Hermes services to Railway.

The first cloud wave should maximize cloud migration without exposing local-only trading gateways.

## Codex Role

Codex is the primary operator for:

- Repository audits
- Deployment docs
- Dockerfile and Railway config maintenance
- Test and build verification
- Pull request preparation
- Railway deployment checklists
- Service health review
- Follow-up issue generation

Codex should not become an autonomous trading executor. Production changes, broker connectivity, and live-trading decisions still require human approval.

## Agent Role Boundaries

| Agent or service | Current role | Cloud role |
|---|---|---|
| Codex | Main engineering and migration operator | Orchestrates repo changes, docs, verification, and PRs. |
| Sigma Core API | Approval spine, task routing, memory, risk, auth, audit | Railway `sigma-api` service. |
| Sigma Dashboard | Human review and operational UI | Railway `sigma-dashboard` service. |
| Sigma Bot | Trade-plan proposal handler | Runs through Redis-backed `agent-worker` when `TASK_QUEUE_MODE=redis`; inline fallback remains for local development. |
| Sigma Dev | Docs/code artifact proposal handler | Runs through Redis-backed `agent-worker` when `TASK_QUEUE_MODE=redis`; inline fallback remains for local development. |
| Hermes default gateway | Local gateway process retained during stability window | Railway `hermes-agent` secured API server, reached through Sigma approval gates. |
| Hermes trading gateway | Trading-profile gateway | Local only until broker, OpenD, MFA, and LAN needs are proven safe. |
| Moomoo OpenD | Local broker gateway | Local only. Never expose publicly. |

## Railway Service Plan

### Wave 1: Move Now

- `sigma-api`
- `sigma-dashboard`

These services have Dockerfiles in:

- `deploy/railway/sigma-api.Dockerfile`
- `deploy/railway/sigma-dashboard.Dockerfile`

### Wave 2: Move After Hermes Audit

- `hermes-agent` default profile

Hermes has its own Dockerfile in the local Hermes package:

- `/Users/jerryhicksjr/.hermes/hermes-agent/Dockerfile`

Before deployment, confirm the default profile does not require local GUI sessions, local Docker socket access, browser state, OpenD, broker software, or private LAN services.

### Wave 3: Evaluate Later

- Dedicated worker process
- Redis queue integration against the managed Railway `Redis` service for `/v1/task`
- PostgreSQL migration against the managed Railway `Postgres` service
- Cloud-safe MCP servers
- Webhook receivers
- Trading middleware

## Railway Configuration

Railway project:

```text
Project: sigma-core-os
Project ID: 4337cbdb-9569-4b30-9cf1-3212fee26eed
Environment: production
```

Live services:

| Service | Status | Public URL |
|---|---|---|
| `sigma-api` | Deployed | `https://sigma-api-production-b005.up.railway.app` |
| `sigma-dashboard` | Deployed | `https://sigma-dashboard-production-a7a7.up.railway.app` |
| `hermes-agent` | Deployed | `https://hermes-agent-production-62ee.up.railway.app` |
| `agent-worker` | Redis worker Dockerfile ready | Deploy with `RAILWAY_DOCKERFILE_PATH=deploy/railway/agent-worker.Dockerfile` |
| `trading-middleware-cloud` | Service shell only | Not deployed |

Create separate Railway services from the same GitHub repository for Sigma:

| Service | Source | Dockerfile variable |
|---|---|---|
| `sigma-api` | Sigma Core OS repo root | `RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-api.Dockerfile` |
| `agent-worker` | Sigma Core OS repo root | `RAILWAY_DOCKERFILE_PATH=deploy/railway/agent-worker.Dockerfile` |
| `sigma-dashboard` | Sigma Core OS repo root | `RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-dashboard.Dockerfile` |

The original single-replica bridge attached a Railway volume to `sigma-api` at:

```text
/data
```

The current Postgres production deployment no longer needs this volume or `DB_PATH`. Keep the old volume only as a temporary rollback artifact while the Postgres deployment soaks.

The old persistent SQLite deployment used:

```text
DB_PATH=/data/sigma.db
SIGMA_SANDBOX_PATH=/data/sandbox
```

The API image now defaults to `SIGMA_CONTROL_STORE=postgres` and `SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox`. The entrypoint prepares the sandbox path, and only prepares a SQLite database directory when `DB_PATH` is explicitly set for a fallback deployment.

Managed Railway databases are provisioned:

| Service | Status | Notes |
|---|---:|---|
| `Postgres` | Online | Service ID `f80547fb-42aa-42c7-afa7-018044531379`, backed by `postgres-volume`. Seeded from live `/data/sigma.db` and backing the Sigma runtime store. |
| `Redis` | Online | Service ID `4107f338-a335-4547-a8d3-22e5e0c67669`, backed by `redis-volume`. Not yet used by Sigma code. |

The first migration layer is available as:

```text
npm run db:migrate:postgres
```

Safe sequence:

1. Run `npm run db:migrate:postgres -- --dry-run` against the source SQLite file.
2. Set `POSTGRES_MIGRATION_URL`, `DATABASE_PUBLIC_URL`, or `DATABASE_URL` outside git.
3. Run `npm run db:migrate:postgres` to create schema, copy rows, and verify counts.
4. Run `npm run db:migrate:postgres -- --verify-only` after any later copy.
5. Keep `SIGMA_CONTROL_STORE=postgres` and `DATABASE_URL` active in Railway production.

Production copy completed on 2026-06-06 from inside the Railway `sigma-api` console:

```text
source: /data/sigma.db
destination: managed Railway Postgres
approvals: 1 -> 1
outcome_log: 1 -> 1
all other current Sigma tables: 0 -> 0
verify-only pass: ok
```

Runtime Postgres support now exists for the Sigma control, identity, trading, and execution stores:

```text
SIGMA_CONTROL_STORE=postgres
DATABASE_URL=<Railway Postgres private/internal URL>
```

This switch moves these API and agent surfaces to Railway Postgres:

- users and session tokens
- workspace records and membership roles
- approvals and approval history
- Hermes approval dispatch lookup
- voice task draft approvals
- risk trade-plan approvals
- strategy profile reads/writes
- journal entry reads/writes
- performance analytics over closed journal entries
- paper order audit reads/writes
- sandbox write audit reads/writes
- Sigma Bot and Sigma Dev memory writes
- outcome log reads/searches/writes

SQLite fallback imports are now lazy-loaded behind the local/default store mode. With `SIGMA_CONTROL_STORE=postgres`, the cloud store facades load without opening the SQLite database. `DB_PATH` is no longer a production Railway requirement.


## Variables

### `sigma-api`

```text
PORT=3001
SIGMA_CONTROL_STORE=postgres
DATABASE_URL=<Railway Postgres private/internal URL>
REDIS_URL=<Railway Redis private/internal URL>
TASK_QUEUE_MODE=redis
TASK_QUEUE_NAME=sigma:tasks
SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox
DASHBOARD_ORIGIN=https://sigma-dashboard-production-a7a7.up.railway.app
LLM_MODELS=gpt-4o
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=<set in Railway>
LLM_TIMEOUT_MS=30000
VOICE_PROVIDER=openrouter
OPENROUTER_API_KEY=<set in Railway>
VOICE_STT_MODEL=microsoft/mai-transcribe-1.5
VOICE_TTS_MODEL=microsoft/mai-voice-2
VOICE_TTS_VOICE=en-US-Harper:MAI-Voice-2
VOICE_TTS_FORMAT=mp3
VOICE_TIMEOUT_MS=30000
HERMES_API_URL=https://hermes-agent-production-62ee.up.railway.app
HERMES_API_KEY=<set in Railway from hermes-agent API_SERVER_KEY>
HERMES_MODEL=hermes-agent
HERMES_TIMEOUT_MS=30000
```

Use `SIGMA_CONTROL_STORE=postgres` only after `DATABASE_URL` points at the managed Railway Postgres service.

### `sigma-dashboard`

```text
PORT=3000
NEXT_PUBLIC_API_URL=https://sigma-api-production-b005.up.railway.app
```

### `agent-worker`

```text
SIGMA_CONTROL_STORE=postgres
DATABASE_URL=<Railway Postgres private/internal URL>
REDIS_URL=<Railway Redis private/internal URL>
TASK_QUEUE_MODE=redis
TASK_QUEUE_NAME=sigma:tasks
TASK_WORKER_POLL_SECONDS=5
TASK_RESULT_TTL_SECONDS=86400
SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox
LLM_MODELS=gpt-4o
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=<set in Railway>
LLM_TIMEOUT_MS=30000
```

### `hermes-agent`

Do not copy local `.env` values into docs or Git.

Verified cloud variables include:

- `HERMES_HOME`
- `HERMES_UID`
- `HERMES_GID`
- `OPENROUTER_API_KEY`
- `GOOGLE_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DEEPSEEK_API_KEY`
- `KIMI_API_KEY`
- `MINIMAX_API_KEY`
- `HERMES_INFERENCE_PROVIDER`
- `HERMES_INFERENCE_MODEL`
- `API_SERVER_ENABLED`
- `API_SERVER_HOST`
- `API_SERVER_PORT`
- `API_SERVER_MODEL_NAME`
- `API_SERVER_KEY`

Use only the variables needed by the cloud default profile.

Telegram, trading, broker, and OpenD variables remain local until a deliberate cutover.

## Validation

Before deploying:

```text
npm run typecheck
DB_PATH=/private/tmp/sigma-core-os-test-railway-3.db npm test
cd apps/dashboard && npm run build
```

Expected result:

```text
typecheck passed
232 tests passed
0 failed
dashboard build passed, 17 app routes generated
```

After deploying `sigma-api`:

```text
GET /health
```

Expected response:

```json
{
  "status": "ok",
  "service": "sigma-core-os"
}
```

Observed live response on 2026-06-06:

```text
HTTP 200
{"status":"ok","service":"sigma-core-os","version":"0.8.0"}
```

The CORS response allows:

```text
https://sigma-dashboard-production-a7a7.up.railway.app
```

After deploying `sigma-dashboard`:

- Load dashboard Railway URL.
- Confirm login page renders.
- Confirm dashboard API proxy points at `sigma-api`.
- Confirm CORS allows the dashboard origin.

Observed live dashboard response on 2026-06-06:

```text
GET /approvals -> HTTP 200
```

After deploying `hermes-agent`:

- Confirm public health endpoint returns `HTTP 200`.
- Confirm unauthenticated model/API access returns `HTTP 401`.
- Confirm authenticated model access returns `HTTP 200`.
- Keep Telegram and trading credentials local during the stability window.

Observed live Hermes response on 2026-06-06:

```text
GET /health -> HTTP 200
{"status": "ok", "platform": "hermes-agent"}

GET /v1/models without API key -> HTTP 401
GET /v1/models with API_SERVER_KEY -> HTTP 200, model hermes-agent
```

After connecting `sigma-api` to `hermes-agent`:

```text
GET /v1/hermes/status -> HTTP 200
GET /v1/hermes/models -> HTTP 200, model hermes-agent
```

After adding approval-gated Hermes chat:

```text
POST /v1/hermes/draft-chat -> HTTP 202, pending sigma-hermes approval
POST /v1/approvals/:id -> HTTP 200, approved
POST /v1/hermes/dispatch-chat -> HTTP 200, Hermes response
```

Dashboard route:

```text
/hermes
```

The first Hermes action surface is deliberately narrow. Sigma sends only non-streaming chat completion prompts to Hermes after a human approval is approved. Do not enable direct Hermes runs, tool calls, trading actions, or broker-connected behavior in Railway without a separate approval design.

## Safety Rules

- Do not expose OpenD publicly.
- Do not move broker desktop software to Railway.
- Do not move MFA-protected GUI sessions to Railway.
- Do not deploy Hermes trading profile until explicitly approved.
- Do not commit `.env`, SQLite production data, or profile secrets.
- Keep live broker execution disabled unless a future approved design adds it.
- Keep Hermes cloud dispatch behind Sigma approvals.
- Keep full Hermes run/tool execution disabled until the review layer records tool scope and dispatch state.

## Today Finish Line

Today is successful when:

- Railway Dockerfiles exist.
- Sigma API and dashboard are deployed on Railway.
- Tests pass with isolated DB.
- Hermes default API server is deployed on Railway.
- Sigma API can queue and dispatch approved Hermes chat prompts.
- Sigma dashboard exposes the Hermes approval page.
- Hermes trading profile remains local.
- A PR can be opened with deployment prep and docs.

## Open Cloud Follow-Ups

- Monitor Postgres-backed approval, memory, identity, trading, and execution store activity after redeploys.
- Remove the old `/data/sigma.db` volume after the Postgres deployment completes its rollback window.
- Deploy `agent-worker` and set `TASK_QUEUE_MODE=redis` on `sigma-api` before increasing API replicas.
- Add Redis cache integration beyond the task queue if low-latency dashboard reads need it.
- Add real secrets through Railway variables, not git or chat.
- Watch the `hermes-agent` 24 hour stability window before disabling the local default LaunchAgent.
- Decide whether `HERMES_HOME=/opt/data` needs a Railway volume before relying on long-term Hermes session memory.
- Add idempotent dispatch tracking before using Hermes approvals for non-chat side effects.
