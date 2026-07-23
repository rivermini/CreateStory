"""DB-backed storage for user-provided NovelHall session cookies."""

from __future__ import annotations

import time
from typing import Any, Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from api.models.db_models import NovelHallCookie


class NovelHallCookieRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_all(self) -> list[NovelHallCookie]:
        result = self.db.scalars(select(NovelHallCookie).order_by(NovelHallCookie.id))
        return list(result)

    def get_valid(self) -> list[NovelHallCookie]:
        """Return cookies that are not expired."""
        rows = self.get_all()
        now = int(time.time())
        return [r for r in rows if r.expires_at is None or r.expires_at > now]

    def get_user_agent(self) -> Optional[str]:
        for row in self.get_all():
            if row.user_agent:
                return row.user_agent
        return None

    def save_cookies(self, parsed_cookies: list[dict[str, Any]], user_agent: Optional[str] = None) -> int:
        """Replace all existing cookies with a fresh set. Returns count saved."""
        self.db.execute(delete(NovelHallCookie))
        for raw in parsed_cookies:
            self.db.add(
                NovelHallCookie(
                    name=str(raw.get("name", "")),
                    value=str(raw.get("value", "")),
                    domain=str(raw.get("domain", ".novelhall.com")),
                    path=str(raw.get("path", "/")),
                    secure=bool(raw.get("secure", True)),
                    expires_at=raw.get("expiry"),
                    user_agent=user_agent or None,
                )
            )
        self.db.commit()
        return len(parsed_cookies)

    def clear(self) -> None:
        self.db.execute(delete(NovelHallCookie))
        self.db.commit()
