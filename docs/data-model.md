# Data model

## Entities

```
users ──< api_keys >── projects ──< modules
  │                       │
  └──< project_members >──┤
                          ├──< tags
                          │       │
                          ├──< strings >── string_tags
                          │       │
                          │       └──< translations
                          └──< activities
```

## Key constraints

- String uniqueness defaults to one live row per `(project_id, key)`. With `allow_duplicate_keys` enabled it is one live row per `(project_id, module_id, key)`, including null modules. A tombstone (`deleted_at` set) does not hold the key, so the same key can be created again. A `pending_delete` row is still live and keeps the key. The same key can exist in two modules only when the project enables that setting.
- `module_id` is nullable (`ON DELETE SET NULL`). Unassigned strings export under `_unassigned` (Excel) or at the top level (JSON modular).
- `strings.key`, `strings.published_key`, `modules.slug` and `tags.name` use `COLLATE "C"` whatever the database collation is. They sort in byte order, the same as Python `sorted()`, so `ORDER BY key` (export, CLI pull, string list) and Python-side sorts (publish preview, module list) agree. Equality and uniqueness are byte-wise under every deterministic collation, so this does not change which keys collide.
- Translation status: `draft` \| `public` on each **string** (not per locale). Working-copy fields (`key`, `source_text`, translations.`value`) are what the editor changes. `published_*` / `published_value` hold the last snapshot used by `stage=public` export. `translations.confidence` is an optional 0–100 AI self-score written by translate; manual edits, import, and CLI push clear it. `pending_delete` marks a published string for removal on the next publish. `deleted_at` is a soft tombstone: the row stays, uniqueness no longer holds that key, and both exports omit it.
- API keys live in `api_keys` (hashed). Projects no longer store a bare `api_key` column. A key is a project-scoped catalog credential, not a membership role: it cannot delete a project or call member APIs. An Editor can revoke a key only when `api_keys.created_by` is that Editor. An Admin can revoke any key on the project. A non-member gets 404.
- `project_members` stores `admin` | `editor` per `(project_id, user_id)`. Authorization reads membership. `projects.created_by` is audit/bootstrap only (set on create, not a permission). The migration backfills an Admin row when `created_by` is set, and skips projects where it is NULL until ops adds an Admin. Deleting a project is a hard cascade and requires the caller to send `confirm_slug` equal to the project slug. Removing a member revokes API keys that member created for the project. Every Admin write locks the project before checking the caller’s current membership and role, holding that lock through commit or rollback. Membership writes, API-key creation/revocation, and project deletion lock the project before touching API keys. API-key revocation also rechecks the caller’s current membership and role under the lock. The lock is FOR NO KEY UPDATE, compatible with foreign-key share locks, and it does not change the project timestamp. API-key creation rechecks membership under that lock, so removal cannot leave a concurrently issued key active. Role changes count Admins while holding the lock so concurrent demotions cannot remove the last Admin.
- `jobs.project_id` is required and set when a translate, import, or undo job is created. `GET /api/jobs/{id}` returns the job to a member of that project, or to an API key of that project. A missing job and a job outside the caller's projects (or the key's project) both return 404 `Job not found`. A failed import or undo job stores the rejection in `result.error` as `{status_code, detail}`, the response the sync request would have returned.
- `activities` is append-only. Only **string** content writes are logged (keys, source, translations, tags, publish, delete). Module, tag, project, and API key changes are not. Content rows are revertible.

