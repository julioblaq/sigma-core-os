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
| `hermes-agent` | Online | Secured default Hermes API server reached through Sigma approval gates. |

## Implemented Middleware

| Surface | Runtime | Safety boundary |
|---|---|---|
| TradingView webhook | `sigma-api` `/v1/webhooks/tradingview` | Approval-only; no broker execution. |
| Simulated trading alert | `sigma-api` `/v1/trading/simulated-alert` and dashboard `/trading` | Approval-only; no market or broker dependency. |
| Nova voice trading draft | `sigma-api` `/v1/voice/draft-simulated-trade` and dashboard `/trading` | Turns speech/transcript into a simulated trade approval. |
| Task queue | `sigma-api` + `agent-worker` + `Redis` | API enqueues, worker executes router, results stored in Redis. |

## Parked Railway Resources

| Resource | Current state | Decision |
|---|---|---|
| `trading-middleware-cloud` | Empty offline service shell; no source repo, no active deployment, no domain, one demo variable. | Delete after confirming destructive Railway cleanup intent, or keep parked until a separate middleware service is needed. |
| `sigma-api-volume` | Still attached at `/data`; production no longer uses `DB_PATH` and `SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox` is live. | Retain only as rollback data until the Postgres soak window closes. |

## Local Only

| Service | Host | Reason |
|---|---|---|
| Hermes trading profile | Local Mac | May depend on broker sessions, MFA, GUI state, OpenD, or private LAN access. |
| Moomoo OpenD | M1 trading host | Must never be publicly exposed. |
| Desktop broker software | M1 trading host | GUI/MFA/session-bound. |
| Local auth/session tools | M1 trading host | Local-only trust boundary. |

## Verified On 2026-06-07

- `sigma-api` `/health` returned HTTP 200.
- `sigma-dashboard` `/trading` returned HTTP 200.
- `hermes-agent` status through `sigma-api` returned configured and ok.
- `/v1/task` queued through Redis and `agent-worker` wrote a result.
- Nova voice simulated trade draft queued an approval and the smoke approval was denied.
- Simulated trading alert queued an approval and the smoke approval was denied.
- `DB_PATH` is absent from `sigma-api` Railway variables.
- `SIGMA_CONTROL_STORE=postgres` and `SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox` are live on `sigma-api`.
