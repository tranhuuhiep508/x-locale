# Undo performance measurements

The harness in `backend/benchmarks/undo.py` measures the real production service, including its audit listener, on disposable Postgres databases. Each trial is cloned with `CREATE DATABASE ... TEMPLATE` from a seeded database. The database named by `DATABASE_URL` is not written.

## XLOCALE-50 bulk undo — 2026-10-12

The bulk implementation uses an ordered in-memory inverse plan and set-based content,
marker, and revert-link writes. Existing string/translation identities and unrelated
translation metadata are preserved. Every inverse retains its own before/after marker,
including repeated edits of a string. Key-changing rows release their old live keys
inside the transaction before final states are written. Before any content write,
a conditional `UPDATE ... RETURNING` matches existing strings against the immutable
`updated_at` versions captured during planning. It leaves timestamps and attribution
unchanged and holds update locks through commit. A changed version aborts the whole
batch with retryable `409 concurrent_modification`, including forced undo; a missing
row retains its 404 response. Stale plans are not automatically retried. Key ownership
reads bind one Postgres array containing only live and historical batch keys,
including empty keys. Module reference locks and whole-transaction retries remain
in place. Legacy translation-entity batches retain
the ordered executor.

The measurements below are from the guarded XLOCALE-50 working tree on top of `82e8f46`:
PostgreSQL 16.15 in the local `postgres:16-alpine` container at `127.0.0.1:5432`,
Python 3.14.4, and dependencies from the repo lockfile. Linux reported 8 logical
CPUs and 15.4 GiB RAM. Each case had one warm-up,
one instrumented counting pass, and three uninstrumented timed trials. No test
suite was running during these timing trials.

| Fixture | Strings | Force | Undo median (s) | Undo range (s) | Preview median (s) | Undo calls / SELECTs |
| --- | ---: | --- | ---: | --- | ---: | ---: |
| Plain | 100 | no | 0.0614 | 0.0542–0.0651 | 0.0303 | 10 / 5 |
| Plain | 1,000 | no | 0.3363 | 0.3159–0.3618 | 0.1302 | 12 / 7 |
| Rich | 100 | no | 0.1173 | 0.1083–0.1188 | 0.0573 | 12 / 7 |
| Rich | 1,000 | no | 1.1643 | 0.9217–1.2114 | 0.4789 | 23 / 9 |
| Plain | 100 | yes | 0.0766 | 0.0703–0.0774 | 0.0331 | 10 / 5 |
| Plain | 1,000 | yes | 0.4071 | 0.3764–0.4078 | 0.1592 | 12 / 7 |
| Rich | 100 | yes | 0.1709 | 0.1697–0.1738 | 0.0700 | 12 / 7 |
| Rich | 1,000 | yes | 0.8402 | 0.7635–1.1938 | 0.4338 | 23 / 9 |

Both plain 1,000-string medians and the forced rich median meet the one-second
target. The initial normal rich run misses it at 1.1643 seconds. A separate normal
rich repeat on 2026-10-13, after the backend suite finished, used the same warm-up,
counting pass, and three timed trials: **0.7958 seconds median**, 0.7946–0.9053 seconds
range, 0.3841 seconds preview median, and the same 23 calls / 9 SELECTs. Its undo
samples were 0.9053, 0.7958, and 0.7946 seconds. No suite was running in either run.

The latest normal and forced rich medians meet the target, but the earlier normal
miss demonstrates substantial timing variation; this is not a latency guarantee.
Timings remain outside CI. All eight original cases and the repeat verified
persisted content, published state, exact audit snapshots, marker counts/grouping,
and original revert links.

"Calls" means `before_cursor_execute` events, matching the harness's `statements`
counter. There were **zero executemany calls**. Writes bind typed column arrays
in `VALUES` and expand them with `unnest` for set-based `UPDATE ... FROM` and
`INSERT ... SELECT`. Each chunk is bounded at 1,000 rows and 30,000 logical values,
so bound parameters are also below 30,000. Collection loading and write chunking
mean the count is bounded for these fixtures, not constant for arbitrary sizes.
The version guard adds one execution per 1,000 existing strings; the 1,000-string
rich fixture still uses only 23 executions, below the 30-call budget.

CI now asserts at most 30 total cursor executions for plain/rich fixtures at 100
and 1,000 strings, normal/forced, with one full string load and one rich module
reference read. Golden comparisons against the ordered executor cover lifecycle
inverses, key release, repeated edits, confidence reset, new locales, missing
references, attribution, marker ordering, and legacy fallback. Generated IDs and
timestamps are normalized while their relationships are checked. Real key races,
module concurrency, retries, and atomic rollback remain covered. Deterministic
description, translation, and publication races verify stale-plan rollback in both
normal and forced mode. A writer arriving after the guard waits for commit and
retains its edit. A one-string batch with 50,000 unrelated keys reads only candidate
owners, including empty keys and rename collisions. Wall-clock
thresholds are not CI assertions.
The full backend suite passed 777 tests; Ruff lint and changed-file formatting
checks passed.

