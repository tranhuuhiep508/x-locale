"""Project-local suggestions from current published snapshots; never calls AI."""

from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Project, StringEntry
from app.services.translation_qa import check_translations

SIMILARITY_THRESHOLD = 0.80
SUGGESTION_LIMIT = 3
# Match str.strip() even when PostgreSQL uses the C locale.
STRIP_WHITESPACE = (
    " \t\n\r\v\f\x1c\x1d\x1e\x1f\x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)


SUGGESTIONS_SQL = text("""
    SELECT r.id AS recipient_id, r.locale, r.source AS recipient_source, match.*
    FROM jsonb_to_recordset(CAST(:recipients AS jsonb))
      AS r(id uuid, source text, module_id uuid, locale text)
    CROSS JOIN LATERAL (
        SELECT s.id AS string_id, s.published_key AS key,
               s.published_module_id AS module_id, m.slug AS module_slug,
               s.published_source_text AS source_text, t.published_value AS value,
               s.published_at,
               (s.published_source_text = r.source) AS exact,
               similarity(s.published_source_text, r.source) AS similarity
        FROM strings s
        JOIN translations t ON t.string_id = s.id AND t.locale = r.locale
        LEFT JOIN modules m ON m.id = s.published_module_id
        WHERE s.project_id = :project_id AND s.status = 'public'
          AND s.deleted_at IS NULL AND NOT s.pending_delete
          AND s.published_source_text IS NOT NULL
          AND s.published_at IS NOT NULL AND s.published_key IS NOT NULL
          AND btrim(t.published_value, :strip_whitespace) <> ''
          AND (s.published_source_text = r.source OR s.published_source_text % r.source)
        ORDER BY exact DESC, similarity DESC,
                 (s.published_module_id IS NOT DISTINCT FROM r.module_id) DESC,
                 s.published_at DESC, s.id
        LIMIT :limit
    ) AS match
""")


def memory_suggestions(
    db: Session,
    project: Project,
    entries: list[StringEntry],
    items: list[dict],
) -> None:
    """Enrich one queue page with a single indexed, batched lookup."""
    by_id = {str(entry.id): entry for entry in entries}
    recipients = [
        {
            "id": item["string_id"],
            "source": item["source_text"],
            "module_id": str(entry.module_id) if entry.module_id else None,
            "locale": locale,
        }
        for item in items
        for entry in [by_id[item["string_id"]]]
        for locale in item["translations"]
    ]
    if not recipients:
        return
    previous = db.execute(
        text("SELECT coalesce(current_setting('pg_trgm.similarity_threshold', true), '0.3')")
    ).scalar_one()
    db.execute(
        text("SELECT set_config('pg_trgm.similarity_threshold', :threshold, true)"),
        {"threshold": str(SIMILARITY_THRESHOLD)},
    )
    try:
        rows = (
            db.execute(
                SUGGESTIONS_SQL,
                {
                    "recipients": json.dumps(recipients),
                    "project_id": project.id,
                    "limit": SUGGESTION_LIMIT,
                    "strip_whitespace": STRIP_WHITESPACE,
                },
            )
            .mappings()
            .all()
        )
    finally:
        db.execute(
            text("SELECT set_config('pg_trgm.similarity_threshold', :threshold, true)"),
            {"threshold": previous},
        )
    by_item = {item["string_id"]: item for item in items}
    for row in rows:
        qa = check_translations(row["recipient_source"], {row["locale"]: row["value"]}).get(
            row["locale"]
        )
        if qa is None:
            continue
        suggestion = {
            key: row[key]
            for key in (
                "string_id",
                "key",
                "module_id",
                "module_slug",
                "source_text",
                "value",
                "published_at",
                "similarity",
            )
        }
        suggestion.update(
            match_type="exact" if row["exact"] else "fuzzy",
            qa=qa,
            can_accept=qa.complete and not any(i.severity == "error" for i in qa.issues),
        )
        by_item[str(row["recipient_id"])].setdefault("memory_suggestions", {}).setdefault(
            row["locale"], []
        ).append(suggestion)
