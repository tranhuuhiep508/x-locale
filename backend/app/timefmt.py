"""UTC JSON timestamps. SQLite stores naive UTC; JS treats naive ISO as local."""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, PlainSerializer


def aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def utc_isoformat(value: datetime) -> str:
    return aware_utc(value).isoformat().replace("+00:00", "Z")


UtcDateTime = Annotated[
    datetime,
    AfterValidator(aware_utc),
    PlainSerializer(utc_isoformat, return_type=str, when_used="json"),
]
