from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.auth import get_project_by_api_key
from app.config import settings
from app.database import Base, engine, get_db
from app.models import Project
from app.routers import strings, sync
from app.schemas import ProjectOut
from app.seed import seed_demo_data


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed_demo_data()
    yield


app = FastAPI(title="TMS API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(strings.router)
app.include_router(sync.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/bootstrap/project", response_model=ProjectOut)
def bootstrap_project(
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> ProjectOut:
    from app.models import StringEntry

    count = db.query(StringEntry).filter(StringEntry.project_id == project.id).count()
    return ProjectOut(
        id=project.id,
        name=project.name,
        base_language=project.base_language,
        target_languages=project.target_languages,
        string_count=count,
    )
