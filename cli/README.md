# x-locale-cli

Sync locale files with an [x-locale](https://github.com/your-org/x-locale) server.

## Install

Install [uv](https://docs.astral.sh/uv/) first if you do not have it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**From PyPI**

```bash
uv tool install x-locale-cli
```

**From this repo**

```bash
uv tool install -e ./cli
```

**Windows:** After install, run `python -m x_locale_cli.windows` once to replace the
unsigned `locale.exe` shim with `locale.cmd` so Smart App Control does not block the
command.

The `locale` command can shadow the system `/usr/bin/locale` tool if the uv/pip
scripts directory is first on `PATH`. Use `uv run --project cli locale` from this
repo, or invoke `python -m x_locale_cli`, if you still need the OS command.

---

## Quick start

```bash
# 1. Initialise — interactive wizard, or pass flags for CI
locale init
# locale init -k xlocale_your_api_key -u https://x-locale.example.com -o ./src/locales

# 2. Push base-language source strings to x-locale
locale push

# 3. Pull all translations back to disk
locale pull

# 4. Or do both in one step
locale sync

# 5. Check what is out of sync without changing anything
locale status
```

---

## Config — `.x-locale/config.yaml`

`locale init` creates this file automatically.  You can edit it by hand.

```yaml
api_url: http://localhost:8000   # x-locale server base URL
project_id: <uuid>               # Auto-discovered from the API key
api_key: xlocale_xxx                 # Project-scoped API key
output_dir: ./src/locales        # Root directory for locale files
layout: modular                  # flat | modular
stage: draft                     # draft | public  (used by pull/sync)
base_language: vi                # Source language pushed by `locale push`
locales: [vi, en, ko, ja]        # Locales to pull (all if omitted)
manifest: true                   # Write manifest.json on modular pull
```

### Flat layout

All locale files live at the top level of `output_dir`:

```
locales/
  vi.json
  en.json
  ja.json
```

### Modular layout

Each module gets its own sub-directory:

```
locales/
  auth/
    vi.json
    en.json
  homepage/
    vi.json
    en.json
  manifest.json
```

---

## Commands

Every command accepts override flags that take precedence over the config file.
The shared flags are: `--output-dir`, `--layout`, `--stage`, `--locales`.

### `locale init`

Initialise `.x-locale/config.yaml`. Calls `GET /api/bootstrap` with the API key to
discover the linked project, its locales, base language, and layout so those
values are not retyped.

Run `locale init` with no flags in a terminal for the interactive wizard (API URL,
API key, output directory, pull stage). Passing any of those flags skips the
wizard and uses defaults for the rest. Existing config is not overwritten
unless you confirm or pass `--yes`.

```
Options:
  -k, --api-key TEXT       Project API key (prompted if omitted)
  -u, --api-url TEXT       x-locale server base URL  [default: http://localhost:8000]
  -o, --output-dir TEXT    Directory for locale files  [default: ./locales]
  --base-language TEXT     Base/source language override (otherwise from project)
  --layout TEXT            flat | modular (otherwise from project)
  --stage TEXT             draft | public  [default: draft]
  -y, --yes                Skip prompts; overwrite existing config
```

### `locale push`

Push base-language strings to x-locale.

- **Flat** — reads `{output_dir}/{base_language}.json`. Keys are stored as-is
  (a file key `common.save` stays `common.save`; dots are not treated as a
  module prefix). Flat push never creates or assigns modules.
- **Modular** — scans `{output_dir}/*/{base_language}.json`; derives module
  slugs from directory names. Push sends
  `{ modules: { slug: { locale: { key: value } } } }`. Keys in each file are
  stored as-is and are **not** prefixed with the folder name.

Orphaned remote keys (present on x-locale but absent locally) are **reported but
never deleted**. Keys queued for removal (`pending_delete`) stay on x-locale;
`locale status` lists them as **Pending remove on x-locale**. Push will not
re-create them.

```
Options:
  --output-dir TEXT    Override output directory
  --layout TEXT        Override layout
  --stage TEXT         Override stage
  --locales TEXT       Comma-separated locale list
  --dry-run            Preview changes without applying
```

### `locale pull`

Pull translations from x-locale to local files.

- **Flat** — writes `{output_dir}/{locale}.json`
- **Modular** — writes `{output_dir}/{module}/{locale}.json` and, when
  `manifest: true`, `{output_dir}/manifest.json`. Created/updated keys use the
  same `module/key` labels as push, with locales listed beside them.
- Keys that were in a rewritten file but are **not** in this stage’s export are
  listed as **Removed from local files**, with a reason (pending remove,
  tombstone, `_unassigned`, or local-only).

```
Options:
  --output-dir TEXT    Override output directory
  --layout TEXT        Override layout
  --stage TEXT         Override stage (draft is the working copy, omitting
                       pending deletes and tombstones; public is the last
                       published snapshot, omitting soft-deleted keys)
  --locales TEXT       Comma-separated locale list
```

### `locale sync`

Runs `push` then `pull` in one step.  Accepts the same override flags as
`push`/`pull`. After both phases, a **Sync summary** lists leftover mismatches
with reasons and next steps. Exit code `1` if any blocking issue remains.

### `locale status`

Show a diff between local files and x-locale without making any changes.

Compares local base-language keys to this stage’s **export**, then classifies
keys that exist on x-locale but are hidden from export.

Displays:

- **Keys in export** — base-language keys in the stage export
- **Local keys** — total base-language keys found locally
- **Missing locally** — in export, absent locally → `locale pull`
- **Local only** — in local files, not on x-locale → `locale push`
- **Pending remove on x-locale** — local key is queued for deletion; omitted from
  draft export. Push will not re-add it. Restore or publish the delete in x-locale,
  or remove the key locally.
- **Removed on x-locale (tombstone)** — soft-deleted on x-locale
- **Source text differs** — same key, different base-language text
- **`_unassigned` (CLI will not push)** — extra keys under `_unassigned/`

Draft export omits pending-remove keys and tombstones. Exit code `1` when any
blocking mismatch above remains.

---

## Auth

The CLI sends the API key in the `X-API-Key` header.  The x-locale server also
accepts it as a `?api_key=` query parameter for back-compat.

---

## Locale JSON format

All locale files use flat JSON with string values only. In **modular** layout,
the folder is the module; keys inside the file are not prefixed with that
folder name:

```json
{
  "auth.email": "Sign in",
  "password": "Password"
}
```

Nested objects and non-string values are rejected.

---

## CI / production example

```bash
# Pull only public-stage translations for a subset of locales
locale pull --stage public --locales en,ja
```

---

## E2E tests (ship gate)

Process tests invoke the real `locale` CLI against a live FastAPI backend with a
project-scoped API key. They assert exit codes, stdout, and catalog side effects.
This suite is separate from Playwright UI tests under `e2e/`.

### Prerequisites

- [uv](https://docs.astral.sh/uv/) (backend + CLI)
- Backend dev dependencies (`cd backend && uv sync --all-extras`)
- CLI dev dependencies (`cd cli && uv sync --extra dev`)

### Run locally

```bash
# From repo root — starts an isolated SQLite backend per session, unique project per test
cd cli && uv run pytest tests/e2e -m e2e -v
```

The harness migrates a temp database, boots `uvicorn` on a free port, creates projects
via the dev-bypass session API, and runs `uv run --project cli locale …` in temp
directories.

### Coverage (XLOCALE-11)

| # | Scenario |
|---|----------|
| 1 | `locale init` writes `.x-locale/config.yaml` from bootstrap |
| 2 | `locale push` (flat + modular); orphans reported, never deleted |
| 3 | `locale push --dry-run` reports without writing |
| 4 | `locale pull --stage draft` writes files; pending-delete omitted |
| 5 | `locale pull --stage public` uses published snapshot |
| 6 | `locale status` exit 0 in sync; exit 1 on mismatch |
| 7 | `locale sync` push+pull; exit 1 when leftovers remain |
| 8 | Bad/missing API key → non-zero exit, no hang |
| 9 | Modular `_unassigned` not pushed |
| 10 | Pull skips rewrite when map unchanged |
| 11 | Single-locale pull + status still correct for base |

CI workflow: `.github/workflows/cli-e2e.yml` (job name: `cli-e2e`).
