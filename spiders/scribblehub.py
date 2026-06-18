"""Spider for scribblehub.com.

Supports:
  Story URL: scrapy crawl scribblehub -a novel="https://www.scribblehub.com/series/117113/isekaid-shoggoth/" -a limit=3
  Chapter URL: scrapy crawl scribblehub -a novel="https://www.scribblehub.com/read/117113-isekaid-shoggoth/chapter/117115/" -a limit=1
"""

from __future__ import annotations

import atexit
import asyncio
try:
    import fcntl
except ImportError:
    fcntl = None  # type: ignore[assignment]  # fcntl is Unix-only; use msvcrt on Windows
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any, Generator, Optional

import requests
import scrapy
from bs4 import BeautifulSoup, Tag
from scrapy.exceptions import CloseSpider

from configs.base_config import load_site_config
from models.chapter import Chapter
from spiders.base_spider import BaseSpider, SelectorConfig
from utils.cleaner import build_promo_patterns, clean_chapter_content
from utils.proxy import get_proxy_url, requests_proxies

try:
    import msvcrt
except ImportError:
    msvcrt = None  # type: ignore[assignment]  # msvcrt is Windows-only; the cookie lock falls back to fcntl


logger = logging.getLogger(__name__)

_SCRIBBLEHUB_BASE = "https://www.scribblehub.com"
_SERIES_PATH_RE = re.compile(r"^/series/(?P<id>\d+)/(?P<slug>[^/?#]+)/?$", re.IGNORECASE)
_CHAPTER_PATH_RE = re.compile(
    r"^/read/(?P<read_slug>(?P<id>\d+)-(?P<slug>[^/?#]+))/chapter/(?P<chapter_id>\d+)/?$",
    re.IGNORECASE,
)
_SPACE_RE = re.compile(r"\s+")
_DATE_SUFFIX_RE = re.compile(
    r"\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$",
    re.IGNORECASE,
)
_SCRIBBLEHUB_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/149.0.0.0 Safari/537.36"
)
_BROWSER_START_LOCK = threading.Lock()
_UC_START_LOCK_FILE = Path(tempfile.gettempdir()) / "scribblehub_uc_start.lock"


