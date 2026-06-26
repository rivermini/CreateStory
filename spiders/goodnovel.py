"""Spider for goodnovel.com.

GoodNovel is crawled through its open JSON API (see
``api/services/goodnovel_api.py``) rather than by rendering the SPA. Only **free**
chapters (``charge == false``) expose full content without a paid account; locked
chapters are skipped and reported in the closing summary.

Supports:
  Story URL:   scrapy crawl goodnovel -a novel="https://www.goodnovel.com/book/The-Alpha-s-Contract_31000725726" -a limit=10
  Chapter URL: scrapy crawl goodnovel -a novel="https://www.goodnovel.com/book/The-Alpha-s-Contract_31000725726/Chapter-0001_7750374" -a limit=5
  Range:       scrapy crawl goodnovel -a novel="<book url>" -a chapter_range=1-30
"""

from __future__ import annotations

import asyncio
import logging
from typing import Generator, Optional

import scrapy

from api.services.goodnovel_api import (
    GoodNovelApiClient,
    GoodNovelChapterContent,
    GoodNovelChapterRef,
    GoodNovelStory,
)
from configs.base_config import load_site_config
from models.chapter import Chapter
from spiders.base_spider import BaseSpider, SelectorConfig
from utils.cleaner import build_promo_patterns, clean_chapter_content


logger = logging.getLogger(__name__)


