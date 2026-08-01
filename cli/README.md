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
  slugs from directory names

Orphaned remote keys (present on TMS but absent locally) are **reported but
never deleted**.

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
  `manifest: true`, `{output_dir}/manifest.json`

```
Options:
  --output-dir TEXT    Override output directory
  --layout TEXT        Override layout
  --stage TEXT         Override stage (draft returns everything; public returns
                       only strings marked public, falling back to source text)
  --locales TEXT       Comma-separated locale list
```

### `tms sync`

Runs `push` then `pull` in one step.  Accepts the same override flags as
`push`/`pull`.

### `tms status`

Show a diff between local files and TMS without making any changes.

Displays:

- **Remote keys** — total base-language keys on TMS
- **Local keys** — total base-language keys found locally
- **Missing locally** — keys on TMS that are absent from local files
- **Orphaned locally** — local keys not found on TMS
- **Untranslated (locale)** — count of base-language keys with no translation
  on TMS for each target locale

---

## Auth

The CLI sends the API key in the `X-API-Key` header.  The TMS server also
accepts it as a `?api_key=` query parameter for back-compat.

---

## Locale JSON format

All locale files use flat JSON with string values only:

```json
{
  "auth.sign_in": "Sign in",
  "common.save": "Save"
}
```

Nested objects and non-string values are rejected.

---

## CI / production example

```bash
# Pull only public-stage translations for a subset of locales
tms pull --stage public --locales en,ja
```
