# Railway Deployment Assets

Date: 2026-06-06

This directory contains Dockerfiles for the cloud-safe Sigma Core OS services.

## Services

| Railway service | Dockerfile path | Notes |
|---|---|---|
| `sigma-api` | `deploy/railway/sigma-api.Dockerfile` | Fastify API, in-process Sigma Bot/Sigma Dev handlers, SQLite-backed state on `/data` for the first migration pass. |
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

## `sigma-api` Variables

Required or recommended:

```text
PORT=3001
DB_PATH=/data/sigma.db
SIGMA_SANDBOX_PATH=/data/sandbox
DASHBOARD_ORIGIN=https://<sigma-dashboard>.up.railway.app
LLM_MODELS=gpt-4o
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=<set in Railway>
LLM_TIMEOUT_MS=30000
```

Attach a Railway volume mounted at `/data` before using SQLite for production-like traffic.

## `sigma-dashboard` Variables

Required:

```text
PORT=3000
NEXT_PUBLIC_API_URL=https://<sigma-api>.up.railway.app
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
