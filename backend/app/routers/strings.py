from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.ai import translate_text
from app.auth import get_project_by_api_key
from app.database import get_db
from app.models import Project, StringEntry, Translation, TranslationStatus
from app.schemas import (
    ProjectOut,
    StringCreate,
    StringOut,
    StringUpdate,
    TranslateMissingResult,
    TranslationOut,
    TranslationUpdate,
)

router = APIRouter(prefix="/projects", tags=["strings"])


def _serialize_string(entry: StringEntry) -> StringOut:
    return StringOut(
        id=entry.id,
        key=entry.key,
        source_text=entry.source_text,
        description=entry.description,
        updated_at=entry.updated_at,
        translations=[
            TranslationOut(
                locale=t.locale,
                value=t.value,
                status=t.status,
                updated_at=t.updated_at,
            )
            for t in entry.translations
        ],
    )


def _get_string_or_404(db: Session, project_id: UUID, key: str) -> StringEntry:
    entry = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations))
        .filter(StringEntry.project_id == project_id, StringEntry.key == key)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail=f"String '{key}' not found")
    return entry


def _ensure_translation_rows(db: Session, entry: StringEntry, project: Project) -> None:
    existing = {t.locale for t in entry.translations}
    for locale in project.target_languages:
        if locale not in existing:
            db.add(
                Translation(
                    string_id=entry.id,
                    locale=locale,
                    value="",
                    status=TranslationStatus.draft,
                )
            )


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: UUID,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> ProjectOut:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")
    count = db.query(StringEntry).filter(StringEntry.project_id == project.id).count()
    return ProjectOut(
        id=project.id,
        name=project.name,
        base_language=project.base_language,
        target_languages=project.target_languages,
        string_count=count,
    )


@router.get("/{project_id}/strings", response_model=list[StringOut])
def list_strings(
    project_id: UUID,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> list[StringOut]:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")

    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations))
        .filter(StringEntry.project_id == project.id)
        .order_by(StringEntry.key)
        .all()
    )
    return [_serialize_string(entry) for entry in entries]


@router.post("/{project_id}/strings", response_model=StringOut, status_code=201)
def create_string(
    project_id: UUID,
    payload: StringCreate,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> StringOut:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")

    existing = (
        db.query(StringEntry)
        .filter(StringEntry.project_id == project.id, StringEntry.key == payload.key)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"String '{payload.key}' already exists")

    entry = StringEntry(
        project_id=project.id,
        key=payload.key,
        source_text=payload.source_text,
        description=payload.description,
    )
    db.add(entry)
    db.flush()
    _ensure_translation_rows(db, entry, project)
    db.commit()
    db.refresh(entry)
    entry = _get_string_or_404(db, project.id, entry.key)
    return _serialize_string(entry)


@router.patch("/{project_id}/strings/{key}", response_model=StringOut)
def update_string(
    project_id: UUID,
    key: str,
    payload: StringUpdate,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> StringOut:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")

    entry = _get_string_or_404(db, project.id, key)
    if payload.source_text is not None:
        entry.source_text = payload.source_text
    if payload.description is not None:
        entry.description = payload.description
    db.commit()
    entry = _get_string_or_404(db, project.id, key)
    return _serialize_string(entry)


@router.patch("/{project_id}/strings/{key}/{locale}", response_model=StringOut)
def update_translation(
    project_id: UUID,
    key: str,
    locale: str,
    payload: TranslationUpdate,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> StringOut:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")

    entry = _get_string_or_404(db, project.id, key)
    translation = next((t for t in entry.translations if t.locale == locale), None)
    if not translation:
        if locale not in project.target_languages and locale != project.base_language:
            raise HTTPException(status_code=400, detail=f"Locale '{locale}' is not configured for this project")
        translation = Translation(string_id=entry.id, locale=locale, value=payload.value)
        db.add(translation)
    else:
        translation.value = payload.value
    if payload.status is not None:
        translation.status = payload.status
    db.commit()
    entry = _get_string_or_404(db, project.id, key)
    return _serialize_string(entry)


@router.post("/{project_id}/strings/{key}/translate", response_model=TranslateMissingResult)
def translate_string(
    project_id: UUID,
    key: str,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> TranslateMissingResult:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")

    entry = _get_string_or_404(db, project.id, key)
    _ensure_translation_rows(db, entry, project)
    db.flush()
    entry = _get_string_or_404(db, project.id, key)

    translated_count = 0
    for locale in project.target_languages:
        translation = next((t for t in entry.translations if t.locale == locale), None)
        if translation is None or translation.value.strip():
            continue

        try:
            translation.value = translate_text(
                entry.source_text,
                project.base_language,
                locale,
                entry.description,
            )
            translation.status = TranslationStatus.live
            translated_count += 1
        except ValueError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"AI translation failed: {exc}") from exc

    db.commit()
    return TranslateMissingResult(translated_count=translated_count, locales=project.target_languages)


@router.delete("/{project_id}/strings/{key}", status_code=204)
def delete_string(
    project_id: UUID,
    key: str,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> None:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")

    entry = _get_string_or_404(db, project.id, key)
    db.delete(entry)
    db.commit()
