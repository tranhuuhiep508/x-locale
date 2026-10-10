from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import require_postgres_database_url, settings
from app.database import DbSession, register_activity_listener
from app.routers import (
    activities,
    auth,
    batch,
    bootstrap,
    jobs,
    languages,
    modules,
    projects,
    strings,
    sync,
    tags,
    translate,
)
from app.services.catalog import is_module_project_fk_error

require_postgres_database_url(settings.database_url)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate_for_runtime()
    register_activity_listener()
    yield


_api_docs = "/docs" if settings.dev_bypass_active else None
_api_redoc = "/redoc" if settings.dev_bypass_active else None
_api_openapi = "/openapi.json" if settings.dev_bypass_active else None

app = FastAPI(
    title="x-locale API",
    version="0.2.0",
    lifespan=lifespan,
    docs_url=_api_docs,
    redoc_url=_api_redoc,
    openapi_url=_api_openapi,
)

# SessionMiddleware required by Authlib OIDC authorize_redirect
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.x_locale_secret,
    https_only=settings.cookies_secure,
)

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Outermost: compress the finished response. Level 1 favors latency over ratio.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=1)

app.include_router(auth.router, prefix="/api")
app.include_router(bootstrap.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(languages.router, prefix="/api")
app.include_router(modules.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(strings.router, prefix="/api")
app.include_router(batch.router, prefix="/api")
app.include_router(translate.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(activities.router, prefix="/api")
app.include_router(sync.router, prefix="/api")


@app.exception_handler(IntegrityError)
async def module_project_fk_handler(_request: Request, exc: IntegrityError) -> JSONResponse:
    """Deferred composite module FKs are checked at commit, not at flush.

    An explicit project check should already have returned 400. This is the
    safety net so a missed call site cannot surface as a database 500.
    """
    if is_module_project_fk_error(exc):
        return JSONResponse(status_code=400, content={"detail": "Unknown module"})
    raise exc


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health")
def api_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/healthcheck/liveness", tags=["healthcheck"])
def liveness(response: Response) -> dict[str, str]:
    """Check that the app can respond, independently of its database."""
    response.headers["Cache-Control"] = "no-store"
    return {"status": "ok"}


@app.get(
    "/healthcheck/readiness",
    tags=["healthcheck"],
    responses={503: {"description": "Database unavailable"}},
)
def readiness(db: DbSession, response: Response) -> dict[str, str]:
    """Check database connectivity before accepting traffic."""
    response.headers["Cache-Control"] = "no-store"
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        response.status_code = 503
        return {"status": "not_ready"}
    return {"status": "ok"}


static_directory = settings.static_directory
if static_directory is not None:
    app.frontend("/", directory=str(static_directory))
