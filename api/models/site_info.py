"""Pydantic schemas for site detection payloads."""

from typing import Any, Optional

from pydantic import BaseModel, Field


class ChapterEntry(BaseModel):
    chapter_number: int = Field(..., description="1-based chapter index")
    title: str = Field(..., description="Chapter title (may be empty string)")
    url: str = Field(..., description="Full URL to the chapter page")
    locked: Optional[bool] = Field(
        default=None,
        description="True if the chapter is paywalled and not readable for free. "
        "None when the site exposes no free/paid distinction.",
    )


class NovelMetadata(BaseModel):
    title: Optional[str] = Field(default=None, description="Story title")
    author: Optional[str] = Field(default=None, description="Author username (single)")
    authors: Optional[list[str]] = Field(default=None, description="Author usernames (list)")
    author_fullname: Optional[str] = Field(default=None, description="Author display name")
    author_avatar: Optional[str] = Field(default=None, description="Author profile picture URL")
    cover_url: Optional[str] = Field(default=None, description="Cover image URL")
    description: Optional[str] = Field(default=None, description="Story synopsis")
    views: Optional[int] = Field(default=None, description="Total read count")
    stars: Optional[int] = Field(default=None, description="Total vote count")
    comment_count: Optional[int] = Field(default=None, description="Total comment count")
    num_parts: Optional[int] = Field(default=None, description="Total chapter count")
    language: Optional[dict] = Field(default=None, description="Language object {id, name}")
    tags: Optional[list[str]] = Field(default_factory=list, description="Genre tags")
    completed: Optional[bool] = Field(default=None, description="Whether the story is marked complete")
    mature: Optional[bool] = Field(default=None, description="Whether the story contains mature content")
    is_paywalled: Optional[bool] = Field(default=None, description="Whether the story has locked chapters")
    season_current: Optional[int] = Field(default=None, description="Current season number")
    season_total: Optional[int] = Field(default=None, description="Total number of seasons")


class SiteInfoResponse(BaseModel):
    config_name: str = Field(..., description="YAML config name, e.g. 'wattpad'")
    site_name: str = Field(..., description="Human-readable site name, e.g. 'Wattpad'")
    base_url: str = Field(..., description="Primary base URL for the site")
    rate_limit: float = Field(default=2.0, description="Recommended delay between requests (seconds)")


class SiteDetectResponse(BaseModel):
    site: Optional[SiteInfoResponse] = None
    slug: Optional[str] = None
    valid: bool = False
    message: str = ""
    story_title: Optional[str] = Field(default=None, description="Extracted story title")
    resolved_url: Optional[str] = Field(default=None, description="Resolved first-chapter URL")
    chapter_count: Optional[int] = Field(default=None, description="Total chapter count")
    chapters: Optional[list[ChapterEntry]] = Field(
        default=None, description="First ~50 chapter entries"
    )
    novel_metadata: Optional[NovelMetadata] = Field(
        default=None, description="Enriched metadata (Wattpad v3 API fields)"
    )


class ChapterListResponse(BaseModel):
    valid: bool = Field(default=True, description="False when the URL is a chapter URL or invalid")
    reason: Optional[str] = Field(default=None, description="When valid=False: 'chapter_url' or other reason")
    message: str = Field(default="", description="Human-readable message or error explanation")
    story_title: Optional[str] = Field(default=None, description="Title of the novel/story")
    chapter_count: int = Field(default=0, description="Number of chapter entries returned (max 50)")
    total_chapter_count: Optional[int] = Field(default=None, description="Total chapter count from site metadata (may arrive later for NovelWorm)")
    chapters: list[ChapterEntry] = Field(default_factory=list, description="List of chapter entries (max 50)")
    warning: Optional[str] = Field(default=None, description="Non-fatal warning")
    free_chapter_count: Optional[int] = Field(default=None, description="Chapters readable for free across the whole book (sites with a paywall)")
    paid_chapter_count: Optional[int] = Field(default=None, description="Paywalled/locked chapters across the whole book (sites with a paywall)")
    authenticated: Optional[bool] = Field(default=None, description="Whether saved login cookies were applied when computing free/paid counts")


class BinarySearchTotalResponse(BaseModel):
    url: str = Field(..., description="The story URL that was queried")
    total: Optional[int] = Field(default=None, description="Total chapter count, None if still running")
    done: bool = Field(default=False, description="True when binary search has completed")
    fetching: bool = Field(default=False, description="True when binary search is in progress")
