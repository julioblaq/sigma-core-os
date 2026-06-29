# Sigma Core OS - Current Context For Claude

Owner: Jerry Hicks Jr.
Date: 2026-06-29
Status: Sigma Corps is live on Railway. Hermes is API-only on Kimi/Moonshot, SigmaBot is paper-action ready, and live brokers remain structurally blocked.

## What This Repo Is

Sigma Core OS is the approval spine and operating layer for Sigma/Nova/Hermes trading workflows.

The system can draft plans, queue background work, store memory and journal entries, route approved Hermes prompts, and execute approved trade plans into the paper broker only. It must not execute live broker actions without a deliberate future approval design.

## Current Production Shape

```text
Railway
  sigma-api
  sigma-dashboard
  agent-worker
  Postgres
  Redis
  hermes-agent

Local Mac / M4 trading boundary
  Hermes dashboard/cockpit
  Hermes trading profile
  Moomoo OpenD
  broker desktop software
  MFA/session-bound tools
```

## Railway Services

| Service | Role |
|---|---|
| `sigma-api` | Fastify API, approval spine, auth, memory, journal, strategies, performance, webhooks, Nova, Hermes routing, and paper trade execution. |
| `sigma-dashboard` | Human operator UI for approvals, tasks, Hermes, voice, trading, strategies, journal, and performance. |
| `agent-worker` | Redis-backed worker for Sigma Bot and Sigma Dev tasks from `sigma:tasks`. |
| `Postgres` | Production runtime store for approvals, outcome log, identity, memory, strategies, journal, performance, paper orders, and sandbox audit. |
| `Redis` | Task queue and task result store. |
| `hermes-agent` | Secured Hermes API server on public port `8642`; API-only; dashboard disabled on Railway. |
| `hermes-dashboard-proxy` | Retired from the active path unless explicitly re-enabled. Hermes dashboard access is local M4 only. |

Public production URLs:

```text
sigma-api: https://sigma-api-production-b005.up.railway.app
sigma-dashboard: https://sigma-dashboard-production-a7a7.up.railway.app
hermes-agent: https://hermes-agent-production-62ee.up.railway.app
```

## Hermes Operating Model

Hermes cloud is the default routed brain/runtime for approved Sigma calls.

Cloud Hermes source of truth as of 2026-06-29:

```text
Provider: Kimi K2.7-code through Moonshot
hermes-agent public root: https://hermes-agent-production-62ee.up.railway.app
OpenAI-compatible base path: /v1
```

Sigma API Railway variables should point at the Hermes root domain, not the `/v1` suffix:

```text
HERMES_API_URL=https://hermes-agent-production-62ee.up.railway.app
HERMES_MODEL=hermes-agent
HERMES_TIMEOUT_MS=30000
```

Hermes auth uses `HERMES_API_KEY` on Sigma and the matching `API_SERVER_KEY` on `hermes-agent`. Never copy either key into docs or Git.

Hermes dashboard is local M4 only in the current shape. The Railway `hermes-agent` service is API-only: `/health`, `/v1/models`, and `/v1/chat/completions` are the important smoke paths. The old DeepSeek/dashboard-proxy notes are stale unless Jerry explicitly re-enables the cockpit service.

Hermes Desktop/local dashboard is the local cockpit/control surface. A previous Hermes Desktop app path was:

```text
/Users/jerryhicksjr/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app
```

Sigma API is the approval gate, audit spine, and paper broker action gate.

Hermes trading profile remains local-only with broker/OpenD/MFA/session tools.

Do not run the default local Hermes LaunchAgent as a competing gateway unless rolling back. The default LaunchAgent `ai.hermes.gateway` was disabled after the 24 hour Railway watch passed. The trading LaunchAgent `ai.hermes.gateway-trading` remains local.

## Trading Boundary

Keep these local-only:

- Moomoo OpenD
- desktop broker software
- MFA-protected broker flows
- GUI login/session tools
- Hermes trading profile
- anything requiring the M4 trading host or local LAN

Do not expose OpenD publicly. Do not place broker credentials in Railway logs, dashboard payloads, Nova payloads, or Hermes cloud prompts.

