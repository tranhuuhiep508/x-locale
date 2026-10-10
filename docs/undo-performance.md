# Undo performance measurements

The harness in `backend/benchmarks/undo.py` measures the real production service, including its audit listener, on disposable Postgres databases. Each trial is cloned with `CREATE DATABASE ... TEMPLATE` from a seeded database. The database named by `DATABASE_URL` is not written.

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
- Undo performs two full string loads per inverse (200, 1,000, and 2,000 loads at 100, 500, and 1,000 strings). SELECT counts stay within `12 × strings + 30` (the largest is 7,003 at 1,000 strings). Wall-clock thresholds are not CI assertions.
- These timings exclude HTTP and browser overhead. Other inverse kinds and error paths are covered by the backend/API and browser regression suites.

## Historical file-database note

Measurements dated 2026-10-04 were taken on file-backed databases, comparing baseline `69e33ff` with refactor `2a03608`, on a different machine. They are not Postgres results. On that run, rich 1,000-string normal Undo was 4.61 s median after the refactor (29.08 s at baseline), and forced Undo was 4.67 s (26.49 s at baseline). Do not compare those seconds with the Postgres table above.

## Reproduce

From `backend/`, with Postgres 16 running at collation C and `DATABASE_URL` set to a Postgres URL on that server (the named database is only used to find the server; throwaway databases are created and dropped):

```bash
PYTHONPATH=. uv run --no-sync python benchmarks/undo.py \
  --sizes 100 500 1000 --profiles plain rich --trials 3 \
  --output /tmp/undo-pg-normal.json

PYTHONPATH=. uv run --no-sync python benchmarks/undo.py \
  --sizes 100 500 1000 --profiles plain rich --trials 3 --force \
  --output /tmp/undo-pg-forced.json
```

The script prints per-case JSON and saves samples, ranges, query categories, and correctness results. Throwaway databases are dropped when each case finishes.

CI coverage: `backend/tests/test_undo_query_budget.py` checks normal/forced rich fixtures at 25 and 100 strings, bounded preview reads, execution read budgets, and exact audit snapshots. Creation/deletion, legacy records, reused keys, uniqueness races, and rollback behavior remain in the activity restoration regressions.
