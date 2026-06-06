# Railway Hermes Migration

Owner: Jerry Hicks Jr.
Date: 2026-06-06
Status: Default Hermes API server deployed to Railway; 24 hour stability window pending.

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

Prefer deploying Hermes from the Hermes package/repository rather than copying Hermes runtime files into Sigma Core OS.

## Required Railway Variables

Store all production values in Railway variables. Do not commit secrets.

Known or likely variables:

- `HERMES_HOME`
- `HERMES_UID`
- `HERMES_GID`
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

If Hermes requires persistent state, back that path with a Railway volume.

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
5. Add a Railway volume for `HERMES_HOME` if Hermes writes durable profile state.
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
- [ ] Persistent state decision made for `HERMES_HOME`
- [x] Default gateway starts on Railway
- [ ] Logs remain healthy through restart
- [x] No local terminal required
- [ ] 24 hour continuous runtime completed
- [ ] Local default LaunchAgent disabled only after Railway success
- [ ] Trading LaunchAgent remains local

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

## Rollback Plan

If Railway deployment fails:

1. Leave or restore the local LaunchAgent `ai.hermes.gateway`.
2. Point clients back to the local Hermes endpoint.
3. Review Railway logs and missing variable names.
4. Fix packaging or environment configuration.
5. Redeploy and retry validation.

Do not disable the local LaunchAgent until Railway has completed the 24 hour success window.

## Security Notes

- Do not expose OpenD publicly.
- Do not tunnel broker desktop software directly to the public internet.
- Prefer Tailscale or an SSH tunnel for any private local connectivity that must remain available to cloud services.
- Keep trading credentials, webhook secrets, and provider API keys in Railway variables.
- Do not copy `.env` values into docs, commits, PR descriptions, or chat.

## Open Questions

- Is Hermes default gateway stateless enough to run without a persistent volume?
- Which Hermes variables are required beyond `HERMES_HOME`?
- Does the default profile call local-only services?
- Is there a health endpoint or heartbeat command suitable for Railway monitoring?
- Should the trading profile remain permanently local, or should it only expose a narrow private tunnel from M1 to cloud middleware?

## Recommended First PR Scope

The first PR should include only:

- `docs/deployment/service-inventory.md`
- `docs/deployment/railway-hermes-migration.md`

Do not include production refactors, Dockerfiles, database migrations, or LaunchAgent changes until the migration plan is reviewed.
