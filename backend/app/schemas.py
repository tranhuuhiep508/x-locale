from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models import TranslationStatus


class TranslationOut(BaseModel):
    locale: str
    value: str
    status: TranslationStatus
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class StringOut(BaseModel):
    id: UUID
    key: str
    source_text: str
    description: str | None
    updated_at: datetime | None
    translations: list[TranslationOut]

    model_config = {"from_attributes": True}


class StringCreate(BaseModel):
    key: str = Field(min_length=1, max_length=512)
    source_text: str = Field(min_length=1)
    description: str | None = None


class StringUpdate(BaseModel):
    source_text: str | None = None
    description: str | None = None


class TranslationUpdate(BaseModel):
    value: str
    status: TranslationStatus | None = None


class ImportPayload(BaseModel):
    strings: dict[str, str]


class ProjectOut(BaseModel):
    id: UUID
    name: str
    base_language: str
    target_languages: list[str]
    string_count: int = 0

    model_config = {"from_attributes": True}


class TranslateMissingResult(BaseModel):
    translated_count: int
    locales: list[str]
