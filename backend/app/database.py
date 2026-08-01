from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def register_activity_listener() -> None:
    """Register the before_flush activity capture listener (idempotent)."""
    from app.activity import capture_activities

    if getattr(register_activity_listener, "_registered", False):
        return
    event.listen(Session, "before_flush", capture_activities)
    register_activity_listener._registered = True  # type: ignore[attr-defined]
