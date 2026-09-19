from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models import ProjectLayout, TranslationStatus
from app.timefmt import UtcDateTime

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
    created_at: UtcDateTime | None = None
    updated_at: UtcDateTime | None = None

    model_config = {"from_attributes": True}


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ApiKeyOut(BaseModel):
    id: UUID
    name: str
    key_prefix: str
    created_at: UtcDateTime | None = None
    last_used_at: UtcDateTime | None = None
    revoked_at: UtcDateTime | None = None

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

ConfidenceScore = Annotated[int, Field(ge=0, le=100)]


class TranslationOut(BaseModel):
    id: UUID | None = None
    locale: str
    value: str
    published_value: str | None = None
    confidence: int | None = None
    updated_at: UtcDateTime | None = None

    model_config = {"from_attributes": True}


class StringOut(BaseModel):
    id: UUID
    key: str
    source_text: str
    description: str | None
    status: TranslationStatus
    pending_delete: bool = False
    deleted_at: UtcDateTime | None = None
    has_unpublished_changes: bool = False
    published_at: UtcDateTime | None = None
    published_key: str | None = None
    published_source_text: str | None = None
    published_module_id: UUID | None = None
    published_module_slug: str | None = None
    module_id: UUID | None = None
    module_slug: str | None = None
    tags: list[TagOut] = Field(default_factory=list)
    created_at: UtcDateTime | None = None
    created_by_type: str | None = None
    created_by_label: str | None = None
    updated_at: UtcDateTime | None = None
    updated_by_type: str | None = None
    updated_by_label: str | None = None
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
    translation_scores: dict[str, ConfidenceScore] = Field(default_factory=dict)


class StringUpdate(BaseModel):
    key: str | None = None
    source_text: str | None = None
    description: str | None = None
    module_id: UUID | None = None
    tag_ids: list[UUID] | None = None
    status: TranslationStatus | None = None
    translations: dict[str, str] | None = None
    translation_scores: dict[str, ConfidenceScore] | None = None


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
    pending_delete: bool | None = None
    has_unpublished_changes: bool | None = None
    deleted: bool | None = None
    max_confidence: ConfidenceScore | None = None


class BatchRequest(BaseModel):
    action: Literal[
        "publish",
        "unpublish",
        "delete",
        "discard_changes",
        "discard_delete",
        "restore",
        "restore_last_history",
        "move_module",
        "add_tags",
        "remove_tags",
    ]
    string_ids: list[UUID] | None = None
    filter: BatchFilter | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    fingerprint: str | None = None


class BatchResult(BaseModel):
    affected: int
    batch_id: UUID


class PublishPreviewRequest(BaseModel):
    string_ids: list[UUID] | None = None
    filter: BatchFilter | None = None


class PublishPreviewEntriesOut(BaseModel):
    items: list[StringOut]
    fingerprint: str


# ── Translate ─────────────────────────────────────────────────────────


class TranslateRequest(BaseModel):
    scope: Literal["missing", "strings", "module", "tag"] = "missing"
    string_ids: list[UUID] | None = None
    module_id: UUID | None = None
    tag_id: UUID | None = None
    locales: list[str] | None = None
    overwrite: bool = False
    q: str | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=100)
    descriptions: dict[UUID, str] | None = None


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
    scores: dict[str, ConfidenceScore] = Field(default_factory=dict)


class TranslateProposalItem(BaseModel):
    string_id: UUID
    key: str
    source_text: str
    status: str
    description: str | None = None
    translations: dict[str, str]
    scores: dict[str, ConfidenceScore] = Field(default_factory=dict)


class TranslateProposalsResult(BaseModel):
    locales: list[str]
    items: list[TranslateProposalItem]
    job_id: UUID | None = None
    total: int = 0
    page: int = 1
    page_size: int = 50


class TranslateApplyItem(BaseModel):
    string_id: UUID
    translations: dict[str, str]
    scores: dict[str, ConfidenceScore] = Field(default_factory=dict)
    description: str | None = None


class TranslateApplyRequest(BaseModel):
    items: list[TranslateApplyItem] = Field(max_length=100)


class TranslateApplyResult(BaseModel):
    translated_count: int
    batch_id: UUID
    locales: list[str]


class TranslateJobProgress(BaseModel):
    phase: str
    chunks_done: int = 0
    chunks_total: int = 0


class JobOut(BaseModel):
    id: UUID
    kind: str
    status: str
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: UtcDateTime | None = None
    completed_at: UtcDateTime | None = None
    progress: TranslateJobProgress | None = None

    model_config = {"from_attributes": True}


