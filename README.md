# x-locale

Self-hosted translation management with multi-project dashboard, modules/tags,
activity log, AI auto-translate, Excel round-trip, and CLI sync.

## Prerequisites

- [uv](https://astral.sh/uv/), Python 3.14+, and Node.js 22.6+
- Postgres 16. Local dev starts it with Docker Compose. A native server is documented below.

## Quick start

```bash
cp .env.example .env
docker compose up -d postgres
```

`docker compose up -d postgres` creates `xlocale` and, on a new volume, `xlocale_test`. Collation is C (`POSTGRES_INITDB_ARGS=--locale=C`). An existing volume keeps its old collation until you recreate it with `docker compose down -v`.

`scripts/dev.sh` does not read `.env` as a shell script. The app loads `DATABASE_URL` and `TEST_DATABASE_URL` from that file. The script exports `AUTH_DEV_BYPASS=true` for its own processes only. `.env.example` keeps `AUTH_DEV_BYPASS=false`, so a fresh clone can sign in as the Dev User without changing the example. `scripts/dev.sh --check` loads that config and exits. `seed-demo` still runs when the bypass is off. It refuses when OIDC is configured or `ENV=production`, unless `--force` is passed, so production does not receive the default demo API key.

**Terminal 1 — backend:**

```bash
cd backend
uv sync --all-extras
uv run alembic upgrade head
uv run python -m app.cli seed-demo
# Local Dev User. .env.example leaves AUTH_DEV_BYPASS=false.
AUTH_DEV_BYPASS=true uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
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

The API, `seed-demo`, and Alembic exit if `DATABASE_URL` is missing or is not a Postgres URL. `seed-demo` still runs when `AUTH_DEV_BYPASS=false`. It exits when OIDC is configured or `ENV=production` unless you pass `--force`.

### Native Postgres

Install PostgreSQL 16 and initialize a cluster with collation C.

Debian and Ubuntu create a cluster named `main` when the package is installed, so `pg_createcluster 16 main` fails until that cluster is removed. Drop it when this server should listen on port 5432:

```bash
sudo -u postgres pg_dropcluster --stop 16 main
sudo -u postgres pg_createcluster 16 main --locale=C --encoding=UTF8
sudo -u postgres pg_ctlcluster 16 main start
```

To keep the existing `main` cluster, add one named `xlocale` and use the port from `pg_lsclusters`:

```bash
sudo -u postgres pg_createcluster 16 xlocale --locale=C --encoding=UTF8
sudo -u postgres pg_ctlcluster 16 xlocale start
```

```bash
sudo -u postgres createuser -d xlocale
sudo -u postgres psql -c "ALTER USER xlocale PASSWORD 'xlocale'"
sudo -u postgres createdb -O xlocale -T template0 --locale-provider=libc --lc-collate=C --lc-ctype=C xlocale
sudo -u postgres createdb -O xlocale -T template0 --locale-provider=libc --lc-collate=C --lc-ctype=C xlocale_test
```

`xlocale` is a `CREATEDB` role, not a superuser. `TEST_DATABASE_URL` points at `xlocale_test`. That database is the bootstrap connection for `CREATE DATABASE` and `DROP DATABASE`. The harness connects to it, not to the `postgres` database, so this role does not need access to `postgres`.

Use the URLs in `.env.example`. PostgreSQL 16 removed `SHOW lc_collate`. `SELECT datcollate, datlocprovider FROM pg_database WHERE datname = current_database()` must be `C` and `c`.

## Quick start (full Docker stack)

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

## Health checks (SIT and production)

Use the same paths on each environment's host. Both accept unauthenticated `GET`
requests and send `Cache-Control: no-store`:

| Probe | URL | Healthy | Unhealthy |
|-------|-----|---------|-----------|
| Liveness | `https://<host>/healthcheck/liveness` | `200`, `{"status":"ok"}` | A failed HTTP check means the app cannot respond |
| Readiness | `https://<host>/healthcheck/readiness` | `200`, `{"status":"ok"}` after a database `SELECT 1` | `503`, `{"status":"not_ready"}` if the database query fails |

Configure infra
to restart an instance when liveness repeatedly fails and remove it from traffic
when readiness fails. Readiness checks database connectivity; migrations run
before the production server starts. It does not check Microsoft sign-in or AI
services. Allow time for migrations during startup and set HTTP probe timeouts.

Locally, use `http://localhost:8000` as the host. The Vite dev server also proxies
`/healthcheck` to the backend, so these paths work on `http://localhost:5173`.
Existing `/health` and `/api/health` endpoints remain basic process checks.

## CLI

```bash
uv tool install -e ./cli

loc init
# or: loc init -k <api-key> -u http://localhost:8000 -o ./locales -y
loc push
loc pull
loc status
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

- **Project references** use a permanent slug in browser URLs and new CLI configs. The API accepts either the slug or an existing project UUID in `/api/projects/{project_id}` paths; UUIDs remain the internal database identity.
- **Modules** group strings for lazy-loaded bundles. Project `layout` (`flat` \| `modular`) controls export/CLI shape. File keys are stored as-is (dots are not a module prefix). Flat import never creates modules; modular Excel uses sheet names as slugs and CLI uses folders.
- **Translation context** is optional plain text in Project Settings and module create/edit forms, capped at 500 characters each. AI translation combines project context, the string's module context, and its description in that order. These are mandatory translator instructions for tone, terminology, and wording. Blank context clears the setting. Context changes affect future AI requests only; they do not publish or change export, Excel metadata, or CLI sync.
- **Status** is per string: `draft` or `public`. Edits stay on the working copy. `stage=public` export / `loc pull --stage public` uses the last published snapshot until you publish again. Untranslated published locales export as empty. Deletes are soft: never-published keys are hidden immediately; published keys stay on prod until you publish the removal, then remain as a restorable tombstone.
- **Tags** enable batch selection (e.g. publish everything tagged `release-1.4`).
- **Activity log** records string content changes (keys, source, translations, publish/delete), not modules, tags, project settings, or API keys. Undo reverts a bulk import/translate/publish batch; History restores an older working copy of one string. **Review this batch** opens the catalog at `?batch_id=` for import, Excel import, and translate cards. That filter AND-composes with the other string filters and, unlike the default catalog, includes soft-deleted members of the batch. No catalog filter is dropped when `batch_id` is set.

More detail: [docs/](docs/).

### String filters

The strings list, filtered publish preview, and filtered batch actions share the
same predicates. Filters compose with AND; a missing-any group uses OR across
its candidate locales. Complete EN with missing FR, or complete EN with
missing-any across EN and FR, are valid combinations.

Contradictory filters return HTTP 400 with a detail message naming the conflicting
fields: a specific `module` (`module_id` in JSON filters) with
`unassigned_module=true`, a specific `tag` (`tag_id` in JSON) with
`untagged=true`, missing and complete for the same locale, or
`missing_any=true` with complete for the sole configured target locale.
False flags do not create these conflicts. Explicit non-empty `string_ids`
continue to take precedence over a supplied filter.

Missing, complete, and AI confidence filters use the same SQL-trimmed, non-empty
translation predicate. Empty and space-only values count as missing and are
excluded from confidence matches. Confidence thresholds are inclusive and
unscored translations are excluded.

**Updated** filters the string row's `updated_at` (translation-only edits also
bump it). The grid uses the same Sentry-style time control as Activity: presets
(`1h`–`90d` in the URL as `period`) or a custom `since`/`until` range. Only
`since` and `until` are sent to the API; presets are recomputed in UTC on each
request. Legacy bookmarks with `updated_within_days=7` or `30` still work. Filter
state persists in browser URLs; Clear resets filters while retaining the page
size. The time control's own Clear removes only time params.
New custom calendar ranges cover full days in the browser's local timezone and
store explicit UTC timestamps, including the final day's last microsecond.
Legacy date-only bookmarks still represent full UTC days.

**Translate missing** honors all active grid filters across queue pages. It
captures the filters and relative time cutoff when review opens, reusing that
window for paging and refreshes after Apply. Reopening review captures a fresh
window. It includes only matching live strings with empty cells in the requested
locales; filled cells and deleted strings are excluded. A Complete filter can therefore
produce an empty queue when no other target locale is missing.

## Development

```bash
# Backend tests. TEST_DATABASE_URL must be Postgres and must differ from DATABASE_URL.
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
