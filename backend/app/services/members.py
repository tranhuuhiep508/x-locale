"""Project membership: add by email, role changes, last-admin guard."""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import MemberRole, ProjectMember, User
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
    member = _get_member(db, project_id, user_id)
    if member.role == MemberRole.admin and _admin_count(db, project_id) <= 1:
        raise HTTPException(status_code=400, detail=LAST_ADMIN)
    db.delete(member)
    db.commit()
