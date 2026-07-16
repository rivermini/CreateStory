"""Database setup for PostgreSQL-backed gateway persistence."""

from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from api.app_config import DATABASE_URL


class Base(DeclarativeBase):
    pass


# Pool sizing: the gateway fronts long-running proxy requests, so give it more
# headroom than SQLAlchemy's 5+10 default. Keep pool_size + max_overflow well
# under postgres max_connections (100) shared with the four worker services.
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
    pool_timeout=int(os.getenv("DB_POOL_TIMEOUT_SECONDS", "30")),
    pool_recycle=1800,
)
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
