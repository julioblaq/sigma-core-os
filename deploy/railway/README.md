# Railway Deployment Assets

Date: 2026-06-06

This directory contains Dockerfiles for the cloud-safe Sigma Core OS services.

## Services

| Railway service | Dockerfile path | Notes |
|---|---|---|
| `sigma-api` | `deploy/railway/sigma-api.Dockerfile` | Fastify API, in-process Sigma Bot/Sigma Dev handlers. Production defaults to Railway Postgres with `SIGMA_CONTROL_STORE=postgres`; SQLite is local fallback only. |
| `agent-worker` | `deploy/railway/agent-worker.Dockerfile` | Redis-backed task worker for Sigma Bot/Sigma Dev execution. Keeps agent work out of the API process for multi-replica readiness. |
| `sigma-dashboard` | `deploy/railway/sigma-dashboard.Dockerfile` | Next.js dashboard. Set `NEXT_PUBLIC_API_URL` to the Railway URL for `sigma-api`. Includes `/voice` and `/hermes` operator pages. |
| `Postgres` | Railway managed database | Online. Service ID `f80547fb-42aa-42c7-afa7-018044531379`, volume `postgres-volume`. Seeded from live `/data/sigma.db`; backs the Sigma runtime store. |
| `Redis` | Railway managed database | Online. Service ID `4107f338-a335-4547-a8d3-22e5e0c67669`, volume `redis-volume`. Used by the Redis-backed agent task queue. |

## Railway Setup

Create separate Railway services from the same GitHub repository.

For each service, keep the repository root as the build context and set:

```text
RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-api.Dockerfile
```

or:

```text
RAILWAY_DOCKERFILE_PATH=deploy/railway/agent-worker.Dockerfile
```

or:

```text
RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-dashboard.Dockerfile
```

For Dockerfile deployments, Railway variables used by Next.js during `next build` must be declared as Docker build args. The dashboard Dockerfile declares `ARG NEXT_PUBLIC_API_URL` so the `/api/*` rewrite is built against the Railway API URL instead of the local fallback.

## `sigma-api` Variables

Required or recommended:

```text
PORT=3001
SIGMA_CONTROL_STORE=postgres
DATABASE_URL=<Railway Postgres private/internal URL>
REDIS_URL=<Railway Redis private/internal URL>
TASK_QUEUE_MODE=redis
TASK_QUEUE_NAME=sigma:tasks
SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox
TRADING_MODE=dry-run
DASHBOARD_ORIGIN=https://sigma-dashboard-production-a7a7.up.railway.app
LLM_MODELS=deepseek-v4-flash,deepseek-v4-pro,minimax/minimax-m3
DEEPSEEK_API_KEY=<set in Railway>
OPENROUTER_API_KEY=<set in Railway>
LLM_TIMEOUT_MS=30000
VOICE_PROVIDER=openrouter
VOICE_STT_MODEL=microsoft/mai-transcribe-1.5
VOICE_TTS_MODEL=microsoft/mai-voice-2
VOICE_TTS_VOICE=en-US-Harper:MAI-Voice-2
VOICE_TTS_FORMAT=mp3
VOICE_TIMEOUT_MS=30000
HERMES_API_URL=https://hermes-agent-production-62ee.up.railway.app
HERMES_API_KEY=<set in Railway from hermes-agent API_SERVER_KEY>
HERMES_MODEL=hermes-agent
HERMES_TIMEOUT_MS=30000
MARKET_DATA_PROVIDER=massive
MASSIVE_API_KEY=<set in Railway>
MASSIVE_BASE_URL=https://api.massive.com
TRADINGVIEW_WEBHOOK_SECRET=<set in Railway>
TRADINGVIEW_DEFAULT_ACCOUNT_SIZE=5000
TRADINGVIEW_DEFAULT_RISK_DOLLARS=100
TRADINGVIEW_DEFAULT_RR=2
```

`DB_PATH` is intentionally omitted from the Railway production variables. The API image starts with `deploy/railway/sigma-api-entrypoint.sh`, prepares `SIGMA_SANDBOX_PATH`, and then uses `gosu` to drop execution to the `node` user before launching the API.

