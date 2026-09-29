"""Service-level coverage for advanced string filters."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

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
