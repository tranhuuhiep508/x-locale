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

Excel imports preserve existing source text when a worksheet omits the
base-language column. New strings without that column use their key as source
text. When the column is present, its cell value replaces the source text;
an explicitly blank cell saves an empty source, including for new strings.
Preview and apply use the same source rules. Translation-only changes retain
the existing Excel counting behavior and do not increase the update count.

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

The command reports all timing samples and statement counts as JSON. The targets
are median fresh imports below 6 seconds and both reimports below 2 seconds,
measured by a manual run on a known machine.

`--check` (run in CI) gates on statement counts, which do not vary with runner
speed: at most 100 for a fresh import, 10 unchanged, and 15 for 10% changed. A
per-row query regression adds thousands of statements at 20k keys, so it fails
the gate on any machine. Recent CI medians are about 7.6 s fresh and 2.4 s for
a 10% Excel reimport (an earlier run was 5.66 s and 1.80 s, only 6–10% under
the 6 s / 2 s targets). `--check` fails timing at three times those targets
(18 s fresh, 6 s reimports), about 2.5× the measured CI time. The pre-rewrite
path took 20–45 s, so a real regression still fails.

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

Ordinary edits and history restores remain outside the import lock.

## Background jobs (XLOCALE-54)

A request that sends `Prefer: respond-async` runs as a background job when it is
larger than `IMPORT_ASYNC_THRESHOLD` (default 5000):

- JSON file and CLI push imports count string values in the payload.
- Excel imports always run as a job, since rows are only known after parsing.
- Batch undo counts the batch's revertible activities.
- Dry runs follow the same rule.

The response is `202 {job_id, status: "running", kind}` with a `Location` header.
The job row is committed as `running` before the response, so the first
`GET /api/jobs/{id}` sees it. Progress phases are `queued`, `parsing`,
`validating`, `writing` (with `chunks_done`/`chunks_total`), and `done`; undo uses
`planning` and `writing`.

The import advisory lock stays the only one-import-per-project guard. The request
takes it to reject a busy project with 409. Committing the job row would drop
that transaction lock before the worker runs, so the request also holds a
session lock until the worker is waiting on the same key, then unlocks. The
worker holds the transaction lock until its one write ends. That write includes
the completed status, for both import and undo, so a saved change never reads
as running and a failure rolls the change back before the job is marked
`failed`. If the worker process dies, Postgres releases the lock and the job
row stays `running`. String-batch undo does not report a step count; its bar
stays indeterminate.

Requests without the header keep the synchronous 200 response. Older CLIs do not
send it, so they never mistake a 202 for a finished push. The UI and current CLI
always send it. `loc push` polls the job (1 s backing off to 3 s, up to
`X_LOCALE_JOB_TIMEOUT` seconds, default 1800) and updates its push index only when
the job completes.

Polling errors leave the job id saved in the tab. The UI offers **Retry status**
and allows closing an import or undo dialog while the result is unknown. It
clears the saved job only after a completed or failed job response; retrying
status never submits the import or undo again.

Add many preserves its submitted JSON, module, and tags when a pending preview
is closed and reopened. A preview recovered after a reload has no original
input, so Apply stays disabled until the user pastes it again and runs a new
preview.
