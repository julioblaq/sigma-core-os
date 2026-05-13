# Sigma Core OS

**Agentic Operating System for Sigma Futures**

Sigma Core OS routes tasks to Sigma Bot, stores shared memory,
manages tools, logs all actions, and requires human approval for trading,
money movement, destructive file actions, deployments, and public publishing.

---

## Project Structure

```
sigma-core-os/
├── agents/
│   └── sigma-bot/          # Futures trading assistant (Python)
│
├── apps/
│   └── api/                # REST + WebSocket API server (TypeScript)
│
├── core/
│   ├── router/             # Task router — classifies and dispatches tasks (TypeScript)
│   ├── memory/             # Shared memory store (TypeScript)
│   ├── policies/           # Human approval gate engine (TypeScript)
│   ├── tools/              # Tool registry and sandboxed execution (TypeScript)
│   └── runtime/            # Agent lifecycle manager (TypeScript)
│
├── integrations/
│   └── litellm/            # LLM proxy via LiteLLM (for Sigma Bot analysis)
│
└── docs/
    ├── architecture.md     # System architecture and data flow
    ├── roadmap.md          # Development phases
    ├── agent-rules.md      # Rules all agents must follow
    └── monetization.md     # Revenue strategy
```

---

## Active Agents

| Agent | Role | Status |
|---|---|---|
| **Sigma Core** | Main orchestrator (`core/router`) | Phase 1 scaffold |
| **Sigma Bot** | Futures trading assistant | Phase 1 scaffold |

> Additional agents (Sigma Dev, Sigma Research) will be added when they have
> > a real use case and real logic — not before.
> >
> > ---
> >
> > ## Human Approval Gates
> >
> > Sigma Core OS **always requires human approval** before executing:
> >
> > - Trade orders or money movement
> > - - Destructive file operations (delete, overwrite)
> >   - - Production deployments
> >     - - Public publishing (social posts, blog, PR merges)
> >       - - Any irreversible action
> >        
> >         - Agents emit an `approval_request` event to `core/policies` and **stop** until a human approves or denies.
> >        
> >         - ---
> >
> > ## Tech Stack
> >
> > - **TypeScript** — `core/`, `apps/api/`
> > - - **Python 3.11+** — `agents/`
> >   - - **LiteLLM** — LLM proxy for Sigma Bot analysis
> >     - - **Redis + SQLite** — Memory store (planned Phase 2)
> >      
> >       - ---
> >
> > ## Adding New Agents
> >
> > The architecture is built to grow. To add a new agent:
> >
> > 1. Create `agents/<agent-name>/agent.py`
> > 2. 2. Implement `handle_task()` and declare `AGENT_CAPABILITIES`
> >    3. 3. Register with the router: `registerAgent('agent-name', capabilities)`
> >       4. 4. Memory, tools, and approval gates work automatically
> >         
> >          5. ---
> >         
> >          6. ## Docs
> >         
> >          7. - [Architecture](docs/architecture.md)
> > - [Roadmap](docs/roadmap.md)
> > - - [Agent Rules](docs/agent-rules.md)
> >   - - [Monetization](docs/monetization.md)
> >    
> >     - ---
> >
> > > Phase 0 scaffold — Sigma Bot is the one agent. Core infrastructure is next.
> > > 
