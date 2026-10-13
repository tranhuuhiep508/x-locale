# Bulk import

JSON upload, CLI push, and Excel use the same in-memory import planner and
chunked PostgreSQL Core writes. The planner validates the complete payload
before creating reference or content rows. It preloads strings, translations,
and tag associations with three scoped queries plus the project's modules and
tags. Partial JSON/CLI imports scope those queries to the submitted keys.

All writes and directly built activity snapshots remain in the request's
transaction. The XLOCALE-52 advisory lock still serializes import and undo.
Updates change only the columns the import actually modified; they do not
overwrite untouched published fields. Empty reimports produce no activities.

Excel audit is deliberately consolidated: a string has one final activity per
import, including repeated rows. Its before-state is the state before the import,
and its after-state is the final working copy. Excel result counts retain their
previous row-based behavior, including source/description update counts.

Default imports update the working copy and preserve published snapshots. An
explicit `status=public` publishes each imported string's final planned state,
for both new and existing strings, after all repeated rows have been processed.
An already matching public snapshot produces no publication writes or activities.
Excel descriptions that are absent, empty, or whitespace-only preserve existing
text; nonblank descriptions replace it with trimmed text. Clear descriptions
through the editor. Unchanged tagged Excel rows preserve update timestamps and
last-editor metadata and produce no content writes or activities.
Each JSON module must map locale codes to objects of string
keys and values; malformed module or unassigned maps return HTTP 400 in preview
and apply before any reference or content rows are created.

## Compatibility fixtures

`backend/tests/fixtures/import_golden.json` was captured from the ORM path at
`f67116f`, before its replacement. It covers all three formats and both layouts,
fresh/changed/unchanged imports, partial imports and overlays, published snapshots,
pending deletion and revival, confidence, tags, metadata, and audit snapshots.
Generated identifiers and timestamps are normalized. Excel reference events are
consolidated from each string's first before-state and last after-state. Tests
compare these immutable fixtures; they do not regenerate them from the bulk path.
Separate behavior tests cover the approved final-state publishing, blank
description preservation, and strict module validation policies.

## PostgreSQL performance gate

From `backend/`, with the normal distinct Postgres `DATABASE_URL` and
`TEST_DATABASE_URL`:

```bash
uv run python -m benchmarks.imports --check
```

Each format runs three trials on disposable test databases, with 20,000 keys,
base `vi`, and targets `en`/`fr`. Modular payloads use three modules. The fresh
import, unchanged reimport, and a reimport changing 10% of source values are
measured through the real synchronous route functions. File parsing, preload,
planning, writes, audit, result construction, and commit are timed. Input
generation, schema/project setup, authentication/dependency lookup, outgoing
HTTP serialization, and verification queries are excluded.

The command reports all timing samples and statement counts as JSON. CI requires
median fresh imports below 6 seconds and both reimports below 2 seconds.

Observed local medians on PostgreSQL 16 (seconds):

| Format | Fresh | Unchanged | 10% changed |
| --- | ---: | ---: | ---: |
| JSON flat | 2.94 | 0.38 | 0.53 |
| JSON modular | 3.43 | 0.40 | 0.60 |
| CLI flat | 2.76 | 0.36 | 0.54 |
| CLI modular | 3.28 | 0.39 | 0.60 |
| Excel flat | 3.46 | 1.03 | 1.20 |
| Excel modular | 4.03 | 1.15 | 1.24 |

Fresh imports used 86 statements in flat layout and 88 in modular layout.
Unchanged imports used 6 statements; 10%-changed imports used 10. The previous
flat JSON ORM baseline was 7.81s, 0.90s, and 1.48s for the same three scenarios.
These timings describe this workload and machine, not a guarantee for arbitrary
payload sizes or server configurations.

## Validation boundary

Import text containing NUL is rejected with HTTP 400, naming the field and key,
and sheet/row context for Excel. Values are never stripped. This delivers the
import-side checks from XLOCALE-49; its generic psycopg error safety net remains
separate. Other control characters retain their previous handling.

Background import jobs and polling remain XLOCALE-54. Ordinary edits and history
restores remain outside the import lock.
