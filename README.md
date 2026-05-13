# Sigma Core OS

**Agentic Operating System for Sigma Futures**

Sigma Core OS routes tasks between specialized AI agents, stores shared memory,
manages tools, logs all actions, and requires human approval for trading,
money movement, destructive file actions, deployments, and public publishing.

---

## Project Structure

```
sigma-core-os/
├── apps/
│   ├── dashboard/          # Web monitoring UI
│   └── api/                # REST + WebSocket API server (TypeScript)
│
├── agents/
│   ├── sigma-bot/          # Futures trading assistant (Python)
│   ├── sigma-dev/          # Coding agent (Python)
│   └── sigma-research/     # Research & analysis agent (Python)
│
├── core/
│   ├── router/             # Task router — classifies and dispatches tasks (TypeScript)
│   ├── memory/             # Shared memory store (TypeScript)
│   ├── policies/           # Human approval gate engine (TypeScript)
│   ├── tools/              # Tool registry and sandboxed execution (TypeScript)
│   └── runtime/            # Agent lifecycle manager (TypeScript)
│
├── integrations/
│   ├── openmonoagent/      # OpenMonoAgent connector (Phase 3)
│   ├── litellm/            # LLM proxy via LiteLLM
│   ├── ollama/             # Local LLM via Ollama
│   └── github/             # GitHub API integration
│
└── docs/
    ├── architecture.md     # System architecture and data flow
    ├── roadmap.md          # Development phases
    ├── agent-rules.md      # Rules all agents must follow
    └── monetization.md     # Revenue strategy
```

---

## First Agents

| Agent | Role | Status |
|---|---|---|
| **Sigma Core** | Main orchestrator (`core/router`) | Phase 1 scaffold |
| **Sigma Bot** | Futures trading assistant | Phase 1 scaffold |
| **Sigma Dev** | Coding agent (OpenMonoAgent-connected in Phase 3) | Phase 1 scaffold |
| **Sigma Research** | Market research & analysis | Phase 1 scaffold |

---

## Human Approval Gates

Sigma Core OS **always requires human approval** before executing:

- Trade orders or money movement
- - Destructive file operations (delete, overwrite)
  - - Production deployments
    - - Public publishing (social posts, blog, PR merges)
      - - Any irreversible action
       
        - Agents emit an `approval_request` event to `core/policies` and **stop** until a human approves or denies.
       
        - ---

        ## Tech Stack

        - **TypeScript** — `core/`, `apps/api/`, `apps/dashboard/`
        - - **Python 3.11+** — `agents/`, `integrations/`
          - - **LiteLLM** — LLM proxy (cloud models)
            - - **Ollama** — Local LLM inference
              - - **Redis + SQLite** — Memory store (planned Phase 2)
               
                - ---

                ## Roadmap

                See [docs/roadmap.md](docs/roadmap.md) for full phases.

                **Current: Phase 0 — Scaffold** (this repo)
                - Next: Phase 1 — Core infrastructure implementation
               
                - ---

                ## Docs

                - [Architecture](docs/architecture.md)
                - - [Roadmap](docs/roadmap.md)
                  - - [Agent Rules](docs/agent-rules.md)
                    - - [Monetization](docs/monetization.md)
                     
                      - ---

                      ## Status

                      > Phase 0 — Initial scaffold. No production features yet.
                      > > Built for Sigma Futures internal use.
                      > > 
