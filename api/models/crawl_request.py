"""Pydantic schemas for crawl request/response payloads."""

from datetime import datetime
from typing import Any, Literal, Optional

import ipaddress
import re
import socket
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


_ALLOWED_URL_SCHEMES = ("http", "https")


def _resolves_to_blocked_ip(host: str) -> bool:
    """True if *host* is, or DNS-resolves to, a loopback / private / link-local /
    reserved / multicast address — i.e. an SSRF target inside the deployment.

    Unresolvable hosts return False: they cannot reach an internal service, so
    the crawl simply fails naturally instead of being rejected here.
    """
    try:
        ipaddress.ip_address(host)
        candidates = [host]
    except ValueError:
        try:
            candidates = [info[4][0] for info in socket.getaddrinfo(host, None)]
        except OSError:
            return False
    for addr in candidates:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return True
    return False


def validate_external_url(
    value: Optional[str],
    allowed_suffixes: tuple[str, ...] = (),
    field_name: str = "url",
) -> Optional[str]:
    """Validate a user-supplied full URL that the crawler will fetch server-side.

    Blocks SSRF: rejects http(s)-scheme URLs whose host is (or resolves to) an
    internal/loopback address, and — when ``allowed_suffixes`` is given — pins the
    host to a known site domain (or its subdomains). ``None``/blank is passed
    through unchanged so the endpoint's own default-URL logic still applies.
    """
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    parts = urlsplit(stripped)
    if parts.scheme not in _ALLOWED_URL_SCHEMES:
        raise ValueError(f"{field_name} must use http or https")
    host = parts.hostname
    if not host:
        raise ValueError(f"{field_name} must include a host")
    if _resolves_to_blocked_ip(host):
        raise ValueError(f"{field_name} points to a disallowed internal/loopback address")
    if allowed_suffixes:
        host_l = host.lower()
        if not any(host_l == suffix or host_l.endswith("." + suffix) for suffix in allowed_suffixes):
            raise ValueError(f"{field_name} host is not an allowed site for this check")
    return value


class CrawlRequest(BaseModel):
    spider_name: str = Field(..., description="Scrapy spider name, e.g. 'wattpad'")
    site_name: str = Field(..., description="Human-readable site name, e.g. 'Wattpad'")
    novel: str = Field(..., description="Novel slug or full chapter URL")
    limit: int = Field(default=10, ge=1, description="Number of chapters to crawl")
    chapter_range: Optional[str] = Field(
        default=None,
        description='Chapter range such as "3-5" or "10-15". When set, overrides limit.',
    )
    output_format: Literal["md"] = Field(
        default="md", description="Output file format: 'md' (Markdown)"
    )
    novel_name: Optional[str] = Field(
        default=None,
        description="Display name of the novel, used as the filename prefix.",
    )
    completed: Optional[bool] = Field(
        default=None,
        description="Whether the novel is completed. Appends 'Completed' or 'Ongoing' to the filename.",
    )
    combine_chapters: bool = Field(
        default=False,
        description="After crawling, merge all chapter files into a single combined JSON file.",
    )
    source_url: Optional[str] = Field(
        default=None,
        description="The original URL the user submitted for the crawl.",
    )

    @field_validator("chapter_range")
    @classmethod
    def validate_chapter_range(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None

        match = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", value)
        if not match:
            raise ValueError('chapter_range must use "start-end" with positive chapter numbers.')

        start, end = (int(part) for part in match.groups())
        if start < 1 or end < 1:
            raise ValueError("chapter_range values must be positive chapter numbers.")
        if end < start:
            raise ValueError("chapter_range end must be greater than or equal to start.")

        return f"{start}-{end}"

    @field_validator("novel")
    @classmethod
    def validate_novel_target(cls, value: str) -> str:
        """Block SSRF: a full-URL `novel` may not point at an internal address.

        Bare slugs (no scheme) are allowed — the spider maps them to a known
        site host, so they are not an arbitrary-fetch vector.
        """
        parts = urlsplit(value.strip())
        if not parts.scheme and not parts.netloc:
            return value  # bare slug, not a direct-fetch URL
        if parts.scheme not in _ALLOWED_URL_SCHEMES:
            raise ValueError("novel URL must use http or https")
        host = parts.hostname
        if not host:
            raise ValueError("novel URL must include a host")
        if _resolves_to_blocked_ip(host):
            raise ValueError("novel URL points to a disallowed internal/loopback address")
        return value


class CrawlStartResponse(BaseModel):
    crawl_id: str
    status: str = "running"


class CrawlCancelResponse(BaseModel):
    crawl_id: str
    cancelled: bool


class ProgressUpdate(BaseModel):
    chapters_crawled: int = 0
    chapters_total: int = 0
    current_title: str = ""
    status: str = "running"
    error_message: Optional[str] = None
    source_url: Optional[str] = None


class LogEntry(BaseModel):
    timestamp: str
    message: str
    level: Literal["info", "error", "warning", "debug"] = "info"


class OutputFile(BaseModel):
    filename: str
    size_bytes: int = 0
    chapter_number: int = 0


class CrawlResult(BaseModel):
    crawl_id: str
    status: str
    spider_name: str
    novel_slug: str
    novel_name: Optional[str] = Field(default=None)
    chapters_crawled: int = 0
    chapters_total: int = 0
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error_message: str = ""
    output_files: list[OutputFile] = Field(default_factory=list)
    novel_metadata: Optional[dict[str, Any]] = Field(
        default=None,
        description="Novel-level metadata extracted from the first chapter entry.",
    )
    source_url: Optional[str] = Field(
        default=None,
        description="The original URL submitted for the crawl.",
    )
    combined_file: Optional[str] = Field(
        default=None,
        description="Filename of the combined JSON file, if created.",
    )
    combined_md_file: Optional[str] = Field(
        default=None,
        description="Filename of the combined Markdown file, if created (md output only).",
    )
