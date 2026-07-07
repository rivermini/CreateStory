"""Repository helpers for users and refresh tokens."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from api.app_config import REFRESH_TOKEN_EXPIRES
from api.models.db_models import RefreshToken, User


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class AuthRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def count_users(self) -> int:
        return self.db.scalar(select(func.count(User.id))) or 0

    def count_admin_users(self, active_only: bool = False) -> int:
        stmt = select(func.count(User.id)).where(User.role == "admin")
        if active_only:
            stmt = stmt.where(User.is_active.is_(True))
        return self.db.scalar(stmt) or 0

    def list_users(self) -> list[User]:
        return list(self.db.scalars(select(User).order_by(User.created_at.asc(), User.email.asc())).all())

    def get_first_admin_user(self) -> User | None:
        return self.db.scalar(select(User).where(User.role == "admin").order_by(User.created_at.asc(), User.email.asc()))

    def get_user_by_email(self, email: str) -> User | None:
        return self.db.scalar(select(User).where(User.email == normalize_email(email)))

    def get_user_by_id(self, user_id: uuid.UUID) -> User | None:
        return self.db.get(User, user_id)

    def create_user(self, email: str, password_hash: str, role: str = "user") -> User:
        user = User(email=normalize_email(email), password_hash=password_hash, role=role)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def create_refresh_token(self, user: User) -> tuple[str, RefreshToken]:
        raw_token = secrets.token_urlsafe(48)
        token = RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(raw_token),
            expires_at=datetime.now(timezone.utc) + REFRESH_TOKEN_EXPIRES,
        )
        self.db.add(token)
        self.db.commit()
        self.db.refresh(token)
        return raw_token, token

    def get_valid_refresh_token(self, raw_token: str) -> RefreshToken | None:
        token_hash = hash_refresh_token(raw_token)
        token = self.db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        if token is None or token.revoked_at is not None:
            return None
        if token.expires_at < datetime.now(timezone.utc):
            return None
        return token

    def get_refresh_token(self, raw_token: str) -> RefreshToken | None:
        return self.db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw_token)))

    def revoke_refresh_token(self, raw_token: str) -> bool:
        token = self.db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw_token)))
        if token is None:
            return False
        token.revoked_at = datetime.now(timezone.utc)
        self.db.commit()
        return True

    def revoke_user_refresh_tokens(self, user_id: uuid.UUID) -> int:
        tokens = list(
            self.db.scalars(
                select(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
            ).all()
        )
        now = datetime.now(timezone.utc)
        for token in tokens:
            token.revoked_at = now
        self.db.commit()
        return len(tokens)
