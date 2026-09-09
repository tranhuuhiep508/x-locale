# Playwright E2E tests

End-to-end tests for the x-locale web UI. These are the **PR merge gate** for core UI flows; they complement (not replace) Vitest, pytest, and CLI unit tests.

## Prerequisites

- Backend: [uv](https://astral.sh/uv/) + Python 3.14+ (same as local dev)
- Frontend: Node.js 20+
- Playwright browsers (installed once)

## Quick start

```bash
# From repo root — installs Playwright + Chromium
npm run e2e:install

# Run all core flows (starts backend :8000 and frontend :5173 automatically)
npm run e2e
```

### Environment

E2E uses an **isolated SQLite database** at `e2e/.data/e2e.db` (not `backend/x-locale.db`).

| Variable | E2E value | Notes |
|----------|-----------|-------|
| `AUTH_DEV_BYPASS` | `true` | Dev User session without OIDC |
| `OIDC_*` | empty | Bypass is ignored when OIDC is configured |
| `DATABASE_URL` | `sqlite:///…/e2e/.data/e2e.db` | Set by Playwright config |
| `X_LOCALE_SECRET` | `e2e-test-secret` | JWT signing for session cookie |

`global-setup.ts` runs `alembic upgrade head` and `seed-demo --force` on that database before the suite. Each spec file calls `resetDemoDatabase()` in `beforeAll` so flows stay independent while sharing one DB (workers are serialized).

### Useful commands

```bash
cd e2e
npm test                    # headless
npm run test:ui             # Playwright UI mode
npx playwright test flow-03 # single spec
npx playwright show-report  # last HTML report (traces on failure)
```

## Core flows → spec files

| Flow | Spec | What it covers |
|------|------|----------------|
| 1 — Sign-in → Demo project | `e2e/tests/flow-01-sign-in-demo.spec.ts` | Dev bypass, login page, Demo App strings catalog |
| 2 — Catalog CRUD + module/tag | `e2e/tests/flow-02-catalog-crud.spec.ts` | Add string, inline module/tag (dialog stays open), edit source |
| 3 — Publish preview | `e2e/tests/flow-03-publish-preview.spec.ts` | New to public, content updates, in-sync noop, needs-publish review |
| 4 — Soft-delete / restore | `e2e/tests/flow-04-soft-delete.spec.ts` | Never-published delete/restore; published pending-delete + publish removal |
| 5 — Import / export | `e2e/tests/flow-05-import-export.spec.ts` | Dry-run create/update/orphan, cancel, apply, export public JSON |

Out of scope for v1: Translate Review, Activity, settings/API keys, Modules/Tags pages, Excel import, visual snapshots.

## Conventions

- Prefer `getByRole` / `getByLabel` selectors.
- **No `retries`** in config — failures are not masked.
- **One worker** — avoids shared-DB flakes on SQLite.
- On failure: **trace + screenshot** attached to the HTML report.

## CI (PR gate)

Workflow: `.github/workflows/e2e.yml` (job name: `e2e`).

Runs on every pull request and on pushes to `master`. To block merges:

1. GitHub → **Settings → Branches → Branch protection** for `master`
2. Enable **Require status checks to pass**
3. Select **`e2e`** as a required check

Until branch protection is configured, the job still runs on PRs but merge is not blocked automatically.

## Resetting demo data locally

```bash
cd backend
DATABASE_URL="sqlite:///$(pwd)/../e2e/.data/e2e.db" \
  AUTH_DEV_BYPASS=true \
  uv run python -m app.cli seed-demo --force
```

Or delete `e2e/.data/e2e.db` and re-run `npm run e2e` (global setup recreates it).
