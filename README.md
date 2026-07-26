# TMS — Translation Management System (MVP)

Self-hosted translation management with dashboard CRUD, AI auto-translate, and CLI sync (`push` / `pull`).

## Prerequisites

- **Option A (easiest on Windows):** Python 3.12+ and Node.js 20+ — run `.\scripts\start-local.ps1`
- **Option B (production-like):** [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Quick start (local, no Docker)

```powershell
# Install runtime (once) — or use winget:
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS

# Set env vars in your PowerShell profile (once) — see .env.example for names
# e.g. $env:AWS_BEARER_TOKEN_BEDROCK = "your-bedrock-api-key"

# Start everything
.\scripts\start-local.ps1
```

Uses SQLite (`backend/tms.db`) by default — no Postgres required for local dev. Environment variables from your shell are used directly; no `.env` file is required.

## Quick start (Docker)

### 1. Configure environment

Set variables in your PowerShell profile (or export them in your shell before `docker compose up`). See `.env.example` for names and defaults — at minimum set `AWS_BEARER_TOKEN_BEDROCK` and `BEDROCK_MODEL_ID` for AI translate.

### 2. Start services

```bash
docker compose up --build
```

- Dashboard: http://localhost:5173
- API docs: http://localhost:8000/docs
- Demo API key: `demo-api-key-change-me` (default; override with `TMS_DEMO_API_KEY`)

### 3. Install CLI

```bash
cd cli
pip install -e .
```

### 4. Sync with a project

```bash
# In your app repo
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

1. Deploy `docker compose` to a VPS or Railway/Fly.io
2. Set strong `TMS_SECRET`, `TMS_DEMO_API_KEY`, and Bedrock settings (`AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `BEDROCK_MODEL_ID`)
3. Point a domain at the frontend; set `CORS_ORIGINS` and `VITE_API_URL`
4. Use HTTPS (Caddy or platform TLS)

## What's next (post-MVP)

- Multi-project dashboard
- 4-eyes review workflow
- `tms listen` (WebSocket live sync)
- Release snapshots + `pull --version`
- Glossary, translation memory, webhooks
