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
| Sigma Bot | Trade-plan proposal handler | Runs in-process with `sigma-api` until queue workers exist. |
| Sigma Dev | Docs/code artifact proposal handler | Runs in-process with `sigma-api` until queue workers exist. |
| Hermes default gateway | Local gateway process retained during stability window | Railway `hermes-agent` secured API server. |
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
- Redis queue
- PostgreSQL migration
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
| `agent-worker` | Service shell only | Not deployed |
| `trading-middleware-cloud` | Service shell only | Not deployed |

Create separate Railway services from the same GitHub repository for Sigma:

| Service | Source | Dockerfile variable |
|---|---|---|
| `sigma-api` | Sigma Core OS repo root | `RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-api.Dockerfile` |
| `sigma-dashboard` | Sigma Core OS repo root | `RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-dashboard.Dockerfile` |

A Railway volume is attached to `sigma-api` at:

```text
/data
```

The current live `sigma-api` deployment temporarily uses:

```text
DB_PATH=/tmp/sigma.db
SIGMA_SANDBOX_PATH=/tmp/sandbox
```

This keeps the API online with the non-root container while the Railway volume mount ownership issue is fixed. The intended persistent setting remains:

```text
DB_PATH=/data/sigma.db
SIGMA_SANDBOX_PATH=/data/sandbox
```

This keeps the first cloud move small. PostgreSQL should still replace SQLite before multi-replica production traffic.

## Variables

### `sigma-api`

```text
PORT=3001
DB_PATH=/tmp/sigma.db
SIGMA_SANDBOX_PATH=/tmp/sandbox
DASHBOARD_ORIGIN=https://sigma-dashboard-production-a7a7.up.railway.app
LLM_MODELS=gpt-4o
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=<set in Railway>
LLM_TIMEOUT_MS=30000
```

### `sigma-dashboard`

```text
PORT=3000
NEXT_PUBLIC_API_URL=https://sigma-api-production-b005.up.railway.app
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
219 tests passed
0 failed
dashboard build passed, 16 app routes generated
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

## Safety Rules

- Do not expose OpenD publicly.
- Do not move broker desktop software to Railway.
- Do not move MFA-protected GUI sessions to Railway.
- Do not deploy Hermes trading profile until explicitly approved.
- Do not commit `.env`, SQLite production data, or profile secrets.
- Keep live broker execution disabled unless a future approved design adds it.

## Today Finish Line

Today is successful when:

- Railway Dockerfiles exist.
- Sigma API and dashboard are deployed on Railway.
- Tests pass with isolated DB.
- Hermes default API server is deployed on Railway.
- Hermes trading profile remains local.
- A PR can be opened with deployment prep and docs.

## Open Cloud Follow-Ups

- Fix persistent `/data` volume ownership for the non-root `sigma-api` container.
- Provision Railway PostgreSQL and Redis once the current database add authorization issue is resolved.
- Add real secrets through Railway variables, not git or chat.
- Watch the `hermes-agent` 24 hour stability window before disabling the local default LaunchAgent.
- Decide whether `HERMES_HOME=/opt/data` needs a Railway volume before relying on long-term Hermes session memory.
