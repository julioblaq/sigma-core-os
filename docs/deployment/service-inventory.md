# Service Inventory

Owner: Jerry Hicks Jr.
Date: 2026-06-06
Scope: Sigma Core OS repository plus local Hermes LaunchAgents discovered on the M4.

## Summary

This is the Phase 1 infrastructure audit for the Railway migration.

The active repo services are Node/TypeScript application surfaces with a Postgres-backed production runtime and local SQLite fallback. Hermes is currently installed outside this repository under `/Users/jerryhicksjr/.hermes` and launched with macOS LaunchAgents.

Deployment assets added for Railway:

- `deploy/railway/sigma-api.Dockerfile`
- `deploy/railway/sigma-dashboard.Dockerfile`
- `deploy/railway/README.md`
- `.dockerignore`

Voice deployment reference added:

- `docs/deployment/sigma-voice-agent.md`

Railway project created on 2026-06-06:

```text
Project: sigma-core-os
Project ID: 4337cbdb-9569-4b30-9cf1-3212fee26eed
Environment: production
```

## Classification Key

- Cloud Safe: Safe candidate for Railway after secrets, persistence, and health checks are configured.
- Local Only: Must stay on dedicated local hardware or private networking.
- Unknown: Needs more discovery before a cloud decision.

## Repo Services

| Service | Classification | Current entrypoint | Evidence | Migration notes |
|---|---:|---|---|---|
| Sigma Core API | Cloud Safe | `npm start` -> `tsx apps/api/server.ts` | `package.json`, `apps/api/server.ts` | Deployed to Railway service `sigma-api` at `https://sigma-api-production-b005.up.railway.app`. Health check passes. Production defaults to `SIGMA_CONTROL_STORE=postgres`; runtime store facades use Railway Postgres and do not open the local SQLite database at import time. |
| Sigma Dashboard | Cloud Safe | `cd apps/dashboard && npm run start` | `apps/dashboard/package.json`, `apps/dashboard/next.config.mjs` | Deployed to Railway service `sigma-dashboard` at `https://sigma-dashboard-production-a7a7.up.railway.app`. `/approvals` renders with HTTP 200 and points at the Railway API URL. |
| Railway Postgres | Cloud Safe | Managed Railway database | Railway dashboard | Online as service `Postgres` (`f80547fb-42aa-42c7-afa7-018044531379`) with `postgres-volume`. Live `/data/sigma.db` data was copied and verified. Runtime support exists for identity, control, trading, and execution audit stores through `SIGMA_CONTROL_STORE=postgres`. |
| Railway Redis | Cloud Safe | Managed Railway database | Railway dashboard | Online as service `Redis` (`4107f338-a335-4547-a8d3-22e5e0c67669`) with `redis-volume`. Used by the new agent task queue when `TASK_QUEUE_MODE=redis`; cache integration remains future work. |
| Sigma Voice Agent | Cloud Safe | `sigma-dashboard` mic UI + `sigma-api` voice routes | `apps/dashboard/app/voice/page.tsx`, `core/voice/index.ts`, `apps/api/server.ts` | Voice is an operator input layer. It transcribes audio, can synthesize replies, and queues approval-gated voice task drafts. It does not execute tasks or broker actions directly. |
| Sigma Bot TypeScript handler | Cloud Safe | Loaded by API router or `agent-worker` | `agents/sigma-bot/handler.ts`, `core/router/index.ts`, `core/queue/tasks.ts` | Runs through Redis-backed `agent-worker` when `TASK_QUEUE_MODE=redis`. Inline API fallback remains for local development. |
| Sigma Dev TypeScript handler | Cloud Safe | Loaded by API router or `agent-worker` | `agents/sigma-dev/handler.ts`, `core/router/index.ts`, `core/queue/tasks.ts` | Runs through Redis-backed `agent-worker` when `TASK_QUEUE_MODE=redis`. Write actions are approval-gated and sandboxed. Production defaults `SIGMA_SANDBOX_PATH` to ephemeral `/tmp/sigma-sandbox`; attach a volume only if generated artifacts must persist outside Postgres audit records. |
| Agent worker | Cloud Safe | `npm run start:worker` | `apps/worker/agent-worker.ts`, `deploy/railway/agent-worker.Dockerfile` | Consumes Redis queue `sigma:tasks`, runs the existing router, and records lightweight task results/dead letters in Redis. Deploy before increasing `sigma-api` replicas. |
| LLM routing client | Cloud Safe | Imported by agent handlers | `core/llm/index.ts`, `integrations/litellm/README.md` | Uses hosted OpenAI/Anthropic/LiteLLM-compatible APIs when configured with environment variables. Local Ollama fallback is not cloud safe unless replaced with a hosted/private endpoint. |
| SQLite database file | Local fallback | `DB_PATH=./sigma.db` locally, optional explicit rollback variable only | `core/db.ts`, `.env.example` | No longer required by the Railway production image or Postgres runtime path. The SQLite-backed modules are lazy-loaded only when `SIGMA_CONTROL_STORE` is left at the local/default SQLite mode. |
| Memory store | Cloud Safe | Postgres in production, SQLite fallback locally | `core/memory/index.ts`, `core/store/control.ts` | Sigma Bot and Sigma Dev memory entries are covered by the Postgres runtime store when `SIGMA_CONTROL_STORE=postgres`. Redis task queue integration is separate from long-term memory. |
| Approval queue and audit log | Cloud Safe | Postgres in production, SQLite fallback locally | `core/policies/index.ts`, `core/runtime/index.ts`, `core/store/control.ts` | Approvals, Hermes dispatch lookups, voice/risk approvals, and outcome logs are covered by the Postgres runtime store when `SIGMA_CONTROL_STORE=postgres`. |
| Massive futures market data | Cloud Safe | Hosted API | Future `MARKET_DATA_PROVIDER=massive` adapter | Preferred source for CME futures OHLC data after the 24 hour Railway stability watch. Use `/futures/v1/aggs/{ticker}` and store `MASSIVE_API_KEY` only in Railway variables. This avoids depending on MooMoo CME entitlements for cloud Sigma/Nova features. |
| Paper broker adapter | Cloud Safe | Imported by runtime | `core/broker/index.ts` | Paper-only, no live broker credentials, and live mode is structurally rejected. Safe to run in cloud because it does not connect to Tradovate, Moomoo, IBKR, Alpaca, or OpenD. |
| Sandbox writer | Unknown | Imported by runtime | `core/sandbox/index.ts` | Safe design, but storage target matters. Railway deployments should set `SIGMA_SANDBOX_PATH` explicitly and decide whether sandbox artifacts are temporary or volume-backed. |
| Python Sigma Bot stub | Unknown | `python agents/sigma-bot/agent.py` | `agents/sigma-bot/agent.py` | Not wired into `package.json` or API router. File appears to be an old stub and should not be deployed until syntax/runtime health is verified. |

