"""DB-backed storage for user-provided WebNovel cookies."""

from __future__ import annotations

import time
from typing import Any, Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from api.models.db_models import WebNovelCookie


class WebNovelCookieRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_all(self) -> list[WebNovelCookie]:
        result = self.db.scalars(select(WebNovelCookie).order_by(WebNovelCookie.id))
        return list(result)

    def get_valid(self) -> list[WebNovelCookie]:
        """Return cookies that are not expired."""
        rows = self.get_all()
        now = int(time.time())
        return [row for row in rows if row.expires_at is None or row.expires_at > now]

    def get_user_agent(self) -> Optional[str]:
        for row in self.get_all():
            if row.user_agent:
                return row.user_agent
        return None

    def save_cookies(self, parsed_cookies: list[dict[str, Any]], user_agent: Optional[str] = None) -> int:
        """Replace all existing WebNovel cookies with a fresh set."""
        self.db.execute(delete(WebNovelCookie))
        for raw in parsed_cookies:
            self.db.add(
                WebNovelCookie(
                    name=str(raw.get("name", "")),
                    value=str(raw.get("value", "")),
                    domain=str(raw.get("domain", ".webnovel.com")),
                    path=str(raw.get("path", "/")),
                    secure=bool(raw.get("secure", True)),
                    expires_at=raw.get("expiry"),
                    user_agent=user_agent or None,
                )
            )
        self.db.commit()
        return len(parsed_cookies)

    def clear(self) -> None:
        self.db.execute(delete(WebNovelCookie))
        self.db.commit()
