# Post-Migration Audit - Nova / Sigma / Middleware

Owner: Jerry Hicks Jr.
Date: 2026-06-07
Status: Live verified on Railway after PRs #22 and #23.

## Summary

This audit confirms the post-migration safety layer for Sigma Core OS on Railway:

- Sigma API, dashboard, worker, Postgres, Redis, and default Hermes are cloud-safe services.
- Broker gateways, OpenD, desktop broker software, local auth, and trading Hermes stay local.
- Trading middleware behavior remains approval-only and dry-run by default.
- Nova query and journal endpoints are safe operator surfaces and do not produce executable intents.

## A. Task Status And Worker Flow

- [x] New tasks create a Redis status document with `status = queued`.
- [x] The worker records `status = running` before routing work.
- [x] Worker completion records final `status = succeeded` or `failed`.
- [x] `GET /v1/task/:id` returns `id`, `type`, `status`, `created_at`, `updated_at`, and `result_summary` when the Redis status document exists.
- [x] `GET /v1/tasks?limit=50` returns recent task status documents.

Implementation notes:

- Status documents are stored at `sigma:task-status:<taskId>`.
- Recent task IDs are indexed at `sigma:tasks:status-index`.
- Legacy `sigma:task-result:<taskId>` reads are still supported as a fallback.

## B. Dashboard Visibility

- [x] Dashboard `/tasks` includes a Background Tasks view.
- [x] The view lists recent tasks with `created_at | type | status | summary`.
- [x] Clicking a task row loads basic detail including status, dates, error, and result payload.
- [x] The list refreshes every five seconds and refreshes immediately after submitting a task.

## C. Trading Middleware Dry-Run Behavior

- [x] `GET /v1/trading/config` reports the current safety mode.
- [x] `TRADING_MODE` defaults to `dry-run`.
- [x] API responses include `executionMode = approval_only`, `brokerExecution = false`, and `liveBrokerSupported = false`.
- [x] TradingView/test alerts flow into `sigma-api`.
- [x] Middleware runs deterministic validation and sizing logic.
- [x] No real orders hit Tradovate, Ghost, or broker gateways.
- [x] Approval records are the current "would place order" audit surface.

There is no separate `simulated_orders` endpoint yet. The current durable review surface is the Sigma approval record plus outcome/audit history.

## D. Nova Integration And Guardrails

- [x] `POST /v1/nova/query` accepts `sessionId`, `transcript`, `screenshotBase64`, `activeApp`, `activeWindowTitle`, and `context`.
- [x] `POST /v1/nova/query` returns `answer`, `voiceText`, `highlights`, and `intent = null`.
- [x] `POST /v1/nova/journal` creates a durable `nova-journal` memory entry.
- [x] Nova journal entries store notes, tags, context, and a screenshot pointer/hash instead of raw screenshot bytes.
- [x] Voice trade draft behavior remains approval-only and does not place orders.

## E. Broker And Hermes Safety

- [x] OpenD, broker gateways, desktop broker software, and local auth stay local-only.
- [x] OpenD must not be exposed to Railway or the public internet.
- [x] Broker credentials must not be logged in cloud services or sent through Nova/Hermes payloads.
- [ ] Disable the default local Hermes LaunchAgent only after the cloud Hermes 24-hour stability window is complete.
- [x] Keep the trading Hermes LaunchAgent local and running.

## F. Repo And Docs Hygiene

- [x] Railway production does not use `DB_PATH`.
- [x] SQLite remains only as a local fallback path and migration source.
- [x] Railway docs cover Postgres, Redis, Hermes cloud, and broker-local boundaries.
- [x] This audit captures current Nova voice trade draft behavior and limits.

## Verification Commands

```text
npm run typecheck
DB_PATH=/tmp/sigma-core-os-audit-full.db npm test
NEXT_PUBLIC_API_URL=https://sigma-api-production-b005.up.railway.app npm --prefix apps/dashboard run build
```

## Live Smoke Results

- [x] `GET /v1/trading/config` returned `tradingMode = dry-run`, `executionMode = approval_only`, and `brokerExecution = false`.
- [x] `POST /v1/nova/query` returned `intent = null` with screen/session highlights.
- [x] `POST /v1/nova/journal` created a durable entry with a `memory://nova-screenshot/...` pointer.
- [x] `POST /v1/task` returned `202 Accepted`, then `GET /v1/task/:id` moved from `queued` to final `failed` for the harmless `unknown_task` smoke.
- [x] `GET /v1/tasks?limit=50` listed recent task status rows and hydrated stale queued rows from legacy worker results during the deploy window.
- [x] `POST /v1/voice/draft-simulated-trade` returned `202 Accepted`, queued an approval, and kept `brokerExecution = false`.
- [x] The smoke voice-trade approval was denied.
- [x] `POST /v1/webhooks/tradingview` without a secret returned `401`.
- [x] Dashboard `/tasks` rendered the Background Tasks view.

Live endpoints checked:

```text
GET  /v1/trading/config
POST /v1/nova/query
POST /v1/nova/journal
POST /v1/task
GET  /v1/task/:id
GET  /v1/tasks?limit=50
GET  /tasks on sigma-dashboard
```
