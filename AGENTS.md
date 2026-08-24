# AGENTS.md

TMS (Translation Management System) — a monorepo with a FastAPI backend, a
React/Vite frontend, and a Python CLI. See `README.md` for the product overview
and `docs/` for the data model and draft/public workflow.

## Cursor Cloud specific instructions

Dependencies are already installed by the environment update script on VM startup
(backend + CLI via `uv sync`, frontend via `npm install`). You normally only need
to start the services and run tests — do not re-run installs unless something is
missing.

### Services

| Service | Dir | Start (dev) | Port | Notes |
|----------|------------|-------------------------------------------------------------------------|------|-------|
| Backend | `backend/` | `uv run alembic upgrade head && uv run python -m app.cli seed-demo && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload` | 8000 | FastAPI + SQLite/Postgres. Schema via Alembic (not `create_all`). |
| Frontend | `frontend/`| `npm run dev` | 5173 | Vite; proxies `/api` → backend `:8000` (no path rewrite). |
| CLI | `cli/` | `uv run --project cli tms <init\|push\|pull\|sync\|status> ...` | n/a | Config-driven via `.tms/config.yaml`. |

Start the backend BEFORE the frontend. Vite uses `strictPort: true` on 5173.

### Config / auth

- Root `.env` (from `.env.example`) is shared by backend and Vite (`envDir` = repo root).
- UI auth: session cookie (`tms_session` JWT signed with `TMS_SECRET`). Microsoft Entra ID via `OIDC_*` (`/common` = work + personal accounts). `AUTH_DEV_BYPASS=true` mints a Dev User only when OIDC is not configured.
- CLI/runtime auth: `X-API-Key` (or `?api_key=`). Keys are hashed in `api_keys`; create them in Project Settings.
- Demo seed: `uv run python -m app.cli seed-demo` creates a Vietnamese-base modular "Demo App" with `auth`/`home`/`common` modules and key `TMS_DEMO_API_KEY`.

### Non-obvious behavior

- Translation status is `draft` \| `public` on each **string** (not per locale). AI translate never auto-publishes.
- Export `stage=public` includes only public strings; missing target locales export as empty (no source fallback).
- Translation inputs save on **blur**.
- Content writes are audited via `before_flush` → `activities`. Batch/import/translate set `batch_id` for grouped revert.
- Modules are always stored; project `layout` only affects export/CLI pull shape.
- Flat export prefixes keys as `{module_slug}.{key}`.

### Lint / test / build

- Backend: `cd backend && uv run pytest` (Ruff available via `uv run ruff check`).
- Frontend: `cd frontend && npm run build` (`tsc` via Vite) ; `npm run test` (Vitest).
- CLI: `uv run --project cli python -m unittest discover -s cli/tests`.
- Validate backend manually: `GET /health`, `GET /api/auth/me` (session cookie, or bypass when OIDC is unset), `GET /api/bootstrap` with `X-API-Key`.