## Historical Postgres baseline — 2026-10-10

The tables below are from a Postgres 16 run on 2026-10-10. For 1,000 public strings with ten translations and three tags each, normal Undo took a median **6.3317 seconds** (7,003 SELECTs, 11,003 statements) and preview a median **0.3278 seconds** (10 SELECTs, 10 statements). Forced Undo on that fixture took a median **6.3258 seconds**, with the same statement and SELECT counts.

## Environment

- Date: 2026-10-10 (run started 2026-10-10T03:43:46Z)
- PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), `datcollate` `C`, `datctype` `C`. The cluster was created with `pg_createcluster 16 main --locale=C --encoding=UTF8`.
- Python 3.14.8, backend dependencies from the repo lockfile
- Host: 4 CPUs, 16 GiB RAM. Throwaway databases on the local server (`127.0.0.1:5432`)
- One warm-up, one instrumented SQL-count pass, then three uninstrumented timed trials. Medians are over those three trials. Seeding, cloning, authentication, project lookup, and verification are outside the elapsed time. Preview and Undo use separate sessions.

## Normal Undo

| Fixture | Strings | Undo median (s) | Preview median (s) | Statements (preview / undo) | SELECTs (preview / undo) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plain | 100 | 0.4999 | 0.0192 | 6 / 1,101 | 6 / 701 |
| Plain | 500 | 2.5188 | 0.0615 | 6 / 5,501 | 6 / 3,501 |
| Plain | 1,000 | 5.0081 | 0.1559 | 8 / 11,001 | 8 / 7,001 |
| Rich | 100 | 0.6295 | 0.0411 | 8 / 1,103 | 8 / 703 |
| Rich | 500 | 3.1070 | 0.1671 | 8 / 5,503 | 8 / 3,503 |
| Rich | 1,000 | 6.3317 | 0.3278 | 10 / 11,003 | 10 / 7,003 |

## Forced Undo

| Fixture | Strings | Undo median (s) | Preview median (s) | Statements (preview / undo) | SELECTs (preview / undo) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plain | 100 | 0.5119 | 0.0182 | 6 / 1,101 | 6 / 701 |
| Plain | 500 | 2.5586 | 0.0592 | 6 / 5,501 | 6 / 3,501 |
| Plain | 1,000 | 5.0774 | 0.1512 | 8 / 11,001 | 8 / 7,001 |
| Rich | 100 | 0.6324 | 0.0399 | 8 / 1,103 | 8 / 703 |
| Rich | 500 | 3.1626 | 0.1689 | 8 / 5,503 | 8 / 3,503 |
| Rich | 1,000 | 6.3258 | 0.3189 | 10 / 11,003 | 10 / 7,003 |

Rich 500 normal undo median is stored as `3.107` by the harness (`round(..., 4)`); the table shows `3.1070`.

## Method

- Plain: draft strings, one working translation, no tags or modules. Rich: public strings, ten translations, three tags per string, ten shared modules, twelve shared tags, and a published snapshot. Each string has one existing-string update to undo.
- Normal live values are A2 after A1 → A2. Forced fixtures have a later A3 edit. Both restore A1; forced markers record A3 → A1.
- Every iteration checks exact persisted values, published state, marker before/after snapshots, one marker per inverse, marker grouping, original revert links, and total audit count. Every case in both runs reported that check as verified.
- The historical implementation performed two full string loads per inverse (200, 1,000, and 2,000 loads at 100, 500, and 1,000 strings). Its old SELECT budget was `12 × strings + 30` (the largest was 7,003 at 1,000 strings).
- These timings exclude HTTP and browser overhead. Other inverse kinds and error paths are covered by the backend/API and browser regression suites.

## Historical file-database note

Measurements dated 2026-10-04 were taken on file-backed databases, comparing baseline `69e33ff` with refactor `2a03608`, on a different machine. They are not Postgres results. On that run, rich 1,000-string normal Undo was 4.61 s median after the refactor (29.08 s at baseline), and forced Undo was 4.67 s (26.49 s at baseline). Do not compare those seconds with the Postgres table above.

## Reproduce

From `backend/`, with Postgres 16 running at collation C, `DATABASE_URL` set to a
Postgres URL on that server, and `TEST_DATABASE_URL` identifying a separate
existing bootstrap database. The role must have permission to create/drop the
disposable databases. The configured application database is not written:

```bash
PYTHONPATH=. uv run --no-sync python benchmarks/undo.py \
  --sizes 100 500 1000 --profiles plain rich --trials 3 \
  --output /tmp/undo-pg-normal.json

PYTHONPATH=. uv run --no-sync python benchmarks/undo.py \
  --sizes 100 500 1000 --profiles plain rich --trials 3 --force \
  --output /tmp/undo-pg-forced.json
```

The script prints per-case JSON and saves samples, ranges, query categories, and correctness results. Throwaway databases are dropped when each case finishes.

The current CI coverage and execution budgets are described in the XLOCALE-50
section above. Historical timings used different hardware and Python versions;
compare query counts directly, but do not attribute all timing differences to code.
