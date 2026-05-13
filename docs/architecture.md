# Sigma Core OS — Architecture

## Overview

Sigma Core OS is an agentic operating system designed for Sigma Futures. It orchestrates a fleet of specialized AI agents, manages shared memory, routes tasks, enforces access policies, and logs all actions for auditability.

## System Components

### apps/
- **dashboard** — Web UI for monitoring agents, memory, and task queues.
- **api** — REST/WebSocket API server exposing Sigma Core OS internals to external clients and the dashboard.

### agents/
- **sigma-bot** — Futures trading assistant. Requires human approval for all trade execution.
- **sigma-dev** — Coding and development agent. Will connect to OpenMonoAgent for extended capabilities.
- **sigma-research** — Research agent for market and technical analysis.

### core/
- **router** — Task router. Receives incoming tasks, classifies intent, and dispatches to the correct agent.
- **memory** — Shared memory store. Agents read/write structured memory here.
- **policies** — Policy engine. Enforces human approval gates and access controls.
- **tools** — Tool registry. All agent tools are registered and sandboxed here.
- **runtime** — Agent lifecycle management. Starts, stops, and monitors agents.

### integrations/
- **openmonoagent** — Connector for OpenMonoAgent (used by sigma-dev).
- **litellm** — LLM proxy via LiteLLM for model routing.
- **ollama** — Local model runner via Ollama.
- **github** — GitHub API integration for sigma-dev.

### docs/
Architecture, roadmap, agent rules, and monetization strategy.

## Data Flow

```
User / External Trigger
        |
            apps/api
                    |
                       core/router  <---> core/memory
                               |
                                 [Agent Dispatch]
                                    /    |     \
                                    sigma-bot  sigma-dev  sigma-research
                                            |
                                               core/policies  (approval gate for sensitive actions)
                                                       |
                                                          core/tools  (sandboxed execution)
                                                                  |
                                                                     Action Log / Memory Update
                                                                     ```

                                                                     ## Human Approval Gates

                                                                     The following actions ALWAYS require explicit human approval before execution:
                                                                     - Trade orders or money movement
                                                                     - Destructive file operations (delete, overwrite)
                                                                     - Deployments to production
                                                                     - Public publishing (social, blog, PR merge)
                                                                     - Any action flagged as irreversible by the policy engine

                                                                     ## Tech Stack

                                                                     - **Language:** TypeScript (apps, core) / Python (agents, integrations)
                                                                     - **Runtime:** Node.js (API, dashboard) / Python 3.11+ (agents)
                                                                     - **Memory:** Redis (short-term) + SQLite/Postgres (long-term)
                                                                     - **LLM:** LiteLLM proxy (cloud) + Ollama (local)
                                                                     
