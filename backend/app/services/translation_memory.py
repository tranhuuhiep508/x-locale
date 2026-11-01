"""Project-local suggestions from the currently published snapshots."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from itertools import batched

from sqlalchemy import String, Text, column, func, or_, select, text, true, values
from sqlalchemy.orm import Session

from app.models import Module, Project, StringEntry, Translation, TranslationStatus
from app.schemas import TranslationMemoryMatch
from app.services.translation_qa import check_translation

logger = logging.getLogger(__name__)

# Two parameters per cell, plus query filters; stay below PostgreSQL's 65,535 limit.
LOOKUP_BATCH_SIZE = 1000

# Match Python str.strip() independently of the database's collation.
_WHITESPACE = (
    "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)


def optional_memory(
    db: Session,
    project: Project,
    cells: Iterable[tuple[str, str]],
) -> tuple[dict[str, dict[str, list[TranslationMemoryMatch]]], str | None]:
    """A failed optional lookup must not abort the queue or an explicit AI request."""
    pairs = list(cells)
    if not pairs:
        return {}, None
    try:
        with db.begin_nested():
            return lookup_memory(db, project, pairs), None
    except Exception as exc:
        # SQLAlchemy exception messages can contain source/translation parameters.
        logger.warning("Translation memory unavailable (%s)", type(exc).__name__)
        return {}, "Published suggestions are unavailable. Try checking again."


def lookup_memory(
    db: Session,
    project: Project,
    cells: Iterable[tuple[str, str]],
) -> dict[str, dict[str, list[TranslationMemoryMatch]]]:
    """Bound SQL batches while preserving three ranked candidates per distinct cell."""
    pairs = list(dict.fromkeys(cells))
    result: dict[str, dict[str, list[TranslationMemoryMatch]]] = {}
    for source, locale in pairs:
        result.setdefault(source, {})[locale] = []
    if not pairs:
        return result

    # A broad indexed prefilter keeps the final 0.8 boundary explicitly inclusive.
    db.execute(text("SET LOCAL pg_trgm.similarity_threshold = 0.3"))
    for batch in batched(pairs, LOOKUP_BATCH_SIZE, strict=False):
        inputs = values(
            column("source_text", Text), column("locale", String), name="memory_inputs"
        ).data(batch)
        exact = StringEntry.published_source_text == inputs.c.source_text
        similarity = func.similarity(StringEntry.published_source_text, inputs.c.source_text)
        matches = (
            select(
                StringEntry.id.label("string_id"),
                StringEntry.published_key.label("key"),
                Module.id.label("module_id"),
                Module.slug.label("module_slug"),
                StringEntry.published_source_text.label("matched_source_text"),
                Translation.published_value.label("translation"),
                exact.label("exact"),
                similarity.label("similarity"),
            )
            .join(Translation, Translation.string_id == StringEntry.id)
            .outerjoin(
                Module,
                (Module.id == StringEntry.published_module_id) & (Module.project_id == project.id),
            )
            .where(
                StringEntry.project_id == project.id,
                StringEntry.status == TranslationStatus.public,
                StringEntry.deleted_at.is_(None),
                StringEntry.published_source_text.is_not(None),
                StringEntry.published_key.is_not(None),
                Translation.locale == inputs.c.locale,
                func.length(func.btrim(Translation.published_value, _WHITESPACE)) > 0,
                or_(
                    exact,
                    StringEntry.published_source_text.bool_op("%")(inputs.c.source_text)
                    & (similarity >= 0.8),
                ),
            )
            .order_by(
                exact.desc(), similarity.desc(), StringEntry.published_at.desc(), StringEntry.id
            )
            .limit(3)
            .correlate(inputs)
            .lateral("memory_matches")
        )
        rows = db.execute(
            select(inputs.c.source_text, inputs.c.locale, *matches.c).select_from(
                inputs.join(matches, true())
            )
        ).mappings()
        for row in rows:
            source, locale = row["source_text"], row["locale"]
            result[source][locale].append(
                TranslationMemoryMatch(
                    **{name: row[name] for name in matches.c.keys()},
                    issues=[
                        issue.as_dict()
                        for issue in check_translation(source, row["translation"], locale)
                    ],
                )
            )
    return result


def memory_examples(
    matches: dict[str, list[TranslationMemoryMatch]],
) -> dict[str, list[dict[str, str]]]:
    return {
        locale: [
            {"source": match.matched_source_text, "translation": match.translation}
            for match in candidates
            if not any(issue.severity == "error" for issue in match.issues)
        ]
        for locale, candidates in matches.items()
        if candidates and not any(match.exact for match in candidates)
    }
