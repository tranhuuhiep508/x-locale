"""OIDC user upsert and session cookie helpers."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Response
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.auth import SESSION_COOKIE, SESSION_TTL_HOURS, create_session_token
from app.models import User


def upsert_oidc_user(
    db: Session,
    *,
    issuer: str,
    sub: str,
    email: str,
    name: str,
    avatar: str | None,
) -> User:
    user = (
        db.query(User)
        .filter(User.oidc_issuer == issuer, User.oidc_sub == sub)
        .first()
    )
    if user:
        user.email = email
        user.name = name
        user.avatar_url = avatar
        user.last_login_at = datetime.now(UTC)
    else:
        user = User(
            email=email,
            name=name,
            avatar_url=avatar,
            oidc_issuer=issuer,
            oidc_sub=sub,
            last_login_at=datetime.now(UTC),
        )
        db.add(user)
    db.commit()
    db.refresh(user)
    return user


def attach_session(response: Response, user: User) -> None:
    token = create_session_token(user)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_TTL_HOURS * 3600,
        path="/",
    )


def login_redirect(user: User) -> RedirectResponse:
    response = RedirectResponse(url="/", status_code=302)
    attach_session(response, user)
    return response


def clear_session(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
