# Railway Cloud Orchestration

Owner: Jerry Hicks Jr.
Date: 2026-06-06
Status: Deployment-prep runbook.

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
| Hermes default gateway | Local gateway process | Candidate Railway `hermes-agent` service after profile/env audit. |
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

Create separate Railway services from the same GitHub repository for Sigma:

| Service | Source | Dockerfile variable |
|---|---|---|
| `sigma-api` | Sigma Core OS repo root | `RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-api.Dockerfile` |
| `sigma-dashboard` | Sigma Core OS repo root | `RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-dashboard.Dockerfile` |

Attach a Railway volume to `sigma-api` at:

```text
/data
```

Set:

```text
DB_PATH=/data/sigma.db
SIGMA_SANDBOX_PATH=/data/sandbox
```

This keeps the first cloud move small. PostgreSQL should still replace SQLite before multi-replica production traffic.

## Variables

### `sigma-api`

```text
PORT=3001
DB_PATH=/data/sigma.db
SIGMA_SANDBOX_PATH=/data/sandbox
DASHBOARD_ORIGIN=https://<sigma-dashboard>.up.railway.app
LLM_MODELS=gpt-4o
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=<set in Railway>
LLM_TIMEOUT_MS=30000
```

### `sigma-dashboard`

```text
PORT=3000
NEXT_PUBLIC_API_URL=https://<sigma-api>.up.railway.app
```

### `hermes-agent`

Do not copy local `.env` values into docs or Git.

Candidate variable names from Hermes `.env.example` include:

- `HERMES_HOME`
- `OPENROUTER_API_KEY`
- `GOOGLE_API_KEY`
- `GEMINI_API_KEY`
- `OLLAMA_API_KEY`
- `EXA_API_KEY`
- `PARALLEL_API_KEY`
- `FIRECRAWL_API_KEY`
- `FAL_KEY`
- `HONCHO_API_KEY`
- `TERMINAL_ENV`

Use only the variables needed by the cloud default profile.

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

After deploying `sigma-dashboard`:

- Load dashboard Railway URL.
- Confirm login page renders.
- Confirm dashboard API proxy points at `sigma-api`.
- Confirm CORS allows the dashboard origin.

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
- Sigma API and dashboard have deploy instructions.
- Tests pass with isolated DB.
- Hermes default gateway has a documented cloud path.
- Hermes trading profile remains local.
- A PR can be opened with deployment prep and docs.
