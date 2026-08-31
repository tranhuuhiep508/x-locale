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
- Translation status: `draft` \| `public` on each **string** (not per locale). Working-copy fields (`key`, `source_text`, translations.`value`) are what the editor changes. `published_*` / `published_value` hold the last snapshot used by `stage=public` export. `pending_delete` marks a published string for removal on the next publish. `deleted_at` is a soft tombstone: the row stays, uniqueness no longer holds that key, and both exports omit it.
- API keys live in `api_keys` (hashed). Projects no longer store a bare `api_key` column.
- `activities` is append-only. Content entities (`string`, `translation`) are revertible; structural ones (`module`, `tag`, `project`, `api_key`) are audit-only.

## Flat vs modular export

| Layout | Shape |
|--------|-------|
| `flat` | `{ locale: { "module.key": value, "orphan": value } }` — module-scoped keys are prefixed |
| `modular` | `{ modules: { login: { vi: {...}, en: {...} } }, unassigned: {...}, manifest: {...} }` |

Project setting chooses the default; export query param overrides.

## Draft / public workflow

1. New strings default to `draft`. Edits, AI translate, JSON import, and CLI push write the **working copy** only and never copy it to the published snapshot (and never auto-publish).
2. **Publish** (per string or selected batch) copies working → published (`published_key`, `published_module_id`, `published_source_text`, `published_value`) and sets `status=public`.
3. CLI/CI `tms pull --stage public` (or export `stage=public`) uses that snapshot. Target locales export the published value, or empty if none. No source-text fallback. `stage=draft` / `all` uses the working copy and omits `pending_delete` strings so staging can test a removal.
4. Editing a public string leaves prod on the last snapshot until you publish again. **Unpublish** sets `status=draft` and drops the key from public export immediately (published columns are kept).
5. Deleting a string that has a published snapshot sets `pending_delete` instead of removing the row. Public export still ships the snapshot until you publish that delete. Publishing the delete sets `deleted_at` (soft tombstone) rather than hard-deleting. Never-published strings set `deleted_at` immediately. **Restore** / **Discard delete** clear those flags. The same key can be created again while a tombstone exists.
6. Import / Excel `status=public` applies on **create** (create then publish). Updates never flip status.

## Version control

Every content write emits `activities` rows (via SQLAlchemy `before_flush`). Revert one row or a whole `batch_id` (import, translate, batch ops). Optional `ACTIVITY_RETENTION_DAYS` can prune old rows.
