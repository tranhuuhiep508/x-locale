"""OIDC helpers: Microsoft Entra /common issuer checks and claim mapping."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.limits import (
    AVATAR_URL_MAX_LENGTH,
    EMAIL_MAX_LENGTH,
    OIDC_ISSUER_MAX_LENGTH,
    OIDC_SUB_MAX_LENGTH,
    USER_NAME_MAX_LENGTH,
)

# Personal Microsoft accounts (Outlook/Hotmail/Xbox) use this Entra tenant.
CONSUMERS_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad"

ENTRA_TENANT_ISS = re.compile(
    r"^https://login\.microsoftonline\.com/"
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    r"/v2\.0$"
)

MICROSOFT_MULTI_TENANT_ISSUERS = frozenset(
    {
        "https://login.microsoftonline.com/common/v2.0",
        "https://login.microsoftonline.com/organizations/v2.0",
        "https://login.microsoftonline.com/consumers/v2.0",
    }
)


def normalize_issuer(issuer: str) -> str:
    return issuer.rstrip("/")


def is_allowed_issuer(iss: str, configured_issuer: str) -> bool:
    """Accept the configured issuer, or any Entra tenant iss when using /common."""
    iss_n = normalize_issuer(iss or "")
    configured = normalize_issuer(configured_issuer or "")
    if not iss_n:
        return False
    if iss_n == configured:
        return True
    if configured in MICROSOFT_MULTI_TENANT_ISSUERS:
        return bool(ENTRA_TENANT_ISS.fullmatch(iss_n))
    return False


def oidc_iss_claims_options(configured_issuer: str) -> dict[str, dict[str, Any]]:
    """Authlib claims_options that do not require iss == metadata issuer (/common)."""

    def _validate(_claims: Any, value: str) -> bool:
        return is_allowed_issuer(value, configured_issuer)

    return {"iss": {"essential": True, "validate": _validate}}


@dataclass(frozen=True)
class OidcProfile:
    issuer: str
    sub: str
    email: str
    name: str
    avatar: str | None


class OidcProfileError(ValueError):
    pass


def _bounded(value: str, *, field: str, limit: int) -> str:
    if len(value) > limit:
        raise OidcProfileError(f"{field} must be at most {limit} characters")
    return value


def map_oidc_profile(claims: Mapping[str, Any], *, configured_issuer: str) -> OidcProfile:
    configured = normalize_issuer(configured_issuer)
    raw_iss = claims.get("iss")
    iss = normalize_issuer(str(raw_iss)) if raw_iss else ""
    if not iss:
        if configured in MICROSOFT_MULTI_TENANT_ISSUERS:
            raise OidcProfileError("OIDC token missing iss")
        iss = configured
    if not is_allowed_issuer(iss, configured):
        raise OidcProfileError(f"Rejected OIDC issuer: {iss}")
    sub = claims.get("sub")
    if not sub:
        raise OidcProfileError("OIDC token missing sub")
    email = claims.get("email") or claims.get("preferred_username") or claims.get("upn")
    if not email:
        email = f"{sub}@unknown"
    name = claims.get("name") or claims.get("preferred_username") or email
    picture = claims.get("picture")
    avatar = str(picture) if picture else None
    return OidcProfile(
        issuer=_bounded(iss, field="issuer", limit=OIDC_ISSUER_MAX_LENGTH),
        sub=_bounded(str(sub), field="sub", limit=OIDC_SUB_MAX_LENGTH),
        email=_bounded(str(email), field="email", limit=EMAIL_MAX_LENGTH),
        name=_bounded(str(name), field="name", limit=USER_NAME_MAX_LENGTH),
        avatar=(
            _bounded(avatar, field="avatar", limit=AVATAR_URL_MAX_LENGTH) if avatar else None
        ),
    )