Base-language corrections belong in `source_text`, through string create/PATCH or
source imports (JSON, Excel, and CLI). Translation maps and
`PUT /api/projects/{project_id}/strings/{id}/translations/{locale}` accept configured
target languages only. A base-language entry rejects the entire request with HTTP
400 and detail `Base language 'vi' must be edited through source_text.` (using the
project's base language). AI locale selections and proposal Apply enforce the same
base-language restriction; omitted or empty AI locale lists default to configured
targets excluding the base. Project locale-setting writes remove the base language
from target lists. Existing base-language translation rows and history are retained
but are not used by source exports. A `source_text` edit changes draft exports;
public exports change only when the source correction is published.

## Explicit editor saves and publication

The single-string editor keeps edits local until **Save as draft** or the final
**Publish** confirmation. Saving a draft preserves an existing public snapshot,
publication status, and pending removal. Unpublish remains a separate immediate
lifecycle action and does not save form edits.

Project-scoped `POST /strings/editor-preview` accepts a `proposal` discriminated
by `mode`: `create` with content `values`, or `update` with `string_id` and partial
`values` including required `expected` baselines. Content values exclude status
and lifecycle fields. The read-only response contains the complete proposed
`entry` (including untouched/historical locales) and a `fingerprint`. Synthetic
identifiers in create previews are never persisted or included in the fingerprint.

`POST /strings/editor-save` accepts that proposal and `action: save_draft | publish`.
Publication requires the reviewed fingerprint. It rechecks current working/public
state, the proposal, and relevant project/catalog settings under the existing
locks, then saves content, promotes snapshots, and captures audit in one
transaction. HTTP 409 `publish_fingerprint_mismatch` requires a fresh review;
`stale_editor_save` requires explicit resolution of competing field edits.
Publication with no public change returns 409 `nothing_to_publish` without saving.
Both successful actions return the saved `StringOut`. Legacy CRUD and batch
publication contracts retain their existing behavior.

## Translation context

`projects.translation_context` and `modules.translation_context` are nullable text
columns, separate from `modules.description`. Editor writes validate a maximum of
500 characters per field before trimming. An omitted PATCH field preserves its
value; explicit `null`, empty, or whitespace-only text clears it to SQL `NULL`.
Project and module creation can set context atomically. Project detail GET/PATCH
responses expose it; project list/create and CLI bootstrap responses do not.

All AI model routes compose project context, the owned module's context (when
assigned), and the string description, skipping blank components and joining with
newlines. Proposal/preview description overrides replace only the string component.
The combined result is passed through `TranslateItem.context` as mandatory
translator instructions; it is never written back into a string description.
Background jobs read the current context when they start. Empty context preserves
the existing prompt. Missing/apply routes do not invoke AI.

These settings are independent of string publication and activity history. They
are absent from exports, Excel `_meta`, sync-state, and published snapshots.
Deploy the additive Alembic migration before running the updated application.

## Flat vs modular export

| Layout | Shape |
|--------|-------|
| `flat` | `{ locale: { "common.save": value, "hello": value } }` — stored keys as-is, never `module.key` prefixed |
| `modular` | `{ modules: { login: { vi: {...}, en: {...} } }, unassigned: {...}, manifest: {...} }` — keys inside each locale map are stored as-is; the module is the folder/slug |

Project setting chooses the default; export query param overrides.

## Draft / public workflow

1. New strings default to `draft`. Edits, AI translate, JSON import, and CLI push write the **working copy** only and never copy it to the published snapshot (and never auto-publish).
2. **Publish** (per string or selected batch) copies working → published (`published_key`, `published_module_id`, `published_source_text`, `published_value`) and sets `status=public`. `POST /strings/publish-preview` returns a server fingerprint of that publishable working copy. Confirm must send it on `POST /strings/batch` `action=publish`; a mismatch is HTTP 409 `publish_fingerprint_mismatch` and writes nothing. Omitting the fingerprint is HTTP 400.
3. CLI/CI `loc pull --stage public` (or export `stage=public`) uses that snapshot. Target locales export the published value, or empty if none. No source-text fallback. `stage=draft` / `all` uses the working copy and omits `pending_delete` strings so staging can test a removal.
4. Editing a public string leaves prod on the last snapshot until you publish again. **Unpublish** sets `status=draft` and drops the key from public export immediately (published columns are kept).
5. Deleting a string that has a published snapshot sets `pending_delete` instead of removing the row. Public export still ships the snapshot until you publish that delete. Publishing the delete sets `deleted_at` (soft tombstone) rather than hard-deleting. Never-published strings set `deleted_at` immediately. **Restore** revives a tombstone as a draft, preserving working content and the historical published snapshot; it stays out of public export until explicitly published. Canceling a pending deletion preserves publication status and the current public snapshot. **Discard delete** only cancels pending removals. The same key can be created again while a tombstone exists. Default JSON and Excel file imports also revive tombstones as drafts; an explicit `status=public` import publishes the imported working copy with the usual published-key collision checks.
6. Default imports update working content without publishing live strings. JSON / Excel `status=public` explicitly publishes the final imported working copy, including newly created or revived strings, with the usual published-key collision checks.

