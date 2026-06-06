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

## Classification Key

- Cloud Safe: Safe candidate for Railway after secrets, persistence, and health checks are configured.
- Local Only: Must stay on dedicated local hardware or private networking.
- Unknown: Needs more discovery before a cloud decision.

## Repo Services

| Service | Classification | Current entrypoint | Evidence | Migration notes |
|---|---:|---|---|---|
| Sigma Core API | Cloud Safe | `npm start` -> `tsx apps/api/server.ts` | `package.json`, `apps/api/server.ts` | Fastify API listens on `0.0.0.0` and uses `PORT`. Add Railway start command, health check on `/health`, and persistent database strategy before production cutover. |
| Sigma Dashboard | Cloud Safe | `cd apps/dashboard && npm run start` | `apps/dashboard/package.json`, `apps/dashboard/next.config.mjs` | Next.js dashboard proxies `/api/*` to `NEXT_PUBLIC_API_URL` or local API. Can deploy as a separate Railway service after API URL and auth cookie/CORS settings are aligned. |
| Sigma Bot TypeScript handler | Cloud Safe | Loaded by API router, not standalone | `agents/sigma-bot/handler.ts`, `core/router/index.ts` | Currently runs in-process when API receives `trade_plan` tasks. Keep with API for first migration, or later split into `agent-worker` when a durable queue exists. |
| Sigma Dev TypeScript handler | Cloud Safe | Loaded by API router, not standalone | `agents/sigma-dev/handler.ts`, `core/router/index.ts` | Currently in-process. Write actions are approval-gated and sandboxed. Cloud deployment needs `SIGMA_SANDBOX_PATH` pointed at an ephemeral or persistent Railway volume depending on intended artifact retention. |
| LLM routing client | Cloud Safe | Imported by agent handlers | `core/llm/index.ts`, `integrations/litellm/README.md` | Uses hosted OpenAI/Anthropic/LiteLLM-compatible APIs when configured with environment variables. Local Ollama fallback is not cloud safe unless replaced with a hosted/private endpoint. |
| SQLite database file | Unknown | `DB_PATH` default `./sigma.db` | `core/db.ts`, `.env.example` | Current persistence is a local SQLite file. For Railway, either mount a volume for a single-replica first phase or migrate to Railway PostgreSQL before scaling replicas. PostgreSQL migration is recommended before multi-replica production. |
| Memory store | Unknown | SQLite table inside `sigma.db` | `core/memory/index.ts` | Not a separate service today. Cloud-safe only after the database strategy is solved. Can later move hot state to Redis and long-term memory to PostgreSQL. |
| Approval queue and audit log | Unknown | SQLite tables inside `sigma.db` | `core/policies/index.ts`, `core/runtime/index.ts` | Critical production state. Needs backup and migration plan before Railway cutover. |
| Paper broker adapter | Cloud Safe | Imported by runtime | `core/broker/index.ts` | Paper-only, no live broker credentials, and live mode is structurally rejected. Safe to run in cloud because it does not connect to Tradovate, Moomoo, IBKR, Alpaca, or OpenD. |
| Sandbox writer | Unknown | Imported by runtime | `core/sandbox/index.ts` | Safe design, but storage target matters. Railway deployments should set `SIGMA_SANDBOX_PATH` explicitly and decide whether sandbox artifacts are temporary or volume-backed. |
| Python Sigma Bot stub | Unknown | `python agents/sigma-bot/agent.py` | `agents/sigma-bot/agent.py` | Not wired into `package.json` or API router. File appears to be an old stub and should not be deployed until syntax/runtime health is verified. |

## Host-Level Services

| Service | Classification | Current launch mechanism | Evidence | Migration notes |
|---|---:|---|---|---|
| Hermes default gateway | Unknown | macOS LaunchAgent `ai.hermes.gateway` | `/Users/jerryhicksjr/Library/LaunchAgents/ai.hermes.gateway.plist` | Runs `/Users/jerryhicksjr/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main gateway run --replace` with `HERMES_HOME=/Users/jerryhicksjr/.hermes`. Candidate for Railway after package/dependency inventory, environment variables, profile data, and network needs are documented. |
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

Local `.env` key scan found only:

- `PORT`
- `DB_PATH`

Do not commit secret values. Put production values in Railway variables.

## Missing Deployment Assets

The repository now has Dockerfile-based Railway deployment assets for the Sigma API and dashboard. It still lacks:

- `docker-compose.yml`
- process manager config
- queue worker entrypoint
- PostgreSQL migration scripts
- Redis integration
- CI/CD deployment workflow

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

Use an isolated test database for migration validation. Do not run migration tests against the live/local `sigma.db`.

Current git working tree also already had unrelated local changes before this audit:

- Modified `sigma.db`
- Untracked `docs/knowledge/`

The clean dependency install restored the missing `node_modules` files. The existing `sigma.db` and `docs/knowledge/` changes were not intentionally modified by this audit.

## Migration Recommendations

1. Deploy `sigma-api` from `deploy/railway/sigma-api.Dockerfile`.
2. Deploy `sigma-dashboard` from `deploy/railway/sigma-dashboard.Dockerfile`.
3. Attach a Railway volume to `sigma-api` at `/data`.
4. Keep SQLite on a single Railway volume only as a temporary bridge, or migrate to PostgreSQL before production traffic.
5. Keep agent handlers in-process until a durable queue exists.
6. Keep OpenD, broker desktop software, MFA sessions, and Hermes trading profile local.
7. Audit Hermes default gateway separately before deploying it to Railway.
