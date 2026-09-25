# x-locale

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
- Auth: Microsoft Entra SSO (work or personal). Set `AUTH_DEV_BYPASS=true` with empty `OIDC_*` for a local Dev User
- Demo API key (CLI): `demo-api-key-change-me`

SQLite (`backend/x-locale.db`) is the default. Delete it and re-run migrate + seed to reset.

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

locale init
# or: locale init -k <api-key> -u http://localhost:8000 -o ./locales -y
locale push
locale pull
locale status
```

See [cli/README.md](cli/README.md) for modular vs flat layouts and override flags.

## Auth

| Mode | How |
|------|-----|
| UI (session) | Microsoft Entra ID via Authlib (`OIDC_*`). `AUTH_DEV_BYPASS=true` mints a local Dev User only when OIDC is **not** configured |
| CLI / runtime | Project API key via `X-API-Key` header |

Any authenticated UI user can access all projects (no roles yet). Create and rotate
keys under **Project → Settings**.

### Microsoft Entra ID (work + personal)

x-locale uses the **`/common`** v2 endpoint so both **work/school** and **personal** Microsoft
accounts (Outlook, Hotmail, Xbox) can sign in. That also allows work accounts from
**any** Entra tenant, not only yours.

1. Copy `.env.example` to `.env` and set:

   ```
   AUTH_DEV_BYPASS=false
   OIDC_ISSUER=https://login.microsoftonline.com/common/v2.0
   OIDC_CLIENT_ID=<application-client-id>
   OIDC_CLIENT_SECRET=<client-secret>
   OIDC_REDIRECT_URL=http://localhost:5173/api/auth/callback
   ```

   For production (SPA served by FastAPI on port 8000), use
   `OIDC_REDIRECT_URL=https://<your-host>/api/auth/callback` (or `http://localhost:8000/api/auth/callback` locally).

2. Create an app registration in [Entra ID → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade):
   1. **New registration**, name e.g. `x-locale`
   2. Supported accounts: **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts**
   3. Platform: **Web** (confidential/server-side — not SPA)
   4. Redirect URIs (exact match):
      - `http://localhost:5173/api/auth/callback` (local Vite)
      - `http://localhost:8000/api/auth/callback` (optional, API-only / prod-compose)
      - your production HTTPS callback when you have it
   5. **Certificates & secrets** → New client secret → `OIDC_CLIENT_SECRET`
   6. Overview → **Application (client) ID** → `OIDC_CLIENT_ID`
   7. Token configuration → optional ID-token claim **email** (x-locale still falls back to UPN / `preferred_username`)
   8. API permissions: delegated Microsoft Graph `openid`, `profile`, `email`

   `http://localhost` redirects are allowed for development. If the app was first created as single-tenant, switch **Authentication → Supported account types** (or manifest `signInAudience` to `AzureADandPersonalMicrosoftAccount`) and keep `OIDC_ISSUER` on `/common`, not `{tenant-id}`.

3. Start backend then frontend, open http://localhost:5173 → **Continue with Microsoft**.

Logout clears the x-locale session cookie only (you stay signed into Microsoft). Do not
commit client IDs or secrets.

## Concepts

- **Modules** group strings for lazy-loaded bundles. Project `layout` (`flat` \| `modular`) controls export/CLI shape. File keys are stored as-is (dots are not a module prefix). Flat import never creates modules; modular Excel uses sheet names as slugs and CLI uses folders.
- **Status** is per string: `draft` or `public`. Edits stay on the working copy. `stage=public` export / `locale pull --stage public` uses the last published snapshot until you publish again. Untranslated published locales export as empty. Deletes are soft: never-published keys are hidden immediately; published keys stay on prod until you publish the removal, then remain as a restorable tombstone.
- **Tags** enable batch selection (e.g. publish everything tagged `release-1.4`).
- **Activity log** records string content changes (keys, source, translations, publish/delete), not modules, tags, project settings, or API keys. Undo reverts a bulk import/translate/publish batch; History restores an older working copy of one string.

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
| `X_LOCALE_SECRET` | Signs session JWTs. **Required in production:** set a long random value; the app refuses to start with the repo default when OIDC is configured or `AUTH_DEV_BYPASS=false`. |
| `SESSION_COOKIE_SECURE` | Set `true` when browsers reach the app over HTTPS (or rely on an `https://` `OIDC_REDIRECT_URL`). |
| `AUTH_DEV_BYPASS` | Local Dev User when OIDC is unset. Ignored once `OIDC_*` is filled |
| `OIDC_ISSUER` | Entra discovery base (`https://login.microsoftonline.com/common/v2.0`) |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Entra app registration credentials |
| `OIDC_REDIRECT_URL` | Must match a Web redirect URI in Entra (`http://localhost:5173/api/auth/callback` for Vite) |
| `X_LOCALE_DEMO_API_KEY` | Seeded demo project key |
| `WEB_CONCURRENCY` | Production uvicorn worker processes (default 4). Each worker keeps its own database pool, about 15 connections, so size Postgres `max_connections` for `workers × 15` plus headroom. Dev compose stays on one process with `--reload`. |
| `DEFAULT_BASE_LANGUAGE` | Default for new projects (`vi`) |
| `ACTIVITY_RETENTION_DAYS` | Delete activity rows older than N days (default 90; 0 = keep forever). Run `python -m app.cli prune-activities` on a schedule. Drops old feed/history, not strings. |
| `AWS_REGION` | Bedrock region (default `us-east-1`) |
| `BEDROCK_MODEL_ID` | Inference profile ID for AI translate |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM credentials for AI translate. Must be real process env vars (`export` or Docker Compose). The backend auto-mints a short-term Bedrock API key before each request. |
| `AWS_BEARER_TOKEN_BEDROCK` | Optional static long-term Bedrock API key if IAM is not available. Leave unset when using IAM so an expired key cannot shadow credentials. |