Current trading mode is dry-run/approval-only with paper execution for approved trade plans:

```text
TRADING_MODE=dry-run or unset -> dry-run
executionMode=approval_only
brokerExecution=false
liveBrokerSupported=false
paperBroker=enabled for approved trade_plan approvals only
```

SigmaBot pipeline:

```text
TradingView webhook | dashboard simulated alert | Nova voice draft
  -> TradePlanInput
  -> deterministic risk engine
  -> BLOCKED or APPROVAL-ELIGIBLE
  -> human approval queue
  -> executeTrade()
  -> paper_orders audit row
```

The deterministic risk engine, not Hermes or any LLM, decides whether a futures trade plan is blocked or approval-eligible. The allowed futures universe is `ES`, `NQ`, `MES`, and `MNQ`.

Production deployment `29265f6c-ee38-4000-90ec-e07ba2975b23` validated the paper flow on 2026-06-29. Smoke approval `13f1c2ce-5ebf-479d-9b80-a41cdc849309` produced paper order `fb6431f5-c358-48f9-9ca4-ca925905a392`.

Deployment wedge audit exception: approval `9e06d8f3-913d-4eae-81fb-1be44c77e8c4` was approved during the 2026-06-29 Railway deploy gap before the paper execution wire was active. Its outcome log reason is flagged `deploy_wedge_void`; it has no `paper_orders` row and must not count as a paper trade or P&L event.

## Trading Source Map

Jerry's trading architecture has two separate lanes.

Futures scalping/day trading is centered around Ghost and indicators:

- QuantCrawler Ghost
- QuantCrawler Trade Copier
- AlgoPro indicators
- EMax ORB
- TradingView webhooks
- QuantCrawler Trade Copier Journal

The futures universe is only:

- MNQ
- MES
- NQ
- ES

Use MNQ and MES while account size is small. Graduate to ES and NQ later as account size grows. Each ticker should eventually have its own Ghost-centered trading bot. Webhooks become more stable/permanent as reliable strategies are locked down.

Use `docs/knowledge/futures-bot-scorecard.md` to evaluate whether a futures bot deserves more trust. Trust must come from broker-sourced QuantCrawler journal evidence, not one good trade or a subjective impression.

Sigma, Hermes, and Nova are centered around stock plays:

- swing trading
- buy-and-hold
- options
- stock/ETF watchlists
- catalysts
- research
- journaling
- performance review

Do not blur these lanes. Sigma/Hermes/Nova can review futures results and store context, but Ghost plus indicators are the center of futures scalping.

## Proven Discretionary Indicator Context

Jerry reported that AlgoPro indicators were the only indicator set he used when he passed five prop firm evaluations.

Version distinction: AlgoPro V1.4 is the proven historical setup used for the passed evaluations. AlgoPro V3 Scalper Bot is the current active tool Jerry is using today.

Treat AlgoPro as a materially relevant discretionary confirmation layer for futures workflows, especially around EMax ORB and related NQ/MNQ setups. AlgoPro can inform trend, market structure, support/resistance, liquidity, reversal risk, and no-trade filters. Keep V1.4 proof separate from V3 Scalper Bot live-testing context until V3 has its own review history.

AlgoPro does not authorize live execution. If AlgoPro alerts are connected later, route them into Sigma as dry-run or approval-only events.

## External Trading Journal And Automation Surface

QuantCrawler is installed on this Mac as a Chrome web app/PWA. Treat QuantCrawler/Ghost/Trade Copier as an external automation and broker-sourced review surface, not local Sigma storage.

Important links:

```text
QuantCrawler Trade Copier: https://quantcrawler.com/tradecopier
QuantCrawler Trade Copier Journal: https://quantcrawler.com/tradecopier/journal
QuantCrawler Ghost Tickers: https://quantcrawler.com/ghost/tickers
```

The Trade Copier journal is labeled `QuantCrawler Journal` and says it is broker-sourced trades only. It can be used to compare broker-verified copied trades against Sigma/Nova/Hermes notes, EMax ORB drafts, and AlgoPro confirmation context.

