# Changelog

All notable changes to Sigma Core OS are documented here.
Format: [Semantic Versioning](https://semver.org/)

---

## [0.6.1] — 2026-05-14

### LLM Rationale Integration

Sigma Risk Engine now generates plain-language trade plan explanations via the multi-model routing chain. Deterministic calculations remain the single source of truth — LLM only explains.

### Added
- `rationale` field on `TradePlanResult` — populated by `generateResponse()` after deterministic calc
- `generateTradePlanWithRationale()` async function in `core/risk/index.ts`
- Provider metadata stored alongside rationale: model, latency, tokens
- Rationale visible in dashboard Inspect modal on approval queue
- Rationale stored in approval payload and runtime log
- Rationale generation failure is non-blocking — plan proceeds, rationale = undefined
- 5 new rationale tests: success, provider fallback, malformed response handled, non-blocking failure, deterministic values preserved

### Tests
- **132 tests, 0 failures** across 7 test files

---

## [0.6.0] — 2026-05-14

### Sigma Risk Engine

Deterministic position sizing and risk management for futures traders.

#### Safety Model
- No autonomous execution — all plans require human approval via POST /v1/approvals/:id
- Paper-only broker — no live orders, no real credentials
- Sandboxed writes — Sigma Dev cannot write outside .sigma-sandbox/
- Immutable audit trail — all logs append-only, approval records never modified after resolution
- LLM never performs calculations — deterministic engine is the only source of truth

#### Features
- Contract specs: exact CME values for ES ($50/pt), NQ ($20/pt), MES ($5/pt), MNQ ($2/pt)
- ATR-based stop calculator: entry ± (ATR × multiplier)
- Position sizing: dollar risk ÷ (stopPoints × pointValue) = contracts (floor, deterministic)
- TP/SL calculator: stop distance × R:R ratio = target distance
- Max daily loss guard: blocks at limit, warns at 80%
- Prop firm drawdown guard: blocks at limit, warns at 75%, trailing high-water support
- Trade plan generator: combines all, produces blocked/unblocked plan for approval
- Approval-gated trade plan submission: blocked plans return 422, open plans queue to approval spine

#### API
- `GET /v1/risk/contracts` — list all supported instruments with CME specs
- `POST /v1/risk/position-size` — calculate contracts for given dollar risk and stop
- `POST /v1/risk/tp-sl` — calculate take profit and stop loss from R:R ratio
- `POST /v1/risk/trade-plan` — generate complete plan, queue for approval if unblocked

#### Dashboard
- Risk Engine page: contract selector, 9-field form, stat cards, plan table, warnings, blocked state
- Submit for Approval button routes to approval queue
- NavBar updated with Risk link

#### Tests
- 127 tests, 0 failures across 7 test files

---

## [0.5.0] — 2026-05-14

### The Full Loop

First complete end-to-end cycle: agent proposes → human approves → runtime acts → system audits.

#### Slice 3b — Broker Stub (Paper)
- `core/broker/index.ts` — paper broker adapter, `validateOrder()`, `submitPaperOrder()`, `getBrokerStatus()`
- Paper-only mode enforced structurally via `BrokerModeError` — live mode rejected at type level
- Allowlisted symbols: ES, NQ, MES, MNQ
- Simulated fill at entry price (deterministic)
- Append-only `paper_orders` SQLite audit table
- 17 new tests

#### Slice 3d — Sandboxed Writes
- `core/sandbox/index.ts` — path validation, `executeSandboxWrite()`, SHA-256 checksums
- Blocks: path traversal, absolute paths, writes outside sandbox root
- Append-only `sandbox_writes` SQLite audit table with pre/post checksums
- 13 new tests

#### Slice 3c — Multi-Model LLM Routing
- `core/llm/index.ts` — full rewrite with provider-agnostic routing chain
- Chain: GPT-5.5 → Claude-3 → Ollama (env-driven via LLM_MODELS)
- Automatic failover on 429, 5xx, timeout
- `ChainExhaustionError` when all providers fail — never silently hallucinates
- 7 new tests

#### Slice 3a — Dashboard
- `apps/dashboard/` — Next.js 14 App Router, React 18, Tailwind CSS
- Views: Approvals, Runtime Log, Memory Store, Activity Feed
- Inline approve/deny with reason enforcement, Inspect modal

### Tests
- 93 tests, 0 failures across 6 test files

---

## [0.3.0] — 2026-05-14

### Slice 2 Complete

#### Slice 2a — Deny Flow
- `reason` field required when denying — server enforces 400 if missing
- Immutability: resolved approvals cannot be changed

#### Slice 2b — Memory Rewrite
- `core/memory/index.ts` — SQLite-backed, fully namespaced

#### Slice 2c — LiteLLM Integration
- `core/llm/index.ts` — environment-driven, provider-agnostic

#### Slice 2d — Sigma Dev Agent
- `agents/sigma-dev/handler.ts` — controlled development agent
- Never writes to disk directly — all write actions require approval

---

## [0.1.0] — Prior Session

### Slice 1 — Approval Spine
- `core/policies/index.ts` — SQLite approval queue
- `core/runtime/index.ts` — outcome logging
- `core/db.ts` — shared SQLite connection
- `agents/sigma-bot/handler.ts` — trade plan agent
- `apps/api/server.ts` — Fastify REST API
- Initial test suite: 12 tests

---

*"Every constraint is a safety guarantee."*
