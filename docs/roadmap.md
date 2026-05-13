# Sigma Core OS — Roadmap

## Phase 0 — Scaffold (Current)
- [x] Repository structure created
- [x] Core module directories defined
- [x] Agent directories defined
- [x] Integration stubs created
- [x] Documentation scaffolded

## Phase 1 — Core Infrastructure
- [ ] Implement `core/router` — task classification and dispatch
- [ ] Implement `core/memory` — Redis + SQLite adapter
- [ ] Implement `core/policies` — approval gate engine
- [ ] Implement `core/tools` — tool registration and sandboxed execution
- [ ] Implement `core/runtime` — agent lifecycle manager
- [ ] Build `apps/api` — REST API with WebSocket support
- [ ] Build `apps/dashboard` — basic monitoring UI

## Phase 2 — First Agents
- [ ] Sigma Bot v1 — futures price queries, market data, alerts (no trading yet)
- [ ] Sigma Dev v1 — code generation, file read/write with approval gates
- [ ] Sigma Research v1 — web search and summarization

## Phase 3 — Integrations
- [ ] LiteLLM integration — model routing (GPT-4, Claude, Gemini)
- [ ] Ollama integration — local model support
- [ ] OpenMonoAgent integration — connect Sigma Dev to extended agent framework
- [ ] GitHub integration — PR creation, issue tracking via Sigma Dev

## Phase 4 — Trading & Advanced Features
- [ ] Sigma Bot — paper trading mode (no real money)
- [ ] Human approval UI for trade orders
- [ ] Risk policy engine for position sizing
- [ ] Sigma Bot — live trading (requires separate compliance review)

## Phase 5 — Production
- [ ] Multi-tenant support
- [ ] Authentication and API key management
- [ ] Deployment pipeline (Docker + CI/CD)
- [ ] Observability stack (logs, metrics, traces)
- [ ] Monetization features (see monetization.md)

## Non-Goals (for now)
- No autonomous money movement without human approval
- No public agent publishing without human review
- No production deployments from agents without approval
