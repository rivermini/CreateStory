"""Admin-only management routes."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.auth import hash_password, require_admin
from api.db import get_db
from api.models.db_models import User
from api.repositories.auth_repository import AuthRepository, normalize_email

router = APIRouter(prefix="/api/admin", tags=["Admin"])

UserRole = Literal["admin", "operator", "viewer"]


class AdminUserResponse(BaseModel):
    id: str
    email: EmailStr
    role: UserRole
    is_active: bool
    created_at: str
    updated_at: str


class UserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = "viewer"
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: UserRole | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> "UserUpdateRequest":
        if self.email is None and self.password is None and self.role is None and self.is_active is None:
            raise ValueError("At least one field must be provided.")
        return self


def _response(user: User) -> AdminUserResponse:
    return AdminUserResponse(
        id=str(user.id),
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat(),
        updated_at=user.updated_at.isoformat(),
    )


def _parse_user_id(user_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


def _ensure_not_last_active_admin(repo: AuthRepository, user: User, next_role: str | None = None, next_active: bool | None = None) -> None:
    role = next_role if next_role is not None else user.role
    is_active = next_active if next_active is not None else user.is_active
    if user.role == "admin" and user.is_active and (role != "admin" or not is_active) and repo.count_admin_users(active_only=True) <= 1:
        raise HTTPException(status_code=400, detail="Cannot remove or disable the last active admin.")


@router.get("/users", response_model=list[AdminUserResponse])
def list_users(
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> list[AdminUserResponse]:
    return [_response(user) for user in AuthRepository(db).list_users()]


@router.post("/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    req: UserCreateRequest,
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserResponse:
    repo = AuthRepository(db)
    try:
        user = repo.create_user(req.email, hash_password(req.password), role=req.role)
        user.is_active = req.is_active
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email is already registered.") from exc
    return _response(user)


@router.put("/users/{user_id}", response_model=AdminUserResponse)
def update_user(
    user_id: str,
    req: UserUpdateRequest,
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserResponse:
    repo = AuthRepository(db)
    user = repo.get_user_by_id(_parse_user_id(user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="Admins cannot edit their own account from this page.")

    next_role = req.role if req.role is not None else user.role
    next_active = req.is_active if req.is_active is not None else user.is_active
    _ensure_not_last_active_admin(repo, user, next_role=next_role, next_active=next_active)

    if req.email is not None:
        user.email = normalize_email(req.email)
    if req.password:
        user.password_hash = hash_password(req.password)
    user.role = next_role
    user.is_active = next_active

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email is already registered.") from exc

    if req.password or req.role is not None or req.is_active is False:
        repo.revoke_user_refresh_tokens(user.id)
    db.refresh(user)
    return _response(user)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    repo = AuthRepository(db)
    user = repo.get_user_by_id(_parse_user_id(user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="Admins cannot delete their own account.")
    _ensure_not_last_active_admin(repo, user, next_active=False)
    deleted_id = str(user.id)
    db.delete(user)
    db.commit()
    return {"deleted": True, "id": deleted_id}
