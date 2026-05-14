# Sigma Core OS

**Agentic Operating System for Sigma Futures — v0.6.0**

Sigma Core OS is a human-in-the-loop agentic platform for futures trading and development operations. Every agent action that touches money, files, or production requires explicit human approval before the runtime executes anything.

> Agent proposes. Human approves. Runtime acts. System audits.

---

## Architecture

```
sigma-core-os/
├── agents/
│   ├── sigma-bot/         # Futures trade plan agent (trade_plan tasks)
│   └── sigma-dev/         # Development agent (dev_task: code, docs, scaffolds)
│
├── apps/
│   ├── api/               # Fastify REST API — approval spine, task routing, risk engine
│   └── dashboard/         # Next.js 14 dark ops dashboard
│
├── core/
│   ├── broker/            # Paper broker adapter — paper-only, no live trading ever
│   ├── llm/               # Multi-model LLM routing (GPT-5.5 → Claude → Ollama)
│   ├── memory/            # SQLite-backed shared memory store (namespaced)
│   ├── policies/          # Approval queue — request, resolve, immutability enforced
│   ├── risk/              # Sigma Risk Engine — deterministic calc, no LLM math
│   ├── router/            # Task router — dispatches to agents by task type
│   ├── runtime/           # executeTrade(), executeWrite(), logOutcome()
│   └── sandbox/           # Sandboxed file writer — path validation, SHA-256 checksums
│
└── tests/                 # 127 tests — node:test built-in runner, no external deps
    ├── approval-spine.test.ts
    ├── memory.test.ts
    ├── llm.test.ts
    ├── sigma-dev.test.ts
    ├── sandbox.test.ts
    ├── broker.test.ts
    └── risk.test.ts
```

---

## System Flow

```
                    ┌─────────────────────────────────────────────┐
                    │              SIGMA CORE OS                   │
                    └─────────────────────────────────────────────┘
                                         │
              ┌──────────────────────────┴──────────────────────────┐
              │                                                       │
     ┌────────▼────────┐                                   ┌────────▼────────┐
     │   Sigma Bot      │                                   │   Sigma Dev      │
     │  (trade_plan)    │                                   │  (dev_task)      │
     └────────┬────────┘                                   └────────┬────────┘
              │ proposes                                            │ proposes
              │ trade plan                                          │ file artifact
              ▼                                                     ▼
     ┌─────────────────────────────────────────────────────────────────────┐
     │                    APPROVAL SPINE (core/policies)                    │
     │              requestApproval() → pending SQLite record               │
     └─────────────────────────────────┬───────────────────────────────────┘
                                       │
                             ┌─────────▼─────────┐
                             │   HUMAN REVIEW     │
                             │   Dashboard UI     │
                             │   POST /v1/approvals/:id │
                             └─────────┬─────────┘
                                       │ approved = true
                              ┌────────┴────────┐
                              │                  │
                    ┌─────────▼─────┐   ┌───────▼────────┐
                    │  executeTrade  │   │  executeWrite   │
                    │  core/runtime  │   │  core/runtime   │
                    └─────────┬─────┘   └───────┬────────┘
                              │                  │
                    ┌─────────▼─────┐   ┌───────▼────────┐
                    │  Paper Broker  │   │  Sandbox Path   │
                    │  core/broker   │   │  core/sandbox   │
                    └─────────┬─────┘   └───────┬────────┘
                              │                  │
                    ┌─────────▼──────────────────▼────────┐
                    │         AUDIT LOG (append-only)       │
                    │  outcome_log | paper_orders           │
                    │  sandbox_writes | approvals           │
                    └──────────────────────────────────────┘
```

---

## Feature Matrix

