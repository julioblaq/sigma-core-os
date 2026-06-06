# Railway Deployment Assets

Date: 2026-06-06

This directory contains Dockerfiles for the cloud-safe Sigma Core OS services.

## Services

| Railway service | Dockerfile path | Notes |
|---|---|---|
| `sigma-api` | `deploy/railway/sigma-api.Dockerfile` | Fastify API, in-process Sigma Bot/Sigma Dev handlers. Current live deployment uses `/tmp/sigma.db` until persistent storage is fixed. |
| `sigma-dashboard` | `deploy/railway/sigma-dashboard.Dockerfile` | Next.js dashboard. Set `NEXT_PUBLIC_API_URL` to the Railway URL for `sigma-api`. |

## Railway Setup

Create separate Railway services from the same GitHub repository.

For each service, keep the repository root as the build context and set:

```text
RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-api.Dockerfile
```

or:

```text
RAILWAY_DOCKERFILE_PATH=deploy/railway/sigma-dashboard.Dockerfile
```

For Dockerfile deployments, Railway variables used by Next.js during `next build` must be declared as Docker build args. The dashboard Dockerfile declares `ARG NEXT_PUBLIC_API_URL` so the `/api/*` rewrite is built against the Railway API URL instead of the local fallback.

## `sigma-api` Variables

Required or recommended:

```text
PORT=3001
DB_PATH=/tmp/sigma.db
SIGMA_SANDBOX_PATH=/tmp/sandbox
DASHBOARD_ORIGIN=https://sigma-dashboard-production-a7a7.up.railway.app
LLM_MODELS=gpt-4o
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=<set in Railway>
LLM_TIMEOUT_MS=30000
VOICE_PROVIDER=openrouter
OPENROUTER_API_KEY=<set in Railway>
VOICE_STT_MODEL=microsoft/mai-transcribe-1.5
VOICE_TTS_MODEL=microsoft/mai-voice-2
VOICE_TTS_VOICE=nova
VOICE_TTS_FORMAT=mp3
VOICE_TIMEOUT_MS=30000
```

The intended persistent SQLite path is `/data/sigma.db` with `SIGMA_SANDBOX_PATH=/data/sandbox`, backed by a Railway volume mounted at `/data`. The current non-root container cannot write to that mounted volume yet, so do not treat `/tmp/sigma.db` as durable production memory.

## `sigma-dashboard` Variables

Required:

```text
PORT=3000
NEXT_PUBLIC_API_URL=https://sigma-api-production-b005.up.railway.app
```

## Live Railway URLs

```text
sigma-api: https://sigma-api-production-b005.up.railway.app
sigma-dashboard: https://sigma-dashboard-production-a7a7.up.railway.app
```

## First Cloud Cutover Rule

Only move cloud-safe services first:

- Sigma Core API
- Sigma Dashboard
- In-process Sigma Bot and Sigma Dev handlers
- Paper broker adapter

Keep these local:

- Moomoo OpenD
- Broker desktop software
- MFA-protected gateways
- GUI trading platforms
- Hermes trading profile
