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
                          ├──< activities
                          └──< snapshots
```

## Key constraints

- String uniqueness is `(project_id, module_id, key)` — the same key may exist in different modules.
- `module_id` is nullable (`ON DELETE SET NULL`). Unassigned strings export under `_unassigned` (Excel) or at the top level (JSON modular).
- Translation status: `draft` \| `public` (renamed from MVP `live`).
- API keys live in `api_keys` (hashed). Projects no longer store a bare `api_key` column.
- `activities` is append-only. Content entities (`string`, `translation`) are revertible; structural ones (`module`, `tag`, `project`, `api_key`) are audit-only.
- `snapshots.content` stores a full JSON document of strings + translations. Fine for MVP size; revisit with a child table if projects grow large.

## Flat vs modular export

| Layout | Shape |
|--------|-------|
| `flat` | `{ locale: { "module.key": value, "orphan": value } }` — module-scoped keys are prefixed |
| `modular` | `{ modules: { login: { vi: {...}, en: {...} } }, unassigned: {...}, manifest: {...} }` |

Project setting chooses the default; export query param overrides.

## Draft / public workflow

1. New and AI-translated values land as `draft`.
2. Translators edit; batch **Publish** sets `status=public`.
3. CLI/CI `tms pull --stage public` (or export `stage=public`) returns only public values, falling back to base-language source so production never shows a raw key.
4. Import / Excel never auto-publishes unless the caller passes `status=public`.

## Version control

1. **Level 1 — Activity feed:** every content write emits `activities` rows (via SQLAlchemy `before_flush`). Revert one row or a whole `batch_id` (import, translate, batch ops, snapshot restore).
2. **Level 2 — Snapshots:** named whole-project checkpoints. Restore auto-creates a safety snapshot first, then overwrites content in one transaction (`batch_kind=snapshot_restore`).

Optional `ACTIVITY_RETENTION_DAYS` can prune old rows; snapshots are kept until deleted.
