# Service Inventory

Owner: Jerry Hicks Jr.
Date: 2026-06-06
Scope: Sigma Core OS repository plus local Hermes LaunchAgents discovered on the M4.

## Summary

This is the Phase 1 infrastructure audit for the Railway migration.

The active repo services are Node/TypeScript application surfaces backed by a local SQLite database. Hermes is currently installed outside this repository under `/Users/jerryhicksjr/.hermes` and launched with macOS LaunchAgents.

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
| Sigma Core API | Cloud Safe | `npm start` -> `tsx apps/api/server.ts` | `package.json`, `apps/api/server.ts` | Deployed to Railway service `sigma-api` at `https://sigma-api-production-b005.up.railway.app`. Health check passes. Uses `/data/sigma.db` on the attached Railway volume and has been verified across redeploy. Keep single-replica until PostgreSQL migration is implemented. |
| Sigma Dashboard | Cloud Safe | `cd apps/dashboard && npm run start` | `apps/dashboard/package.json`, `apps/dashboard/next.config.mjs` | Deployed to Railway service `sigma-dashboard` at `https://sigma-dashboard-production-a7a7.up.railway.app`. `/approvals` renders with HTTP 200 and points at the Railway API URL. |
| Railway Postgres | Cloud Safe | Managed Railway database | Railway dashboard | Online as service `Postgres` (`f80547fb-42aa-42c7-afa7-018044531379`) with `postgres-volume`. Data migration command exists, but Sigma runtime still reads SQLite. |
| Railway Redis | Cloud Safe | Managed Railway database | Railway dashboard | Online as service `Redis` (`4107f338-a335-4547-a8d3-22e5e0c67669`) with `redis-volume`. Not yet used by Sigma code; next step is queue/cache integration. |
| Sigma Voice Agent | Cloud Safe | `sigma-dashboard` mic UI + `sigma-api` voice routes | `apps/dashboard/app/voice/page.tsx`, `core/voice/index.ts`, `apps/api/server.ts` | Voice is an operator input layer. It transcribes audio, can synthesize replies, and queues approval-gated voice task drafts. It does not execute tasks or broker actions directly. |
| Sigma Bot TypeScript handler | Cloud Safe | Loaded by API router, not standalone | `agents/sigma-bot/handler.ts`, `core/router/index.ts` | Currently runs in-process when API receives `trade_plan` tasks. Keep with API for first migration, or later split into `agent-worker` when a durable queue exists. |
| Sigma Dev TypeScript handler | Cloud Safe | Loaded by API router, not standalone | `agents/sigma-dev/handler.ts`, `core/router/index.ts` | Currently in-process. Write actions are approval-gated and sandboxed. Cloud deployment needs `SIGMA_SANDBOX_PATH` pointed at an ephemeral or persistent Railway volume depending on intended artifact retention. |
| LLM routing client | Cloud Safe | Imported by agent handlers | `core/llm/index.ts`, `integrations/litellm/README.md` | Uses hosted OpenAI/Anthropic/LiteLLM-compatible APIs when configured with environment variables. Local Ollama fallback is not cloud safe unless replaced with a hosted/private endpoint. |
| SQLite database file | Cloud Safe | `DB_PATH=/data/sigma.db` on Railway | `core/db.ts`, `.env.example`, `deploy/railway/sigma-api.Dockerfile` | Persistent on the attached Railway volume for the single-replica first phase. PostgreSQL migration is still recommended before scaling replicas or treating this as the final production database layer. |
| Memory store | Cloud Safe | SQLite table inside `/data/sigma.db` | `core/memory/index.ts` | Cloud-safe for the first single-replica phase because it now uses the persistent Railway volume. Can later move hot state to Redis and long-term memory to PostgreSQL. |
| Approval queue and audit log | Cloud Safe | SQLite tables inside `/data/sigma.db` | `core/policies/index.ts`, `core/runtime/index.ts` | Critical production state is now persisted on the Railway volume and verified across redeploy. Add backups/export before heavy production usage; migrate to PostgreSQL before multi-replica traffic. |
| Paper broker adapter | Cloud Safe | Imported by runtime | `core/broker/index.ts` | Paper-only, no live broker credentials, and live mode is structurally rejected. Safe to run in cloud because it does not connect to Tradovate, Moomoo, IBKR, Alpaca, or OpenD. |
| Sandbox writer | Unknown | Imported by runtime | `core/sandbox/index.ts` | Safe design, but storage target matters. Railway deployments should set `SIGMA_SANDBOX_PATH` explicitly and decide whether sandbox artifacts are temporary or volume-backed. |
| Python Sigma Bot stub | Unknown | `python agents/sigma-bot/agent.py` | `agents/sigma-bot/agent.py` | Not wired into `package.json` or API router. File appears to be an old stub and should not be deployed until syntax/runtime health is verified. |

