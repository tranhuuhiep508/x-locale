"""Same-origin CSRF protection for cookie-authenticated writes."""

from __future__ import annotations

from urllib.parse import urlsplit

from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.requests import cookie_parser
from starlette.types import ASGIApp, Receive, Scope, Send

from app.auth import SESSION_COOKIE
from app.config import settings

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
CSRF_FORBIDDEN_DETAIL = "Cross-origin request blocked"


def _normalize_origin(value: str) -> str | None:
    raw = value.strip()
    if not raw or raw == "*" or raw.lower() == "null":
        return None
    try:
        parsed = urlsplit(raw)
        scheme = parsed.scheme.lower()
        if scheme not in {"http", "https"}:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        hostname = parsed.hostname
        if not hostname:
            return None
        port = parsed.port
    except ValueError:
        return None
    host = f"[{hostname.lower()}]" if ":" in hostname else hostname.lower()
    if port is None or (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        return f"{scheme}://{host}"
    return f"{scheme}://{host}:{port}"


def _request_origin(scope: Scope, headers: Headers) -> str | None:
    scheme = "https" if settings.cookies_secure else (scope.get("scheme") or "http").lower()
    host = (headers.get("host") or "").strip()
    if not host:
        server = scope.get("server")
        if server and len(server) >= 2:
            server_host, server_port = server[0], server[1]
            if ":" in server_host and not server_host.startswith("["):
                server_host = f"[{server_host}]"
            host = f"{server_host}:{server_port}" if server_port else server_host
    if not host:
        return None
    return _normalize_origin(f"{scheme}://{host}")


def _allowed_cors_origins() -> set[str]:
    origins: set[str] = set()
    for raw in settings.cors_origin_list:
        normalized = _normalize_origin(raw)
        if normalized is not None:
            origins.add(normalized)
    return origins


def _allowed_same_origins(scope: Scope, headers: Headers) -> set[str]:
    origins = _allowed_cors_origins()
    request_origin = _request_origin(scope, headers)
    if request_origin is not None:
        origins.add(request_origin)
    if settings.oidc_configured:
        oidc_origin = _normalize_origin(settings.oidc_redirect_url)
        if oidc_origin is not None:
            origins.add(oidc_origin)
    return origins


def _is_allowed_csrf_request(scope: Scope, headers: Headers) -> bool:
    sec_fetch_site = (headers.get("sec-fetch-site") or "").strip().lower()
    origin = (headers.get("origin") or "").strip()
    referer = (headers.get("referer") or "").strip()

    if sec_fetch_site:
        if sec_fetch_site in {"same-origin", "none"}:
            return True
        return bool(origin) and _normalize_origin(origin) in _allowed_cors_origins()

    if origin:
        return _normalize_origin(origin) in _allowed_same_origins(scope, headers)
    if referer:
        return _normalize_origin(referer) in _allowed_same_origins(scope, headers)
    return True


class SameOriginCsrfMiddleware:
    """Reject cross-origin cookie-authenticated non-safe HTTP requests."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method", "").upper() in SAFE_METHODS:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        cookies = cookie_parser("; ".join(headers.getlist("cookie")))
        has_session_cookie = bool(cookies.get(SESSION_COOKIE))
        has_api_key = bool((headers.get("x-api-key") or "").strip())

        if not has_session_cookie and not (settings.dev_bypass_active and not has_api_key):
            await self.app(scope, receive, send)
            return

        if _is_allowed_csrf_request(scope, headers):
            await self.app(scope, receive, send)
            return

        response = JSONResponse(
            status_code=403,
            content={"detail": CSRF_FORBIDDEN_DETAIL},
        )
        await response(scope, receive, send)
