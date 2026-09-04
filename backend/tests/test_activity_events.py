from app.services.activity_events import (
    EVENT_CREATED,
    EVENT_DELETED,
    EVENT_PENDING_DELETE,
    EVENT_PUBLISHED,
    EVENT_RENAMED,
    EVENT_RESTORED,
    EVENT_SOURCE,
    EVENT_TRANSLATION,
    EVENT_UNPUBLISHED,
    EVENT_UPDATED,
    batch_card_summary,
    classify_event,
    human_changed,
    is_history_restorable,
)


def test_classify_create():
    event = classify_event(
        action="create",
        before=None,
        after={"key": "login.title", "source_text": "Đăng nhập", "status": "draft"},
    )
    assert event.event_type == EVENT_CREATED
    assert event.summary == "Created 'login.title'"


def test_classify_source_only():
    event = classify_event(
        action="update",
        before={"key": "welcome", "source_text": "Chào", "status": "draft", "translations": {}},
        after={"key": "welcome", "source_text": "Xin chào", "status": "draft", "translations": {}},
    )
    assert event.event_type == EVENT_SOURCE
    assert "source" in event.summary


def test_classify_rename():
    event = classify_event(
        action="update",
        before={"key": "old", "source_text": "A", "status": "draft"},
        after={"key": "new", "source_text": "A", "status": "draft"},
    )
    assert event.event_type == EVENT_RENAMED
    assert "old" in event.summary and "new" in event.summary


def test_classify_single_locale():
    event = classify_event(
        action="update",
        before={
            "key": "welcome",
            "source_text": "Chào",
            "status": "draft",
            "translations": {"en": "Hi"},
        },
        after={
            "key": "welcome",
            "source_text": "Chào",
            "status": "draft",
            "translations": {"en": "Welcome"},
        },
    )
    assert event.event_type == EVENT_TRANSLATION
    assert event.locale == "en"
    assert "→ en" in event.summary


def test_classify_pending_delete_is_not_deleted():
    event = classify_event(
        action="update",
        before={"key": "gone", "pending_delete": False, "deleted_at": None, "status": "public"},
        after={"key": "gone", "pending_delete": True, "deleted_at": None, "status": "public"},
    )
    assert event.event_type == EVENT_PENDING_DELETE
    assert "deletion" in event.summary


def test_classify_deleted_at():
    event = classify_event(
        action="delete",
        before={"key": "gone", "deleted_at": None},
        after={"key": "gone", "deleted_at": "2026-01-01T00:00:00"},
    )
    assert event.event_type == EVENT_DELETED


def test_classify_publish_and_unpublish():
    published = classify_event(
        action="update",
        before={"key": "k", "status": "draft", "published_key": None},
        after={"key": "k", "status": "public", "published_key": "k"},
    )
    assert published.event_type == EVENT_PUBLISHED
    unpublished = classify_event(
        action="update",
        before={"key": "k", "status": "public", "published_key": "k"},
        after={"key": "k", "status": "draft", "published_key": "k"},
    )
    assert unpublished.event_type == EVENT_UNPUBLISHED


def test_classify_restore_intent():
    event = classify_event(
        action="update",
        before={"key": "k", "translations": {"en": "B"}},
        after={"key": "k", "translations": {"en": "A"}},
        intent="restore",
    )
    assert event.event_type == EVENT_RESTORED
    assert event.summary == "Restored previous value of 'k'"


def test_classify_mixed_fields_fallback():
    event = classify_event(
        action="update",
        before={"key": "a", "source_text": "1", "translations": {"en": "x"}},
        after={"key": "b", "source_text": "2", "translations": {"en": "y"}},
    )
    assert event.event_type == EVENT_UPDATED


def test_human_changed_skips_published_fields():
    rows = human_changed(
        {
            "key": "a",
            "source_text": "s",
            "published_key": "old",
            "translations": {"en": "Hi"},
        },
        {
            "key": "a",
            "source_text": "s",
            "published_key": "new",
            "translations": {"en": "Hello"},
        },
        action="update",
    )
    assert all(row.field != "published_key" for row in rows)
    assert any(row.locale == "en" for row in rows)


def test_classify_moved_and_tagged():
    moved = classify_event(
        action="update",
        before={"key": "welcome", "module_id": "a", "status": "draft"},
        after={"key": "welcome", "module_id": "b", "status": "draft"},
    )
    assert moved.event_type == "string.moved"
    tagged = classify_event(
        action="update",
        before={"key": "welcome", "tag_ids": ["a"], "status": "draft"},
        after={"key": "welcome", "tag_ids": ["a", "b"], "status": "draft"},
    )
    assert tagged.event_type == "string.tagged"


def test_batch_card_summary_excel():
    text = batch_card_summary("excel_import", [], 43)
    assert "Excel" in text
    assert "43" in text


def test_history_restorable_skips_lifecycle_events():
    assert is_history_restorable(EVENT_TRANSLATION, "update") is True
    assert is_history_restorable(EVENT_CREATED, "create") is True
    assert is_history_restorable(EVENT_PUBLISHED, "update") is False
    assert is_history_restorable(EVENT_UNPUBLISHED, "update") is False
    assert is_history_restorable(EVENT_PENDING_DELETE, "update") is False
    assert is_history_restorable(EVENT_DELETED, "delete") is False
