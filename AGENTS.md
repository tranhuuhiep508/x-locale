# AGENTS.md

TMS (Translation Management System) — a small monorepo with a FastAPI backend, a
React/Vite frontend, and a Python CLI. See `README.md` for the full product
overview and the standard commands; this file only captures durable, non-obvious
context for working in this repo.

## Cursor Cloud specific instructions

> Scope: this reflects the app's **current MVP state**, not a finished product.
> The run/test/config facts below are stable, but the feature-behavior notes
> (API-key-only auth, the seeded Demo App, the worst-status logic, save-on-blur)
> describe current behavior — update this file as those features are built out.

Dependencies are already installed by the environment update script on VM startup
(backend + CLI via `uv sync`, frontend via `npm install`). You normally only need
to start the services and run tests — do not re-run installs unless something is
missing.

### Services

| Service  | Dir        | Start (dev)                                                              | Port | Notes |
|----------|------------|-------------------------------------------------------------------------|------|-------|
| Backend  | `backend/` | `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`       | 8000 | FastAPI + SQLite. Auto-creates & seeds `backend/tms.db` on startup. |
| Frontend | `frontend/`| `npm run dev`                                                           | 5173 | Vite dev server; proxies `/api` → backend `:8000`. |
| CLI      | `cli/`     | `uv run --project cli tms <init\|push\|pull> ...`                        | n/a  | HTTP client to the backend; optional for dashboard work. |

Start the backend BEFORE (or alongside) the frontend: the dashboard bootstraps by
calling `/bootstrap/project` through the Vite proxy, and it errors clearly if the
backend isn't reachable. Vite uses `strictPort: true` on 5173 — run only ONE
frontend dev server at a time.

### Config / auth

- All config is read from a single root `.env` (copy `.env.example` → `.env`).
  Both the backend (pydantic-settings) and Vite (`envDir` is the repo root) read
  this same file, so keep `TMS_DEMO_API_KEY` and `VITE_API_KEY` in sync.
- There is no user login. Auth is a project-scoped API key passed as `?api_key=`.
  The default demo key is `demo-api-key-change-me`, baked into the frontend via
  `VITE_API_KEY` at dev/build time (no login screen).
- On first startup the backend seeds a "Demo App" project with 10 English strings
  (empty VI/JA). Deleting `backend/tms.db` resets to this seeded state.

### Non-obvious behavior

- Row **Status** in the dashboard shows the *worst* status across all target
  locales: a row is `live` only when every target locale (both `vi` and `ja`) has
  a non-empty value; if any is empty the row stays `draft`. An empty locale
  keeping a row in `draft` is expected, not a bug.
- Translation inputs save on **blur** (click away), not on a Save button.
- **AI translate** (the per-row "Translate" button and `/translate-missing`)
  requires AWS Bedrock credentials (`AWS_BEARER_TOKEN_BEDROCK` or AWS keys). These
  are optional — without them, AI endpoints fail while all other CRUD/sync works.
- Backend requires Python 3.14; `uv` provisions it automatically (system `python3`
  is older and should not be used to run the backend). `uv` lives in
  `~/.local/bin` (on PATH via `~/.bashrc`).

### Lint / test / build

There are no dedicated linters (no ruff/eslint/mypy configured).

- Frontend typecheck + build: `npm run build` (runs `tsc -b && vite build`).
- CLI tests: `uv run --project cli python -m unittest discover -s cli/tests`
  (or `cd cli && uv run python -m unittest discover -s tests`).
- Backend: no automated test suite; validate by starting it and hitting
  `GET /health` and `GET /bootstrap/project?api_key=demo-api-key-change-me`.
