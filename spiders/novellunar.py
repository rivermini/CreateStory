"""Spider for novellunar.com.

Novellunar is a Next.js (App Router) site that *server-renders* the chapter
prose, so a plain HTTP GET returns the full text — no Selenium or Cloudflare
bypass is required (contrast with wattpad/jobnib).

URL shapes:
  Story URL:   https://novellunar.com/novel/<slug>
  Chapter URL: https://novellunar.com/novel/<slug>/chapter/<N>   (N counts from 1)

Run:
  scrapy crawl novellunar -a novel="https://novellunar.com/novel/mother-of-learning" -a limit=10
  scrapy crawl novellunar -a novel="https://novellunar.com/novel/mother-of-learning/chapter/5" -a limit=3
  scrapy crawl novellunar -a novel="https://novellunar.com/novel/mother-of-learning" -a chapter_range="1-20"
"""

from __future__ import annotations

import logging
import re
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Generator, Optional

import scrapy
from bs4 import BeautifulSoup

from configs.base_config import load_site_config
from models.chapter import Chapter
from spiders.base_spider import BaseSpider, SelectorConfig
from utils.cleaner import build_promo_patterns, clean_chapter_content
from utils.proxy import requests_proxies


logger = logging.getLogger(__name__)

_BASE = "https://novellunar.com"
_NOVEL_PATH_RE = re.compile(r"^/novel/([^/]+?)(?:/chapter/(\d+))?/?$", re.IGNORECASE)
_SPACE_RE = re.compile(r"[ \t ]+")
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
# Content container: the prose <div> inside the chapter <article>.
_CONTENT_SELECTOR = "article div[style*='white-space:pre-wrap']"
_SITE_TITLE = "novellunar"


