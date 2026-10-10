"""OIDC claim mapping and Microsoft /common issuer checks."""

from __future__ import annotations

import pytest

from app.oidc import (
    CONSUMERS_TENANT_ID,
    OidcProfileError,
    is_allowed_issuer,
    map_oidc_profile,
)

COMMON = "https://login.microsoftonline.com/common/v2.0"
WORK_ISS = "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0"
PERSONAL_ISS = f"https://login.microsoftonline.com/{CONSUMERS_TENANT_ID}/v2.0"


def test_is_allowed_issuer_accepts_tenant_and_consumers():
    assert is_allowed_issuer(WORK_ISS, COMMON)
    assert is_allowed_issuer(PERSONAL_ISS, COMMON)
    assert is_allowed_issuer(COMMON, COMMON)


def test_is_allowed_issuer_rejects_unrelated():
    assert not is_allowed_issuer("https://evil.example/v2.0", COMMON)
    assert not is_allowed_issuer("https://login.microsoftonline.com/common/v2.0", WORK_ISS)
    assert not is_allowed_issuer("", COMMON)
    assert not is_allowed_issuer("https://login.microsoftonline.com/not-a-guid/v2.0", COMMON)


def test_map_oidc_profile_email_fallback_preferred_username():
    profile = map_oidc_profile(
        {
            "iss": WORK_ISS,
            "sub": "abc",
            "preferred_username": "ada@contoso.com",
            "name": "Ada Lovelace",
        },
        configured_issuer=COMMON,
    )
    assert profile.email == "ada@contoso.com"
    assert profile.name == "Ada Lovelace"
    assert profile.issuer == WORK_ISS
    assert profile.sub == "abc"
    assert profile.avatar is None


def test_map_oidc_profile_email_fallback_upn():
    profile = map_oidc_profile(
        {"iss": WORK_ISS, "sub": "abc", "upn": "ada@contoso.com"},
        configured_issuer=COMMON,
    )
    assert profile.email == "ada@contoso.com"
    assert profile.name == "ada@contoso.com"


def test_map_oidc_profile_prefers_email_claim():
    profile = map_oidc_profile(
        {
            "iss": PERSONAL_ISS,
            "sub": "ms-sub",
            "email": "ada@outlook.com",
            "preferred_username": "ada@outlook.com",
        },
        configured_issuer=COMMON,
    )
    assert profile.email == "ada@outlook.com"
    assert profile.issuer == PERSONAL_ISS


def test_map_oidc_profile_rejects_common_as_stored_issuer_without_token_iss():
    with pytest.raises(OidcProfileError, match="missing iss"):
        map_oidc_profile({"sub": "abc", "email": "a@b.c"}, configured_issuer=COMMON)


def test_map_oidc_profile_rejects_overlong_claims():
    long_issuer = "https://issuer.example/" + ("a" * 500)
    with pytest.raises(OidcProfileError, match="issuer must be at most 512"):
        map_oidc_profile(
            {"iss": long_issuer, "sub": "abc", "email": "a@b.c"},
            configured_issuer=long_issuer,
        )
    with pytest.raises(OidcProfileError, match="sub must be at most 512"):
        map_oidc_profile(
            {"iss": WORK_ISS, "sub": "s" * 513, "email": "a@b.c"},
            configured_issuer=COMMON,
        )
    with pytest.raises(OidcProfileError, match="email must be at most 320"):
        map_oidc_profile(
            {"iss": WORK_ISS, "sub": "abc", "email": "e" * 321},
            configured_issuer=COMMON,
        )
    with pytest.raises(OidcProfileError, match="name must be at most 255"):
        map_oidc_profile(
            {"iss": WORK_ISS, "sub": "abc", "email": "a@b.c", "name": "n" * 256},
            configured_issuer=COMMON,
        )
    with pytest.raises(OidcProfileError, match="avatar must be at most 1024"):
        map_oidc_profile(
            {
                "iss": WORK_ISS,
                "sub": "abc",
                "email": "a@b.c",
                "picture": "https://cdn.example/" + ("a" * 1100),
            },
            configured_issuer=COMMON,
        )


def test_map_oidc_profile_rejects_bad_issuer():
    with pytest.raises(OidcProfileError, match="Rejected"):
        map_oidc_profile(
            {"iss": "https://accounts.google.com", "sub": "abc"},
            configured_issuer=COMMON,
        )
