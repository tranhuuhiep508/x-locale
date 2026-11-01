# Translation Memory Lite

Translation memory suggests up to three published translations per target cell,
before AI generation. Use a suggestion explicitly, then Save in the editor or
Apply in Missing Translations. Selections stay in the working copy until published.

## Matching and safety

Memory reads the existing published snapshots; there is no separate store or
backfill. Candidates belong to the same project and target locale, are currently
public, and have nonblank published translations. Pending deletes remain eligible
until their removal is published. Unpublishing or completing deletion removes a
candidate. Draft edits to text, keys, or modules do not change its published memory.

Exact means literal source equality. Fuzzy uses PostgreSQL `pg_trgm` similarity of
at least 0.8. Exact matches rank first, followed by similarity, newest publication,
and string ID. Trigram scores can be 100% for case or punctuation differences;
those matches still show as similar rather than exact. Suggestions may come from
any module or the edited string's own publication, with their published provenance.

Smart QA checks each candidate against the destination source. Findings appear
before Use and remain advisory. Memory suggestions have no AI confidence score.
When there is no exact match, up to three returned suggestions without QA errors
are supplied to AI as reference examples. Warnings are permitted. Translator notes
retain precedence. An explicit AI request with an exact match receives no examples.

Accepted cells are excluded individually from AI generation and regeneration.
Other locales on the same string remain eligible. Editing an accepted cell keeps
it excluded; clearing it makes it eligible again. Changing the source invalidates
suggestions and selection markers. The editor looks up memory when it opens or
when explicitly requested, never while typing. Saves and Apply retain source
baseline checks, including translation-only editor saves.
If a lookup fails, use **Check again** to retry; an explicit AI request can proceed
without memory examples.

## API

`POST /api/projects/{project_id}/translate/memory` accepts `source_text`, optional
`locales`, and optionally `string_id` with required `expected_source_text`.
An existing string must belong to the project and match that saved baseline;
otherwise the endpoint returns 404 or `409 stale_translation_source`.
The response contains `source_text` and `matches` grouped by locale, including
published origin, matched source, target text, exact flag, similarity, and QA issues.

`/translate/missing` includes the same matches on each row and `memory_error` when
an optional lookup failed. Proposal requests can
send `exclude_cells: {"string-uuid": ["en"]}`; exclusions also survive background
execution. Editor PATCH accepts `translation_scores: {"en": null}` to clear a
previous score even when the text did not change. Checked translation-only PATCH
requests send `expected.source_text` along with the original locale values.

## Deployment

Before rollout, confirm that the production database provides `pg_trgm` and that
the migration role can run `CREATE EXTENSION pg_trgm`, or have a DBA provision it
first. Development availability does not establish production permissions.

Run `uv run alembic upgrade head` from `backend/` before deploying the new backend
and frontend. Revision `t9f27d8e0123` creates the extension if missing and adds a
partial GIN index on public, undeleted published source text. No data migration is
required. Downgrade drops the index and retains the potentially shared extension.
Creating the index uses the regular migration transaction; schedule the migration
for a suitable write-maintenance window on a large catalog.

Check memory lookup, memory-only Apply, mixed-locale AI generation, and unchanged
public export in staging. Semantic matching, historical memory, Excel conflict
flags, and CLI source-change suggestion workflows are outside this feature.
