# Railway Hermes Migration

Owner: Jerry Hicks Jr.
Date: 2026-06-06
Status: Default Hermes API server deployed to Railway; cloud bridge verified; 24 hour stability window pending.

## Objective

Move the cloud-safe Hermes gateway workload from local macOS LaunchAgents to Railway Pro so it no longer depends on a local terminal or local Mac uptime.

Do not move trading-gateway behavior until broker, MFA, OpenD, and local-network requirements are proven safe.

## Current Hermes State

Hermes is not source-controlled in the Sigma Core OS repository. It is installed locally under:

- `/Users/jerryhicksjr/.hermes/hermes-agent`

Hermes already has its own packaging and container assets:

- `/Users/jerryhicksjr/.hermes/hermes-agent/pyproject.toml`
- `/Users/jerryhicksjr/.hermes/hermes-agent/setup.py`
- `/Users/jerryhicksjr/.hermes/hermes-agent/package.json`
- `/Users/jerryhicksjr/.hermes/hermes-agent/Dockerfile`

The Hermes package audit on 2026-06-06 found:

- Python package: `hermes-agent` version `0.15.0`
- Runtime Python: `>=3.11`
- Container base: Debian with Python, Node 22, uv, Playwright, docker CLI, and s6-overlay
- Runtime home in Dockerfile: `HERMES_HOME=/opt/data`
- Runtime volume in Dockerfile: `/opt/data`
- Docker runtime drops supervised services to the `hermes` user after s6 setup
- `.dockerignore` excludes `.env`, `node_modules`, venvs, git state, and runtime data

The active macOS LaunchAgents are:

- `ai.hermes.gateway`
- `ai.hermes.gateway-trading`

The default gateway runs:

```text
/Users/jerryhicksjr/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main gateway run --replace
```

The trading gateway runs:

```text
/Users/jerryhicksjr/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main --profile trading gateway run --replace
```

Both are configured with `RunAtLoad` and restart-on-failure behavior through LaunchAgents.

## Migration Boundary

### Candidate For Railway

- Hermes default gateway, if it does not require local-only devices, LAN services, GUI sessions, or local filesystem access outside its app data directory.

### Keep Local

- Hermes trading profile
- Any Hermes profile connected to OpenD, Moomoo, desktop broker software, MFA-protected sessions, or GUI-only trading tools
- Any broker gateway that requires the M1 trading machine

## Railway Target Service

Suggested Railway service:

- `hermes-agent`

Railway service created:

```text
Project: sigma-core-os
Environment: production
Service: hermes-agent
Service ID: 2d1eff0b-ed39-4683-b2a1-129313ad9cee
Deployment: ac9ab3e3-9191-4c19-8bc0-5a224390b307
Public URL: https://hermes-agent-production-62ee.up.railway.app
```

Verified Railway start command:

```text
hermes gateway run --replace
```

The Hermes API server is enabled through Railway variables and bound to Railway's service port:

```text
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
API_SERVER_MODEL_NAME=hermes-agent
PORT=8642
```

`API_SERVER_KEY` is set in Railway and is required for model/API access. The public `/health` endpoint is intentionally available for uptime checks.

The cloud default runtime model is selected with non-secret Railway variables:

```text
HERMES_INFERENCE_PROVIDER=openrouter
HERMES_INFERENCE_MODEL=google/gemini-3-flash-preview
```

Hermes package commit `a8cd5f37f` makes the gateway runtime honor `HERMES_INFERENCE_MODEL` and mirrors these selectors into `config.yaml` at container boot.

Prefer deploying Hermes from the Hermes package/repository rather than copying Hermes runtime files into Sigma Core OS.

## Required Railway Variables

Store all production values in Railway variables. Do not commit secrets.

Known or likely variables:

- `HERMES_HOME`
- `HERMES_UID`
- `HERMES_GID`
- `HERMES_INFERENCE_PROVIDER`
- `HERMES_INFERENCE_MODEL`
- `API_SERVER_ENABLED`
- `API_SERVER_HOST`
- `API_SERVER_PORT`
- `API_SERVER_MODEL_NAME`
- `API_SERVER_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENROUTER_API_KEY`
- Provider keys required by the cloud default profile

Set `HERMES_HOME` in Railway to the container-owned data path:

```text
/opt/data
```

Current decision: keep Railway Hermes stateless for the approval-gated chat bridge. `HERMES_HOME=/opt/data` is configured, but no Railway volume is attached. Add a Railway volume before relying on long-term Hermes session memory, profile edits, or cloud-side durable state.

Do not copy the local Telegram bot token into Railway until the default local gateway is intentionally cut over. Running two long-polling Telegram gateways with the same bot token can break message handling.

## Pre-Migration Audit

Before deployment, inspect Hermes without printing secret values:

- Python version and package manager: done
- `pyproject.toml`, `requirements.txt`, or equivalent dependency source: done
- CLI import path for `hermes_cli.main`: done
- Required environment variable names
- Required profile files under `HERMES_HOME`
- Files that must persist across restarts
- Whether the default gateway uses local sockets, localhost services, GUI apps, or local Mac file paths: still needs config-level review
- Whether any profile references OpenD, Moomoo, Tradovate, Ghost, browser sessions, or broker desktop apps: trading profile remains local

