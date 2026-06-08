# Railway Runtime Status

Owner: Jerry Hicks Jr.
Date: 2026-06-07
Status: Cloud migration baseline is live.

## Cloud Runtime

| Service | Status | Role |
|---|---:|---|
| `sigma-api` | Online | Fastify API, approval spine, auth, memory, risk, audit, webhooks, voice draft routing. |
| `sigma-dashboard` | Online | Human operator dashboard for approvals, tasks, Hermes, voice, trading, strategies, journal, and performance. |
| `agent-worker` | Online | Redis-backed worker for Sigma Bot and Sigma Dev tasks from `sigma:tasks`. |
| `Postgres` | Online | Production runtime store for approvals, outcome log, memory, identity, strategies, journal, performance, paper orders, and sandbox audit rows. |
| `Redis` | Online | Task queue and task result store. |
| `hermes-agent` | Online | Secured default Hermes API server reached through Sigma approval gates. Stateless Railway runtime for now. |

## Implemented Middleware

| Surface | Runtime | Safety boundary |
|---|---|---|
| TradingView webhook | `sigma-api` `/v1/webhooks/tradingview` | Approval-only; no broker execution. |
| Simulated trading alert | `sigma-api` `/v1/trading/simulated-alert` and dashboard `/trading` | Approval-only; no market or broker dependency. |
| Nova voice trading draft | `sigma-api` `/v1/voice/draft-simulated-trade` and dashboard `/trading` | Turns speech/transcript into a simulated trade approval. |
| Nova operator query/journal | `sigma-api` `/v1/nova/query` and `/v1/nova/journal` | Query returns non-executable intent; journal stores durable notes and screenshot pointers. |
| Task queue | `sigma-api` + `agent-worker` + `Redis` | API enqueues, worker records queued/running/succeeded/failed status, dashboard lists recent jobs. |

## Removed Railway Resources

| Resource | Final state | Notes |
|---|---|---|
| `trading-middleware-cloud` | Deleted from Railway production on 2026-06-07 | It had no source repo, no active deployment, no domain, and only a demo variable. Middleware behavior remains in `sigma-api`. |

## Parked Railway Resources

| Resource | Current state | Decision |
|---|---|---|
| `sigma-api-volume` | Still attached at `/data`; production no longer uses `DB_PATH` and `SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox` is live. | Retain only as rollback data until the Postgres soak window closes. |

## Hermes Cutover State

| Item | Status | Decision |
|---|---:|---|
| Railway `hermes-agent` active deployment | Healthy, active deployment is about 17 hours old as of 2026-06-07 11:11 EDT | Keep watching until the 24 hour window completes. |
| `HERMES_HOME` persistence | `HERMES_HOME=/opt/data`, no Railway volume attached | Acceptable for the current stateless approved chat bridge. Add a Railway volume before relying on long-term Hermes session memory or profile state. |
| Local default LaunchAgent `ai.hermes.gateway` | Still running | Keep as rollback until the 24 hour Railway stability window completes. |
| Local trading LaunchAgent `ai.hermes.gateway-trading` | Still running | Keep local. Do not migrate while broker/OpenD/MFA/local-session needs remain possible. |

## Local Only

| Service | Host | Reason |
|---|---|---|
| Hermes trading profile | Local Mac | May depend on broker sessions, MFA, GUI state, OpenD, or private LAN access. |
| Moomoo OpenD | M1 trading host | Local broker/session gateway only. Must never be publicly exposed. Do not depend on it for US CME futures market data because regional CME entitlement is a known MooMoo licensing wall. |
| Desktop broker software | M1 trading host | GUI/MFA/session-bound. |
| Local auth/session tools | M1 trading host | Local-only trust boundary. |

## Market Data Decision

Use Massive.com as the cloud-safe futures market data source after the 24 hour Railway stability watch. The target endpoint is the Massive futures aggregates path for CME OHLC data:

```text
/futures/v1/aggs/{ticker}
```

Moomoo/OpenD remains local on the M1 for broker connectivity, local sessions, and trading-gateway behavior. It should not be used as the required CME futures data dependency for Sigma/Nova cloud features.

## Verified On 2026-06-07

- `sigma-api` `/health` returned HTTP 200.
- `sigma-dashboard` `/trading` returned HTTP 200.
- `hermes-agent` status through `sigma-api` returned configured and ok.
- `hermes-agent` model listing through `sigma-api` returned model `hermes-agent`.
- Approval-gated Hermes chat dispatch returned: `Hermes cloud bridge healthy.`
- `/v1/task` queued through Redis and `agent-worker` wrote a result.
- `/v1/tasks?limit=50` listed recent jobs and repaired stale queued rows from legacy worker results during the deploy window.
- `/v1/nova/query` returned non-executable `intent=null`.
- `/v1/nova/journal` created a durable journal memory entry with a screenshot pointer.
- Nova voice simulated trade draft queued an approval and the smoke approval was denied.
- Simulated trading alert queued an approval and the smoke approval was denied.
- `/v1/trading/config` returned `tradingMode=dry-run`, `executionMode=approval_only`, and `brokerExecution=false`.
- `DB_PATH` is absent from `sigma-api` Railway variables.
- `SIGMA_CONTROL_STORE=postgres` and `SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox` are live on `sigma-api`.

## Automated Cloud Watch

GitHub Actions runs `.github/workflows/cloud-watch.yml` hourly at minute 17. The scheduled run checks:

- `sigma-api` health.
- `sigma-dashboard` `/trading`.
- `hermes-agent` health.
- Trading safety config remains `dry-run` with broker execution disabled.
- Nova query response contract remains read-only and non-blocking.

Manual workflow dispatch can enable `write_smoke=true` for the deeper audit. That mode also creates a Nova journal smoke entry, queues one Nova voice draft approval, and immediately denies the smoke approval with reason `Automated cloud watch cleanup`.
