import logging
from collections.abc import Generator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event, func, update
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import require_postgres_database_url, settings

logger = logging.getLogger(__name__)

require_postgres_database_url(settings.database_url)
engine = create_engine(settings.database_url, pool_pre_ping=True)
# Job ownership sits idle during AI calls; keep it off the request pool.
job_lock_engine = create_engine(settings.database_url, poolclass=NullPool, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        usage = db.info.get("api_key_usage")
        bind = db.get_bind()
        db.close()
        if usage is not None:
            from app.models import ApiKey

            key_id, used_at = usage
            try:
                # Release the content connection before persisting usage in its own transaction.
                with Session(bind=bind) as usage_db:
                    usage_db.execute(
                        update(ApiKey)
                        .where(ApiKey.id == key_id, ApiKey.revoked_at.is_(None))
                        .values(last_used_at=func.greatest(ApiKey.last_used_at, used_at))
                    )
                    usage_db.commit()
            except Exception:
                logger.warning(
                    "Failed to persist API key last_used_at for %s", key_id, exc_info=True
                )


DbSession = Annotated[Session, Depends(get_db)]


def register_activity_listener() -> None:
    """Register the before_flush activity capture listener (idempotent)."""
    from app.activity import capture_activities

    if getattr(register_activity_listener, "_registered", False):
        return
    event.listen(Session, "before_flush", capture_activities)
    register_activity_listener._registered = True  # type: ignore[attr-defined]
