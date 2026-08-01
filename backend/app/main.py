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
    jobs,
    languages,
    modules,
    projects,
    snapshots,
    strings,
    sync,
    tags,
    translate,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    register_activity_listener()
    yield


app = FastAPI(title="TMS API", version="0.2.0", lifespan=lifespan)

# SessionMiddleware required by Authlib OIDC authorize_redirect
app.add_middleware(SessionMiddleware, secret_key=settings.tms_secret)

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

api = FastAPI(title="TMS API", version="0.2.0")
# Mount routers under /api via a sub-app OR include with prefix.
# Using include_router with prefix keeps OpenAPI under /api/openapi.json too if we want.
# Simpler: include all with prefix="/api"

app.include_router(auth.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(languages.router, prefix="/api")
app.include_router(modules.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(strings.router, prefix="/api")
app.include_router(batch.router, prefix="/api")
app.include_router(translate.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(activities.router, prefix="/api")
app.include_router(snapshots.router, prefix="/api")
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
