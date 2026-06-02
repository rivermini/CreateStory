"""
Spider for wattpad.com.

Supports:
  Chapter URL: scrapy crawl wattpad -a novel="https://www.wattpad.com/..." -a limit=10
  Story URL: scrapy crawl wattpad -a novel="https://www.wattpad.com/story/..." -a limit=5
"""

import asyncio
import logging
import re
import time
import urllib.parse
from pathlib import Path
from typing import AsyncGenerator, Generator, Optional

import requests
import scrapy
from bs4 import BeautifulSoup
from scrapy.http import Response

from configs.base_config import load_site_config
from models.chapter import Chapter
from spiders.base_spider import BaseSpider, SelectorConfig
from utils.cleaner import clean_chapter_content


logger = logging.getLogger(__name__)

_WATTPAD_API_BASE = "https://www.wattpad.com/api/v3/stories"
_WATTPAD_API_FIELDS = (
    "id,title,description,cover,completed,"
    "user(name,avatar,fullname),"
    "readCount,voteCount,commentCount,"
    "numParts,rating,mature,tags,"
    "isPaywalled,paidModel,"
    "parts(id,title,url,length,createDate,voteCount,readCount)"
)
_WATTPAD_API_TIMEOUT = 30

_SEASON_RE = re.compile(r"[Ss]eason\s*(\d+)\s*(?:of|/)\s*(\d+)")