class ScribbleHubSpider(BaseSpider):
    name = "scribblehub"
    config_name = "scribblehub"
    download_delay = 0.35

    custom_settings = {
        "DOWNLOAD_DELAY": 0.35,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
    }

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
            raise ValueError("Spider argument 'novel' is required (a full ScribbleHub story or chapter URL).")

        cfg = load_site_config(self.config_name)
        self.selector_config: SelectorConfig = self.build_selector_config(cfg)
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))

        self._start_url = self._normalize_url(self.start_urls[0])
        self._story_id = self._story_id_from_url(self._start_url)
        if not self._story_id:
            raise ValueError(f"Could not extract ScribbleHub story ID from URL: {self._start_url}")

        self.novel_slug = self._story_slug_from_url(self._start_url)
        self.download_delay = self._configured_download_delay()
        self._chapters_crawled = 0
        self._seen_urls: set[str] = set()
        self._html_cache: dict[str, str] = {}
        self._browser: _ScribbleHubBrowser | None = None
        self._session = requests.Session()
        self._session.headers.update(self._headers())
        proxies = requests_proxies("scribblehub")
        if proxies:
            self._session.proxies.update(proxies)
        self._cookies_loaded = False
        if self._env_flag("SCRIBBLEHUB_USE_COOKIES") is True:
            self._load_saved_cookies()

    async def start(self):
        start_url = self._normalize_url(self.start_urls[0])
        story_url = self._story_url_from_any_url(start_url)

        story_html = self._fetch_page_html(story_url)
        story_soup = BeautifulSoup(story_html, "html.parser")
        story_title = self._extract_story_title(story_soup)
        metadata = self._extract_story_metadata(story_soup, story_url)

        selected = self._select_chapters_from_story(story_soup, story_url, start_url)
        self.limit = len(selected)
        self.logger.info(
            "[scribblehub/story=%s] found %d chapter links, target=selected (%d)",
            self.novel_slug,
            self._last_total_count or len(selected),
            len(selected),
        )

        if not selected:
            self.logger.warning("[scribblehub/story=%s] No chapters matched the requested range/limit.", self.novel_slug)
            return

        for idx, chapter_ref in enumerate(selected):
            if idx > 0:
                await asyncio.sleep(self.download_delay)

            chapter = self._crawl_chapter(
                chapter_ref=chapter_ref,
                story_title=story_title,
                metadata=metadata if idx == 0 else None,
            )
            if chapter is None:
                continue

            self._chapters_crawled += 1
            self.logger.info(
                "[%s/%d] Crawled chapter %d: %s",
                self.novel_slug,
                self.limit,
                chapter.chapter_number,
                chapter.title or "(untitled)",
            )
            yield chapter

    def build_selector_config(self, config: dict) -> SelectorConfig:
        selectors = config.get("selectors", {})
        return SelectorConfig(
            chapter_list=selectors.get("chapter_list", "li.toc_w a.toc_a[href*='/read/'][href*='/chapter/']"),
            chapter_body=selectors.get("chapter_body", "#chp_raw"),
            next_chapter=selectors.get("next_chapter", ".nextprev a[href*='/chapter/'], a:contains('Next')"),
            novel_title=selectors.get("novel_title", ".fic_title"),
            cover_image=selectors.get("cover_image", ".fic_image img, meta[property='og:image']"),
            author=selectors.get("author", ".auth_name_fic a, .auth_name_fic"),
        )

    @property
    def _last_total_count(self) -> Optional[int]:
        return getattr(self, "__last_total_count", None)

    @_last_total_count.setter
    def _last_total_count(self, value: Optional[int]) -> None:
        setattr(self, "__last_total_count", value)

    def _headers(self) -> dict[str, str]:
        return {
            "User-Agent": os.getenv("SCRIBBLEHUB_USER_AGENT", _SCRIBBLEHUB_USER_AGENT),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": _SCRIBBLEHUB_BASE + "/",
            "Cache-Control": "max-age=0",
            "Upgrade-Insecure-Requests": "1",
        }

    def _configured_download_delay(self) -> float:
        raw = os.getenv("SCRIBBLEHUB_DOWNLOAD_DELAY")
        if raw is None:
            return self.download_delay
        try:
            return max(0.0, float(raw))
        except ValueError:
            self.logger.warning("Invalid SCRIBBLEHUB_DOWNLOAD_DELAY '%s' - using %.2fs.", raw, self.download_delay)
            return self.download_delay

    def _env_flag(self, name: str) -> bool | None:
        value = os.environ.get(name)
        if value is None:
            return None
        return value.strip().lower() in {"1", "true", "yes", "on"}

    def _fetch_page_html(self, url: str, timeout: int = 30) -> str:
        url = self._normalize_url(url, keep_query=True)
        cached = self._html_cache.get(url)
        if cached is not None:
            return cached
        try:
            response = self._session.get(url, timeout=timeout)
            if response.status_code == 200 and not self._is_cloudflare_challenge(response.text):
                self._html_cache[url] = response.text
                return response.text
            self.logger.info(
                "[scribblehub] Requests fetch returned HTTP %s/challenge for %s; retrying with browser.",
                response.status_code,
                url,
            )
        except Exception as exc:
            self.logger.debug("[scribblehub] Requests fetch failed for %s: %s; retrying with browser.", url, exc)

        self._clear_cloudflare_cookies()
        browser = self._get_browser()
        html = browser.fetch_page(url, timeout=75)
        self._apply_browser_cookies(browser.cookies())
        browser_user_agent = browser.user_agent()
        if browser_user_agent:
            self._session.headers["User-Agent"] = browser_user_agent
        if self._is_cloudflare_challenge(html):
            raise CloseSpider(
                "[scribblehub] Cloudflare challenge did not clear. "
                "Open ScribbleHub once in the crawler browser profile and retry."
            )
        self._html_cache[url] = html
        return html

    def _select_chapters_from_story(
        self,
        story_soup: BeautifulSoup,
        story_url: str,
        start_url: str,
    ) -> list[dict[str, Any]]:
        total_count = self._extract_total_chapter_count(story_soup)
        self._last_total_count = total_count

        if self._range_start is not None and self._range_end is not None:
            target_ordinals = set(range(self._range_start, self._range_end + 1))
            links = self._collect_chapter_links(
                story_soup=story_soup,
                story_url=story_url,
                target_ordinals=target_ordinals,
                fetch_all=False,
            )
            return [link for link in links if link["chapter_number"] in target_ordinals]

        if self._is_chapter_url(start_url):
            start_chapter_id = self._chapter_id_from_url(start_url)
            direct_number, direct_title = self._chapter_title_from_direct_url(start_url)
            if direct_number:
                if self.limit <= 1:
                    return [{
                        "chapter_number": direct_number,
                        "title": direct_title or f"Chapter {direct_number}",
                        "url": start_url,
                        "chapter_id": start_chapter_id or "",
                    }]

                target_ordinals = set(range(direct_number, direct_number + self.limit))
                links = self._collect_chapter_links(
                    story_soup=story_soup,
                    story_url=story_url,
                    target_ordinals=target_ordinals,
                    fetch_all=False,
                )
                if links:
                    return [link for link in links if int(link["chapter_number"]) in target_ordinals][:self.limit]

            links = self._collect_chapter_links(
                story_soup=story_soup,
                story_url=story_url,
                target_chapter_id=start_chapter_id,
                fetch_all=True,
            )
            start_ordinal = self._ordinal_for_chapter_id(links, start_chapter_id)
            if start_ordinal is None:
                start_title = self._chapter_title_from_direct_url(start_url)
                return [{
                    "chapter_number": start_title[0] or 1,
                    "title": start_title[1],
                    "url": start_url,
                    "chapter_id": start_chapter_id or "",
                }]
            return [
                link for link in links
                if start_ordinal <= int(link["chapter_number"]) < start_ordinal + self.limit
            ][:self.limit]

        target_ordinals = set(range(1, self.limit + 1))
        links = self._collect_chapter_links(
            story_soup=story_soup,
            story_url=story_url,
            target_ordinals=target_ordinals,
            fetch_all=False,
        )
        return [link for link in links if link["chapter_number"] in target_ordinals][:self.limit]

    def _collect_chapter_links(
        self,
        story_soup: BeautifulSoup,
        story_url: str,
        target_ordinals: Optional[set[int]] = None,
        target_chapter_id: Optional[str] = None,
        fetch_all: bool = False,
    ) -> list[dict[str, Any]]:
        first_rows = self._parse_toc_rows(story_soup, story_url=story_url, page_number=1)
        total_count = self._extract_total_chapter_count(story_soup) or len(first_rows)
        self._last_total_count = total_count or None
        per_page = len(first_rows) or self._extract_selected_chapters_per_page(story_soup) or 15
        page_count = self._extract_toc_page_count(story_soup, total_count=total_count, per_page=per_page)

        pages_to_fetch = self._pages_for_selection(
            target_ordinals=target_ordinals,
            total_count=total_count,
            per_page=per_page,
            page_count=page_count,
            fetch_all=fetch_all or bool(target_chapter_id),
        )

        links_by_url: dict[str, dict[str, Any]] = {}
        for link in self._assign_chapter_numbers(first_rows, page_number=1, total_count=total_count, per_page=per_page):
            links_by_url[link["url"]] = link

        for page_number in sorted(pages_to_fetch - {1}):
            page_url = self._toc_page_url(story_url, page_number)
            html = self._fetch_page_html(page_url)
            soup = BeautifulSoup(html, "html.parser")
            rows = self._parse_toc_rows(soup, story_url=story_url, page_number=page_number)
            for link in self._assign_chapter_numbers(rows, page_number=page_number, total_count=total_count, per_page=per_page):
                links_by_url[link["url"]] = link

            if target_chapter_id and any(link.get("chapter_id") == target_chapter_id for link in links_by_url.values()):
                if not target_ordinals:
                    continue

        links = sorted(links_by_url.values(), key=lambda item: int(item["chapter_number"]))
        if target_ordinals:
            links = [link for link in links if int(link["chapter_number"]) in target_ordinals]
        return links

    def _parse_toc_rows(self, soup: BeautifulSoup, story_url: str, page_number: int) -> list[dict[str, Any]]:
        story_id = self._story_id_from_url(story_url)
        rows: list[dict[str, Any]] = []
        for li in soup.select("li.toc_w"):
            anchor = li.select_one(self.selector_config.chapter_list) or li.select_one(
                "a[href*='/read/'][href*='/chapter/']"
            )
            if not anchor:
                continue

            href = anchor.get("href")
            if not href:
                continue

            absolute = self._normalize_url(urllib.parse.urljoin(_SCRIBBLEHUB_BASE, href))
            chapter_story_id = self._story_id_from_url(absolute)
            if story_id and chapter_story_id and chapter_story_id != story_id:
                continue

            title = self._clean_chapter_link_title(anchor.get_text(" ", strip=True), li.get_text(" ", strip=True))
            chapter_id = self._chapter_id_from_url(absolute) or ""
            rows.append({
                "title": title,
                "url": absolute,
                "chapter_id": chapter_id,
                "page_number": page_number,
            })
        return rows

    def _assign_chapter_numbers(
        self,
        rows: list[dict[str, Any]],
        page_number: int,
        total_count: int,
        per_page: int,
    ) -> list[dict[str, Any]]:
        assigned: list[dict[str, Any]] = []
        for row_index, row in enumerate(rows):
            desc_position = ((page_number - 1) * per_page) + row_index
            chapter_number = max(1, total_count - desc_position) if total_count else len(rows) - row_index
            assigned.append({
                **row,
                "chapter_number": chapter_number,
                "title": row.get("title") or f"Chapter {chapter_number}",
            })
        return assigned

    def _pages_for_selection(
        self,
        target_ordinals: Optional[set[int]],
        total_count: int,
        per_page: int,
        page_count: int,
        fetch_all: bool,
    ) -> set[int]:
        if fetch_all or not total_count or not per_page:
            return set(range(1, max(page_count, 1) + 1))

        pages = {1}
        if not target_ordinals:
            return pages

        for ordinal in target_ordinals:
            if ordinal < 1 or ordinal > total_count:
                continue
            desc_position = total_count - ordinal
            page = (desc_position // per_page) + 1
            if 1 <= page <= page_count:
                pages.add(page)
        return pages

    def _crawl_chapter(
        self,
        chapter_ref: dict[str, Any],
        story_title: str,
        metadata: Optional[dict[str, Any]],
    ) -> Chapter | None:
        chapter_url = self._normalize_url(chapter_ref["url"])
        if chapter_url in self._seen_urls:
            return None
        self._seen_urls.add(chapter_url)

        html = self._fetch_page_html(chapter_url)
        soup = BeautifulSoup(html, "html.parser")
        chapter_number = int(chapter_ref["chapter_number"])
        chapter_title = self._extract_chapter_title(soup) or chapter_ref.get("title") or f"Chapter {chapter_number}"
        content = self._extract_chapter_content(soup)
        cleaned_content = clean_chapter_content(content, self._promo_patterns)

        if not cleaned_content:
            self.logger.warning("[scribblehub/%d] No chapter content extracted from %s", chapter_number, chapter_url)
            return None

        word_count = len(cleaned_content.split())
        if word_count < 50:
            self.logger.warning(
                "[scribblehub/%d] Chapter '%s' has only %d words.",
                chapter_number,
                chapter_title,
                word_count,
            )

        return Chapter(
            novel_slug=self.novel_slug,
            novel_title=story_title or (metadata or {}).get("title", "") or self.novel_slug,
            chapter_number=chapter_number,
            title=chapter_title,
            content=cleaned_content,
            source_url=chapter_url,
            novel_metadata=metadata,
        )

    def _extract_chapter_content(self, soup: BeautifulSoup) -> str:
        container = soup.select_one(self.selector_config.chapter_body) or soup.select_one(".chp_raw")
        if container is None:
            return ""

        clone = BeautifulSoup(str(container), "html.parser")
        root = clone.find()
        if root is None:
            return ""

        for unwanted in root.select(
            "script, style, noscript, iframe, ins, button, form, textarea, "
            ".adsbygoogle, .sharedaddy, .code-block, .wi_authornotes, .authornote, "
            ".chapter-nav, .nav-links, .modern-footnotes-footnote__note"
        ):
            unwanted.decompose()

        paragraphs: list[str] = []
        paragraph_nodes = root.select("p")
        if paragraph_nodes:
            for paragraph in paragraph_nodes:
                text = self._clean_text(paragraph.get_text(" ", strip=True))
                if self._is_content_line(text):
                    paragraphs.append(text)
        else:
            raw_lines = [
                self._clean_text(line)
                for line in root.get_text("\n", strip=True).splitlines()
            ]
            paragraphs = [line for line in raw_lines if self._is_content_line(line)]

        return "\n\n".join(paragraphs)

    def _is_content_line(self, text: str) -> bool:
        if not text:
            return False
        lower = text.lower()
        blocked_labels = [
            "previous",
            "next",
            "table of contents",
            "reading options",
            "font size",
            "login to post comment",
            "report",
            "reply",
            "comments",
            "scribble hub",
        ]
        if lower in blocked_labels:
            return False
        if not re.search(r"[A-Za-z0-9]", text):
            return False
        return True

    def _extract_story_metadata(self, soup: BeautifulSoup, source_url: str) -> dict[str, Any]:
        author = self._extract_author(soup)
        metadata: dict[str, Any] = {
            "source_url": source_url,
            "title": self._extract_story_title(soup),
            "authors": [author] if author else None,
            "author": author,
            "cover_url": self._extract_image_url(soup),
            "description": self._extract_description(soup),
            "num_parts": self._extract_total_chapter_count(soup),
            "tags": self._extract_tags(soup),
        }
        return {key: value for key, value in metadata.items() if value not in ("", None, [])}

    def _extract_story_title(self, soup: BeautifulSoup) -> str:
        for selector in [self.selector_config.novel_title, "meta[property='og:title']", "title"]:
            value = self._selector_text_or_content(soup, selector)
            if value:
                return self._clean_story_title(value)
        return ""

    def _extract_chapter_title(self, soup: BeautifulSoup) -> str:
        for selector in [".chapter-title", "meta[property='og:title']", "title"]:
            value = self._selector_text_or_content(soup, selector)
            if value:
                return self._clean_chapter_title(value)
        return ""

    def _extract_author(self, soup: BeautifulSoup) -> str:
        for selector in [self.selector_config.author, "meta[name='author']"]:
            value = self._selector_text_or_content(soup, selector)
            if value:
                return value
        return ""

    def _extract_description(self, soup: BeautifulSoup) -> str:
        for selector in [".wi_fic_desc", "meta[name='description']"]:
            value = self._selector_text_or_content(soup, selector)
            if value:
                return value
        return ""

    def _extract_image_url(self, soup: BeautifulSoup) -> str:
        for selector in [self.selector_config.cover_image, "meta[property='og:image']"]:
            element = soup.select_one(selector)
            if not element:
                continue
            url = element.get("content") if element.name == "meta" else (element.get("src") or element.get("data-src"))
            if url:
                return urllib.parse.urljoin(_SCRIBBLEHUB_BASE, url)
        return ""

    def _extract_tags(self, soup: BeautifulSoup) -> list[str]:
        tags: list[str] = []
        for anchor in soup.select("a.fic_genre[href*='/genre/'], a.stag[href*='/tag/']"):
            text = self._clean_text(anchor.get_text(" ", strip=True))
            if text and text not in tags:
                tags.append(text)
        return tags

    def _extract_total_chapter_count(self, soup: BeautifulSoup) -> int:
        for selector in [".wi_novel_title.tags.toc .cnt_toc", ".cnt_toc"]:
            element = soup.select_one(selector)
            if not element:
                continue
            match = re.search(r"\d+", element.get_text(" ", strip=True))
            if match:
                return int(match.group(0))
        return 0

    def _extract_selected_chapters_per_page(self, soup: BeautifulSoup) -> int:
        selected = soup.select_one("#show_chapters option[selected]")
        if selected:
            try:
                return int(selected.get("value") or selected.get_text(strip=True))
            except ValueError:
                pass
        return 0

    def _extract_toc_page_count(self, soup: BeautifulSoup, total_count: int, per_page: int) -> int:
        page_numbers = []
        for anchor in soup.select("#pagination-mesh-toc a.page-link"):
            text = self._clean_text(anchor.get_text(" ", strip=True))
            if text.isdigit():
                page_numbers.append(int(text))
        if page_numbers:
            return max(page_numbers)
        if total_count and per_page:
            return max(1, (total_count + per_page - 1) // per_page)
        return 1

    def _selector_text_or_content(self, soup: BeautifulSoup, selector: str) -> str:
        element = soup.select_one(selector)
        if not element:
            return ""
        if element.name == "meta":
            return self._clean_text(element.get("content", ""))
        return self._clean_text(element.get_text(" ", strip=True))

    def _clean_chapter_link_title(self, title: str, fallback_text: str) -> str:
        cleaned = self._clean_text(title)
        if not cleaned or cleaned.lower() == "read":
            cleaned = self._clean_text(fallback_text)
        cleaned = _DATE_SUFFIX_RE.sub("", cleaned).strip()
        return cleaned

    def _clean_story_title(self, title: str) -> str:
        title = self._clean_text(title)
        title = re.sub(r"\s*\|\s*Scribble Hub\s*$", "", title, flags=re.IGNORECASE)
        title = re.sub(r"\s*-\s*Scribble Hub\s*$", "", title, flags=re.IGNORECASE)
        return title.strip()

    def _clean_chapter_title(self, title: str) -> str:
        title = self._clean_text(title)
        title = re.sub(r"\s*\|\s*Scribble Hub\s*$", "", title, flags=re.IGNORECASE)
        title = re.sub(r"^.+?\s+-\s+(Chapter\s+.+)$", r"\1", title, flags=re.IGNORECASE)
        return title.strip()

    def _clean_text(self, text: str) -> str:
        text = text.replace("\ufeff", " ").replace("\xa0", " ")
        return _SPACE_RE.sub(" ", text).strip()

    def _chapter_title_from_direct_url(self, url: str) -> tuple[Optional[int], str]:
        html = self._fetch_page_html(url)
        soup = BeautifulSoup(html, "html.parser")
        title = self._extract_chapter_title(soup)
        match = re.search(r"\bchapter\s+(\d+)\b", title, flags=re.IGNORECASE)
        return (int(match.group(1)) if match else None), title

    def _ordinal_for_chapter_id(self, links: list[dict[str, Any]], chapter_id: Optional[str]) -> Optional[int]:
        if not chapter_id:
            return None
        for link in links:
            if str(link.get("chapter_id")) == str(chapter_id):
                return int(link["chapter_number"])
        return None

    def _story_id_from_url(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        series_match = _SERIES_PATH_RE.match(parsed.path)
        if series_match:
            return series_match.group("id")
        chapter_match = _CHAPTER_PATH_RE.match(parsed.path)
        if chapter_match:
            return chapter_match.group("id")
        return ""

    def _story_slug_from_url(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        series_match = _SERIES_PATH_RE.match(parsed.path)
        if series_match:
            return series_match.group("slug")
        chapter_match = _CHAPTER_PATH_RE.match(parsed.path)
        if chapter_match:
            return chapter_match.group("slug")
        return self._story_id_from_url(url) or "scribblehub-unknown"

    def _story_url_from_any_url(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        series_match = _SERIES_PATH_RE.match(parsed.path)
        if series_match:
            return self._normalize_url(url)
        chapter_match = _CHAPTER_PATH_RE.match(parsed.path)
        if chapter_match:
            return f"{_SCRIBBLEHUB_BASE}/series/{chapter_match.group('id')}/{chapter_match.group('slug')}/"
        return self._normalize_url(url)

    def _chapter_id_from_url(self, url: str) -> Optional[str]:
        match = _CHAPTER_PATH_RE.match(urllib.parse.urlparse(url).path)
        return match.group("chapter_id") if match else None

    def _is_chapter_url(self, url: str) -> bool:
        return _CHAPTER_PATH_RE.match(urllib.parse.urlparse(url).path) is not None

    def _toc_page_url(self, story_url: str, page_number: int) -> str:
        base = self._normalize_url(story_url)
        if page_number <= 1:
            return base
        return f"{base}?toc={page_number}#content1"

    def _normalize_url(self, url: str, keep_query: bool = False) -> str:
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme or "https"
        netloc = parsed.netloc.lower() or "www.scribblehub.com"
        if netloc == "scribblehub.com":
            netloc = "www.scribblehub.com"
        path = parsed.path.rstrip("/") + "/" if parsed.path and parsed.path != "/" else "/"
        query = parsed.query if keep_query else ""
        fragment = parsed.fragment if keep_query else ""
        return urllib.parse.urlunparse((scheme, netloc, path, "", query, fragment))

    def _is_cloudflare_challenge(self, html: str) -> bool:
        head = html[:20000]
        if ("fic_title" in html or "chp_raw" in html or "toc_w" in html) and "Just a moment" not in head:
            return False
        return (
            "Just a moment" in head
            or "Enable JavaScript and cookies to continue" in head
            or "cf_chl" in head
            or "/cdn-cgi/challenge-platform/" in head
        )

    def _load_saved_cookies(self) -> int:
        self._cookies_loaded = True
        cookie_file = self._cookie_file()
        if not cookie_file.exists():
            return 0
        try:
            cookies = json.loads(cookie_file.read_text(encoding="utf-8"))
        except Exception as exc:
            self.logger.debug("[scribblehub] Could not read cookie file %s: %s", cookie_file.name, exc)
            return 0
        if not isinstance(cookies, list):
            return 0
        loaded = 0
        for cookie in cookies:
            name = cookie.get("name")
            value = cookie.get("value")
            if not name or value is None:
                continue
            self._session.cookies.set(
                name,
                value,
                domain=cookie.get("domain", ".scribblehub.com"),
                path=cookie.get("path", "/"),
            )
            loaded += 1
        if loaded:
            self.logger.info("[scribblehub] Loaded %d saved cookie(s) from %s", loaded, cookie_file.name)
        return loaded

    def _apply_browser_cookies(self, cookies: list[dict[str, Any]]) -> None:
        for cookie in cookies:
            name = cookie.get("name")
            value = cookie.get("value")
            if not name or value is None:
                continue
            self._session.cookies.set(
                name,
                value,
                domain=cookie.get("domain", ".scribblehub.com"),
                path=cookie.get("path", "/"),
            )

    def _clear_cloudflare_cookies(self) -> None:
        for cookie in list(self._session.cookies):
            if cookie.name != "cf_clearance":
                continue
            try:
                self._session.cookies.clear(cookie.domain, cookie.path, cookie.name)
            except Exception:
                pass

    def _cookie_file(self) -> Path:
        return Path(__file__).parent.parent / "handlers" / "selenium_cookies_scribblehub_com.json"

    def _get_browser(self) -> "_ScribbleHubBrowser":
        if self._browser is None:
            self._browser = _ScribbleHubBrowser(logger=self.logger, cookie_file=self._cookie_file())
        return self._browser

    def parse_chapter(self, response: scrapy.http.Response, chapter_index: int) -> Generator[Chapter, None, None]:
        raise NotImplementedError("ScribbleHubSpider parses pages through direct HTTP requests.")

    def closed(self, reason: str) -> None:
        if self._browser is not None:
            self._browser.close()
        self.logger.info("")
        self.logger.info("=" * 45)
        self.logger.info("  ScribbleHub crawl complete.")
        self.logger.info("  %d chapter(s) saved.", self._chapters_crawled)
        self.logger.info("=" * 45)
        self.logger.info("")


class _FileLock:
    def __init__(self, path: Path, logger: logging.Logger, timeout: float = 90.0, stale_after: float = 180.0):
        self.path = path
        self.logger = logger
        self.timeout = timeout
        self.stale_after = stale_after
        self._fd: int | None = None

    def __enter__(self):
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                self._fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self._fd, str(os.getpid()).encode("ascii", errors="ignore"))
                return self
            except FileExistsError:
                self._remove_stale_lock()
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Timed out waiting for {self.path}")
                time.sleep(0.25)

    def __exit__(self, exc_type, exc, traceback) -> None:
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            self.logger.debug("[scribblehub] Could not remove startup lock %s: %s", self.path, exc)

    def _remove_stale_lock(self) -> None:
        try:
            age = time.time() - self.path.stat().st_mtime
        except FileNotFoundError:
            return
        except OSError:
            return
        if age < self.stale_after:
            return
        try:
            self.path.unlink()
            self.logger.warning("[scribblehub] Removed stale Chrome startup lock %s.", self.path)
        except OSError:
            pass


class _ScribbleHubBrowser:
    def __init__(self, logger: logging.Logger, cookie_file: Path):
        self.logger = logger
        self._driver: Any = None
        self._xvfb_process: subprocess.Popen[Any] | None = None
        self._previous_display: str | None = None
        self._profile_dir = Path(
            os.getenv("SCRIBBLEHUB_CHROME_PROFILE", Path(tempfile.gettempdir()) / "scribblehub_crawler_profile")
        )
        self._cookie_file = cookie_file
        self._persist_cookies = True
        atexit.register(self.close)

    def fetch_page(self, url: str, timeout: int = 75) -> str:
        with _BROWSER_START_LOCK:
            with _FileLock(_UC_START_LOCK_FILE, self.logger):
                return self._fetch_page_unlocked(url, timeout=timeout)

    def _fetch_page_unlocked(self, url: str, timeout: int = 75) -> str:
        last_exc: Exception | None = None
        for attempt in range(1, 3):
            try:
                driver = self._driver_or_start()
                driver.get(url)
                self._wait_for_page(timeout)
                self._dismiss_overlays()
                page_source = driver.page_source
                self._save_cookies()
                return page_source
            except Exception as exc:
                last_exc = exc
                if attempt >= 2:
                    break
                self.logger.warning(
                    "[scribblehub] Browser fetch failed on attempt %d (%s); restarting Chrome once.",
                    attempt,
                    self._short_error(exc),
                )
                self.close(save_cookies=False)
                time.sleep(1.0)
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("ScribbleHub browser fetch failed without an exception.")

    def cookies(self) -> list[dict[str, Any]]:
        if self._driver is None:
            return []
        try:
            return list(self._driver.get_cookies())
        except Exception:
            return []

    def user_agent(self) -> str:
        if self._driver is None:
            return ""
        try:
            return str(self._driver.execute_script("return navigator.userAgent") or "")
        except Exception:
            return ""

    def _driver_or_start(self):
        if self._driver is not None:
            try:
                self._driver.current_url
                return self._driver
            except Exception:
                self.close()

        headless = self._should_run_headless()
        if self._env_flag("SCRIBBLEHUB_HEADLESS") is None and headless and self._start_virtual_display():
            headless = False
        use_uc = self._should_use_undetected_chromedriver(headless)
        uc = None

        if use_uc:
            try:
                import undetected_chromedriver as uc

                Options = uc.ChromeOptions
            except Exception as exc:
                self.logger.warning("[scribblehub] undetected-chromedriver unavailable (%s); using Selenium.", exc)
                use_uc = False

        if not use_uc:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.chrome.service import Service

        options = Options()
        if headless:
            options.add_argument("--headless=new")
        options.add_argument("--window-size=1400,1000")
        browser_user_agent = os.getenv("SCRIBBLEHUB_BROWSER_USER_AGENT")
        if browser_user_agent:
            options.add_argument(f"--user-agent={browser_user_agent}")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-infobars")
        options.add_argument("--remote-debugging-port=0")
        options.add_argument("--no-first-run")
        options.add_argument("--no-default-browser-check")
        if not use_uc:
            options.add_experimental_option("excludeSwitches", ["enable-automation"])
            options.add_experimental_option("useAutomationExtension", False)

        chrome_bin = os.environ.get("CHROME_BIN")
        if chrome_bin and Path(chrome_bin).exists():
            options.binary_location = chrome_bin
        elif Path("/usr/bin/chromium").exists():
            options.binary_location = "/usr/bin/chromium"

        self._profile_dir.mkdir(parents=True, exist_ok=True)
        if (headless or self._xvfb_process is not None) and not os.environ.get("SCRIBBLEHUB_CHROME_PROFILE"):
            self._profile_dir = Path(tempfile.mkdtemp(prefix=f"scribblehub_crawler_profile_{os.getpid()}_"))
        options.add_argument(f"--user-data-dir={self._profile_dir}")
        options.add_argument("--profile-directory=Default")

        proxy_url = get_proxy_url("scribblehub")
        if proxy_url:
            options.add_argument(f"--proxy-server={proxy_url}")

        mode = "headless" if headless else "visible"
        driver_kind = "undetected-chromedriver" if use_uc else "Selenium"
        self.logger.info(
            "[scribblehub] Starting %s Chrome via %s. Binary=%s Profile=%s",
            mode,
            driver_kind,
            getattr(options, "binary_location", None) or "auto-detect",
            self._profile_dir,
        )
        self._persist_cookies = (not headless) or (self._env_flag("SCRIBBLEHUB_USE_COOKIES") is True)

        if use_uc and uc is not None:
            try:
                self._driver = uc.Chrome(options=options, headless=headless, use_subprocess=True)
            except Exception as exc:
                self.logger.warning("[scribblehub] undetected Chrome failed (%s); retrying with Selenium.", exc)
                use_uc = False

        if not use_uc:
            from selenium import webdriver
            from selenium.webdriver.chrome.service import Service

            chromedriver_path = self._resolve_chromedriver()
            service = Service(executable_path=chromedriver_path) if chromedriver_path else Service()
            self._driver = webdriver.Chrome(service=service, options=options)
            self._driver.execute_cdp_cmd(
                "Page.addScriptToEvaluateOnNewDocument",
                {
                    "source": """
                        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                        window.navigator.chrome = { runtime: {} };
                        Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
                        Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
                    """,
                },
            )
        if self._env_flag("SCRIBBLEHUB_USE_COOKIES") is True:
            self._inject_cookies()
        return self._driver

    def _env_flag(self, name: str) -> bool | None:
        value = os.environ.get(name)
        if value is None:
            return None
        return value.strip().lower() in {"1", "true", "yes", "on"}

    def _should_run_headless(self) -> bool:
        explicit = self._env_flag("SCRIBBLEHUB_HEADLESS")
        if explicit is not None:
            return explicit
        if Path("/.dockerenv").exists() or os.environ.get("container"):
            return True
        if os.name != "nt" and not os.environ.get("DISPLAY"):
            return True
        return False

    def _start_virtual_display(self) -> bool:
        if os.name == "nt":
            return False
        xvfb = shutil.which("Xvfb")
        if not xvfb:
            return False

        base_display = 90 + (os.getpid() % 800)
        for offset in range(10):
            display = f":{base_display + offset}"
            lock_file = Path(f"/tmp/.X{display[1:]}-lock")
            if lock_file.exists():
                continue
            process = None
            try:
                process = subprocess.Popen(
                    [xvfb, display, "-screen", "0", "1400x1000x24", "-nolisten", "tcp"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                time.sleep(0.25)
                if process.poll() is None:
                    self._previous_display = os.environ.get("DISPLAY")
                    os.environ["DISPLAY"] = display
                    self._xvfb_process = process
                    self.logger.info("[scribblehub] Started Xvfb display %s for visible Chrome.", display)
                    return True
            except Exception as exc:
                self.logger.debug("[scribblehub] Could not start Xvfb on %s: %s", display, exc)
            if process is not None:
                try:
                    process.terminate()
                except Exception:
                    pass
        return False

    def _should_use_undetected_chromedriver(self, headless: bool) -> bool:
        explicit = self._env_flag("SCRIBBLEHUB_USE_UC")
        if explicit is not None:
            return explicit
        return not headless

    def _wait_for_page(self, timeout: int) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                title = self._driver.title or ""
                has_content = self._driver.execute_script(
                    "return !!document.querySelector('.fic_title, #chp_raw, li.toc_w')"
                )
                if "Just a moment" not in title and has_content:
                    return
            except Exception as exc:
                if self._is_driver_connection_error(exc):
                    raise RuntimeError(f"ScribbleHub browser session died: {self._short_error(exc)}") from exc
            time.sleep(0.5)

    def _dismiss_overlays(self) -> None:
        try:
            self._driver.execute_script(
                """
                document.querySelectorAll(
                  '.fc-ab-root,.fc-dialog,.google-auto-placed,.adsbygoogle,' +
                  '[id*="overlay"],[class*="overlay"],iframe'
                ).forEach(function(el) {
                  var text = (el.innerText || '').toLowerCase();
                  var id = (el.id || '').toLowerCase();
                  var cls = (el.className || '').toString().toLowerCase();
                  if (
                    id.indexOf('overlay') >= 0 ||
                    cls.indexOf('overlay') >= 0 ||
                    text.indexOf('click allow') >= 0 ||
                    text.indexOf('ad blocker') >= 0
                  ) {
                    el.remove();
                  }
                });
                """
            )
        except Exception:
            pass

    def _inject_cookies(self) -> None:
        if not self._persist_cookies or not self._cookie_file.exists():
            return
        try:
            self._driver.get(_SCRIBBLEHUB_BASE)
            cookies = json.loads(self._cookie_file.read_text(encoding="utf-8"))
            for cookie in cookies:
                try:
                    self._driver.add_cookie({
                        "name": cookie["name"],
                        "value": cookie["value"],
                        "domain": cookie.get("domain", ".scribblehub.com"),
                        "path": cookie.get("path", "/"),
                    })
                except Exception:
                    pass
            self.logger.info("[scribblehub] Loaded %d cookie(s) from %s", len(cookies), self._cookie_file.name)
        except Exception as exc:
            self.logger.debug("[scribblehub] Could not inject saved cookies: %s", exc)

    def _save_cookies(self) -> None:
        if not self._persist_cookies:
            return
        try:
            cookies = self._driver.get_cookies()
            if not cookies:
                return
            cookie_path = self._cookie_file
            with open(cookie_path, "r+") as f:
                try:
                    if os.name == "nt" and msvcrt is not None:
                        msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
                    elif fcntl is not None:
                        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                    f.seek(0)
                    json.dump(cookies, f, indent=2)
                    f.truncate()
                finally:
                    if os.name == "nt" and msvcrt is not None:
                        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
                    elif fcntl is not None:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except Exception as exc:
            self.logger.debug("[scribblehub] Could not save cookies: %s", exc)

    def _resolve_chromedriver(self) -> str | None:
        if os.environ.get("CHROMEDRIVER_PATH"):
            return os.environ["CHROMEDRIVER_PATH"]
        found = shutil.which("chromedriver")
        if found:
            return found
        try:
            from webdriver_manager.chrome import ChromeDriverManager

            return ChromeDriverManager().install()
        except Exception as exc:
            self.logger.warning("[scribblehub] webdriver-manager failed (%s); falling back to Selenium Manager.", exc)
            return None

    def _is_driver_connection_error(self, exc: Exception) -> bool:
        text = f"{type(exc).__name__}: {exc}".lower()
        return any(
            fragment in text
            for fragment in (
                "connection refused",
                "remote disconnected",
                "failed to establish a new connection",
                "max retries exceeded",
                "chrome not reachable",
                "disconnected: not connected to devtools",
                "invalid session id",
            )
        )

    def _short_error(self, exc: Exception) -> str:
        text = f"{type(exc).__name__}: {exc}"
        text = _SPACE_RE.sub(" ", text).strip()
        return text[:240]

    def close(self, save_cookies: bool = True) -> None:
        if self._driver is not None:
            try:
                if save_cookies:
                    self._save_cookies()
                self._driver.quit()
            except Exception:
                pass
            self._driver = None
        if self._xvfb_process is not None:
            try:
                self._xvfb_process.terminate()
                self._xvfb_process.wait(timeout=2)
            except Exception:
                try:
                    self._xvfb_process.kill()
                except Exception:
                    pass
            self._xvfb_process = None
            if self._previous_display is None:
                os.environ.pop("DISPLAY", None)
            else:
                os.environ["DISPLAY"] = self._previous_display
                self._previous_display = None


ScribbleHubSpider.complete = (
    "ScribbleHub spider complete. Run with: "
    "scrapy crawl scribblehub -a novel='https://www.scribblehub.com/series/...'"
)
