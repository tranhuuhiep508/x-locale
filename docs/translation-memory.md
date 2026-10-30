# Translation Memory Lite

Translate missing searches current published snapshots in the same project before
calling AI. Suggestions are shown as **Previously published**, with their original
key, module, source, and translation. Each suggestion requires **Use translation**,
including exact matches and matches within the same module. Acceptance fills the
review draft; Apply saves the working copy, and publication remains explicit.

Matching reads `published_source_text` and `published_value`, so unpublished edits
cannot enter memory. Unpublished strings, pending deletes, tombstones, and blank
published translations are excluded. No history is retained separately: replacing
or removing a published snapshot removes it from future lookup results.

Exact matches use literal equality. Fuzzy matches use PostgreSQL `pg_trgm` similarity
at an inclusive 0.80 threshold. Up to three suggestions are ranked by exactness,
similarity, same-module preference, publication time, and donor ID. Trigram matching
ignores punctuation and may score different texts at 100%; these remain fuzzy.
Similarity is not model confidence or a linguistic quality guarantee.

QA compares each suggestion with the recipient source. Structural errors and
incomplete checks disable acceptance. Length warnings remain advisory. Editing an
accepted value retains memory provenance and rechecks QA; Apply is disabled while
memory checks are pending, unavailable, incomplete, or have structural errors.
The backend repeats these checks before any writes and returns atomic HTTP 409
`unsafe_translation_memory` with per-cell findings when reuse is unsafe. Other
translation writes retain existing advisory QA behavior.

Translate and Translate again exclude accepted cells. Clear an accepted cell to
request AI for it. Accepted values survive sync/background generation and stay
editable. Recipient source conflicts still reject the entire Apply; targeted
regeneration clears affected memory drafts. Donor changes after acceptance do not
rewrite an accepted draft. Existing filled cells are preserved at Apply.

## API

`POST /api/projects/{project_id}/translate/missing` adds optional
`memory_suggestions` to proposal items, keyed by target locale. Each suggestion
includes donor ID, published key/module/source/value/time, `match_type`, `similarity`,
`qa`, and `can_accept`. One batched lookup enriches the current queue page.

`POST .../translate/proposals` accepts optional `exclude_locales_by_string`
(`{string_id: [locale]}`). Exclusions are applied before work counts, job selection,
and AI inputs, and are retained in background jobs. All-excluded requests return
empty proposals without a job or model call.

`POST .../translate/apply` accepts optional `memory_locales` per item. Clients must
retain this marker when editing accepted memory values. The backend recomputes QA
instead of trusting client findings and clears AI confidence for these cells.
Older clients omitting these optional fields keep their existing behavior.

## Deployment

Run Alembic before deploying the application. The migration installs `pg_trgm`
and creates a partial GIN index on eligible published source text. The index uses
`fastupdate=off` to keep lookups indexed immediately after bulk publication rather
than accumulating a pending list that makes reads scan the catalog. This trades
some publication write speed for predictable review reads. The deployment
role needs permission to install that extension. Downgrade removes the index and
leaves the potentially shared extension installed. There is no data backfill.

Lookup is limited to the review flow. CLI, imports, direct AI writes, and new-string
preview do not query memory. The threshold and suggestion count are code constants.