## Deployment Steps

1. Create Railway service `hermes-agent`. Done.
2. Configure build source from the Hermes package or a dedicated deployment wrapper.
3. Configure start command in Railway service settings:

   ```text
   hermes gateway run --replace
   ```

4. Add Railway variables. Done for API server and model-provider keys.
5. Use stateless `HERMES_HOME=/opt/data` for the current approved chat bridge. Add a Railway volume only before relying on durable profile/session state.
6. Deploy to Railway. Done.
7. Confirm gateway startup without local path assumptions. Health endpoint verified.
8. Keep the local LaunchAgent running during the first Railway smoke test.
9. Switch traffic or clients to Railway only after successful health verification.
10. After 24 hours of stable Railway runtime, disable only the migrated default local LaunchAgent.

## Validation Checklist

- [x] Hermes dependencies identified
- [x] Hermes start command confirmed
- [x] Secret variable names documented without values
- [x] Railway service created
- [x] Railway variables configured
- [x] Persistent state decision made for `HERMES_HOME`
- [x] Default gateway starts on Railway
- [x] Sigma API can reach Hermes health and model endpoints
- [x] Sigma API exposes approval-gated Hermes chat dispatch
- [x] Logs show active deployment and gateway startup
- [x] No local terminal required
- [ ] 24 hour continuous runtime completed
- [ ] Local default LaunchAgent disabled only after 24 hour Railway success
- [x] Trading LaunchAgent remains local

## Verified Railway Results

Observed on 2026-06-06:

```text
GET https://hermes-agent-production-62ee.up.railway.app/health
HTTP 200
{"status": "ok", "platform": "hermes-agent"}
```

Unauthenticated model access is blocked:

```text
GET /v1/models
HTTP 401
Invalid API key
```

Authenticated model access succeeds with the Railway-only `API_SERVER_KEY`:

```text
GET /v1/models
HTTP 200
model: hermes-agent
```

Sigma API can now queue a Hermes chat prompt as a pending approval and dispatch it only after approval:

```text
POST /v1/hermes/draft-chat
POST /v1/approvals/:id
POST /v1/hermes/dispatch-chat
```

Observed live result on 2026-06-06:

```text
POST /v1/hermes/draft-chat -> HTTP 202
POST /v1/approvals/:id -> HTTP 200, approved
POST /v1/hermes/dispatch-chat -> HTTP 200
Hermes response: "Hermes approval bridge connected."
```

Observed on 2026-06-07:

```text
Railway hermes-agent: Online
Active deployment: successful, about 17 hours old at 2026-06-07 11:11 EDT
HERMES_HOME=/opt/data
Railway volume for HERMES_HOME: none
GET /v1/hermes/status through sigma-api -> HTTP 200, configured=true, ok=true
GET /v1/hermes/models through sigma-api -> HTTP 200, model hermes-agent
Approval-gated Hermes chat dispatch -> HTTP 200
Hermes response: "Hermes cloud bridge healthy."
```

The visible Railway log warning says no user allowlists are configured and unauthorized platform users will be denied. That is acceptable for the current Sigma bridge because Sigma uses `API_SERVER_KEY` server-side and does not expose broad platform user access.

Dashboard surface:

```text
https://sigma-dashboard-production-a7a7.up.railway.app/hermes
```

This does not enable broad Hermes `/v1/runs` execution, trading actions, local gateway access, or broker-connected tools. It is a narrow chat-completion bridge for approved cloud orchestration prompts.

## Rollback Plan

If Railway deployment fails:

1. Leave or restore the local LaunchAgent `ai.hermes.gateway`.
2. Point clients back to the local Hermes endpoint.
3. Review Railway logs and missing variable names.
4. Fix packaging or environment configuration.
5. Redeploy and retry validation.

Do not disable the local default LaunchAgent until Railway has completed the 24 hour success window. The active Railway deployment was about 17 hours old at 2026-06-07 11:11 EDT, so the local default gateway remains a rollback path for now.

## Security Notes

- Do not expose OpenD publicly.
- Do not tunnel broker desktop software directly to the public internet.
- Prefer Tailscale or an SSH tunnel for any private local connectivity that must remain available to cloud services.
- Keep trading credentials, webhook secrets, and provider API keys in Railway variables.
- Do not copy `.env` values into docs, commits, PR descriptions, or chat.
- Keep cloud Hermes dispatch behind Sigma approvals until idempotent execution state and action-level audit are added.

## Open Questions

- After the 24 hour stability window completes, should `ai.hermes.gateway` be disabled immediately or retained as a cold rollback plist?
- Does the default profile need a Railway volume before any long-term session memory features are enabled?
- Should the trading profile remain permanently local, or should it eventually expose a narrow private tunnel from the M1 to cloud middleware?

## Recommended First PR Scope

The first PR should include only:

- `docs/deployment/service-inventory.md`
- `docs/deployment/railway-hermes-migration.md`

Do not include production refactors, Dockerfiles, database migrations, or LaunchAgent changes until the migration plan is reviewed.