CLI `POST /strings/import` rejects an entire request containing a pending-delete
key or a tombstoned key without a live replacement (HTTP 409,
`push_deleted_keys`). It never implicitly restores strings; general JSON upload
imports retain restoration behavior. CLI payloads may provide `base_language`;
a mismatch returns HTTP 409, `base_language_mismatch`, before content writes.
`GET /sync-state` includes all project `locales` and omits tombstones shadowed by
live replacement keys. Explicitly empty source values in JSON imports remain
empty; a newly imported target-only key still uses the key as its initial source.

## Version control

`activities` is append-only. Every string content write is captured in `before_flush` with CRUD `action` (`create` | `update` | `delete`) for revert, plus a stored `event_type` and human `summary` classified from the `before`/`after` diff (and restore intent). `ACTIVITY_RETENTION_DAYS` (default 90; 0 = keep forever) deletes activity rows older than that many days via `uv run python -m app.cli prune-activities`. Pruning is not run on API startup. Pruning removes feed, History, and Undo for those old events; it does not delete strings.

Explicit review saves use `string.saved_draft`; ordinary editor changes retain their
specific event labels. A publication that also saves recorded working-copy content
uses `string.saved_and_published`; publication-only actions keep `string.published`.
Both publication events require recorded before/after content evidence for History
restoration. The Published filter includes both event values, and the translation
filter includes review draft saves. Existing activity rows are not rewritten.

Batch summaries use full SQL event counts, retaining import, CLI, Excel, or AI
origin alongside publication wording. A combined record counts once as published;
a draft save counts as updated. Review saves and later publication have separate
batch IDs from the original import. Content and audit records commit or roll back
together; temporary proposals and discarded local edits create no content audit.
Whole-action Undo retains its full-state inverse and warns when the preview would
change public content or publication status immediately. History Restore only
changes the working copy.

Named project snapshots are not in this pass.

### Project feed vs string History vs bulk undo

| Surface | Reads | Restore |
|---------|--------|---------|
| **Project Activity feed** (`GET /activities/feed`) | Cards grouped by `coalesce(batch_id, id)`, paginated by card. Counts are aggregated in SQL; batch children in the payload are capped at 50 while `children_count` is the full total. Locale filter matches `activity.locale` or a translation key in the snapshot JSON. | **Undo** only on bulk cards (`import` / `cli_push` / `excel_import` / `translate` / `batch`) via `POST /activities/batch/{id}/revert`. API and UI default `force=false`; a 409 (later edits) can be retried with `force=true` after a second confirm. Create-undo tombstones (never hard-deletes). |
| **Per-string History** (`GET /strings/{id}/activities`) | Newest-first rows for one string, paginated (UI loads 50 at a time) | **Restore working copy** applies that row's working-copy **content** `after` (`key`, source, description, translations, tags, module) as a new write (`POST /strings/{sid}/activities/{aid}/restore`). Returns HTTP 409 with `key_conflict` if the historical key is already used; never changes `status`, `published_*`, or `pending_delete`. Response includes a `notice` describing that. Combined save-and-publish records are eligible when their snapshots also record a content edit. **Not offered** for publication-only / `string.unpublished` / `string.pending_delete` / `string.deleted` records |
| **Restore last edit** (grid batch) | Newest restorable activity `before` per selected string (includes combined save-and-publish; skips publication-only / unpublish / pending_delete / deleted) | `POST /strings/batch` action `restore_last_history` |

