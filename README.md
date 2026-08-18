# TMS — Translation Management System

Self-hosted translation management with multi-project dashboard, modules/tags,
activity log, AI auto-translate, Excel round-trip, and CLI sync.

## Prerequisites

- **Option A (local dev):** [uv](https://astral.sh/uv/), Python 3.14+, and Node.js 20+
- **Option B (production-like):** [Docker](https://docs.docker.com/get-docker/)

## Quick start (local, no Docker)

```bash
cp .env.example .env
```

**Terminal 1 — backend:**

```bash
cd backend
uv sync --all-extras
uv run alembic upgrade head
uv run python -m app.cli seed-demo
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — frontend:**

```bash
cd frontend
npm install
npm run dev
```

- Dashboard: http://localhost:5173
- API docs: http://localhost:8000/docs
- Auth: `AUTH_DEV_BYPASS=true` (default) mints a local Dev User — no IdP needed
- Demo API key (CLI): `demo-api-key-change-me`

SQLite (`backend/tms.db`) is the default. Delete it and re-run migrate + seed to reset.

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up --build
```

- Dashboard: http://localhost:5173
- API: http://localhost:8000
- Entrypoint runs `alembic upgrade head` then seeds the Demo App

Production (single origin, SPA served by FastAPI):

```bash
docker compose -f docker-compose.prod.yml up --build
```

## CLI

```bash
uv tool install -e ./cli

tms init -k demo-api-key-change-me -u http://localhost:8000 -o ./locales
tms push
tms pull
tms status
```

See [cli/README.md](cli/README.md) for modular vs flat layouts and override flags.

## Auth

| Mode | How |
|------|-----|
| UI (session) | OIDC via Authlib, or `AUTH_DEV_BYPASS=true` for local Dev User |
| CLI / runtime | Project API key via `X-API-Key` header (or `?api_key=` for back-compat) |

Any authenticated UI user can access all projects (no roles yet). Create and rotate
keys under **Project → Settings**.

## Concepts

- **Modules** group strings for lazy-loaded bundles. Project `layout` (`flat` \| `modular`) controls export shape; modules are always stored.
- **Status** is per string: `draft` or `public`. Export `stage=public` includes only public strings; untranslated locales export as empty.
- **Tags** enable batch selection (e.g. publish everything tagged `release-1.4`).
- **Activity log** records content changes; revert undoes one change (or a whole batch). **Snapshots** capture the full project for one-click restore (auto pre-restore backup included).

More detail: [docs/](docs/).

## Development

```bash
# Backend tests
cd backend && uv sync --all-extras && uv run pytest

# Frontend typecheck + build
cd frontend && npm run build

# CLI tests
uv run --project cli python -m unittest discover -s cli/tests

# Regenerate OpenAPI types (backend must be running)
cd frontend && npm run gen:api
```

## Environment

See [.env.example](.env.example). Notable vars:

| Var | Purpose |
|-----|---------|
| `TMS_SECRET` | Signs session JWTs |
| `AUTH_DEV_BYPASS` | Local UI without OIDC |
| `OIDC_*` | Generic OIDC provider |
| `TMS_DEMO_API_KEY` | Seeded demo project key |
| `DEFAULT_BASE_LANGUAGE` | Default for new projects (`vi`) |
| `ACTIVITY_RETENTION_DAYS` | Optional pruning of append-only activity log |
| `AWS_REGION` | Bedrock region (default `us-east-1`) |
| `BEDROCK_MODEL_ID` | Inference profile ID for AI translate |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM credentials for AI translate. Must be real process env vars (`export` or Docker Compose). The backend auto-mints a short-term Bedrock API key before each request. |
| `AWS_BEARER_TOKEN_BEDROCK` | Optional static long-term Bedrock API key if IAM is not available. Leave unset when using IAM so an expired key cannot shadow credentials. |
