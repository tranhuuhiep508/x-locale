"""Service-level coverage for advanced string filters."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Module, Project, StringEntry, Tag, Translation, TranslationStatus
from app.services.strings import resolve_string_ids, string_query


def test_advanced_string_query_filters_compose():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime.now(UTC)

    with Session(engine) as db:
        project = Project(
            name="Filters",
            slug="filters",
            base_language="vi",
            target_languages=["en", "fr"],
        )
        module = Module(project=project, slug="common", name="Common")
        tag = Tag(project=project, name="tagged", color="#123456")
        db.add_all([project, module, tag])
        db.flush()

        def add(
            key: str,
            *,
            assigned: bool = False,
            translations: dict[str, str] | None = None,
            published: bool = False,
            pending_delete: bool = False,
        ) -> StringEntry:
            entry = StringEntry(
                project_id=project.id,
                module_id=module.id if assigned else None,
                key=key,
                source_text=key.title(),
                status=TranslationStatus.public if published else TranslationStatus.draft,
                published_at=now if published else None,
                pending_delete=pending_delete,
            )
            if assigned:
                entry.tags = [tag]
            entry.translations = [
                Translation(locale=locale, value=value)
                for locale, value in (translations or {}).items()
            ]
            db.add(entry)
            return entry

        add(
            "ready",
            assigned=True,
            translations={"en": "Ready", "fr": "Prêt"},
            published=True,
        )
        add(
            "pending",
            assigned=True,
            translations={"en": "Pending", "fr": "En attente"},
            published=True,
            pending_delete=True,
        )
        new = add("new", translations={"en": "   "})
        mid = add(
            "mid",
            assigned=True,
            translations={"en": "Middle", "fr": "Milieu"},
        )
        old = add("old", translations={"en": "Old", "fr": "Ancien"})
        db.commit()
        for entry, age_days in ((mid, 14), (old, 31)):
            db.execute(
                update(StringEntry)
                .where(StringEntry.id == entry.id)
                .values(updated_at=now - timedelta(days=age_days))
            )
        db.commit()

        def keys(**filters) -> set[str]:
            return {row.key for row in string_query(db, project.id, **filters).all()}

        assert keys(never_published=True) == {"new", "mid", "old"}
        assert keys(pending_delete=True) == {"pending"}
        assert keys(missing_any_locales=project.target_languages) == {"new"}
        assert keys(missing_locale="en") == {"new"}
        assert keys(complete_locale="en") == {"ready", "pending", "mid", "old"}
        assert keys(unassigned_module=True) == {"new", "old"}
        assert keys(untagged=True) == {"new", "old"}
        assert keys(updated_within_days=7) == {"ready", "pending", "new"}
        assert keys(updated_within_days=30) == {"ready", "pending", "new", "mid"}
        assert keys(
            unassigned_module=True,
            untagged=True,
            complete_locale="en",
        ) == {"old"}

        resolved = resolve_string_ids(
            db,
            project,
            None,
            SimpleNamespace(
                missing_any=True,
                unassigned_module=True,
                untagged=True,
            ),
        )
        assert resolved == [new.id]


@pytest.fixture()
def filter_catalog():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            project = Project(
                name="Filter correctness",
                slug="filter-correctness",
                base_language="vi",
                target_languages=["en", "fr"],
            )
            module = Module(project=project, slug="common", name="Common")
            tag = Tag(project=project, name="tagged", color="#123456")
            db.add_all([project, module, tag])
            db.flush()
            entries = {}
            values = {
                "absent": (None, None),
                "empty": ("", 0),
                "spaces": ("   ", 0),
                "unscored": ("Text", None),
                "low": ("Low", 0),
                "boundary": ("  Boundary  ", 50),
                "above": ("Above", 51),
                "other_locale": ("   ", 0),
            }
            for key, (value, score) in values.items():
                entry = StringEntry(project_id=project.id, key=key, source_text=key)
                if value is not None:
                    entry.translations = [
                        Translation(locale="en", value=value, confidence=score),
                    ]
                if key == "other_locale":
                    entry.translations.append(
                        Translation(locale="fr", value="Autre", confidence=80),
                    )
                if key == "low":
                    entry.module_id = module.id
                    entry.tags = [tag]
                db.add(entry)
                entries[key] = entry
            db.commit()
            yield db, project, module, tag, entries
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    ("threshold", "expected"),
    [
        (0, {"low"}),
        (50, {"low", "boundary"}),
        (100, {"low", "boundary", "above", "other_locale"}),
    ],
)
def test_confidence_uses_nonempty_translations(filter_catalog, threshold, expected):
    db, project, _, _, _ = filter_catalog
    query = string_query(db, project.id, max_confidence=threshold)
    assert {entry.key for entry in query.all()} == expected


def test_missing_groups_preserve_empty_and_cross_locale_semantics(filter_catalog):
    db, project, module, tag, entries = filter_catalog

    def keys(**filters):
        return {entry.key for entry in string_query(db, project.id, **filters).all()}

    missing_en = {"absent", "empty", "spaces", "other_locale"}
    assert keys(missing_locale="en") == missing_en
    assert keys(missing_locales=["en", "en"]) == missing_en
    assert keys(missing_any_locales=["en", "en"]) == missing_en
    assert keys(missing_locales=[]) == set(entries)
    assert keys(missing_any_locales=[]) == set()
    assert keys(complete_locale="en") == {"low", "boundary", "above", "unscored"}
    expected = {"low", "boundary", "above", "unscored"}
    assert keys(missing_locale="fr", complete_locale="en") == expected
    assert keys(missing_any_locales=["en", "fr"], complete_locale="en") == expected
    assert keys(missing_locales=["en", "fr"], complete_locale="en") == expected
    assert keys(module_id=module.id, unassigned_module=False) == {"low"}
    assert keys(tag_id=tag.id, untagged=False) == {"low"}
    resolved = resolve_string_ids(
        db, project, None, SimpleNamespace(missing_any=True, complete_locale="en")
    )
    assert set(resolved) == {entries[key].id for key in expected}


@pytest.mark.parametrize(
    ("filters", "field"),
    [
        ({"missing_locale": "en", "complete_locale": "en"}, "missing_locale"),
        ({"missing_locales": ["en"], "complete_locale": "en"}, "missing_locales"),
        ({"missing_any_locales": ["en"], "complete_locale": "en"}, "missing_any"),
        ({"missing_any_locales": ["en", "en"], "complete_locale": "en"}, "missing_any"),
    ],
)
def test_conflicting_locale_filters_are_rejected(filter_catalog, filters, field):
    db, project, _, _, _ = filter_catalog
    with pytest.raises(HTTPException) as error:
        string_query(db, project.id, **filters)
    assert error.value.status_code == 400
    assert field in error.value.detail
    assert "complete_locale" in error.value.detail


def test_conflicting_organization_filters_and_explicit_ids(filter_catalog):
    db, project, module, tag, entries = filter_catalog
    for filters, field in (
        ({"module_id": module.id, "unassigned_module": True}, "unassigned_module"),
        ({"tag_id": tag.id, "untagged": True}, "untagged"),
    ):
        with pytest.raises(HTTPException) as error:
            string_query(db, project.id, **filters)
        assert error.value.status_code == 400
        assert field in error.value.detail

    assert resolve_string_ids(
        db,
        project,
        [entries["low"].id],
        SimpleNamespace(module_id=module.id, unassigned_module=True),
    ) == [entries["low"].id]
