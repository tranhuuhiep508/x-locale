from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models import ProjectLayout, TranslationStatus


# ── Auth ──────────────────────────────────────────────────────────────


class UserOut(BaseModel):
    id: UUID
    email: str
    name: str
    avatar_url: str | None = None

    model_config = {"from_attributes": True}


# ── Languages ─────────────────────────────────────────────────────────


class LanguageOut(BaseModel):
    code: str
    name: str


# ── Projects ──────────────────────────────────────────────────────────


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str | None = Field(default=None, max_length=128)
    base_language: str | None = None
    target_languages: list[str] = Field(default_factory=list)
    layout: ProjectLayout = ProjectLayout.flat


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    slug: str | None = None
    base_language: str | None = None
    target_languages: list[str] | None = None
    layout: ProjectLayout | None = None


class ProjectOut(BaseModel):
    id: UUID
    name: str
    slug: str
    base_language: str
    target_languages: list[str]
    layout: ProjectLayout
    string_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ApiKeyOut(BaseModel):
    id: UUID
    name: str
    key_prefix: str
    created_at: datetime | None = None
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None

    model_config = {"from_attributes": True}


class ApiKeyCreated(ApiKeyOut):
    key: str  # raw key, shown once


# ── Modules ───────────────────────────────────────────────────────────


class ModuleCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=128, pattern=r"^[a-z][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    position: int = 0


class ModuleUpdate(BaseModel):
    slug: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_-]*$")
    name: str | None = None
    description: str | None = None
    position: int | None = None


class ModuleOut(BaseModel):
    id: UUID
    slug: str
    name: str
    description: str | None
    position: int
    string_count: int = 0

    model_config = {"from_attributes": True}


# ── Tags ──────────────────────────────────────────────────────────────


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    color: str = Field(default="#64748b", max_length=32)


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class TagOut(BaseModel):
    id: UUID
    name: str
    color: str
    string_count: int = 0

    model_config = {"from_attributes": True}


# ── Strings / Translations ────────────────────────────────────────────


class TranslationOut(BaseModel):
    id: UUID | None = None
    locale: str
    value: str
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class StringOut(BaseModel):
    id: UUID
    key: str
    source_text: str
    description: str | None
    status: TranslationStatus
    module_id: UUID | None = None
    module_slug: str | None = None
    tags: list[TagOut] = Field(default_factory=list)
    updated_at: datetime | None = None
    translations: list[TranslationOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class StringCreate(BaseModel):
    key: str = Field(min_length=1, max_length=512)
    source_text: str = Field(min_length=1)
    description: str | None = None
    module_id: UUID | None = None
    tag_ids: list[UUID] = Field(default_factory=list)
    status: TranslationStatus = TranslationStatus.draft
    translations: dict[str, str] = Field(default_factory=dict)


class StringUpdate(BaseModel):
    key: str | None = None
    source_text: str | None = None
    description: str | None = None
    module_id: UUID | None = None
    tag_ids: list[UUID] | None = None
    status: TranslationStatus | None = None
    translations: dict[str, str] | None = None


class TranslationUpdate(BaseModel):
    value: str


class StringListOut(BaseModel):
    items: list[StringOut]
    total: int
    page: int
    page_size: int


# ── Batch ─────────────────────────────────────────────────────────────


class BatchFilter(BaseModel):
    module_id: UUID | None = None
    tag_id: UUID | None = None
    q: str | None = None
    missing_locale: str | None = None
    status: TranslationStatus | None = None


class BatchRequest(BaseModel):
    action: Literal["publish", "unpublish", "delete", "move_module", "add_tags", "remove_tags"]
    string_ids: list[UUID] | None = None
    filter: BatchFilter | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class BatchResult(BaseModel):
    affected: int
    batch_id: UUID


# ── Translate ─────────────────────────────────────────────────────────


class TranslateRequest(BaseModel):
    scope: Literal["missing", "strings", "module", "tag"] = "missing"
    string_ids: list[UUID] | None = None
    module_id: UUID | None = None
    tag_id: UUID | None = None
    locales: list[str] | None = None
    overwrite: bool = False


class TranslateResult(BaseModel):
    translated_count: int
    locales: list[str]
    job_id: UUID | None = None


class TranslatePreviewRequest(BaseModel):
    source_text: str = Field(min_length=1)
    description: str | None = None
    locales: list[str] | None = None


class TranslatePreviewResult(BaseModel):
    translations: dict[str, str]


class JobOut(BaseModel):
    id: UUID
    kind: str
    status: str
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Import / Export ───────────────────────────────────────────────────


class ImportPayload(BaseModel):
    strings: dict[str, str] | None = None
    modules: dict[str, dict[str, dict[str, str]]] | None = None


class ImportDiff(BaseModel):
    create: list[str] = Field(default_factory=list)
    update: list[str] = Field(default_factory=list)
    orphan: list[str] = Field(default_factory=list)
    create_count: int = 0
    update_count: int = 0
    orphan_count: int = 0


class ImportResult(BaseModel):
    created: int = 0
    updated: int = 0
    total: int = 0
    dry_run: bool = False
    diff: ImportDiff | None = None
    batch_id: UUID | None = None


# ── Activities ────────────────────────────────────────────────────────


class ActivityOut(BaseModel):
    id: UUID
    actor_type: str
    actor_id: str | None
    actor_label: str
    action: str
    entity_type: str
    entity_id: str
    string_id: UUID | None
    locale: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    summary: str
    batch_id: UUID | None
    batch_kind: str | None
    revert_of_id: UUID | None
    reverted_by_id: UUID | None
    is_revertible: bool
    created_at: datetime | None

    model_config = {"from_attributes": True}


class ActivityListOut(BaseModel):
    items: list[ActivityOut]
    total: int
    page: int
    page_size: int
