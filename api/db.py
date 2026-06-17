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

_FASTAPI_ENV = _PROJECT_ROOT.parent / "FastAPIServer" / ".env"
if _FASTAPI_ENV.exists():
    load_dotenv(_FASTAPI_ENV, override=False)

_DATABASE_URL = os.getenv("DATABASE_URL")
if not _DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is required. "
        "Copy .env.example to .env and set it before starting the service."
    )
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
    import api.models.db_models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _add_version_column_if_missing()
    _add_cover_update_histories_columns_if_missing()
    _add_banner_update_histories_table_if_missing()


def _add_version_column_if_missing() -> None:
    """Add the `version` column to drive_sync_jobs if it doesn't exist yet.

    This is a safe, idempotent migration run on every startup.  It is only
    executed once (the column is only added if missing).
    """
    from sqlalchemy import text

    with engine.connect() as conn:
        result = conn.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name='drive_sync_jobs' AND column_name='version'"
            )
        )
        if result.fetchone() is None:
            conn.execute(text("ALTER TABLE drive_sync_jobs ADD COLUMN version INTEGER NOT NULL DEFAULT 0"))
            conn.commit()


def _add_cover_update_histories_columns_if_missing() -> None:
    """Create cover_update_histories table and add missing columns if they don't exist.

    This is a safe, idempotent migration run on every startup.
    """
    from sqlalchemy import text

    with engine.connect() as conn:
        # Check if table exists
        result = conn.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name='cover_update_histories'"
            )
        )
        if result.fetchone() is None:
            conn.execute(text("""
                CREATE TABLE cover_update_histories (
                    id VARCHAR(64) PRIMARY KEY,
                    folder_id VARCHAR NOT NULL,
                    folder_name VARCHAR NOT NULL,
                    display_name VARCHAR NOT NULL,
                    story_id VARCHAR NOT NULL,
                    story_title VARCHAR NOT NULL DEFAULT '',
                    status VARCHAR NOT NULL,
                    cover_url VARCHAR,
                    error VARCHAR,
                    finished_at VARCHAR(64),
                    cover_file_name VARCHAR,
                    last_updated TIMESTAMP WITH TIME ZONE NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
                )
            """))
            conn.execute(text("CREATE INDEX ix_cover_update_histories_story_id ON cover_update_histories (story_id)"))
            conn.execute(text("CREATE INDEX ix_cover_update_histories_folder_id ON cover_update_histories (folder_id)"))
            conn.execute(text("CREATE INDEX ix_cover_update_histories_status ON cover_update_histories (status)"))
            conn.execute(text("CREATE INDEX ix_cover_update_histories_display_name ON cover_update_histories (display_name)"))
            conn.execute(text("CREATE INDEX ix_cover_update_histories_finished_at ON cover_update_histories (finished_at)"))
            conn.commit()
            return

        # Table exists — add missing columns one by one
        existing_columns: set[str] = set()
        result2 = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='cover_update_histories'"
            )
        )
        for row in result2:
            col_name = str(row[0])
            existing_columns.add(col_name)

        columns_to_add = [
            ("display_name", "VARCHAR NOT NULL DEFAULT ''"),
            ("story_title", "VARCHAR NOT NULL DEFAULT ''"),
            ("folder_name", "VARCHAR NOT NULL DEFAULT ''"),
            ("cover_url", "VARCHAR"),
            ("error", "VARCHAR"),
            ("finished_at", "VARCHAR(64)"),
            ("cover_file_name", "VARCHAR"),
            ("last_updated", "TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()"),
            ("created_at", "TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()"),
            ("updated_at", "TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()"),
        ]
        for col_name, col_def in columns_to_add:
            if col_name not in existing_columns:
                conn.execute(text(f"ALTER TABLE cover_update_histories ADD COLUMN {col_name} {col_def}"))
        conn.execute(
            text(
                "UPDATE cover_update_histories "
                "SET display_name = COALESCE(NULLIF(display_name, ''), NULLIF(story_title, ''), folder_name)"
            )
        )
        conn.execute(
            text(
                "UPDATE cover_update_histories "
                "SET story_title = COALESCE(NULLIF(story_title, ''), NULLIF(display_name, ''), folder_name)"
            )
        )
        conn.execute(
            text(
                "UPDATE cover_update_histories "
                "SET status = 'no_cover1_file' "
                "WHERE status = 'no_cover_file'"
            )
        )
        conn.execute(
            text(
                "UPDATE cover_update_histories "
                "SET last_updated = updated_at "
                "WHERE updated_at IS NOT NULL"
            )
        )
        conn.commit()


def _add_banner_update_histories_table_if_missing() -> None:
    """Create banner_update_histories table on startup if it doesn't exist.

    This is a safe, idempotent migration run on every startup.  Banner history is
    intentionally kept in a separate table from cover_update_histories so the
    banner_url / banner_file_name column semantics and the no_banner1_file status
    do not have to grow the existing cover history migration.
    """
    from sqlalchemy import text

    with engine.connect() as conn:
        result = conn.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name='banner_update_histories'"
            )
        )
        if result.fetchone() is None:
            conn.execute(text("""
                CREATE TABLE banner_update_histories (
                    id VARCHAR(64) PRIMARY KEY,
                    folder_id VARCHAR NOT NULL,
                    folder_name VARCHAR NOT NULL,
                    display_name VARCHAR NOT NULL,
                    story_id VARCHAR NOT NULL,
                    story_title VARCHAR NOT NULL DEFAULT '',
                    status VARCHAR NOT NULL,
                    banner_url VARCHAR,
                    error VARCHAR,
                    finished_at VARCHAR(64),
                    banner_file_name VARCHAR,
                    last_updated TIMESTAMP WITH TIME ZONE NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
                )
            """))
            conn.execute(text("CREATE INDEX ix_banner_update_histories_story_id ON banner_update_histories (story_id)"))
            conn.execute(text("CREATE INDEX ix_banner_update_histories_folder_id ON banner_update_histories (folder_id)"))
            conn.execute(text("CREATE INDEX ix_banner_update_histories_status ON banner_update_histories (status)"))
            conn.execute(text("CREATE INDEX ix_banner_update_histories_display_name ON banner_update_histories (display_name)"))
            conn.execute(text("CREATE INDEX ix_banner_update_histories_finished_at ON banner_update_histories (finished_at)"))
            conn.commit()
