"""Spider for novelhall.com.

Supports:
  Story URL:   scrapy crawl novelhall -a novel="https://www.novelhall.com/the-31st-piece-turns-the-tables-33794/" -a limit=3
  Chapter URL: scrapy crawl novelhall -a novel="https://www.novelhall.com/the-31st-piece-turns-the-tables-33794/14954100.html" -a limit=1

NovelHall sits behind a Cloudflare managed challenge. The spider fetches with plain
``requests`` replaying saved ``cf_clearance`` cookies; on a challenge it self-heals via
FlareSolverr (Docker), persisting the fresh cookies for the rest of the crawl. The full
chapter catalogue is rendered on the story page (``#morelist``) with no TOC pagination,
so chapter selection needs a single fetch.
"""

from __future__ import annotations

import asyncio
import re
import urllib.parse
from typing import Any, Generator, Optional

import requests
import scrapy
from bs4 import BeautifulSoup
from scrapy.exceptions import CloseSpider

from configs.base_config import load_site_config
from models.chapter import Chapter
from spiders.base_spider import BaseSpider, SelectorConfig
from utils.cleaner import build_promo_patterns, clean_chapter_content
from utils.proxy import requests_proxies

_NOVELHALL_BASE = "https://www.novelhall.com"
# Story: /<slug>-<id>/   Chapter: /<slug>-<id>/<chapterId>.html
_STORY_PATH_RE = re.compile(r"^/(?P<slug>[^/]+-\d+)/?$", re.IGNORECASE)
_CHAPTER_PATH_RE = re.compile(r"^/(?P<slug>[^/]+-\d+)/(?P<chapter_id>\d+)\.html$", re.IGNORECASE)
_CHAPTER_NUM_RE = re.compile(r"chapter\s*(\d+)", re.IGNORECASE)
_SPACE_RE = re.compile(r"\s+")
_NOVELHALL_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/149.0.0.0 Safari/537.36"
)
_MAX_FETCH_RETRIES = 3


