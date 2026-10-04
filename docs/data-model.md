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

- String uniqueness is one live row per `(project_id, key)`. A tombstone (`deleted_at` set) does not hold the key, so the same key can be created again. A `pending_delete` row is still live and keeps the key. The same key cannot exist in two modules.
- `module_id` is nullable (`ON DELETE SET NULL`). Unassigned strings export under `_unassigned` (Excel) or at the top level (JSON modular).
- Translation status: `draft` \| `public` on each **string** (not per locale). Working-copy fields (`key`, `source_text`, translations.`value`) are what the editor changes. `published_*` / `published_value` hold the last snapshot used by `stage=public` export. `translations.confidence` is an optional 0–100 AI self-score written by translate; manual edits, import, and CLI push clear it. `pending_delete` marks a published string for removal on the next publish. `deleted_at` is a soft tombstone: the row stays, uniqueness no longer holds that key, and both exports omit it.
- API keys live in `api_keys` (hashed). Projects no longer store a bare `api_key` column.
- `activities` is append-only. Only **string** content writes are logged (keys, source, translations, tags, publish, delete). Module, tag, project, and API key changes are not. Content rows are revertible.

## Flat vs modular export

| Layout | Shape |
|--------|-------|
| `flat` | `{ locale: { "common.save": value, "hello": value } }` — stored keys as-is, never `module.key` prefixed |
| `modular` | `{ modules: { login: { vi: {...}, en: {...} } }, unassigned: {...}, manifest: {...} }` — keys inside each locale map are stored as-is; the module is the folder/slug |

Project setting chooses the default; export query param overrides.

## Draft / public workflow

1. New strings default to `draft`. Edits, AI translate, JSON import, and CLI push write the **working copy** only and never copy it to the published snapshot (and never auto-publish).
2. **Publish** (per string or selected batch) copies working → published (`published_key`, `published_module_id`, `published_source_text`, `published_value`) and sets `status=public`. `POST /strings/publish-preview` returns a server fingerprint of that publishable working copy. Confirm must send it on `POST /strings/batch` `action=publish`; a mismatch is HTTP 409 `publish_fingerprint_mismatch` and writes nothing. Omitting the fingerprint is HTTP 400.
3. CLI/CI `locale pull --stage public` (or export `stage=public`) uses that snapshot. Target locales export the published value, or empty if none. No source-text fallback. `stage=draft` / `all` uses the working copy and omits `pending_delete` strings so staging can test a removal.
4. Editing a public string leaves prod on the last snapshot until you publish again. **Unpublish** sets `status=draft` and drops the key from public export immediately (published columns are kept).
5. Deleting a string that has a published snapshot sets `pending_delete` instead of removing the row. Public export still ships the snapshot until you publish that delete. Publishing the delete sets `deleted_at` (soft tombstone) rather than hard-deleting. Never-published strings set `deleted_at` immediately. **Restore** / **Discard delete** clear those flags. The same key can be created again while a tombstone exists.
6. Import / Excel `status=public` applies on **create** (create then publish). Updates never flip status.

## Version control

`activities` is append-only. Every string content write is captured in `before_flush` with CRUD `action` (`create` | `update` | `delete`) for revert, plus a stored `event_type` and human `summary` classified from the `before`/`after` diff (and restore intent). `ACTIVITY_RETENTION_DAYS` (default 90; 0 = keep forever) deletes activity rows older than that many days via `uv run python -m app.cli prune-activities`. Pruning is not run on API startup. Pruning removes feed, History, and Undo for those old events; it does not delete strings.

Named project snapshots are not in this pass.

### Project feed vs string History vs bulk undo

| Surface | Reads | Restore |
|---------|--------|---------|
| **Project Activity feed** (`GET /activities/feed`) | Cards grouped by `coalesce(batch_id, id)`, paginated by card. Counts are aggregated in SQL; batch children in the payload are capped at 50 while `children_count` is the full total. Locale filter matches `activity.locale` or a translation key in the snapshot JSON. | **Undo** only on bulk cards (`import` / `excel_import` / `translate` / `batch`) via `POST /activities/batch/{id}/revert`. API and UI default `force=false`; a 409 (later edits) can be retried with `force=true` after a second confirm. Create-undo tombstones (never hard-deletes). |
| **Per-string History** (`GET /strings/{id}/activities`) | Newest-first rows for one string, paginated (UI loads 50 at a time) | **Restore working copy** applies that row's working-copy **content** `after` (`key`, source, translations, tags, module) as a new write (`POST /strings/{sid}/activities/{aid}/restore`). Returns HTTP 409 with `key_conflict` if the historical key is already used; never changes `status`, `published_*`, or `pending_delete`. Response includes a `notice` describing that. **Not offered** for `string.published` / `string.unpublished` / `string.pending_delete` / `string.deleted` |
| **Restore last edit** (grid batch) | Newest restorable activity `before` per selected string (skips publish / unpublish / pending_delete / deleted) | `POST /strings/batch` action `restore_last_history` |

