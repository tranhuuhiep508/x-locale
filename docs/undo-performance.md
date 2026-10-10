# Undo performance measurements

The harness in `backend/benchmarks/undo.py` measures the real production service, including its audit listener, on disposable Postgres databases. Each trial is cloned with `CREATE DATABASE ... TEMPLATE` from a seeded database. The database named by `DATABASE_URL` is not written.

The tables below are historical measurements from 2026-10-04, taken on file-backed databases against baseline `69e33ff` and the backend refactor in `2a03608`. They are not Postgres timings. That baseline revision cannot be rerun with this harness, because it only knew how to open a file database. Do not treat the seconds below as current Postgres performance.

For 1,000 public strings with ten translations and three tags each, normal Undo improved from **29.08 seconds to 4.61 seconds** (84% less elapsed time). SELECTs fell from **25,001 to 7,003** (72% fewer), and full string loads from six to two per inverse. Forced Undo improved from **26.49 seconds to 4.67 seconds**.

The earlier exploratory measurement was 27.03 seconds for the baseline and 5.32 seconds for a limited prototype. The tables below are the complete rerun against the final service, with the same interpreter, fixtures, machine, and project filesystem for both revisions.

## Normal Undo

| Fixture | Strings | Baseline median (range), s | Final median (range), s | SELECTs: baseline → final |
| --- | ---: | ---: | ---: | ---: |
| Plain | 100 | 0.86 (0.86–0.91) | 0.50 (0.48–0.53) | 1,501 → 701 |
| Plain | 500 | 3.06 (2.88–3.27) | 2.91 (2.09–2.95) | 7,501 → 3,501 |
| Plain | 1,000 | 5.98 (5.91–6.19) | 3.89 (3.87–3.90) | 15,001 → 7,001 |
| Rich | 100 | 1.26 (1.23–1.35) | 0.48 (0.46–0.56) | 2,501 → 703 |
| Rich | 500 | 10.63 (10.16–10.87) | 2.44 (2.42–2.55) | 12,501 → 3,503 |
| Rich | 1,000 | 29.08 (28.42–29.19) | 4.61 (4.49–4.74) | 25,001 → 7,003 |

## Forced Undo

| Fixture | Strings | Baseline median (range), s | Final median (range), s | SELECTs: baseline → final |
| --- | ---: | ---: | ---: | ---: |
| Plain | 100 | 0.62 (0.54–0.65) | 0.38 (0.37–0.41) | 1,401 → 701 |
| Plain | 500 | 2.81 (2.70–2.88) | 1.86 (1.80–1.90) | 7,001 → 3,501 |
| Plain | 1,000 | 5.41 (5.15–5.62) | 3.71 (3.69–3.78) | 14,001 → 7,001 |
| Rich | 100 | 1.17 (1.11–1.29) | 0.46 (0.45–0.49) | 2,401 → 703 |
| Rich | 500 | 9.54 (9.39–9.68) | 2.35 (2.28–2.39) | 12,001 → 3,503 |
| Rich | 1,000 | 26.49 (25.32–26.97) | 4.67 (4.58–4.75) | 24,001 → 7,003 |

## Method and acceptance

- Python 3.14 with the installed backend dependencies. The current harness uses Postgres: a seeded template database is cloned for every iteration. The 2026-10-04 numbers above were collected on file databases before this port.
- Plain: draft strings, one working translation, no tags/modules. Rich: public strings, ten translations, three tags per string, ten shared modules, twelve shared tags, and a published snapshot. Each string has one existing-string update to undo.
- Normal live values are A2 after A1 → A2. Forced fixtures have a later A3 edit. Both restore A1; forced markers must record A3 → A1.
- One warm-up, one separately instrumented SQL-count pass, then three uninstrumented timed runs. Preview and execution use separate sessions; seeding, copying, authentication/project lookup, and verification are outside elapsed time.
- Every iteration checks exact persisted values, published state, marker before/after snapshots, one marker per inverse, marker grouping, original revert links, and total audit count.
- All fixtures meet the budget of at most two full string loads per inverse and at most `12 × strings + 30` SELECTs. Both 1,000-string rich modes exceed the required 60% time reduction. Wall-clock thresholds are not CI assertions.
- The final 1,000-string rich normal preview uses ten SELECTs versus 3,004 at baseline; its measured median is 0.35 seconds versus 1.46 seconds.
- The 2026-10-04 ranges exclude HTTP/browser overhead. They are historical file-database measurements. Other inverse kinds and error paths are covered by the backend/API and browser regression suites.

## Reproduce

From `backend/`, with Postgres running and `DATABASE_URL` set to a Postgres URL on that server (the named database is only used to find the server; throwaway databases are created and dropped):

```bash
PYTHONPATH=. uv run --no-sync python benchmarks/undo.py \
  --sizes 100 500 1000 --profiles plain rich --trials 3 \
  --output /tmp/undo-final-normal.json

PYTHONPATH=. uv run --no-sync python benchmarks/undo.py \
  --sizes 100 500 1000 --profiles plain rich --trials 3 --force \
  --output /tmp/undo-final-forced.json
```

The script prints per-case JSON and saves samples, ranges, query categories, and correctness results. Throwaway databases are dropped when each case finishes.

CI coverage: `backend/tests/test_undo_query_budget.py` checks normal/forced rich fixtures at 25 and 100 strings, bounded preview reads, execution read budgets, and exact audit snapshots. Creation/deletion, legacy records, reused keys, uniqueness races, and rollback behavior remain in the activity restoration regressions.