Restore always writes a **new** activity. History restore does not use the revert batch path (that path skips capture). Revert/undo markers use `event_type=string.restored` and summary `Restored previous value of 'key'` — no stacked `Reverted:` / `Redid` prefixes.

`pending_delete` is still `action=update`; the classifier labels it `string.pending_delete`. Publish/unpublish are `action=update` labeled from `status` / `published_*` diffs. Batch Undo restores the recorded full state, including publication; undoing a content edit can also roll back a later publication after an overwrite confirmation. History restore preserves public snapshots. Restoring an older **content** version while the string is pending-delete restores text only and leaves `pending_delete` set; the API `notice` tells the user to use grid **Restore** to cancel the removal.

Feed and History summaries show working-copy changes. Activity details and Undo previews also show published changes. Module references use names when available, and Undo previews describe deletion outcomes.

### Review a push from Activity

`GET /strings` accepts optional `batch_id`. Membership is the distinct `activities.string_id` values for that `(project_id, batch_id)` (`ix_activities_project_batch_id`). An unknown or other-project id returns an empty list (200). When `batch_id` is set and `deleted` is omitted, the list includes soft-deleted and `pending_delete` members; an explicit `deleted` or `pending_delete` value still applies. `batch_id` AND-composes with the other catalog filters (module, tag, `q`, and any later advanced filters). None of those filters are ignored. The same `BatchFilter.batch_id` is used by publish-preview and batch actions. The Activity card opens the catalog with `?batch_id=` — not a long `string_ids=` list.

### Restore and undo validation

History restores only working-copy content. Its preview shows the resolved working-copy destination, excluding publish status and published snapshots. Locale values missing from a recorded translation map are cleared to empty working values; the language configuration, translation rows, and published values stay intact. Missing fields in legacy snapshots preserve their current values.

History eligibility for `string.published` is derived from the existing before/after snapshots, without rewriting activity rows. A key, source, description, module, tag, or translation edit must be recorded on both sides. Tag ordering, missing versus empty translation values, and publication/lifecycle changes alone do not qualify. API eligibility flags are authoritative; frontend fallbacks require a working-copy content diff before allowing a published version.

Full-state Undo previews compare the live state to the actual projected inverse operation. Later nonempty translations in newly added languages count as conflicts; additional empty working rows do not. Normal and forced confirmations warn whenever published content or publish status changes. New undo markers capture the live before/after snapshots, including retained tombstones and pending deletion; older markers are not rewritten.

Reused active keys block History restore, Restore last edit, and Undo, even with force. Writes revalidate ownership and return HTTP 409 with detail `{code: "key_conflict", message, key}`. A failed batch rolls back every content write, audit marker, and revert link. Undo previews expose `can_revert` and `blocked_reason`, plus per-item blocking reasons; hard blockers are aggregated before item truncation. Later-edit conflicts remain distinguishable from key collisions.

Undo validates saved `published_at` and `deleted_at` in both before/after snapshots, even when forced. Valid ISO timestamps are normalized to UTC; missing fields preserve current values and `null` or `""` explicitly clears a timestamp. Malformed values block the preview and execution returns HTTP 409 with detail `{code: "invalid_snapshot", message, activity_id, field}` (for example, `field: "before.published_at"`). No inverse changes or audit links survive a failed batch. History ignores historical publication/lifecycle timestamps because those fields are not restored.