With `SIGMA_CONTROL_STORE=postgres`, runtime store facades use Railway Postgres and the SQLite modules are only loaded on the local/default fallback path. The historical `sigma-api-volume` remains attached at `/data` as a temporary rollback artifact, but `DB_PATH` is absent and production no longer depends on the volume.

Railway managed `Postgres` and `Redis` are provisioned and online. `Postgres` backs the Sigma runtime store, and `Redis` backs the agent task queue when `TASK_QUEUE_MODE=redis`:

```text
SIGMA_CONTROL_STORE=postgres
DATABASE_URL=<Railway Postgres private/internal URL>
```

The Postgres runtime store currently covers:

- approvals
- outcome log
- memory entries
- users and sessions
- workspaces and workspace members
- strategies
- journal entries
- performance analytics over closed journal entries
- paper-order audit rows
- sandbox-write audit rows

## `agent-worker` Variables

Required or recommended:

```text
SIGMA_CONTROL_STORE=postgres
DATABASE_URL=<Railway Postgres private/internal URL>
REDIS_URL=<Railway Redis private/internal URL>
TASK_QUEUE_MODE=redis
TASK_QUEUE_NAME=sigma:tasks
TASK_WORKER_POLL_SECONDS=5
TASK_RESULT_TTL_SECONDS=86400
SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox
LLM_MODELS=deepseek-v4-flash,deepseek-v4-pro,minimax/minimax-m3
DEEPSEEK_API_KEY=<set in Railway>
OPENROUTER_API_KEY=<set in Railway>
LLM_TIMEOUT_MS=30000
```

`sigma-api` enqueues `/v1/task` work when `TASK_QUEUE_MODE=redis`. `agent-worker` consumes that queue and runs the existing task router against the same Postgres-backed runtime store.

## SQLite To Postgres Migration

The repository includes a first-pass migration command:

```text
npm run db:migrate:postgres -- --dry-run
```

That command reads the source SQLite database and prints row counts without connecting to Postgres.

To copy rows into Railway Postgres, set a Postgres URL in the shell without committing it:

```text
SQLITE_PATH=/path/to/sigma.db \
POSTGRES_MIGRATION_URL=<railway-postgres-url> \
npm run db:migrate:postgres
```

The script creates the Postgres schema, upserts rows from all current Sigma tables, and verifies row counts. Use `--truncate` only when intentionally replacing all destination table rows.

This migration command prepares the data layer. It does not switch `sigma-api` by itself. After migration verification, set `SIGMA_CONTROL_STORE=postgres` and `DATABASE_URL` in Railway to move runtime stores to Postgres.

Production migration status on 2026-06-06: the command was run from the Railway `sigma-api` console against `/data/sigma.db` and managed Railway `Postgres`. Verification passed with all tables `ok`; live rows copied were `approvals=1` and `outcome_log=1`.

## `sigma-dashboard` Variables

Required:

```text
PORT=3000
NEXT_PUBLIC_API_URL=https://sigma-api-production-b005.up.railway.app
```

## Live Railway URLs

```text
sigma-api: https://sigma-api-production-b005.up.railway.app
sigma-dashboard: https://sigma-dashboard-production-a7a7.up.railway.app
hermes-agent: https://hermes-agent-production-62ee.up.railway.app
```

## Hermes Approval Flow

`sigma-api` connects to the secured Railway `hermes-agent` service through server-side variables only. The dashboard never receives `HERMES_API_KEY`.

Approved cloud action surface:

```text
GET  /v1/llm/config
GET  /v1/market-data/config
GET  /v1/market-data/futures/aggs?ticker=ESU6&resolution=5min&windowStartGte=2026-09-01&windowStartLte=2026-09-02
GET  /v1/hermes/config
GET  /v1/hermes/status
GET  /v1/hermes/models
POST /v1/hermes/draft-chat
POST /v1/hermes/dispatch-chat
```