# ── Import / Export ───────────────────────────────────────────────────


class ImportPayload(BaseModel):
    strings: dict[str, str] | None = None
    modules: dict[str, dict[str, dict[str, str]]] | None = None


class ImportDiffItem(BaseModel):
    key: str
    source_text: str


class ImportDiff(BaseModel):
    create: list[ImportDiffItem] = Field(default_factory=list)
    update: list[ImportDiffItem] = Field(default_factory=list)
    orphan: list[ImportDiffItem] = Field(default_factory=list)
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


class SyncStateOut(BaseModel):
    """Pending-remove and tombstone identities for CLI status."""

    stage: str
    layout: str
    base_language: str
    exported: list[str] = Field(default_factory=list)
    pending_remove: list[str] = Field(default_factory=list)
    tombstones: list[str] = Field(default_factory=list)


# ── Activities ────────────────────────────────────────────────────────


class ActivityChangeOut(BaseModel):
    field: str
    before: str | None = None
    after: str | None = None
    locale: str | None = None
    scope: Literal["draft", "published"] = "draft"
    kind: Literal["field", "translation", "tags"] = "field"


class ActivityCoreOut(BaseModel):
    id: UUID
    actor_type: str
    actor_id: str | None
    actor_label: str
    action: str
    entity_type: str
    entity_id: str
    string_id: UUID | None
    locale: str | None
    event_type: str
    summary: str
    batch_id: UUID | None
    batch_kind: str | None
    revert_of_id: UUID | None
    reverted_by_id: UUID | None
    is_revertible: bool
    created_at: UtcDateTime | None
    changed: list[ActivityChangeOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ActivityOut(ActivityCoreOut):
    before: dict[str, Any] | None
    after: dict[str, Any] | None


class ActivityListItemOut(ActivityCoreOut):
    string_key: str | None = None
    changed_count: int = 0
    is_history_restorable: bool = False
    restore_blocked_reason: str | None = None


class RestoreVersionOut(ActivityOut):
    notice: str
    pending_delete: bool = False


class ActivityLinkOut(BaseModel):
    id: UUID
    summary: str
    created_at: UtcDateTime | None = None


class ActivityDetailOut(ActivityCoreOut):
    string_key: str | None = None
    module_name: str | None = None
    is_history_restorable: bool = False
    restore_blocked_reason: str | None = None
    revert_of: ActivityLinkOut | None = None
    reverted_by: ActivityLinkOut | None = None


class ActivityListOut(BaseModel):
    items: list[ActivityListItemOut]
    total: int
    page: int
    page_size: int


class ActivityFeedChildOut(BaseModel):
    id: UUID
    event_type: str
    summary: str
    string_id: UUID | None = None
    string_key: str | None = None
    locale: str | None = None
    changed: list[ActivityChangeOut] = Field(default_factory=list)
    changed_count: int = 0


class ActivityFeedCardOut(BaseModel):
    id: str
    kind: Literal["single", "batch"]
    event_type: str
    summary: str
    actor_type: str
    actor_label: str
    created_at: UtcDateTime | None
    string_id: UUID | None = None
    string_key: str | None = None
    locale: str | None = None
    batch_id: UUID | None = None
    batch_kind: str | None = None
    children_count: int = 1
    is_undoable: bool = False
    counts: dict[str, int] = Field(default_factory=dict)
    changed: list[ActivityChangeOut] = Field(default_factory=list)
    changed_count: int = 0
    children: list[ActivityFeedChildOut] = Field(default_factory=list)


class ActivityFeedOut(BaseModel):
    items: list[ActivityFeedCardOut]
    total: int
    page: int
    page_size: int


class RevertPreviewItemOut(BaseModel):
    activity_id: UUID
    string_id: UUID | None = None
    string_key: str | None = None
    outcome: Literal[
        "restore_values", "move_to_deleted", "recreate", "already_reverted", "missing"
    ]
    conflict: bool = False
    affects_published: bool = False
    changes: list[ActivityChangeOut] = Field(default_factory=list)


class RevertPreviewOut(BaseModel):
    items: list[RevertPreviewItemOut]
    total: int
    conflict_count: int
    requires_force: bool
    affects_published: bool


class RestorePreviewOut(BaseModel):
    string_id: UUID
    activity_id: UUID
    can_restore: bool
    blocked_reason: str | None = None
    already_matches: bool = False
    pending_delete: bool = False
    notice: str | None = None
    changes: list[ActivityChangeOut] = Field(default_factory=list)