| Feature | Status | Version |
|---|---|---|
| Approval spine (request / resolve / deny) | ✅ Live | v0.1.0 |
| Immutable approval records | ✅ Live | v0.1.0 |
| Append-only audit log | ✅ Live | v0.1.0 |
| SQLite-backed memory store | ✅ Live | v0.2.0 |
| Sigma Bot — trade plan agent | ✅ Live | v0.2.0 |
| Sigma Dev — development agent | ✅ Live | v0.3.0 |
| Multi-model LLM routing chain | ✅ Live | v0.5.0 |
| Automatic provider failover | ✅ Live | v0.5.0 |
| Sandboxed file writes + checksums | ✅ Live | v0.5.0 |
| Paper broker adapter | ✅ Live | v0.5.0 |
| Dashboard (Next.js 14 dark UI) | ✅ Live | v0.5.0 |
| Sigma Risk Engine | ✅ Live | v0.6.0 |
| Position sizing (4 CME instruments) | ✅ Live | v0.6.0 |
| ATR-based stop calculator | ✅ Live | v0.6.0 |
| TP/SL calculator (R:R ratio) | ✅ Live | v0.6.0 |
| Max daily loss guard | ✅ Live | v0.6.0 |
| Prop firm drawdown guard | ✅ Live | v0.6.0 |
| LLM rationale on trade plans | ✅ Live | v0.6.1 |
| User accounts / workspaces | 🔜 v0.7.0 | — |
| Strategy profiles | 🔜 v0.7.0 | — |
| Prop firm templates | 🔜 v0.7.0 | — |
| Approval roles | 🔜 v0.7.0 | — |
| Audit search | 🔜 v0.7.0 | — |
| Risk analytics dashboard | 🔜 v0.7.0 | — |
| Journal timeline | 🔜 v0.7.0 | — |
| Performance dashboard | 🔜 v0.7.0 | — |
| Live broker execution | ❌ Deferred | TBD |
| Webhooks | ❌ Deferred | TBD |
| Autonomous loops | ❌ Never | — |

---

## Safety Model

These are the non-negotiable runtime guarantees of Sigma Core OS:

### No Autonomous Execution
No agent ever executes a trade, writes a file, or affects production without a human explicitly approving a specific pending Approval record. There is no "auto-approve" mode. There is no threshold that triggers automatic execution.

### Human Approval Required
Every financial and destructive action flows through `requestApproval()`. The approval is pending until a human calls `POST /v1/approvals/:id` with `{ approved: true, resolvedBy: "name" }`. Denied approvals require a `reason`. Both states are permanent — approval records cannot be modified after resolution.

### Paper-Only Broker
The broker layer only has a paper adapter. Live mode is structurally rejected via `BrokerModeError` — it is not a config flag, it is a type-level impossibility. No real credentials exist. No Tradovate, IBKR, or Alpaca connections exist.

### Sandboxed Writes
Sigma Dev cannot write to arbitrary paths. All writes go through `executeSandboxWrite()` which validates paths structurally: path traversal (`../`) is blocked before normalization, absolute paths are rejected, and writes outside `SIGMA_SANDBOX_PATH` are blocked at the filesystem boundary.

### Immutable Audit Trail
Every action is logged append-only across four tables: `outcome_log`, `approvals`, `sandbox_writes`, `paper_orders`. Nothing is deleted. Nothing is updated. If something happened, it is in the log.

### Deterministic Risk Calculations
The Sigma Risk Engine performs all math deterministically — no LLM involvement in any calculation. The LLM is used downstream only to explain a plan in plain language. The deterministic engine result is always the source of truth.

### LLM Chain Never Silently Fails
If all LLM providers fail, the routing chain throws `ChainExhaustionError` with a full failure audit. It never returns a hallucinated success response. LLM rationale failure on trade plans is non-blocking — the plan proceeds without rationale rather than with incorrect rationale.

---

## The Approval Spine

```
Task submitted
     ↓
Router → Agent (sigma-bot / sigma-dev)
     ↓
Agent reasons with LLM (narrative only, no math)
     ↓
requestApproval() → pending record in SQLite
     ↓
Human reviews in dashboard (or via API)
     ↓
POST /v1/approvals/:id { approved: true/false }
     ↓
Runtime executes (executeTrade / executeWrite)
     ↓
Outcome logged (append-only)
```

---

## Sigma Risk Engine

Deterministic position sizing and risk management for ES, NQ, MES, MNQ.

### Contract Specs (CME Exact Values)

| Symbol | Name | Tick Size | Tick Value | Point Value |
|---|---|---|---|---|
| ES | E-mini S&P 500 | 0.25 | $12.50 | $50.00 |
| NQ | E-mini NASDAQ-100 | 0.25 | $5.00 | $20.00 |
| MES | Micro E-mini S&P 500 | 0.25 | $1.25 | $5.00 |
| MNQ | Micro E-mini NASDAQ-100 | 0.25 | $0.50 | $2.00 |

### Risk Calculations

```
Position Size:   contracts = floor(riskDollars / (stopPoints × pointValue))
ATR Stop:        stopPrice = entry ± (ATR × multiplier)
Target (R:R):    targetDistance = stopDistance × rrRatio
Daily Loss:      blocks at maxDailyLossPct, warns at 80% utilization
Prop Drawdown:   blocks at maxDrawdownPct, warns at 75% utilization
```

