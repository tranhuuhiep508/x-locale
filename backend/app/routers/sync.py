from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.ai import translate_text
from app.auth import get_project_by_api_key
from app.database import get_db
from app.models import Project, StringEntry, Translation, TranslationStatus
from app.schemas import ImportPayload, TranslateMissingResult

router = APIRouter(prefix="/projects", tags=["sync"])


def _build_locale_map(project: Project, entries: list[StringEntry], locale: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for entry in entries:
        if locale == project.base_language:
            result[entry.key] = entry.source_text
            continue
        translation = next((t for t in entry.translations if t.locale == locale), None)
        if translation and translation.value:
            result[entry.key] = translation.value
    return result


@router.get("/{project_id}/translations.json")
def export_all_translations(
    project_id: UUID,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> dict[str, dict[str, str]]:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")

    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations))
        .filter(StringEntry.project_id == project.id)
        .order_by(StringEntry.key)
        .all()
    )

    all_locales = [project.base_language, *project.target_languages]
    return {locale: _build_locale_map(project, entries, locale) for locale in all_locales}


@router.post("/{project_id}/strings/import")
def import_strings(
    project_id: UUID,
    payload: ImportPayload,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")

    created = 0
    updated = 0

    for key, source_text in payload.strings.items():
        entry = (
            db.query(StringEntry)
            .options(joinedload(StringEntry.translations))
            .filter(StringEntry.project_id == project.id, StringEntry.key == key)
            .first()
        )
        if entry:
            if entry.source_text != source_text:
                entry.source_text = source_text
                updated += 1
        else:
            entry = StringEntry(
                project_id=project.id,
                key=key,
                source_text=source_text,
            )
            db.add(entry)
            db.flush()
            for locale in project.target_languages:
                db.add(
                    Translation(
                        string_id=entry.id,
                        locale=locale,
                        value="",
                        status=TranslationStatus.draft,
                    )
                )
            created += 1

    db.commit()
    return {"created": created, "updated": updated, "total": len(payload.strings)}


@router.post("/{project_id}/translate-missing", response_model=TranslateMissingResult)
def translate_missing(
    project_id: UUID,
    project: Project = Depends(get_project_by_api_key),
    db: Session = Depends(get_db),
) -> TranslateMissingResult:
    if project.id != project_id:
        raise HTTPException(status_code=404, detail="Project not found")

    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations))
        .filter(StringEntry.project_id == project.id)
        .all()
    )

    translated_count = 0
    for entry in entries:
        for locale in project.target_languages:
            translation = next((t for t in entry.translations if t.locale == locale), None)
            if translation is None:
                translation = Translation(
                    string_id=entry.id,
                    locale=locale,
                    value="",
                    status=TranslationStatus.draft,
                )
                db.add(translation)
                entry.translations.append(translation)

            if translation.value.strip():
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