Inverse operations use descending UTC creation time, then activity ID, in both preview and execution. Timestamps without a timezone represent UTC, independent of the server's local timezone. Each inverse uses one live before-state and one resolved target, checks ownership, flushes, and rereads persisted state for its marker. Translations and tags load separately; project references are resolved with a request-local cache. Repeated inverses operate on successive states within the same transaction.

Restoration confirmation shows both sides of changes, including clearing (`FR “Bonjour” → “—”`). Undo's title, warning, button, and submitted force flag derive from the same successful preview. An execution 409 shows its message and refreshes the preview; confirmation remains disabled until a valid refreshed preview permits another confirmation. No automatic forced retry occurs.

The client validates required preview capability/warning fields and consumed collections. Missing or invalid fields show an incompatible-preview error with Retry preview; they never enable confirmation. Deploy backend and frontend together, or backend first for a sequential rollout. Existing audit entries remain unchanged; no schema migration is required. See [Undo performance measurements](undo-performance.md) for the reproducible benchmark and query budgets.

### Optional module-scoped string keys

Project Settings → **Allow duplicate keys across modules** defaults to off for
existing and new projects. Admins can enable it, or use `allow_duplicate_keys`
in project create/update APIs. The setting is included in project responses and
API-key bootstrap responses. It is independent of the project's export layout.

When enabled, `auth/title`, `home/title`, and `_unassigned/title` may coexist.
Each module, including Unassigned, still permits only one live row for a key.
Pending deletes retain their identity; soft tombstones release it. Switching the
setting off returns `409 duplicate_keys_exist` with conflicting keys/modules
until the live duplicates have been renamed, moved, or deleted. No rows are
merged or renamed automatically. Deleting a module also returns 409 if moving
its live strings or public snapshots to Unassigned would collide there. Published
key checks include pending deletes and use the last published module/key rather
than the working copy; unpublished rows and tombstones are excluded.

Postgres enforces both policies. `uq_project_module_key_alive` treats null
module IDs as equal; `uq_project_key_alive` additionally enforces project-wide
uniqueness when the setting is off. Policy updates use the import/undo advisory
guard when the policy actually changes and return `409 import_in_progress` while
one of those operations is active; retry the policy change after it finishes.
Settings saves with an unchanged policy remain available during imports and undo.
The project row lock still waits for other in-flight string inserts. An internal
string policy column is linked
to `(projects.id, projects.allow_duplicate_keys)` by an `ON UPDATE CASCADE`
foreign key, so toggles and concurrent writes cannot bypass the selected policy.
The internal column is not part of string content, history, or public schemas.
A migration downgrade is refused while live duplicate keys exist.

### AI translation source conflicts

Every `POST /api/projects/{id}/translate/apply` item requires
`expected_source_text`, copied exactly from the reviewed proposal's `source_text`.
Missing or null baselines return 422. Apply locks and refreshes strings before
comparing sources; any mismatch returns 409 with `detail.code` equal to
`stale_translation_source` and `conflicts` containing `string_id`, `key`,
`expected_source_text`, and current `source_text`. No part of that Apply batch is
saved. Source conflicts are reported before description conflicts; resolving one
does not bypass the other. The review dialog preserves drafts and regenerates
only affected rows, or lets the user remove them from the review.

Automatic `POST /api/projects/{id}/translate` skips strings whose source changed
during generation and saves unaffected strings. Its response includes
`skipped_source_conflicts` (an empty list normally), using the same conflict
fields. Completed background jobs include that list in `job.result`, together
with `translated_count` and `locales`; a job with every string skipped completes
with zero translations. Comparison is exact, including whitespace; restoring the
identical source makes an existing proposal valid again. AI writes still affect
only the working copy. Deploy backend and frontend together; custom Apply clients
must send the baseline, and older browser tabs may need a reload.

### Save or publish reviewed AI translations

The Translate missing dialog no longer calls `/translate/apply` (kept for API
clients). It uses two endpoints that take the same items (1–100, one per string):

