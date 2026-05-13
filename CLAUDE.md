# Sigma Core OS — Dev Context for Claude

## What this repo is
Agentic OS for Sigma Futures. One active agent: Sigma Bot (futures trading assistant).
Core enforces human approval for all trade actions before execution.

## Stack
- TypeScript (Node.js 20+) — core/, apps/api/, agents/sigma-bot/handler.ts
- - node-sqlite3-wasm — pure WASM SQLite, no native build, no Xcode needed
  - - Fastify — HTTP API server
    - - tsx — run TS directly without a build step in dev
     
      - ## Running locally
      - ```bash
        git pull
        npm install          # pure JS/WASM install — no native compilation
        cp .env.example .env
        npm run dev          # starts on :3001
        ```

        ## Day-one proof: one trade plan through the approval spine

        ### 1. Submit a trade plan
        ```bash
        curl -s -X POST http://localhost:3001/v1/task \
          -H 'Content-Type: application/json' \
          -d '{
            "type": "trade_plan",
            "payload": {
              "symbol": "ES",
              "direction": "long",
              "quantity": 1,
              "rationale": "CPI came in soft, expecting bid"
            },
            "submittedBy": "julio"
          }' | jq
        ```
        Expected: `202` with `status: "pending_approval"` and an `approvalId`.

        ### 2. Check pending approvals
        ```bash
        curl -s http://localhost:3001/v1/approvals | jq
        ```

        ### 3. Approve (paste the approvalId from step 1)
        ```bash
        curl -s -X POST http://localhost:3001/v1/approvals/<APPROVAL_ID> \
          -H 'Content-Type: application/json' \
          -d '{"approved": true, "resolvedBy": "julio"}' | jq
        ```
        Expected: `approval.status: "approved"` + `outcome` object.

        ### 4. Check the outcome log
        ```bash
        curl -s http://localhost:3001/v1/log | jq
        ```

        ## Key files
        | File | Purpose |
        |---|---|
        | `apps/api/server.ts` | HTTP routes — entry point |
        | `agents/sigma-bot/handler.ts` | trade_plan → approval queue |
        | `core/router/index.ts` | Dispatches tasks to agents |
        | `core/db.ts` | Shared SQLite handle (node-sqlite3-wasm) |
        | `core/policies/index.ts` | Approval queue — SQLite |
        | `core/memory/index.ts` | Key-value store — SQLite |
        | `core/runtime/index.ts` | Outcome logger — SQLite |

        ## Rules that never change
        - Sigma Bot NEVER executes a trade without an approved Approval record
        - - All financial/destructive actions require human approval via `POST /v1/approvals/:id`
          - - Logs are append-only — never delete from outcome_log or approvals
            - 
