# Sigma Core OS

**Agentic Operating System for Sigma Futures — v0.5.0**

Sigma Core OS is a human-in-the-loop agentic platform for futures trading and development operations. Every agent action that touches money, files, or production requires explicit human approval before the runtime executes anything.

> Agent proposes. Human approves. Runtime acts. System audits.

---

## Architecture

```
sigma-core-os/
├── agents/
│   ├── sigma-bot/        # Futures trade plan agent (trade_plan tasks)
│   └── sigma-dev/        # Development agent (dev_task: code, docs, scaffolds)
│
├── apps/
│   ├── api/              # Fastify REST API — approval spine, task routing
│   └── dashboard/        # Next.js 14 dark ops dashboard (read + approve/deny)
│
├── core/
│   ├── broker/           # Paper broker adapter — paper-only, no live trading
│   ├── llm/              # Multi-model LLM routing (GPT-5.5 → Claude → Ollama)
│   ├── memory/           # SQLite-backed shared memory store (namespaced)
│   ├── policies/         # Approval queue — request, resolve, immutability
│   ├── router/           # Task router — dispatches to agents by task type
│   ├── runtime/          # executeTrade(), executeWrite(), logOutcome()
│   └── sandbox/          # Sandboxed file writer — path validation, checksums
│
├── tests/                # 93 tests — node:test, no external deps
│   ├── approval-spine.test.ts
│   ├── memory.test.ts
│   ├── llm.test.ts
│   ├── sigma-dev.test.ts
│   ├── sandbox.test.ts
│   └── broker.test.ts
│
└── docs/
```

---

## The Approval Spine

Every destructive or financial action flows through the same spine:

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
POST /v1/approvals/:id  { approved: true/false }
    ↓
Runtime executes (executeTrade / executeWrite)
    ↓
Outcome logged (append-only)
```

**Sigma Bot NEVER executes a trade without an approved Approval record.**
**Sigma Dev NEVER writes a file without an approved Approval record.**

---

## Agents

| Agent | Task Type | Actions |
|---|---|---|
| **Sigma Bot** | `trade_plan` | Proposes trade signals, queues for approval |
| **Sigma Dev** | `dev_task` | Generates code/docs/scaffolds, queues for approval |

### Sigma Bot
- Receives `trade_plan` tasks with symbol, direction, quantity
- Runs deterministic signal logic (no LLM for math)
- Uses LLM only for human-readable rationale
- Queues approval before any broker interaction

### Sigma Dev
- Supported actions: `generate_code`, `scaffold_file`, `write_docs`, `refactor_code`, `explain_code`, `analyze_repo`
- Read-only actions (explain, analyze) complete immediately — no approval needed
- Write actions always queue an approval — runtime writes to `.sigma-sandbox/` after approval
- Never writes to disk directly. Never executes shell commands.

---

## Core Modules

### core/llm — Multi-Model Routing
Provider-agnostic LLM chain. Agents call only `generateResponse()`.

```
LLM_MODELS=gpt-5.5,claude-3,ollama   # env-driven chain
```

Automatic failover on 429 / 5xx / timeout. `ChainExhaustionError` when all providers fail — never silently hallucinates.

### core/sandbox — Sandboxed Writes
All Sigma Dev file writes go through `executeSandboxWrite()`:
- Blocks path traversal (`../`)
- Blocks absolute paths
- Blocks writes outside `SIGMA_SANDBOX_PATH`
- SHA-256 checksum before and after write
- Append-only `sandbox_writes` audit table

### core/broker — Paper Broker
Paper-only broker adapter. Live mode is structurally rejected.
- Allowed symbols: `ES`, `NQ`, `MES`, `MNQ`
- All orders require entry, stop, target, approvalId
- Simulated fill at entry price
- Append-only `paper_orders` audit table

---

## API

| Method | Route | Description |
|---|---|---|
| POST | `/v1/task` | Submit a task to the router |
| GET | `/v1/approvals` | List pending approvals |
| GET | `/v1/approvals/history` | List all resolved approvals |
| GET | `/v1/approvals/:id` | Get one approval |
| POST | `/v1/approvals/:id` | Approve or deny |
| GET | `/v1/log` | Outcome log |
| GET | `/v1/memory` | Memory store (optional `?namespace=`) |
| GET | `/health` | Liveness check |

---

## Dashboard

Next.js 14 App Router — dark institutional UI.

| View | Path | Description |
|---|---|---|
| Approvals | `/approvals` | Pending queue + history, approve/deny inline |
| Runtime Log | `/log` | Outcome log with filter |
| Memory | `/memory` | Memory store browser |
| Activity | `/activity` | Agent activity feed |

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
# 93 tests, 0 failures
```

All tests use Node's built-in `node:test` runner. No Jest, no Vitest, no external test deps. Fetch is mocked globally — no real API calls.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, TypeScript, ESM |
| HTTP | Fastify 4 |
| Database | SQLite via `node-sqlite3-wasm` (pure WASM) |
| LLM | LiteLLM proxy → OpenAI / Anthropic / Ollama |
| Dashboard | Next.js 14, React 18, Tailwind CSS |
| Tests | `node:test` (built-in) |

---

## Environment Variables

```bash
# LLM
LLM_MODELS=gpt-5.5,claude-3,ollama   # routing chain
LLM_API_KEY=sk-...                    # shared key (or per-provider below)
LLM_GPT55_API_KEY=sk-...             # per-provider override
LLM_CLAUDE3_API_KEY=sk-...
LLM_TIMEOUT_MS=30000

# Sandbox
SIGMA_SANDBOX_PATH=./.sigma-sandbox  # default

# API
PORT=3001
DASHBOARD_ORIGIN=http://localhost:3000
```

---

## Immutable Safety Rules

These rules are enforced at the code level — not just policy:

1. **Sigma Bot never executes a trade without an approved Approval record**
2. **Sigma Dev never writes a file without an approved Approval record**
3. **Denial requires a reason** — enforced at API level (400 if missing)
4. **Approval records are immutable** — resolved status cannot be changed
5. **Logs are append-only** — `outcome_log`, `approvals`, `sandbox_writes`, `paper_orders`
6. **Sandbox blocks path traversal** — structurally, not just checked
7. **Broker rejects live mode** — `BrokerModeError` thrown, not logged and skipped
8. **LLM chain never silently fails** — `ChainExhaustionError` with full failure audit

---

*Sigma Core OS — built with deliberate constraints. Every constraint is a safety guarantee.*
