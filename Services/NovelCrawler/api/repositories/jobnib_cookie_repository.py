"""DB-backed storage for Jobnib browser session cookies."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from api.models.db_models import JobnibCookie


class JobnibCookieRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_all(self) -> list[JobnibCookie]:
        return list(self.db.scalars(select(JobnibCookie).order_by(JobnibCookie.id)))

    def get_valid(self) -> list[JobnibCookie]:
        now = int(time.time())
        return [row for row in self.get_all() if row.expires_at is None or row.expires_at > now]

    def get_user_agent(self) -> str | None:
        return next((row.user_agent for row in self.get_all() if row.user_agent), None)

    def save_cookies(self, cookies: list[dict[str, Any]], user_agent: str | None = None) -> int:
        self.db.execute(delete(JobnibCookie))
        for raw in cookies:
            self.db.add(
                JobnibCookie(
                    name=str(raw.get("name") or ""),
                    value=str(raw.get("value") or ""),
                    domain=str(raw.get("domain") or ".jobnib.com"),
                    path=str(raw.get("path") or "/"),
                    secure=bool(raw.get("secure", True)),
                    expires_at=raw.get("expiry"),
                    user_agent=user_agent or None,
                )
            )
        self.db.commit()
        return len(cookies)

    def clear(self) -> None:
        self.db.execute(delete(JobnibCookie))
        self.db.commit()