Do not operate QuantCrawler toggles, flatten buttons, broker sync, or copied-trade controls unless Jerry explicitly asks in that moment.

## Market Data

Use Massive.com as the cloud-safe futures market data source for CME OHLC data.

Sigma exposes it through:

```text
GET /v1/market-data/config
GET /v1/market-data/futures/aggs?ticker=ESU6&resolution=5min&windowStartGte=2026-09-01&windowStartLte=2026-09-02
```

Moomoo/OpenD remains a local broker/session gateway, not the required CME futures data source for cloud Sigma/Nova features.

## Nova

Nova is the operator/trading assistant layer.

Important endpoints:

```text
POST /v1/nova/query
POST /v1/nova/journal
POST /v1/voice/draft-simulated-trade
```

Nova query responses must stay non-executable in the current mode. Voice trade drafts may create simulated trade approvals, but they do not place orders.

## Background Tasks

The API queues tasks into Redis when `TASK_QUEUE_MODE=redis`.

Worker lifecycle:

```text
queued -> running -> succeeded | failed
```

Important endpoints:

```text
POST /v1/task
GET /v1/task/:id
GET /v1/tasks?limit=50
```

## Storage

Production uses Railway Postgres and Redis.

Do not reintroduce production SQLite dependencies. Local `sigma.db` may exist as a local/dev artifact, but Railway production should not depend on `DB_PATH`.

Do not commit `sigma.db`. It is local SQLite/test state. It is already tracked in this checkout, so `.gitignore` alone will not hide local modifications; review or untrack it deliberately before any commit.

Current production storage settings:

```text
SIGMA_CONTROL_STORE=postgres
DATABASE_URL=<Railway Postgres private/internal URL>
REDIS_URL=<Railway Redis private/internal URL>
SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox
```

## Local Development

```bash
npm install
npm run typecheck
DB_PATH=/private/tmp/sigma-core-os-test.db npm test
```

Focused Nova/voice tests:

```bash
DB_PATH=/private/tmp/sigma-core-os-voice-nova-test.db node --import tsx/esm --test --test-concurrency=1 tests/voice-trading.test.ts tests/nova.test.ts
```

Cloud watch:

```bash
npm run cloud:watch
```

Dashboard build:

```bash
NEXT_PUBLIC_API_URL=https://sigma-api-production-b005.up.railway.app npm --prefix apps/dashboard run build
```

## Key Files

| File | Purpose |
|---|---|
| `apps/api/server.ts` | Main Fastify API entry point. |
| `apps/dashboard/app/trading/page.tsx` | Trading/Nova operator surface. |
| `core/risk/index.ts` | Deterministic futures risk engine and approval eligibility checks. |
| `core/runtime/index.ts` | Outcome logger plus approved action execution helpers, including paper trade dispatch. |
| `core/broker/index.ts` | Paper broker adapter and `paper_orders` audit writer. |
| `core/voice/trading.ts` | Nova voice trade draft parser and response copy. |
| `core/nova/index.ts` | Nova query and journal behavior. |
| `core/store/*` | Runtime storage facades and Postgres/SQLite fallbacks. |
| `scripts/cloud-watch.mjs` | Live Railway health and safety watch. |
| `docs/deployment/railway-runtime-status.md` | Current Railway runtime status. |
| `docs/deployment/railway-cloud-orchestration.md` | Service orchestration and Railway layout. |
| `docs/deployment/railway-hermes-migration.md` | Hermes Railway migration history and rules. |
| `docs/deployment/hermes-desktop-cockpit.md` | Hermes Desktop cockpit operating model. |
| `docs/deployment/hermes-dashboard-railway.md` | Live Railway dashboard backend/proxy for Desktop remote mode. |

## Rules That Do Not Change

- Never commit secrets.
- Store production secrets in Railway variables.
- Keep live broker execution disabled until a future approved design adds it.
- Keep all destructive or financial actions behind human approval.
- Keep Hermes cloud dispatch behind Sigma approvals.
- Keep Hermes Desktop as a cockpit, not an approval bypass.
- Keep OpenD and broker software local-only.
- Do not migrate ORB strategy logic while strategy backtests are still being revised externally.
