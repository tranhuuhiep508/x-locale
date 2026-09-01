# tms-cli

Sync locale files with a [TMS](https://github.com/your-org/tms) server.

## Install

Install [uv](https://docs.astral.sh/uv/) first if you do not have it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**From PyPI**

```bash
uv tool install tms-cli
```

**From this repo**

```bash
uv tool install -e ./cli
```

**Windows:** After install, run `python -m tms_cli.windows` once to replace the
unsigned `tms.exe` shim with `tms.cmd` so Smart App Control does not block the
command.

---

## Quick start

```bash
# 1. Initialise — discovers the project from your API key
tms init -k tms_your_api_key -u https://tms.example.com -o ./src/locales

# 2. Push base-language source strings to TMS
tms push

# 3. Pull all translations back to disk
tms pull

# 4. Or do both in one step
tms sync

# 5. Check what is out of sync without changing anything
tms status
```

---

## Config — `.tms/config.yaml`

`tms init` creates this file automatically.  You can edit it by hand.

```yaml
api_url: http://localhost:8000   # TMS server base URL
project_id: <uuid>               # Auto-discovered from the API key
api_key: tms_xxx                 # Project-scoped API key
output_dir: ./src/locales        # Root directory for locale files
layout: modular                  # flat | modular
stage: draft                     # draft | public  (used by pull/sync)
base_language: vi                # Source language pushed by `tms push`
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

### `tms init`

Initialise `.tms/config.yaml`.  Calls `GET /api/bootstrap` with the supplied API
key to discover the linked project and its locales.

```
Options:
  -k, --api-key TEXT       Project API key  [required]
  -u, --api-url TEXT       TMS server base URL  [default: http://localhost:8000]
  -o, --output-dir TEXT    Directory for locale files  [default: ./locales]
  --base-language TEXT     Base/source language override  [default: en]
  --layout TEXT            flat | modular  [default: flat]
  --stage TEXT             draft | public  [default: draft]
```

### `tms push`

Push base-language strings to TMS.

- **Flat** — reads `{output_dir}/{base_language}.json`
- **Modular** — scans `{output_dir}/*/{base_language}.json`; derives module
  slugs from directory names. Push sends
  `{ modules: { slug: { locale: { key: value } } } }`. Keys in each file are
  stored as-is and are **not** prefixed with the folder name.

Orphaned remote keys (present on TMS but absent locally) are **reported but
never deleted**. Keys queued for removal (`pending_delete`) are listed as
**Pending remove (unchanged)** — push will not re-create them.

```
Options:
  --output-dir TEXT    Override output directory
  --layout TEXT        Override layout
  --stage TEXT         Override stage
  --locales TEXT       Comma-separated locale list
  --dry-run            Preview changes without applying
```

### `tms pull`

Pull translations from TMS to local files.

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

### `tms sync`

Runs `push` then `pull` in one step.  Accepts the same override flags as
`push`/`pull`. After both phases, a **Sync summary** lists leftover mismatches
with reasons and next steps. Exit code `1` if any blocking issue remains
(untranslated counts alone do not fail).

### `tms status`

Show a diff between local files and TMS without making any changes.

Compares local base-language keys to this stage’s **export**, then classifies
keys that exist on TMS but are hidden from export.

Displays:

- **Keys in export** — base-language keys in the stage export
- **Local keys** — total base-language keys found locally
- **Missing locally** — in export, absent locally → `tms pull`
- **Local only** — in local files, not on TMS → `tms push`
- **Pending remove on TMS** — local key is queued for deletion; omitted from
  draft export. Push will not re-add it. Restore or publish the delete in TMS,
  or remove the key locally.
- **Removed on TMS (tombstone)** — soft-deleted on TMS
- **Source text differs** — same key, different base-language text
- **`_unassigned` (CLI will not push)** — extra keys under `_unassigned/`
- **Untranslated (locale)** — base-language keys with no translation on TMS
  (informational; does not fail the command)

Draft export omits pending-remove keys and tombstones. Exit code `1` when any
blocking mismatch above remains.

---

## Auth

The CLI sends the API key in the `X-API-Key` header.  The TMS server also
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
tms pull --stage public --locales en,ja
```
