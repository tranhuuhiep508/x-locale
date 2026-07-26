import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text, Uuid, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TranslationStatus(str, enum.Enum):
    draft = "draft"
    live = "live"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    base_language: Mapped[str] = mapped_column(String(10), nullable=False, default="en")
    target_languages: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    api_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    strings: Mapped[list["StringEntry"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class StringEntry(Base):
    __tablename__ = "strings"
    __table_args__ = (UniqueConstraint("project_id", "key", name="uq_project_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["Project"] = relationship(back_populates="strings")
    translations: Mapped[list["Translation"]] = relationship(
        back_populates="string_entry", cascade="all, delete-orphan"
    )


class Translation(Base):
    __tablename__ = "translations"
    __table_args__ = (UniqueConstraint("string_id", "locale", name="uq_string_locale"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    string_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("strings.id", ondelete="CASCADE"))
    locale: Mapped[str] = mapped_column(String(10), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[TranslationStatus] = mapped_column(
        Enum(TranslationStatus, native_enum=False), nullable=False, default=TranslationStatus.draft
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    string_entry: Mapped["StringEntry"] = relationship(back_populates="translations")
