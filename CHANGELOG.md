# Changelog

All notable changes to Sigma Core OS are documented here.
Format: [Semantic Versioning](https://semver.org/)

---

## [0.5.0] — 2026-05-14

### The Full Loop

First complete end-to-end cycle: agent proposes → human approves → runtime acts → system audits.

### Added

#### Slice 3b — Broker Stub (Paper)
- `core/broker/index.ts` — paper broker adapter, `validateOrder()`, `submitPaperOrder()`, `getBrokerStatus()`
- Paper-only mode enforced structurally via `BrokerModeError` — live mode rejected at type level
- Allowlisted symbols: ES, NQ, MES, MNQ
- All orders require entry, stop, target, approvalId
- Simulated fill at entry price (deterministic)
- Append-only `paper_orders` SQLite audit table
- `core/runtime/executeTrade()` wires approval → broker → outcome
- 17 new tests: paper submit, denied, live rejection, symbol validation, risk field validation, audit log

#### Slice 3d — Sandboxed Writes
- `core/sandbox/index.ts` — path validation, `executeSandboxWrite()`, SHA-256 checksums
- Blocks: path traversal (`../`), absolute paths, writes outside sandbox root
- `SIGMA_SANDBOX_PATH` env var (default: `./.sigma-sandbox`)
- Append-only `sandbox_writes` SQLite audit table with pre/post checksums
- `core/runtime/executeWrite()` wires approval → sandbox → outcome
- 13 new tests: approved write, denied, traversal blocked, overwrite blocked, checksum audit

#### Slice 3c — Multi-Model LLM Routing
- `core/llm/index.ts` — full rewrite with provider-agnostic routing chain
- Chain: GPT-5.5 → Claude-3 → Ollama (env-driven via `LLM_MODELS`)
- Automatic failover on 429, 5xx, timeout
- `ChainExhaustionError` when all providers fail — never silently hallucinates
- Per-provider env overrides: `LLM_GPT55_BASE_URL`, `LLM_CLAUDE3_API_KEY`, etc.
- `getLLMHealth()` for runtime status, `getLLMConfig()` never exposes keys
- 7 new tests: primary success, failover chains, chain exhaustion, timeout, malformed response

#### Slice 3a — Dashboard
- `apps/dashboard/` — Next.js 14 App Router, React 18, Tailwind CSS
- Dark institutional UI: "Bloomberg terminal meets AI ops center"
- Views: Approvals (pending + history), Runtime Log, Memory Store, Activity Feed
- Inline approve/deny with reason enforcement, Inspect modal for artifact payload
- NavBar with pending count badge and API health indicator
- Backend additions: `GET /v1/approvals/history`, `GET /v1/memory`, CORS headers

### Tests
- **93 tests, 0 failures** across 6 test files
- Approval spine: 14 | Memory: 16 | LLM routing: 11 | Sigma Dev: 16 | Sandbox: 13 | Broker: 17
- No Jest, no Vitest — `node:test` built-in runner only

---

## [0.4.0] — 2026-05-14

### Slice 3c — Multi-Model Routing (intermediate)
- Routing chain built (see 0.5.0 above for full details)
- 60 tests passing

---

## [0.3.0] — 2026-05-14

### Slice 2 Complete + Dashboard

#### Slice 2a — Deny Flow
- `reason` field required when denying — server enforces 400 if missing
- `resolveApproval()` stores reason in DB
- Immutability: resolved approvals cannot be changed

#### Slice 2b — Memory Rewrite
- `core/memory/index.ts` — SQLite-backed, fully namespaced
- Operations: `memSet`, `memGet`, `memDel`, `memList`, `memClear`
- Each namespace is fully isolated

#### Slice 2c — LiteLLM Integration
- `core/llm/index.ts` — environment-driven, provider-agnostic
- Agents call only `generateResponse()` — no provider SDKs in agents
- Lazy config read (ESM-cache-safe)

#### Slice 2d — Sigma Dev Agent
- `agents/sigma-dev/handler.ts` — controlled development agent
- Actions: generate_code, scaffold_file, write_docs, explain_code, refactor_code, analyze_repo
- Never writes to disk directly — all write actions require approval
- No shell execution, no git commands, no autonomous loops

#### Slice 3a — Dashboard (first build)
- 17 files committed to `apps/dashboard/`
- 53 tests passing

---

## [0.1.0] — Prior Session

### Slice 1 — Approval Spine
- `core/policies/index.ts` — SQLite approval queue
- `core/runtime/index.ts` — outcome logging
- `core/router/index.ts` — task routing
- `core/db.ts` — shared SQLite connection
- `agents/sigma-bot/handler.ts` — trade plan agent
- `apps/api/server.ts` — Fastify REST API
- Initial test suite: 12 tests

---

*"Every constraint is a safety guarantee."*
