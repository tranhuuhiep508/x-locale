"""Language catalog."""

from fastapi import APIRouter

from app.languages import LANGUAGES
from app.schemas import LanguageOut

router = APIRouter(prefix="/languages", tags=["languages"])


@router.get("", response_model=list[LanguageOut])
def list_languages() -> list[LanguageOut]:
    return [LanguageOut(**lang) for lang in LANGUAGES]
