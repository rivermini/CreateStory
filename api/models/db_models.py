"""SQLAlchemy models for NovelCrawler metadata."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from api.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CrawlSessionRecord(Base):
    __tablename__ = "crawl_sessions"

    crawl_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    site_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    novel_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    chapters_crawled: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chapters_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="pending", index=True)
    started_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    combined_file: Mapped[str] = mapped_column(Text, nullable=False, default="")
    combined_md_file: Mapped[str] = mapped_column(Text, nullable=False, default="")
    completed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    output_format: Mapped[str] = mapped_column(String(32), nullable=False, default="md")
    source_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class CrawlOutputFileRecord(Base):
    __tablename__ = "crawl_output_files"

    file_id: Mapped[str] = mapped_column(String(512), primary_key=True)
    crawl_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(Text, nullable=False, default="")
    file_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    file_ext: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    file_role: Mapped[str] = mapped_column(String(32), nullable=False, default="chapter", index=True)
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class InkittCookie(Base):
    """Stores Inkitt login cookies (user_credentials, cf_clearance) in the database.

    Only the most recently saved set of cookies is considered valid at any time.
    Expired cookies are skipped at read time.
    """

    __tablename__ = "inkitt_cookies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    domain: Mapped[str] = mapped_column(String(256), nullable=False, default=".inkitt.com")
    path: Mapped[str] = mapped_column(String(64), nullable=False, default="/")
    secure: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class ScribbleHubCookie(Base):
    """Stores user-provided ScribbleHub session cookies (chiefly cf_clearance) in the database.

    ScribbleHub sits behind a Cloudflare managed challenge, so the crawler reuses a
    cookie set captured from a real browser. cf_clearance is bound to the IP and the
    User-Agent that solved the challenge, so the matching User-Agent is stored alongside
    the cookies and replayed on every request.

    Only the most recently saved set of cookies is considered valid at any time.
    Expired cookies are skipped at read time.
    """

    __tablename__ = "scribblehub_cookies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    domain: Mapped[str] = mapped_column(String(256), nullable=False, default=".scribblehub.com")
    path: Mapped[str] = mapped_column(String(64), nullable=False, default="/")
    secure: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