def format_number(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


def parse_season_from_text(text: str) -> tuple[Optional[int], Optional[int]]:
    match = _SEASON_RE.search(text)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None, None


class WattpadSpider(BaseSpider):
    name = "wattpad"
    config_name = "wattpad"

    _SELECTOR_CHAPTER_BODY = ".panel.panel-reading pre p[data-p-id]"
    _SELECTOR_NEXT_CHAPTER = "a[class*='primary-variant']"
    _SELECTOR_NEXT_PAGE = "a[href*='/page/']"
    _SELECTOR_CHAPTER_TITLE = ".part-title"

    _WATTPAD_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.wattpad.com/",
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
                    self.logger.warning("Invalid chapter_range '%s' -- ignoring.", chapter_range)

        if not self.start_urls:
            raise ValueError(
                "Spider argument 'novel' is required (a full Wattpad chapter or story URL)."
            )

        self.novel_slug = self._extract_story_id(self.start_urls[0]) or self._story_id_from_url(self.start_urls[0])

        cfg = load_site_config(self.config_name)
        self.selector_config: SelectorConfig = self.build_selector_config(cfg)

        self._chapters_crawled: int = 0
        self._seen_urls: set[str] = set()
        self._is_chapter_url_mode: bool = False

        self._story_data: Optional[dict] = None
        self._is_paywalled: bool = False
        self._skipped_locked: int = 0
        self._saved_chapters: int = 0

    async def start(self):
        url = self.start_urls[0]
        if self._is_story_url(url):
            async for req in self._start_from_story_api():
                yield req
        else:
            async for req in self._start_from_chapter_url():
                yield req

    def _is_story_url(self, url: str) -> bool:
        return "/story/" in url

    def _extract_story_id(self, url: str) -> Optional[str]:
        match = re.search(r"/story/(\d+)", url)
        return match.group(1) if match else None

    async def _start_from_story_api(self) -> AsyncGenerator:
        story_id = self._extract_story_id(self.start_urls[0])
        if not story_id:
            self.logger.error("[wattpad] Could not extract story ID from story URL: %s", self.start_urls[0])
            async for r in self._start_from_chapter_url():
                yield r
            return

        self.logger.info("[wattpad/story=%s] Detected story URL -- collecting chapter parts.", story_id)

        try:
            all_parts, story_data = self._collect_all_parts(story_id)
        except Exception as exc:
            self.logger.error("[wattpad/story=%s] Failed to collect chapter parts: %s", story_id, exc)
            async for r in self._start_from_chapter_url():
                yield r
            return

        self._story_data = story_data
        browse = story_data.get("readerBrowseEligibility", {})
        self._is_paywalled = browse.get("eligible") is False
        self._log_story_header(story_data)

        if not all_parts:
            self.logger.warning("[wattpad/story=%s] No parts returned from API.", story_id)
            async for r in self._start_from_chapter_url():
                yield r
            return

        self.logger.info("[wattpad/story=%s] Collected %d parts total.", story_id, len(all_parts))
        start_idx = (self._range_start - 1) if self._range_start is not None else 0
        fetch_count = (
            (self._range_end - self._range_start + 1)
            if self._range_start is not None and self._range_end is not None
            else self.limit
        )
        async for item in self._yield_story_chapters_from_api(story_id, all_parts, start_idx, fetch_count):
            yield item

    def _log_story_header(self, story_data: dict) -> None:
        title = story_data.get("title", "?")
        user = story_data.get("user", {})
        username = user.get("name", "?")
        fullname = user.get("fullname") or username
        views = story_data.get("readCount", 0)
        stars = story_data.get("voteCount", 0)
        num_parts = story_data.get("numParts", 0)
        tags = story_data.get("tags", [])
        is_paywalled = story_data.get("isPaywalled", False)
        description = story_data.get("description", "")
        season_current, season_total = parse_season_from_text(description)
        season_str = f"Season {season_current} of {season_total}" if season_current else ""

        parts_line = f"{num_parts} parts"
        if season_str:
            parts_line = f"{season_str}  |  {parts_line}"

        self.logger.info("")
        self.logger.info("=" * 45)
        self.logger.info("  %s", title)
        self.logger.info("  Author: %s (%s)", fullname, username)
        self.logger.info("  Views: %s  |  Stars: %s  |  Parts: %s", format_number(views), format_number(stars), parts_line)
        if tags:
            self.logger.info("  Tags: %s", ", ".join(tags))
        if is_paywalled:
            self.logger.warning("  Wattpad Original - some chapters may be locked")
        self.logger.info("=" * 45)
        self.logger.info("")

    def _collect_all_parts(self, story_id: str) -> tuple[list[dict], dict]:
        import json as _json

        session = requests.Session()
        session.headers.update(self._WATTPAD_HEADERS)

        try:
            cookie_file = Path(__file__).parent.parent / "handlers" / "selenium_cookies.json"
            if cookie_file.exists():
                raw = _json.loads(cookie_file.read_text())
                for c in raw:
                    session.cookies.set(
                        c["name"], c["value"],
                        domain=c.get("domain", ".wattpad.com"),
                        path=c.get("path", "/"),
                    )
                self.logger.info("Loaded %d cookies from Selenium session", len(raw))
        except Exception as exc:
            self.logger.warning("Could not load Selenium cookies: %s", exc)

        api_url = f"{_WATTPAD_API_BASE}/{story_id}?fields={_WATTPAD_API_FIELDS}"
        self.logger.info("[wattpad/story=%s] Fetching full chapter list from API ...", story_id)

        resp = session.get(api_url, timeout=_WATTPAD_API_TIMEOUT)
        if resp.status_code != 200:
            self.logger.error("[wattpad/story=%s] API returned HTTP %d.", story_id, resp.status_code)
            return [], {}

        try:
            data = resp.json()
        except Exception as exc:
            self.logger.error("[wattpad/story=%s] Failed to parse API JSON: %s", story_id, exc)
            return [], {}

        parts: list[dict] = data.get("parts", [])
        self.logger.info("[wattpad/story=%s] API returned %d parts.", story_id, len(parts))
        return parts, data

    def _build_novel_metadata(self, story_data: dict) -> dict:
        user = story_data.get("user", {})
        description = story_data.get("description", "")
        season_current, season_total = parse_season_from_text(description)
        browse = story_data.get("readerBrowseEligibility", {})
        is_paywalled = None if browse.get("eligible") is not False else True

        meta: dict = {
            "source_url": f"https://www.wattpad.com/story/{story_data.get('id', '')}",
            "title": story_data.get("title"),
            "authors": [user.get("name")],
            "author_fullname": user.get("fullname") or user.get("name"),
            "author_avatar": user.get("avatar"),
            "cover_url": story_data.get("cover"),
            "description": description,
            "chapter_count": story_data.get("numParts"),
            "comment_count": story_data.get("commentCount"),
            "views": story_data.get("readCount"),
            "stars": story_data.get("voteCount"),
            "tags": story_data.get("tags"),
            "completed": story_data.get("completed"),
            "mature": story_data.get("mature"),
            "is_paywalled": is_paywalled,
            "paid_model": story_data.get("paidModel"),
            "rating": story_data.get("rating"),
            "season_current": season_current,
            "season_total": season_total,
        }
        return {k: v for k, v in meta.items() if v is not None}

    async def _yield_story_chapters_from_api(
        self,
        story_id: str,
        parts: list[dict],
        start_idx: int = 0,
        fetch_count: Optional[int] = None,
    ) -> AsyncGenerator[Chapter, None]:
        if fetch_count is None:
            fetch_count = self.limit

        limited = parts[start_idx:start_idx + fetch_count]
        self.limit = len(limited)
        self.novel_slug = story_id
        self.logger.info(
            "[wattpad/story=%s] Will crawl %d chapters via API with concurrency=%d.",
            story_id,
            len(limited),
            self.api_concurrency,
        )

        novel_meta = self._build_novel_metadata(self._story_data) if self._story_data else {}
        story_title = (self._story_data or {}).get("title") or story_id

        for batch_start in range(0, len(limited), self.api_concurrency):
            batch = limited[batch_start:batch_start + self.api_concurrency]
            results = await asyncio.gather(
                *[
                    asyncio.to_thread(self._fetch_part_content_api_first, part)
                    for part in batch
                ],
                return_exceptions=True,
            )

            for offset, (part, result) in enumerate(zip(batch, results)):
                chapter_index = start_idx + batch_start + offset
                chapter_number = chapter_index + 1
                part_url = part.get("url") or ""
                chapter_url = urllib.parse.urljoin("https://www.wattpad.com", part_url)
                chapter_title = part.get("title") or f"Chapter {chapter_number}"

                if isinstance(result, Exception):
                    self.logger.warning(
                        "[wattpad/story=%s] API fetch failed for chapter %d '%s': %s",
                        story_id,
                        chapter_number,
                        chapter_title,
                        result,
                    )
                    self._skipped_locked += 1
                    continue

                cleaned_content = clean_chapter_content(result or "")
                word_count = len(cleaned_content.split())
                if word_count < 200:
                    self.logger.warning(
                        "Chapter %d '%s' has only %d words after extraction.",
                        chapter_number,
                        chapter_title,
                        word_count,
                    )

                self._chapters_crawled += 1
                self._saved_chapters += 1
                self.logger.info(
                    "[%d/%d] Crawled chapter %d: %s",
                    self._chapters_crawled,
                    self.limit,
                    chapter_number,
                    chapter_title,
                )

                yield Chapter(
                    novel_slug=story_id,
                    novel_title=story_title,
                    chapter_number=chapter_number,
                    title=chapter_title,
                    content=cleaned_content,
                    source_url=chapter_url,
                    novel_metadata=novel_meta if batch_start == 0 and offset == 0 else None,
                )

    def _fetch_part_content_api_first(self, part: dict) -> str:
        chapter_id = str(part.get("id") or "")
        if not chapter_id:
            return ""

        content = self._fetch_chapter_content_api(chapter_id)
        if content:
            return content

        chapter_url = urllib.parse.urljoin("https://www.wattpad.com", part.get("url") or "")
        return self._fetch_chapter_content_pages(chapter_url, chapter_id)

    async def _dispatch_chapters(
        self, story_id: str, parts: list[dict], start_idx: int = 0, fetch_count: Optional[int] = None,
    ) -> AsyncGenerator:
        if fetch_count is None:
            fetch_count = self.limit
        limited = parts[start_idx:start_idx + fetch_count]
        self.logger.info("[wattpad/story=%s] Will crawl %d chapters.", story_id, len(limited))

        novel_meta = self._build_novel_metadata(self._story_data) if self._story_data else {}

        for i, part in enumerate(limited):
            part_url = part.get("url")
            if not part_url:
                self.logger.warning("[wattpad/story=%s] Part %d has no URL, skipping.", story_id, start_idx + i + 1)
                continue

            chapter_url = urllib.parse.urljoin("https://www.wattpad.com", part_url)
            if i > 0:
                time.sleep(1)

            attach_meta: Optional[dict] = novel_meta if i == 0 else None

            yield scrapy.Request(
                chapter_url,
                callback=self._parse_chapter_page,
                errback=self._handle_error,
                meta={
                    "retry_count": 0,
                    "cookiejar": 0,
                    "chapter_index": start_idx + i,
                    "in_chapter_page": False,
                    "selenium": True,
                    "selenium_timeout": 30,
                    "skip_scroll": True,
                    "chapter_id": str(part.get("id", "")),
                    "part_data": part,
                    "novel_metadata": attach_meta,
                },
                dont_filter=True,
            )

    async def _start_from_chapter_url(self) -> AsyncGenerator:
        self._is_chapter_url_mode = True
        start_url = self.start_urls[0]
        chapter_id = self._story_id_from_url(start_url)
        yield scrapy.Request(
            start_url,
            callback=self._parse_chapter_page,
            errback=self._handle_error,
            meta={
                "retry_count": 0,
                "cookiejar": 0,
                "chapter_index": 0,
                "in_chapter_page": False,
                "selenium": True,
                "selenium_timeout": 30,
                "skip_scroll": True,
                "chapter_id": chapter_id,
            },
            dont_filter=True,
        )

    def build_selector_config(self, config: dict) -> SelectorConfig:
        selectors = config.get("selectors", {})
        return SelectorConfig(
            chapter_list=selectors.get("chapter_list", ".story-parts li a"),
            chapter_body=selectors.get("chapter_body", ".story-content p, .xaclass p"),
            next_chapter=selectors.get("next_chapter", "a.next-part-link"),
            novel_title=selectors.get("novel_title", ".story-title"),
            cover_image=selectors.get("cover_image", ".cover img"),
            author=selectors.get("author", ".author-name a"),
        )

    def _is_chapter_locked(self, response: Response) -> bool:
        if not self._is_paywalled:
            return False

        status = response.status
        url = response.url

        if status == 403:
            self.logger.warning("Chapter page returned HTTP 403 -- treating as locked.")
            return True

        if "/login" in url.lower() or "wattpad.com" not in url:
            return True

        body_text = response.css("::text").getall()
        body_clean = " ".join(t.strip() for t in body_text if t.strip())

        locked_indicators = [
            "this chapter is locked", "this story is locked",
            "continue reading on the wattpad app", "download the app",
            "unlock this chapter", "paid chapters", "coins to unlock",
            "wattpad originals",
        ]
        body_lower = body_clean.lower()
        for indicator in locked_indicators:
            if indicator in body_lower:
                self.logger.warning("Chapter content contains paywall indicator: '%s'", indicator)
                return True

        if len(body_clean) < 200:
            self.logger.warning("Chapter body is suspiciously short (%d chars) -- treating as potentially locked.", len(body_clean))
            return True

        return False

    def _parse_chapter_page(self, response: Response) -> Generator:
        chapter_index = response.meta.get("chapter_index", 0)
        chapter_number = chapter_index + 1

        if not self._is_chapter_url_mode:
            if self._range_start is not None and self._range_end is not None:
                if chapter_number > self._range_end:
                    self.logger.info("Chapter %d is beyond range end (%d) -- skipping.", chapter_number, self._range_end)
                    return
                if chapter_number < self._range_start:
                    self.logger.info("Chapter %d is before range start (%d) -- skipping.", chapter_number, self._range_start)
                    return

        if self._chapters_crawled >= self.limit:
            self.logger.info("Limit reached (%d/%d) -- stopping.", self._chapters_crawled, self.limit)
            return

        url_normalized = self._normalize_url(response.url)
        if url_normalized in self._seen_urls:
            return
        self._seen_urls.add(url_normalized)

        if self._is_chapter_locked(response):
            part_data = response.meta.get("part_data", {})
            chapter_title = part_data.get("title") or response.css(".chapter-title ::text, h2.chapter-title ::text").get() or "(untitled)"
            self.logger.warning("[wattpad/%d] Chapter %d '%s' is locked (Wattpad Original). Skipping.", chapter_number, chapter_number, chapter_title)
            self._skipped_locked += 1
            return

        novel_title = self._extract_novel_title(response)
        chapter_title = self._extract_chapter_title(response)
        self._chapters_crawled += 1

        chapter_id = response.meta.get("chapter_id", "")
        chapter_url = response.url

        if chapter_id:
            content = self._fetch_chapter_content_api(chapter_id)
            if content:
                self.logger.debug("Chapter %d: fetched %d words via API", chapter_number, len(content.split()))
            else:
                self.logger.info("API failed for chapter %s (%s), falling back to page scraping", chapter_id, chapter_title or "(untitled)")
                content = self._fetch_chapter_content_pages(chapter_url, chapter_id)
        else:
            content_parts = self._extract_page_content(response)
            content = "\n\n".join(content_parts)

        cleaned_content = clean_chapter_content(content)
        word_count = len(cleaned_content.split())
        if word_count < 200:
            self.logger.warning("Chapter %d '%s' has only %d words after extraction.", chapter_number, chapter_title or "(untitled)", word_count)

        yield Chapter(
            novel_slug=self._story_id_from_url(response.url),
            novel_title=novel_title,
            chapter_number=chapter_number,
            title=chapter_title,
            content=cleaned_content,
            source_url=response.url,
            novel_metadata=response.meta.get("novel_metadata"),
        )
        self._saved_chapters += 1

        self.logger.info("[%d/%d] Crawled chapter %d: %s", self._chapters_crawled, self.limit, chapter_number, chapter_title or "(untitled)")

        if not self._is_chapter_url_mode:
            pass
        elif self._chapters_crawled < self.limit:
            next_chapter_url = self._extract_next_chapter_url(response)
            if next_chapter_url:
                next_url = response.urljoin(next_chapter_url)
                if next_url not in self._seen_urls:
                    next_chapter_id = self._story_id_from_url(next_url)
                    yield scrapy.Request(
                        next_url,
                        callback=self._parse_chapter_page,
                        errback=self._handle_error,
                        meta={
                            "retry_count": 0,
                            "chapter_index": chapter_index + 1,
                            "in_chapter_page": False,
                            "selenium": True,
                            "selenium_timeout": 30,
                            "skip_scroll": True,
                            "chapter_id": next_chapter_id,
                            "novel_metadata": response.meta.get("novel_metadata"),
                        },
                    )

    def _extract_novel_title(self, response: Response) -> str:
        title = (
            response.css(".story-title ::text, h1.story-title ::text").get()
            or response.css(".story-info h1 ::text").get()
            or response.css("h1 ::text").get()
            or ""
        ).strip()
        return title

    def _extract_chapter_title(self, response: Response) -> str:
        title = (
            response.css(".chapter-title ::text, h2.chapter-title ::text").get()
            or response.css(".story-part-info h2 ::text").get()
            or ""
        ).strip()
        if not title:
            title = self._extract_novel_title(response)
        return title

    def _extract_page_content(self, response: Response) -> list[str]:
        if hasattr(response, "_scroll_paragraphs") and response._scroll_paragraphs:
            paragraphs = response._scroll_paragraphs
            self.logger.debug("Using %d pre-scrolled paragraphs from SeleniumHandler", len(paragraphs))
            return paragraphs

        selectors = [
            ".panel.panel-reading pre p[data-p-id]",
            ".story-content p[data-p-id]",
            "main p[data-p-id]",
        ]
        seen: set[str] = set()
        paragraphs: list[str] = []

        for sel in selectors:
            for p in response.css(f"{sel} ::text").getall():
                text = p.strip()
                if text and len(text) > 10 and text not in seen:
                    seen.add(text)
                    paragraphs.append(text)

        if not paragraphs:
            self.logger.warning("No chapter content found on %s", response.url)
            for t in response.css("::text").getall():
                t = t.strip()
                if len(t) > 50:
                    self.logger.debug("Fallback text: %s", t[:80])

        return paragraphs

    def _extract_next_chapter_url(self, response: Response) -> Optional[str]:
        for sel in [
            "a.primary-variant__NO4pv::attr(href)",
            "a[class*='primary-variant']::attr(href)",
            "#story-part-navigation a::attr(href)",
            "footer .part-navigation a::attr(href)",
        ]:
            href = response.css(sel).get()
            if href:
                return href
        return None

    def _fetch_chapter_content_api(self, chapter_id: str) -> Optional[str]:
        url = "https://www.wattpad.com/apiv2/storytext"
        params = {"id": str(chapter_id), "output": "json"}
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Linux; Android 10; Mobile) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Mobile Safari/537.36"
            ),
            "Referer": "https://www.wattpad.com/",
            "Accept": "application/json",
        }

        try:
            response = requests.get(url, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json()

            raw_html = data.get("text", "")
            if not raw_html:
                self.logger.warning("API returned empty text for chapter %s", chapter_id)
                return None

            soup = BeautifulSoup(raw_html, "html.parser")
            paragraphs = [
                p.get_text().strip()
                for p in soup.find_all("p")
                if p.get_text().strip()
            ]

            seen: set[str] = set()
            unique: list[str] = []
            for p in paragraphs:
                if p not in seen:
                    seen.add(p)
                    unique.append(p)

            content = "\n\n".join(unique)
            self.logger.debug("Chapter %s: %d paragraphs, %d words via API", chapter_id, len(unique), len(content.split()))
            return content

        except Exception as e:
            self.logger.warning("API fetch failed for chapter %s: %s", chapter_id, e)
            return None

    def _fetch_chapter_content_pages(self, chapter_url: str, chapter_id: str) -> str:
        all_paragraphs: list[str] = []
        page_num = 1
        base_url = chapter_url.rstrip("/")
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Referer": "https://www.wattpad.com/",
        }

        while True:
            url = base_url if page_num == 1 else f"{base_url}/page/{page_num}"

            try:
                response = requests.get(url, headers=headers, timeout=30)
                if response.status_code == 404:
                    break

                soup = BeautifulSoup(response.text, "html.parser")
                paragraphs = soup.select("p[data-p-id]")
                if not paragraphs:
                    paragraphs = soup.select(".page p")

                if not paragraphs and page_num > 1:
                    break

                page_texts = [p.get_text().strip() for p in paragraphs if p.get_text().strip()]
                all_paragraphs.extend(page_texts)

                self.logger.debug("Chapter %s page %d: %d paragraphs", chapter_id, page_num, len(page_texts))
                page_num += 1

            except Exception as e:
                self.logger.warning("Page fetch error chapter %s page %d: %s", chapter_id, page_num, e)
                break

        return "\n\n".join(all_paragraphs)

    def parse_chapter(self, response: Response, chapter_index: int) -> Generator[Chapter, None, None]:
        yield from self._parse_chapter_page(response)

    @staticmethod
    def _normalize_url(url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        return parsed._replace(query="", fragment="").geturl().rstrip("/")

    @staticmethod
    def _story_id_from_url(url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        parts = [p for p in parsed.path.split("/") if p]
        for part in parts:
            if part.isdigit():
                return part
        return "wattpad-unknown"

    def closed(self, reason: str) -> None:
        total = self._saved_chapters + self._skipped_locked
        self.logger.info("")
        self.logger.info("=" * 45)
        self.logger.info("  Crawl complete.")
        self.logger.info("  %d chapter(s) saved, %d chapter(s) skipped (locked).", self._saved_chapters, self._skipped_locked)
        if self._skipped_locked > 0 and self._skipped_locked == total:
            self.logger.warning("  All %d chapters were locked. This story may be fully paywalled.", total)
        self.logger.info("=" * 45)
        self.logger.info("")


WattpadSpider.complete = (
    "Wattpad spider complete. Run with: "
    "scrapy crawl wattpad -a novel='https://www.wattpad.com/...'"
)