class NovelHallSpider(BaseSpider):
    name = "novelhall"
    config_name = "novelhall"
    download_delay = 0.5

    custom_settings = {
        "DOWNLOAD_DELAY": 0.5,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
    }

    def __init__(self, *args, novel: str = "", limit: int = 1, chapter_range: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        if not novel.strip():
            raise ValueError("Spider argument 'novel' is required (a full NovelHall story or chapter URL).")
        self.start_urls: list[str] = [novel.strip()]
        self.limit: int = max(1, int(limit))

        self._range_start: Optional[int] = None
        self._range_end: Optional[int] = None
        if chapter_range and "-" in chapter_range:
            a, b = chapter_range.split("-", 1)
            try:
                self._range_start = max(1, int(a.strip()))
                self._range_end = max(self._range_start, int(b.strip()))
                self.logger.info("Chapter range: %d to %d", self._range_start, self._range_end)
            except ValueError:
                self.logger.warning("Invalid chapter_range '%s' - ignoring.", chapter_range)

        cfg = load_site_config(self.config_name)
        self.selector_config: SelectorConfig = self.build_selector_config(cfg)
        self._description_selector = (cfg.get("selectors", {}) or {}).get("description", ".intro")
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))

        self._start_url = self._normalize_url(self.start_urls[0])
        self.novel_slug = self._slug_from_url(self._start_url) or "novelhall-unknown"

        self._chapters_crawled = 0
        self._seen_urls: set[str] = set()
        self._html_cache: dict[str, str] = {}
        self._fs_solves = 0

        self._session = requests.Session()
        self._session.headers.update(self._headers())
        proxies = requests_proxies("novelhall")
        if proxies:
            self._session.proxies.update(proxies)
        self._saved_cookie_count = self._load_saved_cookies()

    # ------------------------------------------------------------------ #
    # Scrapy entry point (self-fetch flow — bypasses the Scrapy downloader)
    # ------------------------------------------------------------------ #

    async def start(self):
        story_url = self._story_url_from_any_url(self._start_url)
        story_html = self._fetch_page_html(story_url)
        story_soup = BeautifulSoup(story_html, "html.parser")

        story_title = self._extract_story_title(story_soup)
        metadata = self._extract_story_metadata(story_soup, story_url)
        all_refs = self._parse_chapter_refs(story_soup, story_url)
        selected = self._select_chapters(all_refs, self._start_url)
        self.limit = len(selected)

        self.logger.info(
            "[novelhall/story=%s] catalogue=%d chapters, selected=%d",
            self.novel_slug, len(all_refs), len(selected),
        )
        if not selected:
            self.logger.warning("[novelhall/story=%s] No chapters matched the requested range/limit.", self.novel_slug)
            return

        for idx, ref in enumerate(selected):
            if idx > 0:
                await asyncio.sleep(self.download_delay)
            chapter = self._crawl_chapter(ref, story_title, metadata if idx == 0 else None)
            if chapter is not None:
                self._chapters_crawled += 1
                self.logger.info(
                    "[%s/%d] Crawled chapter %d: %s",
                    self.novel_slug, self.limit, chapter.chapter_number, chapter.title or "(untitled)",
                )
                yield chapter

    def parse_chapter(self, response: scrapy.http.Response, chapter_index: int) -> Generator[Chapter, None, None]:
        raise NotImplementedError("NovelHallSpider parses pages through direct HTTP requests.")

    # ------------------------------------------------------------------ #
    # Chapter selection
    # ------------------------------------------------------------------ #

    def _parse_chapter_refs(self, story_soup: BeautifulSoup, story_url: str) -> list[dict[str, Any]]:
        """Return the full ascending chapter list from the story page ``#morelist``."""
        container = story_soup.select_one("#morelist") or story_soup
        refs: list[dict[str, Any]] = []
        last_number = 0
        for anchor in container.select("a[href]"):
            href = anchor.get("href") or ""
            absolute = self._normalize_url(urllib.parse.urljoin(_NOVELHALL_BASE, href), keep_chapter=True)
            if not self._is_chapter_url(absolute):
                continue
            if absolute in {r["url"] for r in refs}:
                continue
            title = self._clean_text(anchor.get_text(" ", strip=True))
            match = _CHAPTER_NUM_RE.search(title)
            number = int(match.group(1)) if match else last_number + 1
            last_number = number
            refs.append({"url": absolute, "title": title, "chapter_number": number})
        return refs

    def _select_chapters(self, refs: list[dict[str, Any]], start_url: str) -> list[dict[str, Any]]:
        if not refs:
            return []

        # Range filter takes precedence (by the source's own chapter numbers).
        if self._range_start is not None and self._range_end is not None:
            return [r for r in refs if self._range_start <= r["chapter_number"] <= self._range_end]

        # Chapter URL → start from that chapter and walk forward ``limit`` chapters.
        if self._is_chapter_url(start_url):
            target = self._normalize_url(start_url, keep_chapter=True)
            start_idx = next((i for i, r in enumerate(refs) if r["url"] == target), None)
            if start_idx is not None:
                return refs[start_idx:start_idx + self.limit]
            # Fall back to a single synthetic ref if the link isn't in the catalogue.
            return [{"url": target, "title": "", "chapter_number": self._chapter_id_from_url(target) or 1}]

        # Story URL → first ``limit`` chapters.
        return refs[:self.limit]

    def _crawl_chapter(
        self, ref: dict[str, Any], story_title: str, metadata: Optional[dict[str, Any]]
    ) -> Chapter | None:
        url = ref["url"]
        if url in self._seen_urls:
            return None
        self._seen_urls.add(url)

        html = self._fetch_page_html(url)
        soup = BeautifulSoup(html, "html.parser")
        chapter_title = self._extract_chapter_title(soup) or ref.get("title") or f"Chapter {ref['chapter_number']}"
        content = self._extract_chapter_content(soup, chapter_title, story_title)
        cleaned = clean_chapter_content(content, self._promo_patterns)
        if not cleaned:
            self.logger.warning("[novelhall/%s] No content extracted from %s", ref["chapter_number"], url)
            return None

        return Chapter(
            novel_slug=self.novel_slug,
            novel_title=story_title or (metadata or {}).get("title", "") or self.novel_slug,
            chapter_number=int(ref["chapter_number"]),
            title=chapter_title,
            content=cleaned,
            source_url=url,
            novel_metadata=metadata,
        )

    # ------------------------------------------------------------------ #
    # Extraction
    # ------------------------------------------------------------------ #

    def _extract_chapter_content(self, soup: BeautifulSoup, chapter_title: str, story_title: str = "") -> str:
        container = soup.select_one(self.selector_config.chapter_body) or soup.select_one("#htmlContent")
        if container is None:
            return ""
        clone = BeautifulSoup(str(container), "html.parser")
        root = clone.find()
        if root is None:
            return ""
        for junk in root.select("script, style, noscript, iframe, ins, button, form, .ads, .adsbygoogle, .gg, a"):
            junk.decompose()

        paragraphs: list[str] = []
        nodes = root.select("p")
        if nodes:
            lines = [self._clean_text(p.get_text(" ", strip=True)) for p in nodes]
        else:
            lines = [self._clean_text(x) for x in root.get_text("\n", strip=True).splitlines()]
        for line in lines:
            if self._is_content_line(line):
                paragraphs.append(line)

        # NovelHall prefixes the body with a header block: the chapter title, the story
        # title, and the section heading (e.g. "Chapter 0: Prologue" / "<Story>" /
        # "Prologue") before the prose. Drop those leading echoes.
        echoes: set[str] = set()
        for heading in (chapter_title, story_title):
            norm = self._clean_text(heading).lower()
            if norm:
                echoes.add(norm)
        # Chapter-title components split on a colon (e.g. "Chapter 0: Prologue" → "prologue").
        for part in re.split(r"[:：]", self._clean_text(chapter_title)):
            norm = part.strip().lower()
            if norm:
                echoes.add(norm)
        while paragraphs and self._is_heading_echo(paragraphs[0], echoes):
            paragraphs.pop(0)
        return "\n\n".join(paragraphs)

    def _is_heading_echo(self, line: str, echoes: set[str]) -> bool:
        low = self._clean_text(line).lower()
        if not low:
            return True
        if low in echoes:
            return True
        # Short "Chapter N" / "Chapter N: Chapter N" style echoes only — never a real paragraph.
        return len(line) < 40 and _CHAPTER_NUM_RE.match(low) is not None

    def _is_content_line(self, text: str) -> bool:
        if not text:
            return False
        if not re.search(r"[A-Za-z0-9一-鿿]", text):
            return False
        lower = text.lower()
        if lower in {"previous", "next", "table of contents", "report", "prev", "home"}:
            return False
        return True

    def _extract_story_metadata(self, soup: BeautifulSoup, source_url: str) -> dict[str, Any]:
        author = self._extract_author(soup)
        metadata: dict[str, Any] = {
            "source_url": source_url,
            "title": self._extract_story_title(soup),
            "authors": [author] if author else None,
            "author": author,
            "cover_url": self._extract_cover_url(soup),
            "description": self._extract_description(soup),
        }
        return {k: v for k, v in metadata.items() if v not in ("", None, [])}

    def _extract_story_title(self, soup: BeautifulSoup) -> str:
        for selector in [self.selector_config.novel_title, 'meta[property="og:title"]', "title"]:
            value = self._selector_text_or_content(soup, selector)
            if value:
                return self._clean_story_title(value)
        return ""

    def _extract_chapter_title(self, soup: BeautifulSoup) -> str:
        h1 = soup.select_one("h1")
        if h1:
            value = self._clean_text(h1.get_text(" ", strip=True))
            if value:
                return self._clean_chapter_title(value)
        value = self._selector_text_or_content(soup, 'meta[property="og:title"]')
        return self._clean_chapter_title(value) if value else ""

    def _extract_author(self, soup: BeautifulSoup) -> str:
        el = soup.select_one(self.selector_config.author)
        if el:
            value = self._valid_author(el.get_text(" ", strip=True))
            if value:
                return value
        # Fall back to the "Author：<name>" label inside .book-info. Keep it on the SAME
        # line ([ \t]* — not \s*, which would swallow the newline of an empty label and
        # capture the click-count on the next line).
        info = soup.select_one(".book-info")
        if info:
            m = re.search(r"Author[:：][ \t]*([^\n]+)", info.get_text("\n", strip=True))
            if m:
                return self._valid_author(m.group(1))
        return ""

    def _valid_author(self, raw: str) -> str:
        """Clean an author candidate, rejecting empty / numeric-only noise (e.g. a view count)."""
        value = self._clean_text(raw)
        if not value or value.isdigit():
            return ""
        return value

    def _extract_description(self, soup: BeautifulSoup) -> str:
        for selector in [self._description_selector, 'meta[property="og:description"]', 'meta[name="description"]']:
            value = self._selector_text_or_content(soup, selector)
            if value:
                return value
        return ""

    def _extract_cover_url(self, soup: BeautifulSoup) -> str:
        for selector in [self.selector_config.cover_image, 'meta[property="og:image"]']:
            element = soup.select_one(selector)
            if not element:
                continue
            url = element.get("content") if element.name == "meta" else (element.get("src") or element.get("data-src"))
            if url:
                return urllib.parse.urljoin(_NOVELHALL_BASE, url)
        return ""

    # ------------------------------------------------------------------ #
    # Fetch (requests + FlareSolverr self-heal)
    # ------------------------------------------------------------------ #

    def _fetch_page_html(self, url: str, timeout: int = 30) -> str:
        url = self._normalize_url(url, keep_chapter=True)
        cached = self._html_cache.get(url)
        if cached is not None:
            return cached

        challenged = False
        for attempt in range(_MAX_FETCH_RETRIES + 1):
            try:
                response = self._session.get(url, timeout=timeout)
            except Exception as exc:
                self.logger.debug("[novelhall] Requests fetch failed for %s: %s.", url, exc)
                if attempt >= _MAX_FETCH_RETRIES:
                    break
                continue
            if response.status_code == 200 and not self._is_cloudflare_challenge(response.text):
                self._html_cache[url] = response.text
                return response.text
            challenged = response.status_code in (403, 503) or self._is_cloudflare_challenge(response.text)
            if challenged:
                break
            if attempt >= _MAX_FETCH_RETRIES:
                break

        solved = self._solve_with_flaresolverr(url)
        if solved is not None:
            self._html_cache[url] = solved
            return solved

        from api.services.flaresolverr_client import is_configured as _fs_configured

        if _fs_configured():
            raise CloseSpider(
                f"[novelhall] FlareSolverr could not solve the Cloudflare challenge for {url}. "
                "Check that the flaresolverr service is healthy."
            )
        raise CloseSpider(
            "[novelhall] NovelHall returned a Cloudflare challenge"
            + (" (HTTP 403/503)." if challenged else ".")
            + " Set FLARESOLVERR_URL to auto-solve, or paste a fresh cf_clearance cookie in Settings."
        )

    def _solve_with_flaresolverr(self, url: str) -> str | None:
        try:
            from api.services.flaresolverr_client import is_configured, solve
        except Exception:
            return None
        if not is_configured() or self._fs_solves >= 5:
            return None
        try:
            result = solve(url)
        except Exception as exc:
            self.logger.warning("[novelhall] FlareSolverr solve failed for %s: %s", url, exc)
            return None
        self._fs_solves += 1

        html = result.get("html", "")
        if self._is_cloudflare_challenge(html):
            self.logger.warning("[novelhall] FlareSolverr returned a page still showing a challenge.")
            return None

        cookies = result.get("cookies") or {}
        user_agent = result.get("user_agent") or ""
        if user_agent:
            self._session.headers["User-Agent"] = user_agent
        for name, value in cookies.items():
            self._session.cookies.set(name, value, domain=".novelhall.com", path="/")
        self._saved_cookie_count = len(cookies) or self._saved_cookie_count

        try:
            from api.services.novelhall_cookie_service import persist_solved_cookies

            persist_solved_cookies(result.get("raw_cookies") or [], user_agent)
        except Exception as exc:
            self.logger.debug("[novelhall] Could not persist FlareSolverr cookies: %s", exc)

        self.logger.info("[novelhall] Solved Cloudflare via FlareSolverr (%d cookie(s) harvested).", len(cookies))
        return html

    def _load_saved_cookies(self) -> int:
        try:
            from api.services.novelhall_cookie_service import load_novelhall_cookies

            cookies, user_agent = load_novelhall_cookies()
        except Exception as exc:
            self.logger.debug("[novelhall] Could not load cookies from database: %s", exc)
            return 0
        if user_agent:
            self._session.headers["User-Agent"] = user_agent
        for cookie in cookies:
            self._session.cookies.set(
                cookie["name"], cookie["value"],
                domain=cookie.get("domain", ".novelhall.com"), path=cookie.get("path", "/"),
            )
        if cookies:
            self.logger.info(
                "[novelhall] Loaded %d cookie(s) from database%s.",
                len(cookies), " (with saved User-Agent)" if user_agent else "",
            )
        return len(cookies)

    # ------------------------------------------------------------------ #
    # URL helpers
    # ------------------------------------------------------------------ #

    def _headers(self) -> dict[str, str]:
        return {
            "User-Agent": _NOVELHALL_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": _NOVELHALL_BASE + "/",
            "Upgrade-Insecure-Requests": "1",
        }

    def _is_chapter_url(self, url: str) -> bool:
        return _CHAPTER_PATH_RE.match(urllib.parse.urlparse(url).path) is not None

    def _chapter_id_from_url(self, url: str) -> Optional[int]:
        m = _CHAPTER_PATH_RE.match(urllib.parse.urlparse(url).path)
        return int(m.group("chapter_id")) if m else None

    def _slug_from_url(self, url: str) -> str:
        path = urllib.parse.urlparse(url).path
        for pattern in (_STORY_PATH_RE, _CHAPTER_PATH_RE):
            m = pattern.match(path)
            if m:
                return m.group("slug")
        return ""

    def _story_url_from_any_url(self, url: str) -> str:
        slug = self._slug_from_url(url)
        if slug:
            return f"{_NOVELHALL_BASE}/{slug}/"
        return self._normalize_url(url)

    def _normalize_url(self, url: str, keep_chapter: bool = False) -> str:
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme or "https"
        netloc = (parsed.netloc or "www.novelhall.com").lower()
        if netloc == "novelhall.com":
            netloc = "www.novelhall.com"
        path = parsed.path or "/"
        if not keep_chapter and not path.endswith(".html") and path != "/":
            path = path.rstrip("/") + "/"
        return urllib.parse.urlunparse((scheme, netloc, path, "", "", ""))

    def _is_cloudflare_challenge(self, html: str) -> bool:
        head = html[:20000]
        if "morelist" in html or "htmlContent" in html or "book-info" in html:
            return False
        return (
            "Just a moment" in head
            or "Enable JavaScript and cookies to continue" in head
            or "cf_chl" in head
            or "/cdn-cgi/challenge-platform/" in head
            or "Attention Required! | Cloudflare" in head
        )

    # ------------------------------------------------------------------ #
    # Text helpers
    # ------------------------------------------------------------------ #

    def _selector_text_or_content(self, soup: BeautifulSoup, selector: str) -> str:
        element = soup.select_one(selector)
        if not element:
            return ""
        if element.name == "meta":
            return self._clean_text(element.get("content", ""))
        return self._clean_text(element.get_text(" ", strip=True))

    def _clean_text(self, text: str) -> str:
        text = (text or "").replace("﻿", " ").replace("\xa0", " ")
        return _SPACE_RE.sub(" ", text).strip()

    def _clean_story_title(self, title: str) -> str:
        title = self._clean_text(title)
        title = re.sub(r"\s*[-|]\s*Novelhall.*$", "", title, flags=re.IGNORECASE)
        title = re.sub(r"\s+read novel online free\s*$", "", title, flags=re.IGNORECASE)
        return title.strip()

    def _clean_chapter_title(self, title: str) -> str:
        title = self._clean_text(title)
        title = re.sub(r"\s*[-|]\s*Novelhall.*$", "", title, flags=re.IGNORECASE)
        return title.strip()


NovelHallSpider.complete = (
    "NovelHall spider complete. Run with: "
    "scrapy crawl novelhall -a novel='https://www.novelhall.com/<slug>-<id>/'"
)