## Host-Level Services

| Service | Classification | Current launch mechanism | Evidence | Migration notes |
|---|---:|---|---|---|
| Hermes default gateway | Cloud migrated; local rollback disabled | Railway `hermes-agent`; disabled macOS LaunchAgent `ai.hermes.gateway` retained for rollback | `/Users/jerryhicksjr/Library/LaunchAgents/ai.hermes.gateway.plist`, Railway service `hermes-agent` | Railway `hermes-agent` is online with start command `hermes gateway run --replace`, API server enabled, and Sigma approval-gated chat verified. The local default LaunchAgent was disabled and stopped on 2026-06-09 after the 24 hour watch passed. |
| Hermes trading gateway | Local Only until proven otherwise | macOS LaunchAgent `ai.hermes.gateway-trading` | `/Users/jerryhicksjr/Library/LaunchAgents/ai.hermes.gateway-trading.plist` | Runs Hermes with `--profile trading` and `HERMES_HOME=/Users/jerryhicksjr/.hermes/profiles/trading`. Keep local until it is confirmed that it does not require broker desktop software, MFA sessions, OpenD, or LAN-only trading access. |
| Disabled legacy Hermes LaunchAgent | Local Only / inactive | Disabled plist file | `/Users/jerryhicksjr/Library/LaunchAgents/xyz.mindlyft.hermes.plist.disabled-20260604062832` | Inactive historical service. Do not migrate unless re-enabled intentionally. |

