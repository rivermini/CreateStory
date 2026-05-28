"""Pydantic models for user settings."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SettingsResponse(BaseModel):
    theme: str = Field(default="light", description="'light' or 'dark'")
    crawl_mode: str = Field(default="count", description="'count' or 'range'")
    crawl_default_count: int = Field(default=10, ge=1, le=100000)
    crawl_default_range_from: int = Field(default=1, ge=1)
    crawl_default_range_to: int = Field(default=10, ge=1)
    crawl_auto_max_chapters: bool = Field(default=False, description="Auto fill full available chapters after URL detection")
    auto_audio_rest_seconds: int = Field(default=30, ge=0, description="Rest time in seconds between stories")
    auto_audio_external_api_base: str = Field(default="", description="External API base URL for auto audio")
    auto_audio_test_story_ids: list[str] = Field(default_factory=list, description="Story IDs used in test mode")


class SettingsUpdateRequest(BaseModel):
    theme: str | None = Field(default=None, description="'light' or 'dark'")
    crawl_mode: str | None = Field(default=None, description="'count' or 'range'")
    crawl_default_count: int | None = Field(default=None, ge=1, le=100000)
    crawl_default_range_from: int | None = Field(default=None, ge=1)
    crawl_default_range_to: int | None = Field(default=None, ge=1)
    crawl_auto_max_chapters: bool | None = Field(default=None)
    auto_audio_rest_seconds: int | None = Field(default=None, ge=0)
    auto_audio_external_api_base: str | None = Field(default=None)
    auto_audio_test_story_ids: list[str] | None = Field(default=None)
