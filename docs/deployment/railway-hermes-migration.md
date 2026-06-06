# Railway Hermes Migration

Owner: Jerry Hicks Jr.
Date: 2026-06-06
Status: Draft migration plan, documentation-only.

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

Candidate command:

```text
python -m hermes_cli.main gateway run --replace
```

The exact command should be confirmed against the existing Hermes Dockerfile and s6-overlay service layout before deployment. Prefer deploying Hermes from the Hermes package/repository rather than copying Hermes runtime files into Sigma Core OS.

## Required Railway Variables

Store all production values in Railway variables. Do not commit secrets.

Known or likely variables:

- `HERMES_HOME`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GITHUB_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TRADINGVIEW_WEBHOOK_SECRET`
- Any Hermes-specific auth tokens from local `.env` files

Set `HERMES_HOME` in Railway to an app-owned path such as:

```text
/app/.hermes
```

If Hermes requires persistent state, back that path with a Railway volume.

## Pre-Migration Audit

Before deployment, inspect Hermes without printing secret values:

- Python version and package manager
- `pyproject.toml`, `requirements.txt`, or equivalent dependency source
- CLI import path for `hermes_cli.main`
- Required environment variable names
- Required profile files under `HERMES_HOME`
- Files that must persist across restarts
- Whether the default gateway uses local sockets, localhost services, GUI apps, or local Mac file paths
- Whether any profile references OpenD, Moomoo, Tradovate, Ghost, browser sessions, or broker desktop apps

## Deployment Steps

1. Create Railway service `hermes-agent`.
2. Configure build source from the Hermes package or a dedicated deployment wrapper.
3. Configure start command:

   ```text
   python -m hermes_cli.main gateway run --replace
   ```

4. Add Railway variables.
5. Add a Railway volume for `HERMES_HOME` if Hermes writes durable profile state.
6. Deploy to Railway.
7. Confirm logs show gateway startup without local path assumptions.
8. Keep the local LaunchAgent running during the first Railway smoke test.
9. Switch traffic or clients to Railway only after successful health verification.
10. After 24 hours of stable Railway runtime, disable only the migrated default local LaunchAgent.

## Validation Checklist

- [ ] Hermes dependencies identified
- [ ] Hermes start command confirmed
- [ ] Secret variable names documented without values
- [ ] Railway service created
- [ ] Railway variables configured
- [ ] Persistent state decision made for `HERMES_HOME`
- [ ] Default gateway starts on Railway
- [ ] Logs remain healthy through restart
- [ ] No local terminal required
- [ ] 24 hour continuous runtime completed
- [ ] Local default LaunchAgent disabled only after Railway success
- [ ] Trading LaunchAgent remains local

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
