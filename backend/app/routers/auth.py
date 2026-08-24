"""OIDC auth routes + session management."""

from __future__ import annotations

from typing import Annotated

import httpx
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_or_create_dev_user
from app.config import settings
from app.database import get_db
from app.models import User
from app.oidc import OidcProfileError, map_oidc_profile, oidc_iss_claims_options
from app.schemas import UserOut
from app.services.auth import clear_session, login_redirect, upsert_oidc_user

router = APIRouter(prefix="/auth", tags=["auth"])

oauth = OAuth()


def _configure_oauth() -> None:
    if settings.oidc_configured and "oidc" not in oauth._clients:
        oauth.register(
            name="oidc",
            client_id=settings.oidc_client_id,
            client_secret=settings.oidc_client_secret,
            server_metadata_url=(
                f"{settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration"
            ),
            client_kwargs={
                "scope": settings.oidc_scopes,
                "token_endpoint_auth_method": "client_secret_post",
            },
        )


@router.get("/login")
async def login(request: Request, db: Annotated[Session, Depends(get_db)]):
    if settings.dev_bypass_active:
        user = get_or_create_dev_user(db)
        db.commit()
        return login_redirect(user)

    if not settings.oidc_configured:
        raise HTTPException(status_code=503, detail="OIDC is not configured")

    _configure_oauth()
    redirect_uri = settings.oidc_redirect_url
    return await oauth.oidc.authorize_redirect(request, redirect_uri)


@router.get("/callback")
async def callback(request: Request, db: Annotated[Session, Depends(get_db)]):
    if not settings.oidc_configured:
        raise HTTPException(status_code=503, detail="OIDC is not configured")

    _configure_oauth()
    try:
        token = await oauth.oidc.authorize_access_token(
            request,
            claims_options=oidc_iss_claims_options(settings.oidc_issuer),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"OIDC callback failed: {exc}") from exc

    userinfo = token.get("userinfo")
    if not userinfo:
        async with httpx.AsyncClient() as client:
            meta = await oauth.oidc.load_server_metadata()
            resp = await client.get(
                meta["userinfo_endpoint"],
                headers={"Authorization": f"Bearer {token['access_token']}"},
            )
            resp.raise_for_status()
            userinfo = resp.json()

    try:
        profile = map_oidc_profile(userinfo, configured_issuer=settings.oidc_issuer)
    except OidcProfileError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user = upsert_oidc_user(
        db,
        issuer=profile.issuer,
        sub=profile.sub,
        email=profile.email,
        name=profile.name,
        avatar=profile.avatar,
    )
    return login_redirect(user)


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    clear_session(response)
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user
