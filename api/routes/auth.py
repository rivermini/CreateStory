"""Custom email/password auth routes."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.auth import create_access_token, hash_password, require_active_user, verify_password
from api.db import get_db
from api.models.db_models import User
from api.repositories.auth_repository import AuthRepository

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class AuthUserResponse(BaseModel):
    id: str
    email: EmailStr
    role: Literal["admin", "user"]
    is_active: bool


class AuthTokensResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: AuthUserResponse


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


def _user_response(user: User) -> AuthUserResponse:
    return AuthUserResponse(id=str(user.id), email=user.email, role=user.role, is_active=user.is_active)


def _tokens(repo: AuthRepository, user: User) -> AuthTokensResponse:
    refresh_token, _ = repo.create_refresh_token(user)
    return AuthTokensResponse(
        access_token=create_access_token(user),
        refresh_token=refresh_token,
        user=_user_response(user),
    )

@router.post("/login", response_model=AuthTokensResponse)
def login(req: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> AuthTokensResponse:
    repo = AuthRepository(db)
    user = repo.get_user_by_email(req.email)
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is disabled.")
    return _tokens(repo, user)


@router.post("/refresh", response_model=AuthTokensResponse)
def refresh(req: RefreshRequest, db: Annotated[Session, Depends(get_db)]) -> AuthTokensResponse:
    repo = AuthRepository(db)
    token = repo.get_valid_refresh_token(req.refresh_token)
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token.")
    user = repo.get_user_by_id(token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid refresh token.")
    repo.revoke_refresh_token(req.refresh_token)
    return _tokens(repo, user)


@router.post("/logout")
def logout(req: LogoutRequest, db: Annotated[Session, Depends(get_db)]) -> dict:
    revoked = AuthRepository(db).revoke_refresh_token(req.refresh_token)
    return {"revoked": revoked}


@router.get("/me", response_model=AuthUserResponse)
def me(current_user: Annotated[User, Depends(require_active_user)]) -> AuthUserResponse:
    return _user_response(current_user)