## Expected Cloud Safe Services

These are reasonable Railway candidates after the blockers below are handled:

- Sigma Core API
- Sigma Dashboard
- Sigma Bot TypeScript handler
- Sigma Dev TypeScript handler
- Paper broker adapter
- Hosted LLM routing through OpenAI, Anthropic, or LiteLLM
- Hermes default gateway, pending Hermes-specific dependency and network audit

## Expected Local Only Services

These should not be publicly exposed or moved to Railway in the first migration:

- Moomoo OpenD
- Broker desktop software
- MFA-protected broker gateways
- GUI login services
- Trading platforms requiring a local session
- Hermes trading profile until its broker/hardware dependencies are proven cloud safe
- Local Ollama endpoints such as `http://localhost:11434/v1`

Moomoo/OpenD remains useful as the local M1 broker/session gateway, but it is not the target CME futures data source for cloud Sigma/Nova. Futures market data should route through Massive.com once the data adapter is added.

## Unknown Services And Integrations

No source-controlled MCP servers, Composio integration configs, NotebookLM configs, Telegram bots, N8N configs, Open WebUI configs, TradingView webhook receivers, Ghost connectors, or Tradovate connectors were found in this repository during this audit.

Items still requiring external discovery:

- Hermes package dependencies under `/Users/jerryhicksjr/.hermes/hermes-agent`
- Hermes secrets and profile-specific config, without exposing secret values
- Any MCP servers configured in Codex, Claude, or user-level config outside this repository
- Any active services started manually in terminal sessions
- Any broker or OpenD services running on the M1

## Environment Variables

Documented by `.env.example`:

- `PORT`
- `DATABASE_URL`
- `SIGMA_CONTROL_STORE`
- `DB_PATH`
- `REDIS_URL`
- `TASK_QUEUE_MODE`
- `TASK_QUEUE_NAME`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_API_KEY`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_RETRIES`

Read by source code:

