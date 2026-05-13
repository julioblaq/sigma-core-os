# Sigma Core OS — Agent Rules

These rules govern the behavior of all agents operating within Sigma Core OS.
All agents MUST follow these rules at all times.

---

## 1. Identity

- Every agent must identify itself by name and version in every log entry.
- Agents may not impersonate other agents or claim permissions they do not hold.
- Agents must declare their capabilities to the router at startup.

## 2. Task Handling

- Agents only accept tasks dispatched by `core/router`.
- Agents must acknowledge receipt of a task within 5 seconds.
- Agents must return a result, error, or progress update — never silently drop a task.
- Agents may reject tasks that fall outside their declared capabilities.

## 3. Memory

- Agents may read from shared memory (`core/memory`) at any time.
- Agents may write to memory only in their designated namespace.
- Agents must not overwrite or delete memory entries from other agents.

## 4. Tools

- Agents may only use tools registered in `core/tools`.
- Tool calls must be logged with: agent name, tool name, inputs, and timestamp.
- Agents must not invoke system-level calls outside the tool registry.

## 5. Human Approval Gates

The following actions REQUIRE explicit human approval before execution:

| Action | Gate Required |
|---|---|
| Place a trade order | YES |
| Move or transfer funds | YES |
| Delete a file permanently | YES |
| Overwrite a production file | YES |
| Deploy to production | YES |
| Publish public content (social, blog, PR) | YES |
| Send email on behalf of user | YES |
| Execute any irreversible action | YES |

- Agents must PAUSE and emit an `approval_request` event to `core/policies`.
- Agents must NOT proceed until an explicit `approved` signal is received.
- Agents must NOT retry an unapproved action automatically.

## 6. Error Handling

- Agents must catch and log all errors to the action log.
- Agents must emit an `agent_error` event on unrecoverable failures.
- Agents must not crash the runtime — use graceful degradation.

## 7. Logging

- Every agent action must be logged with: timestamp, agent, action, inputs, outputs, and status.
- Logs are append-only — agents may not modify or delete past log entries.

## 8. Scope Limits

- **Sigma Bot** — market data, alerts, analysis only. No autonomous trading.
- **Sigma Dev** — code generation and file operations only. No deployment without approval.
- **Sigma Research** — web search, summarization, data retrieval only.

## 9. Shutdown

- Agents must handle `SIGTERM` gracefully: finish current task, flush memory writes, and exit cleanly.
- Agents must not spawn child processes that outlive their own lifecycle.

## 10. Updates

These rules may only be updated via a PR to this repository with explicit human review.
No agent may modify its own rules at runtime.
