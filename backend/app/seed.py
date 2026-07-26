import os

from app.database import SessionLocal
from app.models import Project, StringEntry, Translation, TranslationStatus

DEMO_API_KEY = os.environ.get("TMS_DEMO_API_KEY", "demo-api-key-change-me")

DEMO_STRINGS = [
    ("common.save", "Save", "Primary action button"),
    ("common.cancel", "Cancel", "Secondary action button"),
    ("common.delete", "Delete", "Destructive action button"),
    ("auth.sign_in", "Sign in", "Login page heading"),
    ("auth.sign_up", "Create account", "Registration page heading"),
    ("auth.email", "Email address", "Email input label"),
    ("auth.password", "Password", "Password input label"),
    ("homepage.welcome", "Welcome back, {name}!", "Dashboard greeting"),
    ("homepage.subtitle", "Manage your translations in one place", "Dashboard subtitle"),
    ("errors.not_found", "Page not found", "404 error message"),
]


def seed_demo_data() -> None:
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.api_key == DEMO_API_KEY).first()
        if project:
            return

        project = Project(
            name="Demo App",
            base_language="en",
            target_languages=["vi", "ja"],
            api_key=DEMO_API_KEY,
        )
        db.add(project)
        db.flush()

        for key, source_text, description in DEMO_STRINGS:
            entry = StringEntry(
                project_id=project.id,
                key=key,
                source_text=source_text,
                description=description,
            )
            db.add(entry)
            db.flush()

            for locale, value in [
                ("vi", ""),
                ("ja", ""),
            ]:
                db.add(
                    Translation(
                        string_id=entry.id,
                        locale=locale,
                        value=value,
                        status=TranslationStatus.draft,
                    )
                )

        db.commit()
    finally:
        db.close()