class NovellunarSpider(BaseSpider):
    name = "novellunar"
    config_name = "novellunar"
    download_delay = 0.0

    def __init__(self, *args, novel: str = "", limit: int = 1, chapter_range: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls: list[str] = [novel.strip()] if novel.strip() else []
        self.limit: int = max(1, int(limit))
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
            raise ValueError("Spider argument 'novel' is required (a full Novellunar story or chapter URL).")

        cfg = load_site_config(self.config_name)
        self.selector_config: SelectorConfig = self.build_selector_config(cfg)
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))
        self._concurrency = self._resolve_concurrency(cfg)
        self._submit_delay = max(0.0, float(cfg.get("rate_limit", 0.2) or 0.0))

        self.novel_slug = self._slug_from_url(self.start_urls[0])
        self._story_title = ""
        self._metadata: dict[str, Any] = {}
        self._chapters_crawled = 0
        self._seen_lock = threading.Lock()
        self._seen_urls: set[str] = set()

    # ----- crawl entrypoint -------------------------------------------------

    async def start(self):
        start_url = self._normalize_url(self.start_urls[0])
        first_number = self._chapter_number_from_url(start_url)

        if first_number is None:
            # Story URL — read the story page for title/metadata, then crawl from chapter 1.
            try:
                html = self._fetch_html(start_url)
                soup = BeautifulSoup(html, "html.parser")
                self._story_title = self._extract_story_title(soup)
                self._metadata = self._extract_story_metadata(soup, start_url)
            except Exception as exc:
                self.logger.warning("[novellunar] Could not read story page %s: %s", start_url, exc)
            start_number = self._range_start or 1
        else:
            start_number = first_number

        numbers = self._target_chapter_numbers(start_number)
        self.limit = len(numbers)
        self.logger.info(
            "[novellunar/story=%s] crawling %d chapter(s) starting at %d (concurrency=%d).",
            self.novel_slug, len(numbers), start_number, self._concurrency,
        )

        workers = min(self._concurrency, len(numbers))
        if workers <= 1:
            for index, number in enumerate(numbers):
                if index > 0 and self._submit_delay > 0:
                    time.sleep(self._submit_delay)
                chapter = self._crawl_chapter(number, include_metadata=index == 0)
                if chapter is None:
                    continue
                self._log_crawled_chapter(chapter)
                yield chapter
            return

        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="novellunar")
        futures = {}
        try:
            for index, number in enumerate(numbers):
                if index > 0 and self._submit_delay > 0:
                    time.sleep(self._submit_delay)
                futures[executor.submit(self._crawl_chapter, number, index == 0)] = number
            for future in as_completed(futures):
                number = futures[future]
                try:
                    chapter = future.result()
                except Exception as exc:
                    self.logger.warning("[novellunar/%d] crawl failed: %s", number, exc)
                    continue
                if chapter is None:
                    continue
                self._log_crawled_chapter(chapter)
                yield chapter
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def _target_chapter_numbers(self, start_number: int) -> list[int]:
        if self._range_start is not None and self._range_end is not None:
            return list(range(self._range_start, self._range_end + 1))
        return list(range(start_number, start_number + self.limit))

    # ----- per-chapter fetch ------------------------------------------------

    def _crawl_chapter(self, chapter_number: int, include_metadata: bool) -> Chapter | None:
        chapter_url = self._chapter_url(self.novel_slug, chapter_number)
        with self._seen_lock:
            if chapter_url in self._seen_urls:
                return None
            self._seen_urls.add(chapter_url)

        html = self._fetch_html(chapter_url)
        soup = BeautifulSoup(html, "html.parser")
        content = self._extract_chapter_content(soup)

        # Out-of-range chapters return HTTP 200 but with no prose container.
        if not content or len(content.split()) < 20:
            self.logger.info("[novellunar/%d] No content (end of novel or unavailable) — skipping.", chapter_number)
            return None

        chapter_title = self._extract_chapter_title(soup) or f"Chapter {chapter_number}"
        novel_title = self._story_title or self._extract_story_title(soup) or self.novel_slug
        cleaned = clean_chapter_content(content, self._promo_patterns)

        word_count = len(cleaned.split())
        if word_count < 200:
            self.logger.warning("[novellunar/%d] Chapter '%s' has only %d words.", chapter_number, chapter_title, word_count)

        metadata = self._metadata if include_metadata and self._metadata else None
        return Chapter(
            novel_slug=self.novel_slug,
            novel_title=novel_title,
            chapter_number=chapter_number,
            title=chapter_title,
            content=cleaned,
            source_url=chapter_url,
            novel_metadata=metadata,
        )

    def _fetch_html(self, url: str, timeout: int = 30) -> str:
        import requests

        headers = {
            "User-Agent": _USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": _BASE + "/",
        }
        resp = requests.get(url, headers=headers, timeout=timeout, proxies=requests_proxies("novellunar"))
        resp.raise_for_status()
        return resp.text

    # ----- extraction (shared with the sites API route) ---------------------

    def _extract_chapter_content(self, soup: BeautifulSoup) -> str:
        container = soup.select_one(_CONTENT_SELECTOR) or soup.select_one("article")
        if container is None:
            return ""
        for junk in container.select("script, style, ins, .adsbygoogle, button, a[href*='play.google.com']"):
            junk.decompose()
        # Paragraph breaks are single "\n" text nodes between prose <span>s.
        raw = container.get_text("")
        paragraphs = [self._clean_text(line) for line in raw.split("\n")]
        paragraphs = [p for p in paragraphs if p]
        return "\n\n".join(paragraphs)

    def _extract_chapter_title(self, soup: BeautifulSoup) -> str:
        for selector in ["main h1", "article h1", "h1"]:
            for el in soup.select(selector):
                text = self._clean_text(el.get_text(" ", strip=True))
                if text and text.lower() != _SITE_TITLE:
                    return text
        og = soup.select_one("meta[property='og:title']")
        if og:
            text = self._clean_text(og.get("content", ""))
            # "Mother of Learning Chapter 1: Chapter 1 - Read Free ... | Novellunar"
            match = re.search(r"(Chapter\s+\d+[^|\-]*)", text, re.IGNORECASE)
            if match:
                return self._clean_text(match.group(1))
        return ""

    def _extract_story_title(self, soup: BeautifulSoup) -> str:
        for el in soup.select("h1.text-2xl, h1.text-3xl, h1[class*='text-2xl'], h1[class*='text-3xl']"):
            text = self._clean_text(el.get_text(" ", strip=True))
            if text and text.lower() != _SITE_TITLE:
                return text
        og = soup.select_one("meta[property='og:title']")
        if og:
            text = self._clean_text(og.get("content", ""))
            text = re.sub(r"\s+Novel$", "", text, flags=re.IGNORECASE)
            text = re.sub(r"\s*\|\s*Novellunar\s*$", "", text, flags=re.IGNORECASE)
            if text and text.lower() != _SITE_TITLE:
                return text
        return ""

    def _extract_story_metadata(self, soup: BeautifulSoup, source_url: str) -> dict[str, Any]:
        title = self._extract_story_title(soup)
        cover = self._meta_content(soup, "meta[property='og:image']")
        description = self._meta_content(soup, "meta[name='description']") or self._meta_content(
            soup, "meta[property='og:description']"
        )
        author = ""
        author_el = soup.select_one("a[href*='/author/']")
        if author_el:
            author = self._clean_text(author_el.get_text(" ", strip=True))
        if not author and description:
            match = re.search(r"written by the author\s+([^,]+)", description, re.IGNORECASE)
            if match:
                author = self._clean_text(match.group(1))
        tags = [self._clean_text(t.get("content", "")) for t in soup.select("meta[property='book:tag']")]
        tags = [t for t in tags if t]

        metadata = {
            "source_url": source_url,
            "title": title,
            "author": author,
            "authors": [author] if author else None,
            "cover_url": cover,
            "description": description,
            "tags": tags or None,
        }
        return {key: value for key, value in metadata.items() if value}

    def _meta_content(self, soup: BeautifulSoup, selector: str) -> str:
        el = soup.select_one(selector)
        return self._clean_text(el.get("content", "")) if el else ""

    # ----- url helpers ------------------------------------------------------

    def _slug_from_url(self, url: str) -> str:
        match = _NOVEL_PATH_RE.match(urllib.parse.urlparse(url).path)
        return match.group(1) if match else "novellunar-unknown"

    def _chapter_number_from_url(self, url: str) -> Optional[int]:
        match = _NOVEL_PATH_RE.match(urllib.parse.urlparse(url).path)
        if match and match.group(2):
            return int(match.group(2))
        return None

    def _chapter_url(self, slug: str, chapter_number: int) -> str:
        return f"{_BASE}/novel/{slug}/chapter/{chapter_number}"

    def _normalize_url(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme or "https"
        netloc = (parsed.netloc or "novellunar.com").lower()
        path = parsed.path.rstrip("/") or "/"
        return urllib.parse.urlunparse((scheme, netloc, path, "", "", ""))

    def _clean_text(self, text: str) -> str:
        return _SPACE_RE.sub(" ", (text or "").replace("﻿", " ")).strip()

    def _resolve_concurrency(self, config: dict) -> int:
        import os

        raw = os.getenv("NOVELLUNAR_CONCURRENCY", config.get("concurrency", 5))
        try:
            return max(1, min(12, int(raw)))
        except (TypeError, ValueError):
            return 5

    def _log_crawled_chapter(self, chapter: Chapter) -> None:
        self._chapters_crawled += 1
        self.logger.info(
            "[%d/%d] Crawled chapter %d: %s",
            self._chapters_crawled, self.limit, chapter.chapter_number, chapter.title or "(untitled)",
        )

    def parse_chapter(self, response: scrapy.http.Response, chapter_index: int) -> Generator[Chapter, None, None]:
        raise NotImplementedError("NovellunarSpider uses a direct requests flow via start().")

    def closed(self, reason: str) -> None:
        self.logger.info("")
        self.logger.info("=" * 45)
        self.logger.info("  Novellunar crawl complete.")
        self.logger.info("  %d chapter(s) saved.", self._chapters_crawled)
        self.logger.info("=" * 45)
        self.logger.info("")


NovellunarSpider.complete = (
    "Novellunar spider complete. Run with: "
    "scrapy crawl novellunar -a novel='https://novellunar.com/novel/<slug>'"
)