- `POST /api/projects/{id}/translate/review` is read-only. It returns the full
  proposed strings (working copy after the save, with published snapshots and
  every configured locale, empty ones included) and a `fingerprint` binding the
  reviewed membership, values, scores, project locales, and each string's
  complete current working and published state. Items carry no description
  (descriptions never publish); extra fields return 422.
- `POST /api/projects/{id}/translate/save` with `action: "draft"` writes the working
  copy only, audited as `string.saved_draft`. With `action: "publish"` and the review
  `fingerprint`, it writes and promotes exactly the reviewed strings (all locales,
  including pending edits made elsewhere) in one transaction with its audit rows
  (`string.saved_and_published`). Both use activity `batch_kind=translate` with a new
  `batch_id`, so whole-action Undo reverses working and public changes together.

Every reviewed cell fills a cell that was empty at review. The whole request is
rejected with 409 and nothing is written when a source (`stale_translation_source`)
or reviewed cell
(`stale_translation_value`, filled elsewhere with different text) changed, a string
was deleted (`stale_translation_review`), any reviewed content or baseline changed
(`publish_fingerprint_mismatch`), a reviewed string is pending removal
(`pending_delete_in_review`, also returned by `/translate/review` so the preview
never shows a publish that cannot succeed), or publication would collide with a public key
(`published_key_conflict`). Unconfigured or base locales return 400. Scope is the
current queue page; paging stays blocked until that page is saved or its edits are
undone, so no action spans unreviewed pages.


## CLI push batch workspace

New JSON-body CLI pushes record activity `batch_kind=cli_push`; file imports keep
`import`/`excel_import`. Historical batches are not reclassified. The endpoint
`GET /api/projects/{project_id}/cli-push-batches/{batch_id}` resolves unique activity
members within the project and returns metadata, active working/published rows,
excluded lifecycle counts, and the existing publication fingerprint. An unknown,
other-project, or non-CLI batch returns 404; an entirely excluded batch returns an
empty review. No additional workflow state or schema migration is required.

The dashboard automatically translates all configured project target languages
(excluding the base language), with no language picker. The stepper shows Translate,
Review, and Publish. It generates read-only translation proposals and keeps them, manual
edits, confidence scores, and QA findings in memory until an explicit save. It does not call
`/translate/apply`, save on blur, or store resumable jobs. Leaving or reloading
abandons unsaved progress and starts a new review from saved content. Other
editors retain their existing blur-save behavior. In-app leave and restart
confirmations use the shared shadcn dialog; browser reload/close warnings remain
controlled by the browser. Partial AI responses leave unresolved cells visible;
retries exclude completed or manually edited cells. Publication waits until those
cells are generated or explicitly reviewed through manual editing.

Both `POST /api/projects/{project_id}/cli-push-batches/{batch_id}/draft` and
`POST /api/projects/{project_id}/cli-push-batches/{batch_id}/publish` accept
the original review fingerprint and all staged translation changes. The server
locks publication, batch strings, and their translations; verifies batch membership,
source text, locales, and the full review fingerprint (including unchanged public
strings); applies translations; and commits the content and audit batch together.
Only publication promotes snapshots and validates public-key collisions. Saving
as draft preserves existing string status and public snapshots: new strings remain
draft and already-public strings retain their last published values. More than 100 rows
can complete in this one transaction; there are no independently committed chunks.
Any validation, stale-content, or publication failure rolls back the entire final
request, including translation edits and audit records. A stale workflow must be
restarted before publication. The original CLI push remains saved as before.

Publication is still per string across all locales, including historical locales
outside the current project targets. These remain visible but read-only. Missing
values and QA issues remain advisory. Saving or publishing shows a success toast
and refreshes the batch in place. View in Strings opens the catalog filtered to
the original CLI push batch. If refresh fails, saved changes remain committed;
Reload batch retries the read without saving or publishing again. The existing catalog,
translation Apply, audit, Undo, export, and soft-delete semantics are retained.
