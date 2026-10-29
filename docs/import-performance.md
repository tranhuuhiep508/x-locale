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

Excel exports and templates write literal string cells, including values beginning
with `=`, `+`, `-`, `@`, or apostrophes. Imports preserve those apostrophes and do
not decode the apostrophe escapes used by earlier exports. Regenerate pre-fix
workbooks before importing; their original leading apostrophes cannot be inferred
reliably. Existing whitespace trimming and comma-separated tag rules still apply.

Modular Excel exports and templates preserve full module slugs in the hidden
`_meta` worksheet as `module_slug:<worksheet name>` rows. Worksheet names are
unique, stay within Excel's 31-character limit, and are display labels; imports
use the mapped slug for module identity. `_unassigned` retains its reserved
meaning. Workbooks with mappings must include one valid, distinct mapping for
every data worksheet. Renaming or copying a data worksheet requires updating its
mapping in `_meta`; invalid or incomplete mappings fail before any content is
written. Notes worksheets without a `key` column are still ignored.

Legacy workbooks without mappings still use worksheet names as module slugs.
Old exports whose long slugs were already truncated cannot be repaired reliably
from worksheet names alone; re-export those workbooks after upgrading.

## Excel resource limits

Excel imports validate the archive and stream its XML before openpyxl opens it.
Preview, apply, and background jobs use the same checks. Resource failures return
HTTP 400 for synchronous requests, or a failed job with the validation error for
async requests, before any content or reference rows are written.

The compressed upload limit remains 20 MiB. Fixed Excel limits are:

| Resource | Limit |
| --- | --- |
| Total expanded archive | 64 MiB |
| Single expanded archive member | 32 MiB |
| Archive entries | 1,024 |
| Worksheets | 128 |
| Cumulative row slots | 100,000 |
| Columns per worksheet | 256 |
| Cumulative cell slots | 1,000,000 |
| Cell or shared-string text | 32,768 characters |
| Shared-string entries per archive part | 1,000,000 |
| Cumulative decoded text budget | 67,108,864 characters |
| XML nesting depth | 128 |
| Total XML elements | 8,000,000 |

Expanded bytes are checked against ZIP metadata and during chunked reads.
Archive members must use stored or deflate compression, whose decompression
output can be bounded during reads. Row and cell slots include declared
dimensions and sparse coordinates, including empty positions. Repeated row/cell
records also count toward the limits. Hidden
metadata and ignored worksheets count too. Duplicate archive names and reused
worksheet relationships/targets are rejected so repeated parsing cannot bypass
the budgets. Each row may have one trailing `extLst` extension list. It counts
as one extra cell slot of parsing work; its XML remains subject to the archive,
element, and nesting limits. Every declared sheet must resolve to an internal
worksheet relationship; unsupported types and external worksheet targets are rejected.
Workbook sheet lists must contain `sheet` elements, and relationship references
use namespaced `r:id` attributes. Renamed elements and unqualified `id`
attributes are rejected before loading.
Foreign-namespace extension metadata does not define worksheet coordinates or
cell text, but still counts toward the global archive and XML limits.
Rich-text fragments count together toward the text limit. The cumulative text
budget includes serialized cell/shared-string text, the expanded text of every
shared-string cell reference, and conservative estimates for every shared-formula
expansion, including coordinate growth. References are checked after the archive
scan so ZIP entry order does not matter; multiple string tables cannot reduce
the bound for any index. Shared formulas within that budget remain supported
and import as formula text. XML DTD
and entity declarations are rejected. These limits require no configuration and
preserve the 20,000-key flat and modular benchmark workloads.

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
`failed`. String-batch undo does not report a step count; its bar
stays indeterminate.

Each import/undo executor also holds a separate session advisory lock for its job,
claimed before the job row is committed. Its ORM session is bound to that same open
connection, so ownership survives dry-run rollback and status commits without
holding an extra connection for the lifetime of the job. Ownership is explicitly
unlocked before returning the connection to the pool; an unlock failure discards
the connection.

AI `translate` and `translate_proposals` callbacks acquire the same job ownership
lock before starting work, using a session bound to that connection. Only a
`pending` job can start; a delayed callback skips a job already finished by
recovery. The worker commits `running` before generation and keeps ownership
across transactions and separate progress updates. Translation writes and the
completed result commit together. AI work does not acquire the project import lock.

At startup and every 60 seconds, each API worker examines running `import`,
`excel_import`, and `revert` jobs, plus pending or running `translate` and
`translate_proposals` jobs, older than 60 seconds. It marks one failed only after
acquiring job ownership (and the project import lock for import/undo), then
rechecking the row. Age or unchanged progress alone never fails a live job.
Abandoned jobs return a terminal `job_interrupted` error with an instruction to
run the operation again. Recovery never resubmits work. A live but hung executor
keeps ownership and is not terminated by recovery.

For the first deployment of ownership tracking, replace all old API worker
processes together: do not overlap old executors without ownership locks with
the new recovery sweeps. This also applies when deploying AI ownership tracking:
old AI workers must finish or stop before the expanded sweeps start. No schema
migration is needed.

Requests without the header keep the synchronous 200 response. Older CLIs do not
send it, so they never mistake a 202 for a finished push. The UI and current CLI
always send it. `loc push` polls the job (1 s backing off to 3 s, up to
`X_LOCALE_JOB_TIMEOUT` seconds, default 1800) and updates its push index only when
the job completes.

The UI saves a five-minute polling deadline with the job id in sessionStorage.
Navigation and reload preserve that deadline; legacy saved jobs without one
start paused. On expiry it cancels outstanding status requests and stops all
automatic status checks. The project-wide job banner offers **Check status**
(one GET, remaining paused for a running job) and **Stop tracking**. Polling
errors offer **Retry status**, which resumes automatic polling only before the
original deadline. Import and undo dialogs can be closed while polling is paused
or unavailable, making the banner accessible.

Stopping tracking clears the tab's stored and component job ids and releases
its busy controls, without cancelling or resubmitting the server operation.
Unapplied previews must be run again before Apply. The job's actual terminal
result still controls success/failure handling; browser timeout is not failure.

Add many preserves its submitted JSON, module, and tags when a pending preview
is closed and reopened. A preview recovered after a reload has no original
input, so Apply stays disabled until the user pastes it again and runs a new
preview.