### Risk API

| Method | Route | Description |
|---|---|---|
| GET | `/v1/risk/contracts` | List all 4 instruments with CME specs |
| POST | `/v1/risk/position-size` | Calculate contracts from dollar risk + stop |
| POST | `/v1/risk/tp-sl` | Calculate take profit / stop loss from R:R |
| POST | `/v1/risk/trade-plan` | Generate complete plan, queue approval if unblocked |

---

## Multi-Model LLM Routing

```
LLM_MODELS=gpt-5.5,claude-3,ollama
```

Agents call only `generateResponse()` — no provider SDKs in agent code.

Automatic failover: 429 → next provider. 5xx → next provider. Timeout → next provider. Full chain exhaustion → `ChainExhaustionError` (never silent failure).

---

## Agents

| Agent | Task Type | Allowed Actions |
|---|---|---|
| **sigma-bot** | `trade_plan` | Propose trade signals, queue for approval |
| **sigma-dev** | `dev_task` | `generate_code`, `scaffold_file`, `write_docs`, `refactor_code`, `explain_code`, `analyze_repo` |

---

## API Reference

| Method | Route | Description |
|---|---|---|
| POST | `/v1/task` | Submit a task to the router |
| GET | `/v1/approvals` | List pending approvals |
| GET | `/v1/approvals/history` | List all resolved approvals |
| GET | `/v1/approvals/:id` | Get one approval |
| POST | `/v1/approvals/:id` | Approve or deny |
| GET | `/v1/log` | Outcome log |
| GET | `/v1/memory` | Memory store |
| GET | `/v1/risk/contracts` | CME contract specs |
| POST | `/v1/risk/position-size` | Position sizing |
| POST | `/v1/risk/tp-sl` | TP/SL calculator |
| POST | `/v1/risk/trade-plan` | Generate + queue trade plan |
| GET | `/health` | Liveness check |

---

## Dashboard

Next.js 14 App Router — dark institutional UI.

| View | Path | Description |
|---|---|---|
| Approvals | `/approvals` | Pending queue + history, approve/deny inline, Inspect modal |
| Runtime Log | `/log` | Outcome log with filter |
| Memory | `/memory` | Memory store browser |
| Activity | `/activity` | Agent activity feed |
| Risk Engine | `/risk` | Position sizing, trade plan generator, Submit for Approval |

```bash
# Terminal 1 — API
npm run dev

# Terminal 2 — Dashboard
npm run dashboard
# → http://localhost:3000
```

---

## Running Tests

```bash
npm test
# 127 tests, 0 failures — 7 test files
# node:test built-in runner — no Jest, no Vitest
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, TypeScript, ESM |
| HTTP | Fastify 4 |
| Database | SQLite via `node-sqlite3-wasm` (pure WASM) |
| LLM | Multi-model chain: GPT-5.5 → Claude → Ollama |
| Dashboard | Next.js 14, React 18, Tailwind CSS |
| Tests | `node:test` (built-in, no external deps) |

---

## Environment Variables

```bash
# LLM routing chain
LLM_MODELS=gpt-5.5,claude-3,ollama
LLM_API_KEY=sk-...
LLM_GPT55_API_KEY=sk-...
LLM_CLAUDE3_API_KEY=sk-...
LLM_TIMEOUT_MS=30000

# Sandbox
SIGMA_SANDBOX_PATH=./.sigma-sandbox

# API
PORT=3001
DASHBOARD_ORIGIN=http://localhost:3000
```

---

## Immutable Safety Rules

Enforced at the code level — not configuration, not policy:

1. **No autonomous execution** — no agent acts without an approved Approval record
2. **Human approval required** — `POST /v1/approvals/:id` with explicit `approved: true`
3. **Paper-only broker** — live mode throws `BrokerModeError`, structurally blocked
4. **Sandboxed writes** — path traversal and absolute paths blocked structurally
5. **Denial requires reason** — 400 error if `reason` missing on deny
6. **Immutable approvals** — resolved records cannot be changed
7. **Append-only logs** — `outcome_log`, `approvals`, `sandbox_writes`, `paper_orders`
8. **No LLM math** — deterministic engine is always the calculation source of truth
9. **No silent LLM failure** — `ChainExhaustionError` with full audit on chain exhaustion
10. **No new agents** — only sigma-bot and sigma-dev exist

---

*Sigma Core OS — built with deliberate constraints.*
*Every constraint is a safety guarantee.*
*Every rule is enforced in code, not in spirit.*
