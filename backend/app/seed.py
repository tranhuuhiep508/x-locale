"""Demo seed data — Vietnamese base with auth/home/common modules."""

from __future__ import annotations

from app.auth import generate_api_key, hash_api_key
from app.config import settings
from app.database import SessionLocal
from app.models import (
    ApiKey,
    Module,
    Project,
    ProjectLayout,
    StringEntry,
    Translation,
    TranslationStatus,
)

DEMO_MODULES = [
    ("common", "Common", "Shared UI strings"),
    ("auth", "Auth", "Authentication screens"),
    ("home", "Home", "Home / dashboard screens"),
]

# (module_slug, key, source_vi, description)
DEMO_STRINGS = [
    ("common", "save", "Lưu", "Nút hành động chính"),
    ("common", "cancel", "Hủy", "Nút hành động phụ"),
    ("common", "delete", "Xóa", "Nút hành động phá hủy"),
    ("common", "search", "Tìm kiếm", "Ô tìm kiếm"),
    ("auth", "sign_in", "Đăng nhập", "Tiêu đề trang đăng nhập"),
    ("auth", "sign_up", "Tạo tài khoản", "Tiêu đề trang đăng ký"),
    ("auth", "email", "Địa chỉ email", "Nhãn ô email"),
    ("auth", "password", "Mật khẩu", "Nhãn ô mật khẩu"),
    ("home", "welcome", "Chào mừng trở lại, {name}!", "Lời chào dashboard"),
    ("home", "subtitle", "Quản lý bản dịch tại một nơi", "Phụ đề dashboard"),
]


def seed_demo_data(*, force: bool = False) -> Project | None:
    db = SessionLocal()
    try:
        # Check if demo project already exists via api key hash
        demo_hash = hash_api_key(settings.tms_demo_api_key)
        existing_key = db.query(ApiKey).filter(ApiKey.key_hash == demo_hash).first()
        if existing_key and not force:
            return db.query(Project).filter(Project.id == existing_key.project_id).first()

        if existing_key and force:
            project = db.query(Project).filter(Project.id == existing_key.project_id).first()
            if project:
                db.delete(project)
                db.commit()

        project = Project(
            name="Demo App",
            slug="demo-app",
            base_language="vi",
            target_languages=["en", "ja"],
            layout=ProjectLayout.modular,
        )
        db.add(project)
        db.flush()

        # API key — use the configured demo key (not randomly generated) so docs stay valid
        raw = settings.tms_demo_api_key
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

        for module_slug, key, source_text, description in DEMO_STRINGS:
            entry = StringEntry(
                project_id=project.id,
                module_id=modules[module_slug].id,
                key=key,
                source_text=source_text,
                description=description,
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

        db.commit()
        db.refresh(project)
        return project
    finally:
        db.close()
