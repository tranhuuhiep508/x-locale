# Data model

## Entities

```
users ──< api_keys >── projects ──< modules
                          │
                          ├──< tags
                          │       │
                          ├──< strings >── string_tags
                          │       │
                          │       └──< translations
                          └──< activities
```

## Key constraints

- String uniqueness is `(project_id, module_id, key)` — the same key may exist in different modules.
- `module_id` is nullable (`ON DELETE SET NULL`). Unassigned strings export under `_unassigned` (Excel) or at the top level (JSON modular).
- Translation status: `draft` \| `public` on each **string** (not per locale).
- API keys live in `api_keys` (hashed). Projects no longer store a bare `api_key` column.
- `activities` is append-only. Content entities (`string`, `translation`) are revertible; structural ones (`module`, `tag`, `project`, `api_key`) are audit-only.

## Flat vs modular export

| Layout | Shape |
|--------|-------|
| `flat` | `{ locale: { "module.key": value, "orphan": value } }` — module-scoped keys are prefixed |
| `modular` | `{ modules: { login: { vi: {...}, en: {...} } }, unassigned: {...}, manifest: {...} }` |

Project setting chooses the default; export query param overrides.

## Draft / public workflow

1. New strings default to `draft`. AI translate writes values only and never auto-publishes.
2. Translators edit; **Publish** (batch or string update) sets `strings.status=public` anytime — independent of locale completeness.
3. CLI/CI `tms pull --stage public` (or export `stage=public`) includes only public strings. Target locales export the stored translation value, or empty if not translated yet. No source-text fallback.
4. Import / Excel can set string `status=public` via query param; otherwise imported strings stay `draft`.

## Version control

Every content write emits `activities` rows (via SQLAlchemy `before_flush`). Revert one row or a whole `batch_id` (import, translate, batch ops). Optional `ACTIVITY_RETENTION_DAYS` can prune old rows.
