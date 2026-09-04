from datetime import UTC, datetime

from app.schemas import ActivityOut
from app.timefmt import utc_isoformat


def test_naive_utc_serializes_with_z():
    naive = datetime(2026, 9, 2, 8, 0, 0)
    assert utc_isoformat(naive) == "2026-09-02T08:00:00Z"


def test_activity_created_at_json_is_utc_z():
    out = ActivityOut(
        id="00000000-0000-0000-0000-000000000001",
        actor_type="user",
        actor_id=None,
        actor_label="dev",
        action="update",
        entity_type="string",
        entity_id="1",
        string_id=None,
        locale=None,
        before=None,
        after=None,
        event_type="string.unpublished",
        summary="Unpublished 'x'",
        batch_id=None,
        batch_kind=None,
        revert_of_id=None,
        reverted_by_id=None,
        is_revertible=True,
        created_at=datetime(2026, 9, 2, 8, 0, 0),
        changed=[],
    )
    payload = out.model_dump(mode="json")
    assert payload["created_at"] == "2026-09-02T08:00:00Z"
    aware = datetime(2026, 9, 2, 15, 0, 0, tzinfo=UTC)
    # 15:00 UTC should stay 15:00Z, not be rewritten as local
    out2 = out.model_copy(update={"created_at": aware})
    assert out2.model_dump(mode="json")["created_at"] == "2026-09-02T15:00:00Z"
