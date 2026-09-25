from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.database import register_activity_listener
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health")
def api_health() -> dict[str, str]:
    return {"status": "ok"}


static_directory = settings.static_directory
if static_directory is not None:
    app.frontend("/", directory=str(static_directory))