`/v1/llm/config` exposes the active model chain, base URLs, runtime health, and `apiKeySet` booleans only. It must never return raw API key values.

`/v1/market-data/config` exposes provider, base URL, timeout, and `apiKeySet` only. Futures aggregate requests call Massive.com server-side using `MASSIVE_API_KEY`; the dashboard and clients never receive the raw key.

Dashboard surface:

```text
/hermes
```

`POST /v1/hermes/draft-chat` creates a `sigma-hermes` approval with action `hermes_chat`. `POST /v1/hermes/dispatch-chat` sends the prompt to Hermes only after that approval has status `approved`.

This is intentionally limited to non-streaming `/v1/chat/completions`. Do not expose the broader Hermes run/tool execution surface until tool permissions, audit logging, idempotency, and rollback handling are reviewed.

## TradingView Webhook Approval Flow

`sigma-api` can receive TradingView alerts and turn them into `sigma-risk` `trade_plan` approvals:

```text
POST /v1/webhooks/tradingview
```

This endpoint is approval-only. It generates a deterministic risk plan, queues it for human approval, and never submits an order to a broker.

Current safety mode can be checked with:

```text
GET /v1/trading/config
```

Production should keep:

```text
TRADING_MODE=dry-run
```

Required Railway variable:

```text
TRADINGVIEW_WEBHOOK_SECRET=<set in Railway>
```

Optional safe defaults:

```text
TRADINGVIEW_DEFAULT_ACCOUNT_SIZE=5000
TRADINGVIEW_DEFAULT_RISK_DOLLARS=100
TRADINGVIEW_DEFAULT_RR=2
```

TradingView should pass the secret as a `secret` field in the JSON body. Non-TradingView clients can also use an `Authorization: Bearer <secret>` header or `x-sigma-webhook-secret`.

Example alert body:

```json
{
  "secret": "<TradingView webhook secret>",
  "ticker": "MNQ",
  "action": "buy",
  "price": 19000,
  "stop_points": 10
}
```

If defaults are not configured, alerts must also include `accountSize`, `riskDollars`, and `rrRatio`.

## Simulated Trading Ops Flow

The dashboard includes a no-account simulated alert surface:

```text
/trading
```

It submits approval-only trade-plan drafts through:

```text
POST /v1/trading/simulated-alert
POST /v1/voice/draft-simulated-trade
```

This route uses the same deterministic Sigma risk engine as the TradingView webhook, stores `source=simulated`, and never submits broker orders. It is the preferred workflow while no prop-firm account or sufficiently funded live account is connected.

The Nova voice draft path accepts transcripts such as:

```text
Draft a simulated MNQ long at 19000 with a 10 point stop, risk 100 dollars, 2R.
```

If account size, risk dollars, or R:R are not spoken, the API uses safe defaults:

```text
VOICE_TRADE_DEFAULT_ACCOUNT_SIZE=5000
VOICE_TRADE_DEFAULT_RISK_DOLLARS=100
VOICE_TRADE_DEFAULT_RR=2
```

## First Cloud Cutover Rule

Only move cloud-safe services first:

- Sigma Core API
- Sigma Dashboard
- In-process Sigma Bot and Sigma Dev handlers
- Paper broker adapter

Keep these local:

- Moomoo OpenD
- Broker desktop software
- MFA-protected gateways
- GUI trading platforms
- Hermes trading profile

Use Massive.com for cloud-safe CME futures OHLC data after the 24 hour stability watch. MooMoo/OpenD stays local as the broker/session gateway and should not be treated as the required CME data source in US production because of regional entitlement limits.

Supported first adapter:

```text
GET /v1/market-data/futures/aggs
```

Query parameters:

```text
ticker=ESU6
resolution=1min | 5min | 1hour | 1session
windowStart=YYYY-MM-DD
windowStartGte=YYYY-MM-DD
windowStartGt=<nanosecond timestamp or date>
windowStartLte=YYYY-MM-DD
windowStartLt=<nanosecond timestamp or date>
limit=1..50000
sort=window_start.asc | window_start.desc
```