class GoodNovelSpider(BaseSpider):
    name = "goodnovel"
    config_name = "goodnovel"
    download_delay = 0.5

    custom_settings = {
        "DOWNLOAD_DELAY": 0.5,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
    }

    def __init__(
        self,
        *args,
        novel: str = "",
        limit: int = 1,
        chapter_range: str = "",
        api_concurrency: int = 4,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.start_urls: list[str] = [novel.strip()] if novel.strip() else []
        self.limit: int = max(1, int(limit))
        self.api_concurrency: int = max(1, min(8, int(api_concurrency)))
        self._range_start: Optional[int] = None
        self._range_end: Optional[int] = None

        if chapter_range:
            parts = chapter_range.split("-")
            if len(parts) == 2:
                try:
                    self._range_start = max(1, int(parts[0].strip()))
                    self._range_end = max(self._range_start, int(parts[1].strip()))
                    self.logger.info("Chapter range: %d to %d", self._range_start, self._range_end)
                except ValueError:
                    self.logger.warning("Invalid chapter_range '%s' - ignoring.", chapter_range)

        if not self.start_urls:
            raise ValueError("Spider argument 'novel' is required (a full GoodNovel book or chapter URL).")

        cfg = load_site_config(self.config_name)
        self.selector_config: SelectorConfig = self.build_selector_config(cfg)
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))

        self._api_client = GoodNovelApiClient(timeout=20, retries=2)
        self.novel_slug = self._api_client.slug_from_url(self.start_urls[0])

        self._chapters_crawled = 0
        self._locked_skipped = 0
        self._empty_skipped = 0

    async def start(self):
        start_url = self.start_urls[0]

        try:
            story = await asyncio.to_thread(self._api_client.resolve_story, start_url)
        except Exception as exc:
            self.logger.error("[goodnovel] Failed to resolve story from %s: %s", start_url, exc)
            return

        self.novel_slug = story.slug

        auth_state = "authenticated (cookies)" if self._api_client.authenticated else "anonymous (no cookies)"
        self.logger.info("[goodnovel/story=%s] Crawling %s.", story.slug, auth_state)

        selected = self._select_chapters(story, start_url)
        if self._api_client.authenticated:
            # Verify-by-detail: with a logged-in account the per-chapter `unlock` flag in
            # the listing can lag, so attempt EVERY selected chapter and keep whatever
            # returns full content. This guarantees chapters the account has bought/unlocked
            # are crawled; genuinely locked ones return preview-only and are skipped per-chapter.
            candidates = list(selected)
        else:
            candidates = [ref for ref in selected if ref.readable]
            self._locked_skipped = len(selected) - len(candidates)
        self.limit = max(1, len(candidates))

        self.logger.info(
            "[goodnovel/story=%s] found %d chapter links, target=crawlable (%d)",
            story.slug,
            len(story.chapters),
            len(candidates),
        )
        if self._locked_skipped:
            self.logger.info(
                "[goodnovel/story=%s] %d locked/paid chapter(s) in range will be skipped%s.",
                story.slug,
                self._locked_skipped,
                "" if self._api_client.authenticated
                else " — add GoodNovel cookies in Settings to unlock more",
            )

        if not candidates:
            self.logger.warning(
                "[goodnovel/story=%s] No crawlable chapters matched the requested range/limit.",
                story.slug,
            )
            return

        for batch_start in range(0, len(candidates), self.api_concurrency):
            batch = candidates[batch_start:batch_start + self.api_concurrency]
            results = await asyncio.gather(
                *[asyncio.to_thread(self._api_client.fetch_chapter, ref) for ref in batch],
                return_exceptions=True,
            )
            for ref, result in zip(batch, results):
                if isinstance(result, Exception):
                    self.logger.warning("[goodnovel] Chapter fetch failed for %s: %s", ref.url, result)
                    continue
                chapter = self._build_chapter(story, result)
                if chapter is not None:
                    yield chapter

    def start_requests(self):
        """Fallback for Scrapy - delegates to the async start()."""
        return self.start()

    def _select_chapters(self, story: GoodNovelStory, start_url: str) -> list[GoodNovelChapterRef]:
        chapters = story.chapters
        if not chapters:
            return []

        if self._range_start is not None and self._range_end is not None:
            return [
                ref for ref in chapters
                if self._range_start <= ref.chapter_number <= self._range_end
            ]

        start_number = self._chapter_number_for_url(chapters, start_url)
        if start_number > 1:
            tail = [ref for ref in chapters if ref.chapter_number >= start_number]
            return tail[:self.limit]

        return chapters[:self.limit]

    def _chapter_number_for_url(self, chapters: list[GoodNovelChapterRef], url: str) -> int:
        """If a chapter URL was supplied, find its 1-based position; else 1."""
        resource = url.rstrip("/").split("/")[-1]
        if "_" not in resource or "chapter" not in resource.lower():
            return 1
        chapter_id = resource.split("_")[-1]
        for ref in chapters:
            if ref.id == chapter_id or ref.resource_url == resource:
                return ref.chapter_number
        return 1

    def _build_chapter(self, story: GoodNovelStory, data: GoodNovelChapterContent) -> Optional[Chapter]:
        ref = data.ref

        if data.is_locked or not data.content:
            self._locked_skipped += 1
            self.logger.info(
                "[goodnovel] Chapter %d '%s' is locked (price=%d) - skipping.",
                ref.chapter_number,
                data.title,
                data.price,
            )
            return None

        cleaned_content = clean_chapter_content(data.content, self._promo_patterns)
        if not cleaned_content:
            self._empty_skipped += 1
            self.logger.warning("[goodnovel/%d] No content extracted from %s", ref.chapter_number, ref.url)
            return None

        chapter_title = data.title or ref.title or f"Chapter {ref.chapter_number}"
        word_count = len(cleaned_content.split())
        if word_count < 50:
            self.logger.warning(
                "[goodnovel/%d] Chapter '%s' has only %d words.",
                ref.chapter_number,
                chapter_title,
                word_count,
            )

        metadata = story.metadata if self._chapters_crawled == 0 else None
        self._chapters_crawled += 1
        self.logger.info(
            "[%s/%d] Crawled chapter %d: %s",
            self.novel_slug,
            self.limit,
            ref.chapter_number,
            chapter_title,
        )

        return Chapter(
            novel_slug=story.slug,
            novel_title=story.title,
            chapter_number=ref.chapter_number,
            title=chapter_title,
            content=cleaned_content,
            source_url=ref.url,
            novel_metadata=metadata,
        )

    def parse_chapter(self, response: scrapy.http.Response, chapter_index: int = 0):
        """Not used — GoodNovel is parsed through direct API calls in start()."""
        raise NotImplementedError("GoodNovelSpider parses chapters through the JSON API.")

    def closed(self, reason: str) -> None:
        self.logger.info("")
        self.logger.info("=" * 45)
        self.logger.info("  GoodNovel crawl complete.")
        self.logger.info("  %d readable chapter(s) saved.", self._chapters_crawled)
        if self._locked_skipped:
            self.logger.info("  %d locked/paid chapter(s) skipped (paywall).", self._locked_skipped)
        if self._empty_skipped:
            self.logger.warning("  %d chapter(s) skipped with empty content.", self._empty_skipped)
        self.logger.info("=" * 45)
        self.logger.info("")


GoodNovelSpider.complete = (
    "GoodNovel spider complete. Run with: "
    "scrapy crawl goodnovel -a novel='https://www.goodnovel.com/book/...'"
)
