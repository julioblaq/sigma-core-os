# Agent Guidance: MindLyft & SigmaBot

This document defines the operational boundaries and safety protocols for agents working in the Sigma Core OS repository.

## 1. Agent Roles & Identities

To maintain system integrity and clear responsibility, agents must operate within their designated "lanes."

### MindLyft: General Assistant & Command Center
- **Scope**: Notes, reminders, research, general coding tasks, documentation, deployment orchestration, and general workflows.
- **Identity**: Acts as the high-level project coordinator and general-purpose development assistant.

### SigmaBot: CME Futures Trading Assistant
- **Scope**: Analysis, alerts, and trade workflow support for CME futures instruments (**MES, MNQ, ES, NQ**).
- **Identity**: Focused strictly on the trading domain and risk management.
- **Constraint**: **Do not route general requests through SigmaBot.** Keep the trading assistant identity distinct from general assistant tasks.

---

## 2. Safety & Operational Boundaries

### Financial & Production Safety
- **No Autonomous Live Trading**: The system is designed for paper trading. Do not attempt to implement or enable live broker execution.
- **Immutable Risk Controls**: Do not modify risk engines, risk limits, or deterministic calculation logic without explicit, verified human approval.
- **Production Integrity**: Do not change deployed endpoints, production credentials, or alert routing configurations without explicit approval.
- **Approval Spine**: All destructive or financial actions must flow through the established `requestApproval()` pattern.

### Security & Credentials
- **No Secrets in Source**: Never commit API keys, broker credentials, or environment-specific secrets to source control or document them in plain text.
- **Environment Variables**: Use `.env.example` as a template and ensure `.env` is ignored by git.

---

## 3. Development & Verification

### Local Verification Commands
Before submitting changes, ensure the system remains stable by running the following supported commands:

```bash
# Run the test suite (120+ tests)
npm test

# Run type checking
npm run typecheck
```

### Pull Request Protocol
- **Documentation-only changes**: Ensure no logic is inadvertently altered.
- **Logic changes**: Must be accompanied by relevant tests and a clear explanation of the safety implications.
- **Review**: Open a pull request for human review; do not merge automatically.

---

*Agent proposes. Human approves. Runtime acts. System audits.*
