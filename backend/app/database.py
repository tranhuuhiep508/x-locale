from collections.abc import Generator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import require_postgres_database_url, settings

require_postgres_database_url(settings.database_url)
engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DbSession = Annotated[Session, Depends(get_db)]


def register_activity_listener() -> None:
    """Register the before_flush activity capture listener (idempotent)."""
    from app.activity import capture_activities

    if getattr(register_activity_listener, "_registered", False):
        return
    event.listen(Session, "before_flush", capture_activities)
    register_activity_listener._registered = True  # type: ignore[attr-defined]
