"""DB-backed storage for Inkitt login cookies."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from api.db import SessionLocal
from api.models.db_models import InkittCookie


_COOKIE_PATH = Path(__file__).resolve().parents[2] / "handlers" / "selenium_cookies_www_inkitt_com.json"


class InkittCookieRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_all(self) -> list[InkittCookie]:
        result = self.db.scalars(select(InkittCookie).order_by(InkittCookie.id))
        return list(result)

    def get_valid(self) -> list[InkittCookie]:
        """Return cookies that are not expired."""
        rows = self.get_all()
        now = int(time.time())
        return [r for r in rows if r.expires_at is None or r.expires_at > now]

    def get_user_agent(self) -> str | None:
        for row in self.get_all():
            if row.user_agent:
                return row.user_agent
        return None

    def save_cookies(self, parsed_cookies: list[dict[str, Any]], user_agent: str | None = None) -> int:
        """Replace all existing cookies with a fresh set. Returns count saved."""
        self.db.execute(delete(InkittCookie))
        for raw in parsed_cookies:
            self.db.add(
                InkittCookie(
                    name=str(raw.get("name", "")),
                    value=str(raw.get("value", "")),
                    domain=str(raw.get("domain", ".inkitt.com")),
                    path=str(raw.get("path", "/")),
                    secure=bool(raw.get("secure", True)),
                    expires_at=raw.get("expiry"),
                    user_agent=user_agent or None,
                )
            )
        self.db.commit()
        return len(parsed_cookies)

    def clear(self) -> None:
        self.db.execute(delete(InkittCookie))
        self.db.commit()


def _load_from_json_file() -> list[dict[str, Any]]:
    """Read cookies from the legacy JSON file, if it exists."""
    if not _COOKIE_PATH.exists():
        return []
    try:
        raw = json.loads(_COOKIE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    return [c for c in raw if isinstance(c, dict) and c.get("name") and c.get("value") is not None]


def migrate_json_to_db(db: Session) -> int:
    """Import existing JSON file cookies into the database. Idempotent — skips if DB already has rows."""
    count = db.query(InkittCookie).count()
    if count > 0:
        return 0

    file_cookies = _load_from_json_file()
    if not file_cookies:
        return 0

    repo = InkittCookieRepository(db)
    saved_count = repo.save_cookies(file_cookies)
    return saved_count
