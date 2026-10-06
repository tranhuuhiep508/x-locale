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

The command is `loc`, avoiding a collision with the system `locale` command on
macOS and Linux. From this repo, use `uv run --project cli loc`, or invoke
`python -m x_locale_cli`.

If you installed an earlier version with the `locale` command, reinstall from
the updated repo to refresh the executable:

```bash
uv tool install --reinstall -e ./cli
```

Update scripts and CI commands from `locale` to `loc`. Existing
`.x-locale/config.yaml` files continue to work.

---

## Quick start

```bash
# 1. Initialise — interactive wizard, or pass flags for CI
loc init
# loc init -k xlocale_your_api_key -u https://x-locale.example.com -o ./src/locales

# 2. Push base-language source strings to x-locale
loc push

# 3. Pull all translations back to disk
loc pull

# 4. Or do both in one step
loc sync

# 5. Check what is out of sync without changing anything
loc status
```

---

## Config — `.x-locale/config.yaml`

`loc init` creates this file automatically.  You can edit it by hand.

```yaml
api_url: http://localhost:8000   # x-locale API origin
web_url: http://localhost:5173   # optional UI origin for review links
project_slug: demo-app           # Auto-discovered from the API key; immutable
api_key: xlocale_xxx                 # Project-scoped API key
output_dir: ./src/locales        # Root directory for locale files
layout: modular                  # flat | modular
stage: draft                     # draft | public  (used by pull/sync)
base_language: vi                # Source language pushed by `loc push`
locales: [vi, en, ko, ja]        # Locales to pull (all if omitted)
manifest: true                   # Write manifest.json on modular pull
```

`web_url` is optional. Existing configs keep working without it. When it is
omitted, `loc push` builds the review link from `api_url`. Set it when the
UI is served separately from the API — local dev uses the API on port 8000 and
Vite on port 5173, so set `web_url: http://localhost:5173`. `XLOCALE_WEB_URL`
is used only when `web_url` is unset.

Project slugs are permanent public references. Existing configurations with
`project_id: <uuid>` continue to work; `loc init` writes `project_slug` for
new configurations. Keep the generated slug or choose a different one when
creating the project, because it cannot be changed later.

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

### `loc init`

Initialise `.x-locale/config.yaml`. Calls `GET /api/bootstrap` with the API key to
discover the linked project, its locales, base language, and layout so those
values are not retyped.

Run `loc init` with no flags in a terminal for the interactive wizard (API URL,
optional Web URL, API key, output directory, pull stage). Passing any of those
flags skips the wizard and uses defaults for the rest. Existing config is not
overwritten unless you confirm or pass `--yes`. Leave Web URL blank to use the
API origin.

```
Options:
  -k, --api-key TEXT       Project API key (prompted if omitted)
  -u, --api-url TEXT       x-locale server base URL  [default: http://localhost:8000]
  --web-url TEXT           Web app URL for review links (optional; defaults to the API origin)
  -o, --output-dir TEXT    Directory for locale files  [default: ./locales]
  --base-language TEXT     Base/source language; must match the discovered project
  --layout TEXT            flat | modular (otherwise from project)
  --stage TEXT             draft | public  [default: draft]
  -y, --yes                Skip prompts; overwrite existing config
```

### `loc push`

Push base-language strings to x-locale.

- **Flat** — reads `{output_dir}/{base_language}.json`. Keys are stored as-is
  (a file key `common.save` stays `common.save`; dots are not treated as a
  module prefix). Flat push never creates or assigns modules.
- **Modular** — scans `{output_dir}/*/{base_language}.json`; derives module
  slugs from directory names. Push sends
  `{ modules: { slug: { locale: { key: value } } } }`. Keys in each file are
  stored as-is and are **not** prefixed with the folder name.

Orphaned remote keys (present on x-locale but absent locally) are **reported but
never deleted**. Push rejects the entire operation if any local source key is
queued for removal (`pending_delete`) or tombstoned on x-locale. Restore the
string in x-locale or remove it locally, then retry. This check also runs when
local files match the push index; `loc sync` stops before pull on rejection.
A historical tombstone does not block a live string created later with the same
key.

Push sends only keys changed since the last successful push or draft pull.
`--full` sends the entire source catalog and reports remote-only keys. Every push
checks current server metadata, including dry-run and an empty delta. The
configured base language must match the project; refresh stale config with
`loc init`.

A push that creates or updates strings prints one absolute review link when a
web origin can be resolved:

```
Review: http://localhost:5173/projects/demo-app/strings?batch_id=<batch_id>&batch_kind=import
```

The link opens the strings catalog filtered to that import batch. Dry runs and
pushes that do not create or update strings omit the line.

```
Options:
  --output-dir TEXT    Override output directory
  --layout TEXT        Override layout
  --stage TEXT         Override stage
  --locales TEXT       Comma-separated locale list
  --dry-run            Preview changes without applying
  --full               Send the entire source catalog, ignoring the push index
```

