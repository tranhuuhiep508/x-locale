# TMS — Translation Management System (MVP)

Self-hosted translation management with dashboard CRUD, AI auto-translate, and CLI sync (`push` / `pull`).

## Prerequisites

- **Option A (local dev):** [uv](https://docs.astral.sh/uv/), Python 3.14+, and Node.js 20+
- **Option B (production-like):** [Docker Desktop](https://www.docker.com/products/docker-desktop/)

Install uv once:

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows
winget install astral-sh.uv
```

## Quick start (local, no Docker)

Install runtimes once (Windows example with winget):

```powershell
winget install Python.Python.3.14
winget install OpenJS.NodeJS.LTS
winget install astral-sh.uv
```

Set env vars in your shell (see `.env.example` for names), e.g. `$env:AWS_BEARER_TOKEN_BEDROCK = "your-bedrock-api-key"`.

**Terminal 1 — backend:**

```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — frontend:**

```bash
cd frontend
npm install
npm run dev
```

Uses SQLite (`backend/tms.db`) by default — no Postgres required for local dev. Environment variables from your shell are used directly; no `.env` file is required.

## Quick start (Docker, local dev with HMR)

### 1. Configure environment

Set variables in your PowerShell profile (or export them in your shell before `docker compose up`). See `.env.example` for names and defaults — at minimum set `AWS_BEARER_TOKEN_BEDROCK` and `BEDROCK_MODEL_ID` for AI translate.

### 2. Start services

```bash
docker compose up --build
```

- Dashboard: http://localhost:5173 (Vite dev server, proxies `/api` → backend)
- API docs: http://localhost:8000/docs
- Demo API key: `demo-api-key-change-me` (default; override with `TMS_DEMO_API_KEY`)

No CORS configuration is needed in dev: the Vite proxy keeps the browser on one origin.

## Quick start (Docker, production)

Build the frontend into the backend image and serve everything from Python on port 8000:

```bash
docker compose -f docker-compose.prod.yml up --build
```

- Dashboard + API: http://localhost:8000
- API docs: http://localhost:8000/docs

Same origin — no separate frontend container and no `CORS_ORIGINS`.

### 3. Install CLI

```bash
# From this repo (recommended for development)
uv tool install -e ./cli
python -m tms_cli.windows     # Windows only, once per machine
```

### 4. Sync with a project

```bash
# In your app repo (not the TMS repo)
tms init -k demo-api-key-change-me -u http://localhost:8000 -o ./locales
tms push ./locales/en.json
tms pull ./locales/
```

## MVP demo script (5 min)

1. Open http://localhost:5173 — see 10 seeded strings (EN/VI/JA)
2. Edit a Vietnamese value inline → save on blur
3. Run `tms pull ./locales/` → check updated `vi.json`
4. Add a key to `en.json` → `tms push ./locales/en.json` → refresh dashboard
5. Click **Translate missing** (requires `AWS_BEARER_TOKEN_BEDROCK`) → `tms pull` again

## Project structure

```
tms/
├── backend/     FastAPI + Postgres
├── frontend/    React dashboard
├── cli/         tms init | push | pull
└── docker-compose.yml
```

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/bootstrap/project?api_key=` | Resolve project by API key |
| GET | `/projects/{id}/strings?api_key=` | List strings |
| POST | `/projects/{id}/strings?api_key=` | Create string |
| PATCH | `/projects/{id}/strings/{key}?api_key=` | Update source |
| PATCH | `/projects/{id}/strings/{key}/{locale}?api_key=` | Update translation |
| DELETE | `/projects/{id}/strings/{key}?api_key=` | Delete string |
| POST | `/projects/{id}/strings/import?api_key=` | CLI push |
| GET | `/projects/{id}/translations.json?api_key=` | CLI pull |
| POST | `/projects/{id}/translate-missing?api_key=` | AI translate |

## Go-live (production)

### Server

1. Deploy with `docker compose -f docker-compose.prod.yml up --build` (or equivalent using `backend/Dockerfile.prod`)
2. Set strong `TMS_SECRET`, `TMS_DEMO_API_KEY`, and Bedrock settings (`AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `BEDROCK_MODEL_ID`)
3. Point a domain at port 8000 — FastAPI serves both the API and the built React dashboard
4. Use HTTPS (Caddy or platform TLS)

The production image bakes `VITE_API_KEY` at build time (`TMS_DEMO_API_KEY` build arg). The dashboard and API share the same origin, so CORS is not required.

### CLI on every developer machine

Each person who syncs translations needs the `tms` command once per machine. Point it at your production API URL.

| Platform | One-time install |
|----------|------------------|
| Any OS | `uv tool install tms-cli` then `python -m tms_cli.windows` on Windows |
| From this repo | `uv tool install -e ./cli` |

The extra Windows step replaces the unsigned `tms.exe` shim with `tms.cmd` so Smart App Control does not block the command.

**From PyPI** (after you publish `tms-cli`):

```bash
uv tool install tms-cli
python -m tms_cli.windows     # Windows only, once per machine
```

**From Git** (before PyPI, or private fork):

```bash
uv tool install "git+https://github.com/YOUR_ORG/tms.git#subdirectory=cli"
```

**In each app repository** (once per repo):

```bash
tms init -k <production-api-key> -u https://api.yourdomain.com -o ./locales
tms push ./locales/en.json    # upload source strings
tms pull ./locales/           # download all locales
```

The `.tms/config.yaml` file is created in the app repo and can be committed so the team shares the same `api_url` and `output_dir` (keep API keys in CI secrets, not git).

**CI/CD** (GitHub Actions, etc.):

```yaml
- uses: astral-sh/setup-uv@v5
- run: uv tool install tms-cli
- run: |
    tms init -k ${{ secrets.TMS_API_KEY }} -u https://api.yourdomain.com -o ./locales
    tms pull ./locales/
```

## What's next (post-MVP)

- Multi-project dashboard
- 4-eyes review workflow
- `tms listen` (WebSocket live sync)
- Release snapshots + `pull --version`
- Glossary, translation memory, webhooks
