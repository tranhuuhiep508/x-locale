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

# Run all core flows (starts isolated backend :8001 and frontend :5174)
npm run e2e
```

### Environment

E2E uses a **unique Postgres database per run** and **dedicated ports** (`8001` / `5174`) so it never attaches to a local `npm run dev` stack on `:8000` / `:5173`. Playwright always starts its own servers (`reuseExistingServer: false`) and stays at **one worker**. Override with `E2E_BACKEND_PORT` / `E2E_FRONTEND_PORT` if those ports are taken. Set `E2E_DATABASE_URL` to choose the database; otherwise the config derives a unique name on the server in `DATABASE_URL`, falling back to the local URL in `.env.example`.

| Variable | E2E value | Notes |
|----------|-----------|-------|
| `AUTH_DEV_BYPASS` | `true` | Dev User session without OIDC |
| `OIDC_*` | empty | Bypass is ignored when OIDC is configured |
| `E2E_DATABASE_URL` | unique Postgres URL | Created from `template0`, dropped after the run |
| `X_LOCALE_SECRET` | `e2e-test-secret` | JWT signing for session cookie |
| `AI_TRANSLATE_STUB` | `true` | Deterministic translate responses (no Bedrock) |
| `AI_TRANSLATE_STUB_DELAY_MS` | `400` | Keeps translate progress UI visible in specs |
| `E2E_BACKEND_PORT` | `8001` | Isolated uvicorn; never `:8000` |
| `E2E_FRONTEND_PORT` | `5174` | Isolated Vite; never `:5173` |

`global-setup.ts` creates that database, then runs `alembic upgrade head` and `seed-demo --force`. Each spec file calls `resetDemoDatabase()` in `beforeAll` so flows stay independent while sharing one DB. `global-teardown.ts` drops the database.

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
| B — AI translate review | `e2e/tests/flow-06-ai-translate-review.spec.ts` | Translate missing → review dialog, progress, apply to working copy (stubbed AI) |
| C — Unpublish selection | `e2e/tests/flow-07-unpublish-selection.spec.ts` | Batch unpublish returns published strings to draft |
| D — Activity undo (batch) | `e2e/tests/flow-08-activity-undo.spec.ts` | Import apply → Activity → Undo restores catalog |
| E — Settings / API key | `e2e/tests/flow-09-settings-api-key.spec.ts` | Generate key, one-time secret, revoke blocks bootstrap |
| 10 — Modules & Tags CRUD | `e2e/tests/flow-10-modules-tags.spec.ts` | Dedicated Modules and Tags management pages CRUD |
| 11 — Excel round-trip | `e2e/tests/flow-11-excel-roundtrip.spec.ts` | Export XLSX, upload preview dry-run, apply, verify catalog |
| 12 — String History restore | `e2e/tests/flow-12-string-history.spec.ts` | History tab restore reverts working copy to previous version |
| Activity/History regressions | `e2e/tests/flow-activity-restore-regressions.spec.ts` | Actual forced-undo history; normal/forced publication warnings; reused-key blockers; full clearing transitions; incompatible-preview retry; 409 refresh and force-mode reset; invalid-snapshot blockers |
| 13 — Publish fingerprint (XLOCALE-5) | `e2e/tests/flow-13-publish-fingerprint.spec.ts` | Batch publish sends preview fingerprint; stale confirm → 409 + re-preview; cancel leaves draft; needs-publish review |

Out of scope: visual snapshots.

## Conventions

- Prefer `getByRole` / `getByLabel` selectors.
- **No `retries`** in config — failures are not masked.
- **One worker** — specs share one Postgres database and reset it in `beforeAll`.
- On failure: **trace + screenshot** attached to the HTML report.

## CI (PR gate)

Workflow: `.github/workflows/e2e.yml` (job name: `e2e`).

Runs on every pull request and on pushes to `master`. CI installs Chromium via `npx playwright install chromium` plus Ubuntu-packaged OS libraries (avoids `playwright install --with-deps`, which can flake when Google's apt mirror has a hash mismatch).

To block merges:

1. GitHub → **Settings → Branches → Branch protection** for `master`
2. Enable **Require status checks to pass**
3. Select **`e2e`** as a required check

Until branch protection is configured, the job still runs on PRs but merge is not blocked automatically.

## Resetting demo data locally

Re-run `npm run e2e`. Global setup creates a new database, migrates it, and seeds the Demo App. Global teardown drops it.