## Host-Level Services

| Service | Classification | Current launch mechanism | Evidence | Migration notes |
|---|---:|---|---|---|
| Hermes default gateway | Unknown | macOS LaunchAgent `ai.hermes.gateway` | `/Users/jerryhicksjr/Library/LaunchAgents/ai.hermes.gateway.plist` | Runs `/Users/jerryhicksjr/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main gateway run --replace` with `HERMES_HOME=/Users/jerryhicksjr/.hermes`. Hermes package, Dockerfile, and gateway command were audited on 2026-06-06. Railway service shell `hermes-agent` exists, but deployment is pending explicit Railway start-command configuration and secret/profile review. |
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
- `DB_PATH`
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

Local `.env` key scan found only:

- `PORT`
- `DB_PATH`

Do not commit secret values. Put production values in Railway variables.

## Missing Deployment Assets

The repository now has Dockerfile-based Railway deployment assets for the Sigma API and dashboard. It still lacks:

- `docker-compose.yml`
- process manager config
- queue worker entrypoint
- Runtime repository support for `DATABASE_URL`
- Redis queue/cache integration and repository support for `REDIS_URL`
- CI/CD deployment workflow

Railway service shells created but not yet deployed:

- `agent-worker`
- `trading-middleware-cloud`

Hermes audit findings:

- Hermes has a production Dockerfile with s6-overlay supervision and `HERMES_HOME=/opt/data`.
- The Dockerfile's default empty `CMD` routes to the base `hermes` command, not directly to `gateway run --replace`.
- For Railway, configure the service start command to `gateway run --replace` before deploying `hermes-agent`.
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

The `sigma-api` Railway volume at `/data` is now active. Deployment `d46ed713-75d8-4434-a5de-3fc219fac9a9` opened `/data/sigma.db`, passed the public `/health` check, and read back a smoke-test approval after redeploy. This proves the current SQLite database survives container replacement.

SQLite-to-Postgres migration layer added on 2026-06-06:

```text
npm run db:migrate:postgres -- --dry-run
npm run db:migrate:postgres
npm run db:migrate:postgres -- --verify-only
```

The command creates the Postgres schema, upserts rows from all current Sigma SQLite tables, and verifies row counts. It does not switch the live API runtime to Postgres.

Use an isolated test database for migration validation. Do not run migration tests against the live/local `sigma.db`.

Current git working tree also already had unrelated local changes before this audit:

- Modified `sigma.db`
- Untracked `docs/knowledge/`

The clean dependency install restored the missing `node_modules` files. The existing `sigma.db` and `docs/knowledge/` changes were not intentionally modified by this audit.

## Migration Recommendations

1. Deploy `sigma-api` from `deploy/railway/sigma-api.Dockerfile`.
2. Deploy `sigma-dashboard` from `deploy/railway/sigma-dashboard.Dockerfile`.
3. Keep SQLite on a single Railway volume only as a temporary bridge.
4. Run the SQLite-to-Postgres migration, then add runtime Postgres support before multi-replica usage.
5. Keep agent handlers in-process until a durable queue exists.
6. Keep OpenD, broker desktop software, MFA sessions, and Hermes trading profile local.
7. Audit Hermes default gateway separately before deploying it to Railway.
8. Keep voice commands approval-gated until Hermes and live execution boundaries are explicitly approved.
