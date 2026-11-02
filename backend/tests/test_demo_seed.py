import re

from app import seed
from app.models import Project, StringEntry, TranslationStatus
from app.services.sync import build_modular_export
from app.services.translation_memory import lookup_memory
from app.services.translation_qa import check_translation


def test_demo_seed_has_rich_translations_and_published_snapshots(session_factory, monkeypatch):
    monkeypatch.setattr(seed, "SessionLocal", session_factory)
    project = seed.seed_demo_data()
    with session_factory() as db:
        entries = db.query(StringEntry).filter_by(project_id=project.id).all()
        assert len(entries) == 73
        assert {entry.module.slug for entry in entries if entry.module} == {
            "checkout",
            "notifications",
            "settings",
        }
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
                if translation.value and entry.tags[0].name != "QA example":
                    assert set(re.findall(r"\{\{(\w+)\}\}", translation.value)) == placeholders
                if (
                    entry.status == TranslationStatus.public
                    and entry.key != "demo_translation_edit"
                ):
                    assert translation.published_value == translation.value

        by_key = {entry.key: entry for entry in entries}
        qa = by_key["demo_qa_missing_placeholder"]
        assert "placeholder_missing" in {
            issue.code
            for issue in check_translation(qa.source_text, qa.translations[0].value, "en")
        }
        assert by_key["demo_deleted"].deleted_at is not None
        assert by_key["demo_pending_delete"].pending_delete
        assert by_key["demo_unassigned"].module_id is None
        project_in_db = db.get(Project, project.id)
        exact_source = by_key["demo_memory_exact"].source_text
        similar_source = by_key["demo_memory_similar"].source_text
        matches = lookup_memory(db, project_in_db, [(exact_source, "en"), (similar_source, "en")])
        assert any(
            match.key == "demo_memory_published" and match.exact
            for match in matches[exact_source]["en"]
        )
        assert any(
            match.key == "demo_memory_published" and not match.exact
            for match in matches[similar_source]["en"]
        )
        draft = build_modular_export(project_in_db, entries, "draft")
        public = build_modular_export(project_in_db, entries, "public")
        assert "demo_pending_delete" not in draft["modules"]["checkout"]["en"]
        assert "demo_pending_delete" in public["modules"]["checkout"]["en"]
        assert draft["unassigned"]["en"]["demo_unassigned"]
        assert (
            draft["modules"]["checkout"]["en"]["demo_translation_edit"]
            != public["modules"]["checkout"]["en"]["demo_translation_edit"]
        )

    assert seed.seed_demo_data().id == project.id
    with session_factory() as db:
        assert db.query(StringEntry).filter_by(project_id=project.id).count() == 73
