"""OIDC auth routes + session management."""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlencode

import httpx
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.auth import (
    SESSION_COOKIE,
    create_session_token,
    current_user,
    get_or_create_dev_user,
)
from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

oauth = OAuth()


def _configure_oauth() -> None:
    if settings.oidc_configured and "oidc" not in oauth._clients:
        oauth.register(
            name="oidc",
            client_id=settings.oidc_client_id,
            client_secret=settings.oidc_client_secret,
            server_metadata_url=f"{settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration",
            client_kwargs={"scope": settings.oidc_scopes},
        )


@router.get("/login")
async def login(request: Request, db: Session = Depends(get_db)):
    if settings.auth_dev_bypass and not settings.oidc_configured:
        user = get_or_create_dev_user(db)
        db.commit()
        token = create_session_token(user)
        # Redirect to frontend
        response = RedirectResponse(url="/", status_code=302)
        response.set_cookie(
            SESSION_COOKIE,
            token,
            httponly=True,
            samesite="lax",
            max_age=72 * 3600,
            path="/",
        )
        return response

    if not settings.oidc_configured:
        raise HTTPException(status_code=503, detail="OIDC is not configured")

    _configure_oauth()
    redirect_uri = settings.oidc_redirect_url
    return await oauth.oidc.authorize_redirect(request, redirect_uri)


@router.get("/callback")
async def callback(request: Request, db: Session = Depends(get_db)):
    if not settings.oidc_configured:
        raise HTTPException(status_code=503, detail="OIDC is not configured")

    _configure_oauth()
    try:
        token = await oauth.oidc.authorize_access_token(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"OIDC callback failed: {exc}") from exc

    userinfo = token.get("userinfo")
    if not userinfo:
        # Fetch userinfo manually
        async with httpx.AsyncClient() as client:
            meta = await oauth.oidc.load_server_metadata()
            resp = await client.get(
                meta["userinfo_endpoint"],
                headers={"Authorization": f"Bearer {token['access_token']}"},
            )
            resp.raise_for_status()
            userinfo = resp.json()

    issuer = settings.oidc_issuer.rstrip("/")
    sub = userinfo["sub"]
    email = userinfo.get("email") or f"{sub}@unknown"
    name = userinfo.get("name") or userinfo.get("preferred_username") or email
    avatar = userinfo.get("picture")

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

    session_token = create_session_token(user)
    response = RedirectResponse(url="/", status_code=302)
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        httponly=True,
        samesite="lax",
        max_age=72 * 3600,
        path="/",
    )
    return response


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> User:
    return user
