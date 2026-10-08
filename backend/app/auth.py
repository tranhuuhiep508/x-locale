"""Authentication: session cookies for UI, API keys for CLI/runtime."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Cookie, Depends, Header, HTTPException, Path, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.helpers import resolve_project_ref
from app.models import ApiKey, MemberRole, Project, ProjectMember, User
from app.services.members import lock_project

SESSION_COOKIE = "x_locale_session"
SESSION_TTL_HOURS = 72
DEV_ISSUER = "x-locale-dev"
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
    raw = f"xlocale_{secrets.token_urlsafe(32)}"
    prefix = raw[:12]
    return raw, prefix, hash_api_key(raw)


def create_session_token(user: User) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "name": user.name,
        "tv": int(user.token_version or 0),
        "iat": now,
        "exp": now + timedelta(hours=SESSION_TTL_HOURS),
    }
    return jwt.encode(payload, settings.x_locale_secret, algorithm="HS256")


def _user_from_session_payload(db: Session, payload: dict) -> User:
    user = db.query(User).filter(User.id == uuid.UUID(payload["sub"])).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    token_tv = int(payload.get("tv", 0))
    if int(user.token_version or 0) != token_tv:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


def decode_session_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.x_locale_secret, algorithms=["HS256"])
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


def _require_session_user(db: Session, token: str | None) -> User:
    if token:
        payload = decode_session_token(token)
        return _user_from_session_payload(db, payload)
    if settings.dev_bypass_active:
        user = get_or_create_dev_user(db)
        db.commit()
        return user
    raise HTTPException(status_code=401, detail="Not authenticated")


def _bind_user_activity(db: Session, user: User) -> None:
    set_activity_context(
        db,
        AuthContext(
            actor_type="user",
            actor_id=str(user.id),
            actor_label=user.email or user.name,
            user=user,
        ),
    )


def current_user(
    request: Request,
    db: Session = Depends(get_db),
    x_locale_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    """Require an authenticated UI session (or AUTH_DEV_BYPASS)."""
    user = _require_session_user(db, x_locale_session)
    _bind_user_activity(db, user)
    return user


def optional_user(
    db: Session = Depends(get_db),
    x_locale_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User | None:
    if x_locale_session:
        try:
            payload = decode_session_token(x_locale_session)
            return _user_from_session_payload(db, payload)
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
) -> Project:
    if not x_api_key:
        raise HTTPException(status_code=401, detail="API key required")
    _, project = _resolve_api_key(db, x_api_key)
    return project


def membership_for(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectMember | None:
    return (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        .populate_existing()
        .first()
    )


def project_access(
    project_id: Annotated[str, Path(description="Project UUID or immutable slug")],
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> Project:
    """API key for its own project, or a session member. Non-members get 404."""
    raw = x_api_key
    if raw:
        _, project = _resolve_api_key(db, raw)
        resolved = resolve_project_ref(db, project_id)
        if project.id != resolved.id:
            raise HTTPException(status_code=404, detail="Project not found")
        return resolved

    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    _bind_user_activity(db, user)
    resolved = resolve_project_ref(db, project_id)
    if membership_for(db, resolved.id, user.id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return resolved


@dataclass(frozen=True)
class MemberAccess:
    project: Project
    user: User
    member: ProjectMember


def _member_access(
    db: Session, project_ref: str, user: User, *, for_write: bool = False
) -> MemberAccess:
    _bind_user_activity(db, user)
    project = resolve_project_ref(db, project_ref)
    if for_write:
        # Hold the lifecycle lock from fresh authorization through commit or
        # rollback, so removal/demotion cannot precede an authorized write.
        lock_project(db, project.id)
    member = membership_for(db, project.id, user.id)
    if member is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return MemberAccess(project=project, user=user, member=member)


def _reject_api_key(db: Session, project_ref: str, raw_key: str) -> None:
    """Keys can do catalog work only. Mismatch stays 404 so existence does not leak."""
    _, key_project = _resolve_api_key(db, raw_key)
    resolved = resolve_project_ref(db, project_ref)
    if key_project.id != resolved.id:
        raise HTTPException(status_code=404, detail="Project not found")
    raise HTTPException(status_code=403, detail="API keys cannot perform this action")


def member_api(
    project_id: Annotated[str, Path(description="Project UUID or immutable slug")],
    db: Session = Depends(get_db),
    x_locale_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> MemberAccess:
    """Member read for a session user. API keys cannot call member APIs."""
    if x_api_key:
        _reject_api_key(db, project_id, x_api_key)
    user = _require_session_user(db, x_locale_session)
    return _member_access(db, project_id, user)


def session_admin(
    project_id: Annotated[str, Path(description="Project UUID or immutable slug")],
    db: Session = Depends(get_db),
    x_locale_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> MemberAccess:
    """Session Admin. Editors get 403, non-members 404, API keys 403."""
    if x_api_key:
        _reject_api_key(db, project_id, x_api_key)
    access = _member_access(
        db, project_id, _require_session_user(db, x_locale_session), for_write=True
    )
    if access.member.role != MemberRole.admin:
        raise HTTPException(status_code=403, detail="Admin role required")
    return access


# Type aliases for Annotated Depends
CurrentUser = Annotated[User, Depends(current_user)]
ProjectFromApiKey = Annotated[Project, Depends(project_from_api_key)]
ProjectAccess = Annotated[Project, Depends(project_access)]
MemberApi = Annotated[MemberAccess, Depends(member_api)]
SessionMemberNoKey = MemberApi
SessionAdmin = Annotated[MemberAccess, Depends(session_admin)]
