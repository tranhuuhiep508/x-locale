import re

from app import seed
from app.models import StringEntry, TranslationStatus


def test_demo_seed_has_rich_translations_and_published_snapshots(session_factory, monkeypatch):
    monkeypatch.setattr(seed, "SessionLocal", session_factory)
    project = seed.seed_demo_data()
    with session_factory() as db:
        entries = db.query(StringEntry).filter_by(project_id=project.id).all()
        assert len(entries) == 64
        assert {entry.module.slug for entry in entries} == {"checkout", "notifications", "settings"}
        assert any("<strong>" in entry.source_text for entry in entries)
        assert any(not translation.value for entry in entries for translation in entry.translations)
        assert any(entry.status == TranslationStatus.draft for entry in entries)
        assert any(
            entry.published_source_text != entry.source_text
            for entry in entries
            if entry.published_key
        )
        for entry in entries:
            assert entry.tags
            placeholders = set(re.findall(r"\{\{(\w+)\}\}", entry.source_text))
            for translation in entry.translations:
                if translation.value:
                    assert set(re.findall(r"\{\{(\w+)\}\}", translation.value)) == placeholders
                if entry.status == TranslationStatus.public:
                    assert translation.published_value == translation.value

    assert seed.seed_demo_data().id == project.id
    with session_factory() as db:
        assert db.query(StringEntry).filter_by(project_id=project.id).count() == 64
