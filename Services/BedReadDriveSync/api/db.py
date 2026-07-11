"""Database helpers for Drive Sync persistence."""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

def _env_or_file(name: str) -> str | None:
    value = os.getenv(name)
    if value:
        return value.strip()
    file_path = os.getenv(f"{name}_FILE")
    if file_path:
        return Path(file_path).read_text(encoding="utf-8").strip()
    return None


_DATABASE_URL = _env_or_file("DATABASE_URL")
if not _DATABASE_URL:
    raise RuntimeError("DATABASE_URL or DATABASE_URL_FILE is required.")
DATABASE_URL: str = _DATABASE_URL


class Base(DeclarativeBase):
    pass


engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Register ORM models without performing schema changes at runtime."""
    import api.models.db_models  # noqa: F401
