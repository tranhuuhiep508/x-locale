"""Authentication: session cookies for UI, API keys for CLI/runtime."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Cookie, Depends, Header, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import ApiKey, Project, User

SESSION_COOKIE = "tms_session"
SESSION_TTL_HOURS = 72
DEV_ISSUER = "tms-dev"
DEV_SUB = "dev-user"


@dataclass
class AuthContext:
    actor_type: str  # user | api_key | system
    actor_id: str | None
    actor_label: str
    user: User | None = None
    api_key: ApiKey | None = None
    project: Project | None = None


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    """Return (raw_key, prefix, hash)."""
    raw = f"tms_{secrets.token_urlsafe(32)}"
    prefix = raw[:12]
    return raw, prefix, hash_api_key(raw)


def create_session_token(user: User) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "name": user.name,
        "iat": now,
        "exp": now + timedelta(hours=SESSION_TTL_HOURS),
    }
    return jwt.encode(payload, settings.tms_secret, algorithm="HS256")


def decode_session_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.tms_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from exc


def get_or_create_dev_user(db: Session) -> User:
    user = (
        db.query(User)
        .filter(User.oidc_issuer == DEV_ISSUER, User.oidc_sub == DEV_SUB)
        .first()
    )
    if user:
        user.last_login_at = datetime.now(UTC)
        return user
    user = User(
        email="dev@localhost",
        name="Dev User",
        oidc_issuer=DEV_ISSUER,
        oidc_sub=DEV_SUB,
        last_login_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    return user


def set_activity_context(db: Session, ctx: AuthContext, *, batch_id: uuid.UUID | None = None, batch_kind: str | None = None) -> None:
    info: dict = {
        "actor_type": ctx.actor_type,
        "actor_id": ctx.actor_id,
        "actor_label": ctx.actor_label,
    }
    if batch_id is not None:
        info["batch_id"] = str(batch_id)
    if batch_kind is not None:
        info["batch_kind"] = batch_kind
    db.info["activity"] = info


def current_user(
    request: Request,
    db: Session = Depends(get_db),
    tms_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    """Require an authenticated UI session (or AUTH_DEV_BYPASS)."""
    if tms_session:
        payload = decode_session_token(tms_session)
        user = db.query(User).filter(User.id == uuid.UUID(payload["sub"])).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        set_activity_context(
            db,
            AuthContext(
                actor_type="user",
                actor_id=str(user.id),
                actor_label=user.email or user.name,
                user=user,
            ),
        )
        return user

    if settings.dev_bypass_active:
        user = get_or_create_dev_user(db)
        db.commit()
        set_activity_context(
            db,
            AuthContext(
                actor_type="user",
                actor_id=str(user.id),
                actor_label=user.email or user.name,
                user=user,
            ),
        )
        return user

    raise HTTPException(status_code=401, detail="Not authenticated")


def optional_user(
    db: Session = Depends(get_db),
    tms_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User | None:
    if tms_session:
        try:
            payload = decode_session_token(tms_session)
            return db.query(User).filter(User.id == uuid.UUID(payload["sub"])).first()
        except HTTPException:
            return None
    if settings.dev_bypass_active:
        user = get_or_create_dev_user(db)
        db.commit()
        return user
    return None


def _resolve_api_key(db: Session, raw_key: str) -> tuple[ApiKey, Project]:
    key_hash = hash_api_key(raw_key)
    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.key_hash == key_hash, ApiKey.revoked_at.is_(None))
        .first()
    )
    if not api_key:
        # Back-compat: look for legacy bare key match via prefix store of demo key
        # Demo seed stores the raw demo key hashed.
        raise HTTPException(status_code=401, detail="Invalid API key")
    project = db.query(Project).filter(Project.id == api_key.project_id).first()
    if not project:
        raise HTTPException(status_code=401, detail="Invalid API key")
    api_key.last_used_at = datetime.now(UTC)
    set_activity_context(
        db,
        AuthContext(
            actor_type="api_key",
            actor_id=str(api_key.id),
            actor_label=api_key.name,
            api_key=api_key,
            project=project,
        ),
    )
    return api_key, project


def project_from_api_key(
    db: Session = Depends(get_db),
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    api_key: Annotated[str | None, Query(description="Project API key")] = None,
) -> Project:
    raw = x_api_key or api_key
    if not raw:
        raise HTTPException(status_code=401, detail="API key required")
    _, project = _resolve_api_key(db, raw)
    return project


def project_access(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    api_key: Annotated[str | None, Query()] = None,
) -> Project:
    """Accept either session user (any project) or API key matching the project."""
    raw = x_api_key or api_key
    if raw:
        _, project = _resolve_api_key(db, raw)
        if project.id != project_id:
            raise HTTPException(status_code=404, detail="Project not found")
        return project

    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    set_activity_context(
        db,
        AuthContext(
            actor_type="user",
            actor_id=str(user.id),
            actor_label=user.email or user.name,
            user=user,
        ),
    )
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# Type aliases for Annotated Depends
CurrentUser = Annotated[User, Depends(current_user)]
ProjectFromApiKey = Annotated[Project, Depends(project_from_api_key)]
ProjectAccess = Annotated[Project, Depends(project_access)]
