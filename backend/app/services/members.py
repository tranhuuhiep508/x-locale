"""Project membership: add by email, role changes, last-admin guard."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import ApiKey, MemberRole, Project, ProjectMember, User
from app.schemas import MemberOut

LAST_ADMIN = "This project must keep at least one admin"
UNKNOWN_EMAIL = "No user with this email has signed in"
AMBIGUOUS_EMAIL = "More than one account uses this email"
ALREADY_MEMBER = "This user is already a member of the project"


def role_name(role: MemberRole | str) -> str:
    return role.value if isinstance(role, MemberRole) else str(role)


def member_out(member: ProjectMember, user: User) -> MemberOut:
    return MemberOut(
        user_id=user.id,
        email=user.email,
        name=user.name,
        role=role_name(member.role),  # type: ignore[arg-type]
        created_at=member.created_at,
    )


def _project_lock_query(db: Session, project_id: uuid.UUID):
    """FOR NO KEY UPDATE, so an API-key insert's FOR KEY SHARE lock can proceed."""
    return db.query(Project.id).filter(Project.id == project_id).with_for_update(key_share=True)


def lock_project(db: Session, project_id: uuid.UUID) -> None:
    """Lock before membership reads or key writes, through commit/rollback.

    FOR NO KEY UPDATE so foreign-key checks from catalog and key inserts can proceed.
    """
    found = _project_lock_query(db, project_id).first() is not None
    if not found:
        raise HTTPException(status_code=404, detail="Project not found")


def _admin_count(db: Session, project_id: uuid.UUID) -> int:
    return (
        db.query(func.count(ProjectMember.id))
        .filter(ProjectMember.project_id == project_id, ProjectMember.role == MemberRole.admin)
        .scalar()
        or 0
    )


def _get_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectMember:
    member = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        .populate_existing()
        .first()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return member


def list_members(db: Session, project_id: uuid.UUID) -> list[MemberOut]:
    rows = (
        db.query(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .filter(ProjectMember.project_id == project_id)
        .all()
    )
    ranked = sorted(
        rows,
        key=lambda row: (0 if row[0].role == MemberRole.admin else 1, row[1].email.lower()),
    )
    return [member_out(member, user) for member, user in ranked]


def find_user_by_email(db: Session, email: str) -> User:
    normalized = email.strip().lower()
    matches = db.query(User).filter(func.lower(User.email) == normalized).all()
    if not matches:
        raise HTTPException(status_code=400, detail=UNKNOWN_EMAIL)
    if len(matches) > 1:
        raise HTTPException(status_code=409, detail=AMBIGUOUS_EMAIL)
    return matches[0]


def add_member(db: Session, project_id: uuid.UUID, email: str, role: MemberRole) -> MemberOut:
    lock_project(db, project_id)
    user = find_user_by_email(db, email)
    existing = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id)
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=ALREADY_MEMBER)
    member = ProjectMember(project_id=project_id, user_id=user.id, role=role)
    db.add(member)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=ALREADY_MEMBER) from None
    db.refresh(member)
    return member_out(member, user)


def set_member_role(
    db: Session, project_id: uuid.UUID, user_id: uuid.UUID, role: MemberRole
) -> MemberOut:
    lock_project(db, project_id)
    member = _get_member(db, project_id, user_id)
    demoting_last_admin = (
        member.role == MemberRole.admin
        and role != MemberRole.admin
        and _admin_count(db, project_id) <= 1
    )
    if demoting_last_admin:
        raise HTTPException(status_code=400, detail=LAST_ADMIN)
    member.role = role
    db.commit()
    db.refresh(member)
    user = db.query(User).filter(User.id == user_id).one()
    return member_out(member, user)


def remove_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> None:
    # Lock order: projects row (FOR NO KEY UPDATE) before api_keys.
    # Key-authorized catalog writes go the other way (api_keys.last_used_at,
    # then FOR KEY SHARE on projects from FK inserts). That is safe only
    # because NO KEY UPDATE does not conflict with KEY SHARE. Any path that
    # writes api_keys and then UPDATEs, DELETEs or locks projects will
    # deadlock with this function.
    lock_project(db, project_id)
    member = _get_member(db, project_id, user_id)
    if member.role == MemberRole.admin and _admin_count(db, project_id) <= 1:
        raise HTTPException(status_code=400, detail=LAST_ADMIN)
    db.query(ApiKey).filter(
        ApiKey.project_id == project_id,
        ApiKey.created_by == user_id,
        ApiKey.revoked_at.is_(None),
    ).update({ApiKey.revoked_at: datetime.now(UTC)}, synchronize_session=False)
    db.delete(member)
    db.commit()
