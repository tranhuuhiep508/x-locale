"""Demo seed data — Vietnamese base with checkout, notifications and settings."""

from __future__ import annotations

from datetime import UTC, datetime

from app.auth import get_or_create_dev_user, hash_api_key
from app.config import settings
from app.database import SessionLocal
from app.demo_data import DEMO_STRINGS
from app.models import (
    ApiKey,
    MemberRole,
    Module,
    Project,
    ProjectLayout,
    ProjectMember,
    StringEntry,
    Tag,
    Translation,
)
from app.services.strings import promote_string

DEMO_MODULES = [
    ("checkout", "Checkout", "Checkout and order examples"),
    ("notifications", "Notifications", "Notifications and email examples"),
    ("settings", "Settings", "Account settings examples"),
]


def _ensure_dev_admin(db, project: Project) -> None:
    """Give the Dev User an Admin membership on the demo project.

    The Dev User row owns Demo App. Signing in as that user still requires
    AUTH_DEV_BYPASS. Sets created_by when it is empty and inserts Admin if missing.
    An existing membership role is left unchanged. This is separate from the
    migration, which adds no Admin when created_by is null.
    """
    user = get_or_create_dev_user(db)
    if project.created_by is None:
        project.created_by = user.id
    member = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project.id, ProjectMember.user_id == user.id)
        .first()
    )
    if member is None:
        db.add(ProjectMember(project_id=project.id, user_id=user.id, role=MemberRole.admin))


def seed_demo_data(*, force: bool = False) -> Project | None:
    db = SessionLocal()
    try:
        # Check if demo project already exists via api key hash
        demo_hash = hash_api_key(settings.x_locale_demo_api_key)
        existing_key = db.query(ApiKey).filter(ApiKey.key_hash == demo_hash).first()
        if existing_key and not force:
            project = db.query(Project).filter(Project.id == existing_key.project_id).first()
            if project is not None:
                _ensure_dev_admin(db, project)
                db.commit()
                db.refresh(project)
            return project

        if existing_key and force:
            project = db.query(Project).filter(Project.id == existing_key.project_id).first()
            if project:
                db.delete(project)
                db.commit()

        dev_user = get_or_create_dev_user(db)
        project = Project(
            name="Demo App",
            slug="demo-app",
            base_language="vi",
            target_languages=["en", "ja"],
            layout=ProjectLayout.modular,
            translation_context="Use a friendly, concise tone for an online shopping app.",
            created_by=dev_user.id,
        )
        db.add(project)
        db.flush()
        db.add(ProjectMember(project_id=project.id, user_id=dev_user.id, role=MemberRole.admin))

        # API key — use the configured demo key (not randomly generated) so docs stay valid
        raw = settings.x_locale_demo_api_key
        prefix = raw[:12] if len(raw) >= 12 else raw
        db.add(
            ApiKey(
                project_id=project.id,
                name="Demo key",
                key_prefix=prefix,
                key_hash=hash_api_key(raw),
            )
        )

        modules: dict[str, Module] = {}
        for i, (slug, name, desc) in enumerate(DEMO_MODULES):
            mod = Module(
                project_id=project.id,
                slug=slug,
                name=name,
                description=desc,
                position=i,
            )
            db.add(mod)
            db.flush()
            modules[slug] = mod

        tags = {}
        for name in sorted({row[5] for row in DEMO_STRINGS}):
            tag = Tag(project_id=project.id, name=name, color="#6366f1")
            db.add(tag)
            tags[name] = tag

        for module_slug, key, source_text, english, japanese, tag, public, pending in DEMO_STRINGS:
            entry = StringEntry(
                project_id=project.id,
                key_policy_allows_duplicates=project.allow_duplicate_keys,
                module_id=modules[module_slug].id,
                key=key,
                source_text=source_text,
                description=f"{tag} localization example for {module_slug}.",
            )
            entry.tags.append(tags[tag])
            entry.translations = [
                Translation(locale=locale, value=value)
                for locale, value in zip(project.target_languages, (english, japanese), strict=True)
            ]
            db.add(entry)
            if public:
                promote_string(entry)
            if pending:
                entry.source_text += " (đã cập nhật)"
            if key == "demo_pending_delete":
                entry.pending_delete = True
            elif key == "demo_deleted":
                entry.deleted_at = datetime.now(UTC)
            elif key == "demo_unassigned":
                entry.module_id = None
            elif key == "demo_translation_edit":
                entry.translations[0].value = "Thanks for shopping with us."

        db.commit()
        db.refresh(project)
        return project
    finally:
        db.close()