- `PORT`
- `DASHBOARD_ORIGIN`
- `NEXT_PUBLIC_API_URL`
- `DB_PATH`
- `LLM_MODELS`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_TIMEOUT_MS`
- `LLM_<MODEL>_BASE_URL`
- `LLM_<MODEL>_API_KEY`
- `LLM_<MODEL>_TIMEOUT_MS`
- `SIGMA_SANDBOX_PATH`
- `VOICE_PROVIDER`
- `VOICE_API_KEY`
- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `VOICE_BASE_URL`
- `VOICE_STT_MODEL`
- `VOICE_TTS_MODEL`
- `VOICE_TTS_VOICE`
- `VOICE_TTS_FORMAT`
- `VOICE_TIMEOUT_MS`
- `HERMES_API_URL`
- `HERMES_API_KEY`
- `HERMES_MODEL`
- `HERMES_TIMEOUT_MS`
- `SIGMA_CONTROL_STORE`
- `DATABASE_URL`
- `DATABASE_PUBLIC_URL`
- `POSTGRES_MIGRATION_URL`

Local `.env` key scan found only:

- `PORT`
- `DB_PATH`

Do not commit secret values. Put production values in Railway variables.

## Missing Deployment Assets

The repository now has Dockerfile-based Railway deployment assets for the Sigma API, dashboard, and Redis-backed agent worker. It still lacks:

- `docker-compose.yml`
- process manager config
- Redis cache integration beyond task queue support
- CI/CD deployment workflow

Railway service shell cleanup:

- `trading-middleware-cloud` was deleted from Railway production on 2026-06-07 after confirming it had no source repo, no active deployment, no domain, and only a demo variable. Middleware behavior currently lives in `sigma-api`.

Hermes audit findings:

- Hermes has a production Dockerfile with s6-overlay supervision and `HERMES_HOME=/opt/data`.
- The Dockerfile's default empty `CMD` routes to the base `hermes` command, not directly to `gateway run --replace`.
- Railway `hermes-agent` start command is configured as `hermes gateway run --replace`.
- `HERMES_HOME=/opt/data` has no Railway volume attached; this is acceptable for the current stateless approved chat bridge, but not for long-term Hermes session memory.
- Keep `ai.hermes.gateway-trading` local because it explicitly runs `--profile trading` with `HERMES_HOME=/Users/jerryhicksjr/.hermes/profiles/trading`.

## Current Verification Status

The first `npm test` attempt did not reach application tests because the local `node_modules` install was missing generated esbuild/tsx files. Running `npm ci` restored the dependency install.

After the clean install, `npm test` against the default `DB_PATH` still failed because `node-sqlite3-wasm` could not open the local repository `sigma.db`. Running the full suite with an isolated temporary database passed:

```text
DB_PATH=/private/tmp/sigma-core-os-test-railway-3.db npm test
```

Result:

```text
219 tests passed
0 failed
```

Additional verification:

```text
npm run typecheck
cd apps/dashboard && npm run build
```

Both passed on 2026-06-06 after narrowing the root TypeScript project to server-side code and pinning the dashboard TypeScript version for Next 14.2.3 compatibility. The dashboard build generated 16 static app routes.

Railway deployment verification on 2026-06-06:

```text
sigma-api -> SUCCESS
GET https://sigma-api-production-b005.up.railway.app/health -> HTTP 200
sigma-dashboard -> SUCCESS
GET https://sigma-dashboard-production-a7a7.up.railway.app/approvals -> HTTP 200
```

Railway managed PostgreSQL and Redis were blocked from the CLI because `railway add --database postgres` and `railway add --database redis` returned `Unauthorized` even after CLI login. They were provisioned through the Railway dashboard on 2026-06-06 instead. `Postgres` and `Redis` both show `Online` in the Railway architecture view.

The original `sigma-api` Railway volume at `/data` proved the single-replica SQLite bridge could survive container replacement. Production no longer depends on that volume once `SIGMA_CONTROL_STORE=postgres` and `DATABASE_URL` are active.

SQLite-to-Postgres migration layer added on 2026-06-06:

```text
npm run db:migrate:postgres -- --dry-run
npm run db:migrate:postgres
npm run db:migrate:postgres -- --verify-only
```

The command creates the Postgres schema, upserts rows from all current Sigma SQLite tables, and verifies row counts. It does not switch the live API runtime by itself.

Production copy completed on 2026-06-06 from the Railway `sigma-api` console using source `/data/sigma.db`. Verification passed after copying `approvals=1` and `outcome_log=1`; all other current Sigma tables verified at zero rows.

Runtime control-store adapter added on 2026-06-06:

```text
SIGMA_CONTROL_STORE=postgres
DATABASE_URL=<Railway Postgres private/internal URL>
```

This adapter moves approvals, outcome logs, memory reads/writes, users, sessions, workspaces, workspace members, strategies, journal entries, performance analytics reads, paper order audit rows, and sandbox write audit rows to Railway Postgres for the API, Hermes approval dispatch, voice approvals, risk approvals, Sigma Bot, and Sigma Dev. SQLite remains as the local/default fallback and is lazy-loaded only when that fallback path is used.

Use an isolated test database for migration validation. Do not run migration tests against the live/local `sigma.db`.

Current git working tree also already had unrelated local changes before this audit:

- Modified `sigma.db`
- Untracked `docs/knowledge/`

The clean dependency install restored the missing `node_modules` files. The existing `sigma.db` and `docs/knowledge/` changes were not intentionally modified by this audit.

## Migration Recommendations

1. Deploy `sigma-api` from `deploy/railway/sigma-api.Dockerfile`.
2. Deploy `sigma-dashboard` from `deploy/railway/sigma-dashboard.Dockerfile`.
3. Keep the old SQLite Railway volume only as a temporary rollback artifact.
4. Use the Postgres control store for identity, approvals, memory, strategies, journal/performance, paper orders, and sandbox write audit rows before multi-replica usage.
5. Deploy `agent-worker`, set `TASK_QUEUE_MODE=redis` on `sigma-api`, and then evaluate increasing `sigma-api` replicas.
6. Keep OpenD, broker desktop software, MFA sessions, and Hermes trading profile local.
7. Audit Hermes default gateway separately before deploying it to Railway.
8. Keep voice commands approval-gated until Hermes and live execution boundaries are explicitly approved.