Restore always writes a **new** activity. History restore does not use the revert batch path (that path skips capture). Revert/undo markers use `event_type=string.restored` and summary `Restored previous value of 'key'` — no stacked `Reverted:` / `Redid` prefixes.

`pending_delete` is still `action=update`; the classifier labels it `string.pending_delete`. Publish/unpublish are `action=update` labeled from `status` / `published_*` diffs. Batch Undo restores the recorded full state, including publication; undoing a content edit can also roll back a later publication after an overwrite confirmation. History restore preserves public snapshots. Restoring an older **content** version while the string is pending-delete restores text only and leaves `pending_delete` set; the API `notice` tells the user to use grid **Restore** to cancel the removal.

Feed and History summaries show working-copy changes. Activity details and Undo previews also show published changes. Module references use names when available, and Undo previews describe deletion outcomes.

### Review a push from Activity

`GET /strings` accepts optional `batch_id`. Membership is the distinct `activities.string_id` values for that `(project_id, batch_id)` (`ix_activities_project_batch_id`). An unknown or other-project id returns an empty list (200). When `batch_id` is set and `deleted` is omitted, the list includes soft-deleted and `pending_delete` members; an explicit `deleted` or `pending_delete` value still applies. `batch_id` AND-composes with the other catalog filters (module, tag, `q`, and any later advanced filters). None of those filters are ignored. The same `BatchFilter.batch_id` is used by publish-preview and batch actions. The Activity card opens the catalog with `?batch_id=` — not a long `string_ids=` list.

### Restore and undo validation

History restores only working-copy content. Its preview shows the resolved working-copy destination, excluding publish status and published snapshots. Locale values missing from a recorded translation map are cleared to empty working values; the language configuration, translation rows, and published values stay intact. Missing fields in legacy snapshots preserve their current values.

Full-state Undo previews compare the live state to the actual projected inverse operation. Later nonempty translations in newly added languages count as conflicts; additional empty working rows do not. Normal and forced confirmations warn whenever published content or publish status changes. New undo markers capture the live before/after snapshots, including retained tombstones and pending deletion; older markers are not rewritten.

Reused active keys block History restore, Restore last edit, and Undo, even with force. Writes revalidate ownership and return HTTP 409 with detail `{code: "key_conflict", message, key}`. A failed batch rolls back every content write, audit marker, and revert link. Undo previews expose `can_revert` and `blocked_reason`, plus per-item blocking reasons; hard blockers are aggregated before item truncation. Later-edit conflicts remain distinguishable from key collisions.

Undo validates saved `published_at` and `deleted_at` in both before/after snapshots, even when forced. Valid ISO timestamps are normalized to UTC; missing fields preserve current values and `null` or `""` explicitly clears a timestamp. Malformed values block the preview and execution returns HTTP 409 with detail `{code: "invalid_snapshot", message, activity_id, field}` (for example, `field: "before.published_at"`). No inverse changes or audit links survive a failed batch. History ignores historical publication/lifecycle timestamps because those fields are not restored.

Inverse operations use descending UTC creation time, then activity ID, in both preview and execution. SQLite timestamps without a timezone represent UTC, independent of the server's local timezone. Each inverse uses one live before-state and one resolved target, checks ownership, flushes, and rereads persisted state for its marker. Translations and tags load separately; project references are resolved with a request-local cache. Repeated inverses operate on successive states within the same transaction.

Restoration confirmation shows both sides of changes, including clearing (`FR “Bonjour” → “—”`). Undo's title, warning, button, and submitted force flag derive from the same successful preview. An execution 409 shows its message and refreshes the preview; confirmation remains disabled until a valid refreshed preview permits another confirmation. No automatic forced retry occurs.

The client validates required preview capability/warning fields and consumed collections. Missing or invalid fields show an incompatible-preview error with Retry preview; they never enable confirmation. Deploy backend and frontend together, or backend first for a sequential rollout. Existing audit entries remain unchanged; no schema migration is required. See [Undo performance measurements](undo-performance.md) for the reproducible benchmark and query budgets.
