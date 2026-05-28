"""Pydantic schemas for crawl request/response payloads."""

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class CrawlRequest(BaseModel):
    spider_name: str = Field(..., description="Scrapy spider name, e.g. 'wattpad'")
    site_name: str = Field(..., description="Human-readable site name, e.g. 'Wattpad'")
    novel: str = Field(..., description="Novel slug or full chapter URL")
    limit: int = Field(default=10, ge=1, le=10000, description="Number of chapters to crawl")
    chapter_range: Optional[str] = Field(
        default=None,
        description='Chapter range such as "3-5" or "10-15". When set, overrides limit.',
    )
    output_format: Literal["jsonl", "txt"] = Field(
        default="jsonl", description="Output file format: 'jsonl' or 'txt'"
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
    combined_txt_file: Optional[str] = Field(
        default=None,
        description="Filename of the combined TXT file, if created (txt/md output only).",
    )
