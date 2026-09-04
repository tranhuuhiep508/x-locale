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
- Translation status: `draft` \| `public` on each **string** (not per locale). Working-copy fields (`key`, `source_text`, translations.`value`) are what the editor changes. `published_*` / `published_value` hold the last snapshot used by `stage=public` export. `translations.confidence` is an optional 0–100 AI self-score written by translate; manual edits, import, and CLI push clear it. `pending_delete` marks a published string for removal on the next publish. `deleted_at` is a soft tombstone: the row stays, uniqueness no longer holds that key, and both exports omit it.
- API keys live in `api_keys` (hashed). Projects no longer store a bare `api_key` column.
- `activities` is append-only. Only **string** content writes are logged (keys, source, translations, tags, publish, delete). Module, tag, project, and API key changes are not. Content rows are revertible.

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

`activities` is append-only. Every string content write is captured in `before_flush` with CRUD `action` (`create` | `update` | `delete`) for revert, plus a stored `event_type` and human `summary` classified from the `before`/`after` diff (and restore intent). `ACTIVITY_RETENTION_DAYS` (0 = keep forever) deletes activity rows older than that many days on API startup and via `uv run python -m app.cli prune-activities`. Pruning removes feed, History, and Undo for those old events; it does not delete strings.

Named project snapshots are not in this pass.

### Project feed vs string History vs bulk undo

| Surface | Reads | Restore |
|---------|--------|---------|
| **Project Activity feed** (`GET /activities/feed`) | Cards grouped by `coalesce(batch_id, id)`, paginated by card. Batch children are capped at 50; `children_count` is the full total. | **Undo** only on bulk cards (`import` / `excel_import` / `translate` / `batch`) via `POST /activities/batch/{id}/revert`. API `force` defaults false; the UI passes `force=true`. Create-undo tombstones (never hard-deletes). |
| **Per-string History** (`GET /strings/{id}/activities`) | Newest-first rows for one string | **Restore this version** applies that row's working-copy **content** `after` (`key`, source, translations, tags, module) as a new write (`POST /strings/{sid}/activities/{aid}/restore`). Never 409s; never changes `status`, `published_*`, or `pending_delete`. Response includes a `notice` describing that. **Not offered** for `string.published` / `string.unpublished` / `string.pending_delete` / `string.deleted` |
| **Restore last edit** (grid batch) | Latest activity `before` per selected string | `POST /strings/batch` action `restore_last_history` |

Restore always writes a **new** activity. History restore does not use the revert batch path (that path skips capture). Revert/undo markers use `event_type=string.restored` and summary `Restored previous value of 'key'` — no stacked `Reverted:` / `Redid` prefixes.

`pending_delete` is still `action=update`; the classifier labels it `string.pending_delete`. Publish/unpublish are `action=update` labeled from `status` / `published_*` diffs. Public snapshots are rolled back only by Publish / Unpublish (or **batch** undo of a publish/unpublish event), not by History restore. Restoring an older **content** version while the string is pending-delete restores text only and leaves `pending_delete` set; the API `notice` tells the user to use grid **Restore** to cancel the removal.

The UI `changed` list is working-copy fields only (`key`, `source_text`, translations, `status`). It does not dump `module_id`, `published_*`, or `deleted_at`.
