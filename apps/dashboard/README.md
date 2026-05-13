# apps/dashboard

Sigma Core OS — Monitoring Dashboard

Web UI for monitoring agents, memory, tasks, approvals, and action logs.

## Status

Phase 1 stub. Implementation planned for Phase 2.

## Planned Features

- Agent status panel (running, stopped, error)
- Task queue and history viewer
- Approval queue with approve/deny buttons
- Memory namespace browser
- Action log viewer (append-only)
- Real-time updates via WebSocket

## Tech Stack (planned)

- Next.js or Vite + React
- Connects to `apps/api` for data
- Deployed separately from agents

## Setup

TBD — scaffold in Phase 2.

```bash
cd apps/dashboard
npm install
npm run dev
```
