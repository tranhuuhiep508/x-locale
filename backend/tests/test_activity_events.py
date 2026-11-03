import pytest

from app.services.activity_events import (
    EVENT_CREATED,
    EVENT_DELETED,
    EVENT_PENDING_DELETE,
    EVENT_PUBLISHED,
    EVENT_RENAMED,
    EVENT_RESTORED,
    EVENT_SAVED_DRAFT,
    EVENT_SAVED_PUBLISHED,
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


@pytest.mark.parametrize(
    "field,old,new",
    [
        ("key", "old", "new"),
        ("source_text", "Hello", "Welcome"),
        ("description", None, "Greeting"),
        ("module_id", None, "module"),
        ("tag_ids", [], ["tag"]),
        ("translations", {"en": "Hello"}, {"en": "Welcome"}),
    ],
)
def test_classify_combined_content_and_publication(field, old, new):
    event = classify_event(
        action="update",
        before={"status": "draft", field: old},
        after={"status": "public", field: new},
        intent="save_draft",
    )
    assert event.event_type == EVENT_SAVED_PUBLISHED
    assert event.summary.startswith("Saved and published")


@pytest.mark.parametrize(
    "before,after",
    [
        ({"tag_ids": ["a", "b"]}, {"tag_ids": ["b", "a"]}),
        ({"translations": {}}, {"translations": {"en": ""}}),
        (
            {"translations": [{"locale": "en", "value": "Hello"}]},
            {"translations": {"en": {"value": "Hello", "confidence": 90}}},
        ),
        ({"key": "a"}, {"key": "a", "description": "Not recorded before"}),
    ],
)
def test_classify_publication_requires_content_evidence(before, after):
    event = classify_event(
        action="update",
        before={**before, "status": "draft"},
        after={**after, "status": "public"},
    )
    assert event.event_type == EVENT_PUBLISHED


def test_classify_draft_save_requires_review_intent_and_actual_content():
    kwargs = {
        "action": "update",
        "before": {"key": "a", "status": "public", "translations": {"en": "Hello"}},
        "after": {"key": "a", "status": "public", "translations": {"en": "Welcome"}},
    }
    assert classify_event(**kwargs).event_type == EVENT_TRANSLATION
    saved = classify_event(**kwargs, intent="save_draft")
    assert saved.event_type == EVENT_SAVED_DRAFT and saved.locale == "en"
    assert saved.summary == "Saved translations of 'a' as draft"
    assert (
        classify_event(
            action="update", before=kwargs["after"], after=kwargs["after"], intent="save_draft"
        ).event_type
        != EVENT_SAVED_DRAFT
    )


@pytest.mark.parametrize(
    "before,after,expected",
    [
        ({"status": "public"}, {"status": "draft"}, EVENT_UNPUBLISHED),
        ({"pending_delete": False}, {"pending_delete": True}, EVENT_PENDING_DELETE),
        ({"deleted_at": None}, {"deleted_at": "now"}, EVENT_DELETED),
        ({"deleted_at": "then"}, {"deleted_at": None}, EVENT_RESTORED),
    ],
)
def test_review_save_preserves_lifecycle_precedence(before, after, expected):
    event = classify_event(
        action="update",
        before={**before, "source_text": "Hello"},
        after={**after, "source_text": "Welcome"},
        intent="save_draft",
    )
    assert event.event_type == expected


@pytest.mark.parametrize(
    "kind,counts,count,expected",
    [
        ("batch", {EVENT_SAVED_DRAFT: 101}, 101, "Saved translations as draft · 101 strings"),
        ("batch", {EVENT_PUBLISHED: 101}, 101, "Published 101 strings"),
        ("batch", {EVENT_SAVED_PUBLISHED: 101}, 101, "Saved and published 101 strings"),
        (
            "batch",
            {EVENT_SAVED_PUBLISHED: 1, EVENT_PUBLISHED: 2, EVENT_SAVED_DRAFT: 1},
            4,
            "Updated 4 strings · Saved and published 1 string · Published 2 strings",
        ),
        ("translate", {EVENT_TRANSLATION: 3}, 3, "AI translated 3 strings"),
        ("cli_push", {EVENT_CREATED: 3}, 3, "CLI push · 3 strings"),
        ("import", {EVENT_UPDATED: 3}, 3, "Imported · 3 strings"),
        ("excel_import", {EVENT_CREATED: 3}, 3, "Imported from Excel · 3 strings"),
    ],
)
def test_batch_summaries_use_full_event_counts(kind, counts, count, expected):
    assert batch_card_summary(kind, counts, count) == expected


@pytest.mark.parametrize(
    "kind,origin",
    [
        ("import", "Imported"),
        ("excel_import", "Excel"),
        ("cli_push", "CLI push"),
        ("translate", "AI translated"),
    ],
)
def test_publication_batch_summaries_keep_origin(kind, origin):
    summary = batch_card_summary(kind, {EVENT_SAVED_PUBLISHED: 2}, 2)
    assert "Saved and published 2 strings" in summary and origin in summary


def test_human_changed_can_omit_published_scope():
    rows = human_changed(
        {
            "key": "a",
            "published_key": "old",
            "translations": {"en": "Hi"},
        },
        {
            "key": "a",
            "published_key": "new",
            "translations": {"en": "Hello"},
        },
        action="update",
        include_published=False,
    )
    assert not any(row.field == "published_key" for row in rows)
    assert any(row.field == "translation" and row.locale == "en" for row in rows)


def test_human_changed_tags_published_fields_with_scope():
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
    published_key_row = next(row for row in rows if row.field == "published_key")
    assert published_key_row.scope == "published"
    assert published_key_row.before == "old"
    assert published_key_row.after == "new"
    draft_translation = next(
        row for row in rows if row.field == "translation" and row.locale == "en"
    )
    assert draft_translation.scope == "draft"
    assert draft_translation.kind == "translation"


def test_human_changed_includes_module_id_and_published_translations():
    rows = human_changed(
        {
            "key": "a",
            "module_id": "mod-1",
            "published_translations": {"en": "Old"},
        },
        {
            "key": "a",
            "module_id": "mod-2",
            "published_translations": {"en": "New"},
        },
        action="update",
    )
    module_row = next(row for row in rows if row.field == "module_id")
    assert module_row.before == "mod-1"
    assert module_row.after == "mod-2"
    assert module_row.scope == "draft"
    pub_translation = next(
        row for row in rows if row.field == "translation" and row.scope == "published"
    )
    assert pub_translation.locale == "en"
    assert pub_translation.before == "Old"
    assert pub_translation.after == "New"


def test_human_changed_prefers_tag_names():
    rows = human_changed(
        {
            "key": "welcome",
            "status": "draft",
            "tag_ids": ["uuid-old"],
            "tag_names": ["old"],
        },
        {
            "key": "welcome",
            "status": "draft",
            "tag_ids": ["uuid-new"],
            "tag_names": ["release"],
        },
        action="update",
    )
    tag = next(row for row in rows if row.field == "tags")
    assert tag.before == "old"
    assert tag.after == "release"
    assert tag.kind == "tags"


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
    text = batch_card_summary("excel_import", {}, 43)
    assert "Excel" in text
    assert "43" in text


def test_history_restorable_skips_lifecycle_events():
    assert is_history_restorable(EVENT_TRANSLATION, "update") is True
    assert is_history_restorable(EVENT_CREATED, "create") is True
    assert is_history_restorable(EVENT_PUBLISHED, "update") is False
    assert is_history_restorable(EVENT_UNPUBLISHED, "update") is False
    assert is_history_restorable(EVENT_PENDING_DELETE, "update") is False
    assert is_history_restorable(EVENT_DELETED, "delete") is False


@pytest.mark.parametrize(
    "field,before,after",
    [
        ("key", "old", "new"),
        ("source_text", "Hello", "Welcome"),
        ("description", None, "Greeting"),
        ("module_id", None, "module"),
        ("tag_ids", [], ["tag"]),
        ("translations", {"en": "Hello"}, {"en": "Welcome"}),
    ],
)
@pytest.mark.parametrize("event_type", [EVENT_PUBLISHED, EVENT_SAVED_PUBLISHED])
def test_history_restorable_mixed_publication(field, before, after, event_type):
    assert is_history_restorable(event_type, "update", before={field: before}, after={field: after})


@pytest.mark.parametrize(
    "before,after",
    [
        (None, {"source_text": "Welcome"}),
        ({"source_text": "Hello"}, None),
        ({"key": "greeting"}, {"key": "greeting", "description": "Greeting"}),
        ({"status": "draft"}, {"status": "public"}),
        ({"published_source_text": "Hello"}, {"published_source_text": "Welcome"}),
        ({"published_at": "old"}, {"published_at": "new"}),
        ({"published_translations": {"en": "Hello"}}, {"published_translations": {"en": "Hi"}}),
        ({"pending_delete": False}, {"pending_delete": True}),
        ({"deleted_at": None}, {"deleted_at": "now"}),
        ({"tag_ids": ["a", "b"]}, {"tag_ids": ["b", "a"]}),
        ({"translations": {}}, {"translations": {"en": ""}}),
        ({"translations": {"en": ""}}, {"translations": {"en": None}}),
        (
            {"translations": [{"locale": "en", "value": "Hello"}]},
            {"translations": {"en": {"value": "Hello", "confidence": 90}}},
        ),
    ],
)
@pytest.mark.parametrize("event_type", [EVENT_PUBLISHED, EVENT_SAVED_PUBLISHED])
def test_history_publication_requires_recorded_content_edit(before, after, event_type):
    assert not is_history_restorable(event_type, "update", before=before, after=after)


@pytest.mark.parametrize(
    "event,action",
    [
        (EVENT_UNPUBLISHED, "update"),
        (EVENT_PENDING_DELETE, "update"),
        (EVENT_DELETED, "update"),
        (EVENT_PUBLISHED, "delete"),
        (EVENT_SAVED_PUBLISHED, "delete"),
    ],
)
def test_history_lifecycle_stays_blocked_with_content_edit(event, action):
    assert not is_history_restorable(
        event, action, before={"source_text": "Hello"}, after={"source_text": "Welcome"}
    )