### `loc pull`

Pull validates the entire export and resolves all affected paths before writing
or pruning. Invalid responses, incomplete locale maps, malformed manifests, or
unsafe/aliasing paths fail without changing files, the manifest, or the push
index. Empty locale maps and empty catalogs remain valid exports.

Pull translations from x-locale to local files. Each run downloads the full
stage export and **replaces** in-scope locale files with that payload (canonical
JSON). There is no revision or delta download. A draft pull refreshes
`.x-locale/push-index.json` from the export base catalog so the next push can
stay a delta push when values match.

- **Flat** — writes `{output_dir}/{locale}.json` for each locale in scope,
  including `{}` when the export has no keys for that locale.
- **Modular** — writes `{output_dir}/{module}/{locale}.json` and, when
  `manifest: true`, `{output_dir}/manifest.json`. Empty locale maps inside a
  module are written as `{}`. When every in-scope `_unassigned` map is empty,
  `_unassigned/` is removed.
- **Prune** — deletes in-scope `{locale}.json` files (and empty module folders)
  that are not in this export. Removed keys and file paths are listed in the
  pull report. Locales outside `--locales` / config `locales` are left untouched.
- Key diffs (Created / Updated / Removed) compare the previous file to the
  export. Files are always rewritten even when values are unchanged.
- Keys that exist only in rewritten files are removed from those files. Run
  `loc push` first when new base-language keys in real modules should be
  kept on x-locale. `_unassigned` is never pushed; pull deletes those files and
  lists the keys (including after `loc sync`).

```
Options:
  --output-dir TEXT    Override output directory
  --layout TEXT        Override layout
  --stage TEXT         Override stage (draft is the working copy, omitting
                       pending deletes and tombstones; public is the last
                       published snapshot, omitting soft-deleted keys)
  --locales TEXT       Comma-separated locale list
```

### `loc sync`

Runs `push` then `pull` in one step.  Accepts the same override flags as
`push`/`pull`. After both phases, a **Sync summary** lists leftover mismatches
with reasons and next steps. Exit code `1` if any blocking issue remains.

### `loc status`

Show a diff between local files and x-locale without making any changes.

Compares local base-language keys to this stage’s **export**, then classifies
keys that exist on x-locale but are hidden from export.

Displays:

- **Keys in export** — base-language keys in the stage export
- **Local keys** — total base-language keys found locally
- **Missing locally** — in export, absent locally → `loc pull`
- **Local only** — in local files, not on x-locale → `loc push`
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

Nested objects and non-string values are rejected. All discovered source files
must be valid before push can proceed. Trailing commas are supported outside
quoted strings; punctuation and escapes inside strings are preserved exactly.
Explicitly empty (`""`) and whitespace-only source values are stored as supplied.
Comments and other nonstandard JSON syntax are rejected.

---

## CI / production example

```bash
# Pull only public-stage translations for a subset of locales
loc pull --stage public --locales en,ja
```

---

## E2E tests (ship gate)

Process tests invoke the real `loc` CLI against a live FastAPI backend with a
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
via the dev-bypass session API, and runs `uv run --project cli loc …` in temp
directories.

### Coverage (XLOCALE-11)

| # | Scenario |
|---|----------|
| 1 | `loc init` writes `.x-locale/config.yaml` from bootstrap |
| 2 | `loc push` (flat + modular); orphans reported, never deleted |
| 3 | `loc push --dry-run` reports without writing |
| 4 | `loc pull --stage draft` writes files; pending-delete omitted |
| 5 | `loc pull --stage public` uses published snapshot |
| 6 | `loc status` exit 0 in sync; exit 1 on mismatch |
| 7 | `loc sync` push+pull; local-only files in scope are replaced |
| 8 | Bad/missing API key → non-zero exit, no hang |
| 9 | Modular `_unassigned` not pushed |
| 10 | Pull rewrites from export even when key values unchanged |
| 11 | Single-locale pull + status still correct for base |

CI workflow: `.github/workflows/cli-e2e.yml` (job name: `cli-e2e`).

## Compatibility for the push/pull safety release

Deploy the updated backend before installing the updated CLI. The CLI requires
`sync-state.locales`; an older backend produces a clear error before writes.
No database migration or new dependencies are needed. Existing CLI payloads
without `base_language` remain accepted by the updated backend.

The push index is now version 2. A version-1 index triggers one full push; a
successful push or draft pull replaces it with the new index. Public pulls that
change source files still remove the index. Full pushes obey deletion safeguards.

This release does not repair text previously altered by the old JSON parser or
empty-source fallback. Review affected source text against source control or
backups before pushing. General UI JSON uploads continue to support restoring
strings; CLI push requires restoring deleted strings in x-locale first.
