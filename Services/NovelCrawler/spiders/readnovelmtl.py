"""Spider for readnovelmtl.com.

Supports:
  Story URL:   scrapy crawl readnovelmtl -a novel="https://readnovelmtl.com/novel/<slug>-<id>" -a limit=3
  Chapter URL: scrapy crawl readnovelmtl -a novel="https://readnovelmtl.com/novel/<slug>-<id>/chapter/<chapter-slug>" -a limit=1

ReadNovelMtl sits behind a Cloudflare managed challenge, so fetching goes through
FlareSolverr (solve once, cache cf_clearance, replay with requests) -- the same
pattern as the NovelHall/ScribbleHub spiders. The full chapter catalogue is
rendered on the story page (no TOC pagination), so chapter selection is a single
fetch. Chapter body is in div#content; the page carries rich story metadata
(EN + original title, author, status, chapter count, libraries, rankings, tags,
cover, description) which is surfaced on the first chapter's novel_metadata.
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

_RNM_BASE = "https://readnovelmtl.com"
# Story:   /novel/<slug>            Chapter: /novel/<slug>/chapter/<chapter-slug>
_STORY_PATH_RE = re.compile(r"^/novel/(?P<slug>[^/]+)/?$", re.IGNORECASE)
_CHAPTER_PATH_RE = re.compile(r"^/novel/(?P<slug>[^/]+)/chapter/(?P<chapter>[^/]+)/?$", re.IGNORECASE)
_CHAPTER_NUM_RE = re.compile(r"chapter[-\s]*0*(\d+)", re.IGNORECASE)
_SPACE_RE = re.compile(r"\s+")
_RNM_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/149.0.0.0 Safari/537.36"
)
_MAX_FETCH_RETRIES = 3
# On a Cloudflare challenge, first try reloading a freshly-warmed cf_clearance from the DB
# (the batch cookie-warmer keeps one ready) before paying for a ~13s inline solve.
_MAX_WARM_RELOAD_ATTEMPTS = 2


class ReadNovelMtlSpider(BaseSpider):
    name = "readnovelmtl"
    config_name = "readnovelmtl"
    download_delay = 0.1

    custom_settings = {
        # This spider self-fetches (Scrapy's downloader is unused), but AutoThrottle /
        # DOWNLOAD_DELAY still pace how fast the engine consumes start(), adding ~2s per
        # chapter. Disable them so single-story crawls run at fetch speed.
        "AUTOTHROTTLE_ENABLED": False,
        "DOWNLOAD_DELAY": 0,
        "CONCURRENT_REQUESTS": 16,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 16,
    }

    def __init__(self, *args, novel: str = "", limit: int = 1, chapter_range: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        if not novel.strip():
            raise ValueError("Spider argument 'novel' is required (a full ReadNovelMtl story or chapter URL).")
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
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))

        self._start_url = self._normalize_url(self.start_urls[0])
        self.novel_slug = self._slug_from_url(self._start_url) or "readnovelmtl-unknown"

        self._chapters_crawled = 0
        self._seen_urls: set[str] = set()
        self._html_cache: dict[str, str] = {}
        self._fs_solves = 0

        self._session = requests.Session()
        self._session.headers.update(self._headers())
        proxies = requests_proxies("readnovelmtl")
        if proxies:
            self._session.proxies.update(proxies)
        self._saved_cookie_count = self._load_saved_cookies()

    # ------------------------------------------------------------------ #
    # Scrapy entry point (self-fetch flow)
    # ------------------------------------------------------------------ #

    async def start(self):
        story_url = self._story_url_from_any_url(self._start_url)
        story_soup = BeautifulSoup(self._fetch_page_html(story_url), "html.parser")

        story_title = self._extract_story_title(story_soup)
        metadata = self._extract_story_metadata(story_soup, story_url)
        all_refs = self._parse_chapter_refs(story_soup, story_url)
        selected = self._select_chapters(all_refs, self._start_url)
        self.limit = len(selected)

        self.logger.info(
            "[readnovelmtl/story=%s] catalogue=%d chapters, selected=%d",
            self.novel_slug, len(all_refs), len(selected),
        )
        if not selected:
            self.logger.warning("[readnovelmtl/story=%s] No chapters matched the requested range/limit.", self.novel_slug)
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
        raise NotImplementedError("ReadNovelMtlSpider parses pages through direct HTTP requests.")

    # ------------------------------------------------------------------ #
    # Chapter selection
    # ------------------------------------------------------------------ #

    def _parse_chapter_refs(self, story_soup: BeautifulSoup, story_url: str) -> list[dict[str, Any]]:
        """Return the full ascending chapter list from the story page (dedup by URL)."""
        story_slug = self._slug_from_url(story_url)
        refs: list[dict[str, Any]] = []
        seen: set[str] = set()
        last_number = 0
        for anchor in story_soup.select("a[href*='/chapter/']"):
            href = anchor.get("href") or ""
            absolute = self._normalize_url(urllib.parse.urljoin(_RNM_BASE, href), keep_chapter=True)
            match = _CHAPTER_PATH_RE.match(urllib.parse.urlparse(absolute).path)
            if not match or match.group("slug") != story_slug:
                continue
            if absolute in seen:
                continue
            seen.add(absolute)
            title = self._clean_text(anchor.get_text(" ", strip=True))
            number = self._chapter_number_from(absolute, title, last_number + 1)
            last_number = number
            refs.append({"url": absolute, "title": title, "chapter_number": number})
        refs.sort(key=lambda r: r["chapter_number"])
        return refs

    def _chapter_number_from(self, url: str, title: str, fallback: int) -> int:
        chapter_slug = ""
        m = _CHAPTER_PATH_RE.match(urllib.parse.urlparse(url).path)
        if m:
            chapter_slug = m.group("chapter")
        for source in (chapter_slug, title):
            nm = _CHAPTER_NUM_RE.search(source or "")
            if nm:
                return int(nm.group(1))
        return fallback

    def _select_chapters(self, refs: list[dict[str, Any]], start_url: str) -> list[dict[str, Any]]:
        if not refs:
            return []
        if self._range_start is not None and self._range_end is not None:
            return [r for r in refs if self._range_start <= r["chapter_number"] <= self._range_end]
        if self._is_chapter_url(start_url):
            target = self._normalize_url(start_url, keep_chapter=True)
            start_idx = next((i for i, r in enumerate(refs) if r["url"] == target), None)
            if start_idx is not None:
                return refs[start_idx:start_idx + self.limit]
            return [{"url": target, "title": "", "chapter_number": 1}]
        return refs[:self.limit]

    def _crawl_chapter(
        self, ref: dict[str, Any], story_title: str, metadata: Optional[dict[str, Any]]
    ) -> Chapter | None:
        url = ref["url"]
        if url in self._seen_urls:
            return None
        self._seen_urls.add(url)

        soup = BeautifulSoup(self._fetch_page_html(url), "html.parser")
        chapter_title = self._extract_chapter_title(soup) or ref.get("title") or f"Chapter {ref['chapter_number']}"
        content = self._extract_chapter_content(soup, chapter_title, story_title)
        cleaned = clean_chapter_content(content, self._promo_patterns)
        if not cleaned:
            self.logger.warning("[readnovelmtl/%s] No content extracted from %s", ref["chapter_number"], url)
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
        container = soup.select_one(self.selector_config.chapter_body) or soup.select_one("#content")
        if container is None:
            return ""
        clone = BeautifulSoup(str(container), "html.parser")
        root = clone.find()
        if root is None:
            return ""
        for junk in root.select("script, style, noscript, iframe, ins, button, form, nav, .ads, .adsbygoogle, .breadcrumb, a"):
            junk.decompose()

        nodes = root.select("p")
        if nodes:
            lines = [self._clean_text(p.get_text(" ", strip=True)) for p in nodes]
        else:
            lines = [self._clean_text(x) for x in root.get_text("\n", strip=True).splitlines()]
        paragraphs = [line for line in lines if self._is_content_line(line)]

        echoes = set()
        for heading in (chapter_title, story_title):
            norm = self._clean_text(heading).lower()
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
        return len(line) < 40 and _CHAPTER_NUM_RE.match(low) is not None

    def _is_content_line(self, text: str) -> bool:
        if not text:
            return False
        if not re.search(r"[A-Za-z0-9一-鿿]", text):
            return False
        lower = text.lower()
        if lower in {"previous", "next", "prev", "home", "read first", "report", "table of contents"}:
            return False
        return True

    def _extract_story_metadata(self, soup: BeautifulSoup, source_url: str) -> dict[str, Any]:
        author = self._extract_author(soup)
        info = self._parse_info_items(soup)
        metadata: dict[str, Any] = {
            "source_url": source_url,
            "site": "ReadNovelMtl",
            "title": self._extract_story_title(soup),
            "original_title": self._extract_original_title(soup),
            "author": author,
            "authors": [author] if author else None,
            "status": info.get("status"),
            "num_parts": info.get("chapters"),
            "chapter_count_label": info.get("chapters_label"),
            "libraries": info.get("libraries"),
            "updated": info.get("updated"),
            "rankings": self._extract_rankings(soup),
            "tags": self._extract_tags(soup),
            "cover_url": self._extract_cover_url(soup),
            "description": self._extract_description(soup),
        }
        return {key: value for key, value in metadata.items() if value not in ("", None, [], {})}

    def _extract_story_title(self, soup: BeautifulSoup) -> str:
        for selector in [self.selector_config.novel_title, 'meta[property="og:title"]', "title"]:
            value = self._selector_text_or_content(soup, selector)
            if value:
                return self._clean_story_title(value)
        return ""

    def _extract_original_title(self, soup: BeautifulSoup) -> str:
        h1 = soup.select_one("h1")
        if h1:
            sibling = h1.find_next_sibling("p")
            if sibling:
                text = self._clean_text(sibling.get_text(" ", strip=True))
                if text and re.search(r"[一-鿿]", text):
                    return text
        el = soup.select_one("p.text-secondary.fw-normal")
        return self._clean_text(el.get_text(" ", strip=True)) if el else ""

    def _extract_chapter_title(self, soup: BeautifulSoup) -> str:
        h1 = soup.select_one("h1")
        if h1:
            value = self._clean_text(h1.get_text(" ", strip=True))
            if value:
                return value
        value = self._selector_text_or_content(soup, 'meta[property="og:title"]')
        return value or ""

    def _extract_author(self, soup: BeautifulSoup) -> str:
        el = soup.select_one(self.selector_config.author)
        if el:
            value = self._clean_text(el.get_text(" ", strip=True))
            if value:
                return value
        # Fall back to the "By <author>" info line.
        for item in soup.select("div.d-flex.align-items-center.gap-2"):
            text = self._clean_text(item.get_text(" ", strip=True))
            m = re.match(r"^By\s+(.+)$", text)
            if m:
                return self._clean_text(m.group(1))
        return ""

    def _parse_info_items(self, soup: BeautifulSoup) -> dict[str, Any]:
        info: dict[str, Any] = {}
        for item in soup.select("div.d-flex.align-items-center.gap-2"):
            text = self._clean_text(item.get_text(" ", strip=True))
            low = text.lower()
            if low in ("completed", "ongoing", "complete", "hiatus", "dropped"):
                info["status"] = text
            elif "chapters" in low:
                m = re.search(r"([\d,]+)\s*chapters", low)
                if m:
                    info["chapters"] = int(m.group(1).replace(",", ""))
                    info["chapters_label"] = text
            elif "libraries" in low or "library" in low:
                m = re.search(r"([\d,]+)", text)
                if m:
                    info["libraries"] = int(m.group(1).replace(",", ""))
            elif "ago" in low:
                info["updated"] = text
        return info

    def _extract_rankings(self, soup: BeautifulSoup) -> dict[str, str]:
        el = soup.select_one("div.pt-2.border-top.text-secondary") or soup.select_one("div.border-top.text-secondary")
        if not el:
            return {}
        text = el.get_text(" ", strip=True).replace("\xa0", " ")
        rankings: dict[str, str] = {}
        for value, label in re.findall(r"#(\d+)\s+([A-Za-z ]+?)(?:\s*[•·]|$)", text):
            key = label.strip().lower().replace("this ", "").replace(" ", "_")
            rankings[key] = f"#{value}"
        return rankings

    def _extract_tags(self, soup: BeautifulSoup) -> list[str]:
        tags: list[str] = []
        container = soup.select_one("div.d-flex.flex-wrap.gap-2")
        anchors = container.select("a[href*='/category/']") if container else soup.select("div.mb-3 a[href*='/category/']")
        for anchor in anchors:
            text = self._clean_text(anchor.get_text(" ", strip=True))
            if text and text not in tags:
                tags.append(text)
        return tags

    def _extract_description(self, soup: BeautifulSoup) -> str:
        original = self._extract_original_title(soup)
        best = ""
        for p in soup.find_all("p"):
            text = self._clean_text(p.get_text(" ", strip=True))
            if text == original:
                continue
            if len(text) > len(best):
                best = text
        if len(best) >= 80:
            return best
        return self._selector_text_or_content(soup, 'meta[property="og:description"]')

    def _extract_cover_url(self, soup: BeautifulSoup) -> str:
        for selector in [self.selector_config.cover_image, 'meta[property="og:image"]']:
            element = soup.select_one(selector)
            if not element:
                continue
            url = element.get("content") if element.name == "meta" else (element.get("src") or element.get("data-src"))
            if url:
                return urllib.parse.urljoin(_RNM_BASE, url)
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
                self.logger.debug("[readnovelmtl] Requests fetch failed for %s: %s.", url, exc)
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

        # Cheap path first: a background cookie-warmer keeps a fresh cf_clearance in the DB,
        # so reload it and retry the plain request. When the warmer is keeping up this turns
        # ReadNovelMtl's ~150-request session death into a ~0.3s reload instead of a ~13s solve.
        if challenged:
            for _ in range(_MAX_WARM_RELOAD_ATTEMPTS):
                self._reload_saved_cookies()
                try:
                    response = self._session.get(url, timeout=timeout)
                except Exception:
                    break
                if response.status_code == 200 and not self._is_cloudflare_challenge(response.text):
                    self._html_cache[url] = response.text
                    return response.text

        solved = self._solve_with_flaresolverr(url)
        if solved is not None:
            self._html_cache[url] = solved
            return solved

        from api.services.flaresolverr_client import is_configured as _fs_configured

        if _fs_configured():
            raise CloseSpider(
                f"[readnovelmtl] FlareSolverr could not solve the Cloudflare challenge for {url}. "
                "Check that the flaresolverr service is healthy."
            )
        raise CloseSpider(
            "[readnovelmtl] ReadNovelMtl returned a Cloudflare challenge"
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

        def _recheck() -> str | None:
            # A peer worker may have already refreshed cf_clearance while we queued for the
            # single-browser solve lock: reload it and retry the plain request before paying
            # for another ~12s solve.
            self._reload_saved_cookies()
            try:
                response = self._session.get(url, timeout=20)
            except Exception:
                return None
            if response.status_code == 200 and not self._is_cloudflare_challenge(response.text):
                return response.text
            return None

        try:
            result = solve(url, recheck=_recheck)
        except Exception as exc:
            self.logger.warning("[readnovelmtl] FlareSolverr solve failed for %s: %s", url, exc)
            return None
        if result.get("reused"):
            return result.get("html")
        self._fs_solves += 1

        html = result.get("html", "")
        if self._is_cloudflare_challenge(html):
            self.logger.warning("[readnovelmtl] FlareSolverr returned a page still showing a challenge.")
            return None

        cookies = result.get("cookies") or {}
        user_agent = result.get("user_agent") or ""
        if user_agent:
            self._session.headers["User-Agent"] = user_agent
        for name, value in cookies.items():
            self._session.cookies.set(name, value, domain=".readnovelmtl.com", path="/")
        self._saved_cookie_count = len(cookies) or self._saved_cookie_count

        try:
            from api.services.readnovelmtl_cookie_service import persist_solved_cookies

            persist_solved_cookies(result.get("raw_cookies") or [], user_agent)
        except Exception as exc:
            self.logger.debug("[readnovelmtl] Could not persist FlareSolverr cookies: %s", exc)

        self.logger.info("[readnovelmtl] Solved Cloudflare via FlareSolverr (%d cookie(s) harvested).", len(cookies))
        return html

    def _load_saved_cookies(self) -> int:
        try:
            from api.services.readnovelmtl_cookie_service import load_readnovelmtl_cookies

            cookies, user_agent = load_readnovelmtl_cookies()
        except Exception as exc:
            self.logger.debug("[readnovelmtl] Could not load cookies from database: %s", exc)
            return 0
        if user_agent:
            self._session.headers["User-Agent"] = user_agent
        for cookie in cookies:
            self._session.cookies.set(
                cookie["name"], cookie["value"],
                domain=cookie.get("domain", ".readnovelmtl.com"), path=cookie.get("path", "/"),
            )
        if cookies:
            self.logger.info(
                "[readnovelmtl] Loaded %d cookie(s) from database%s.",
                len(cookies), " (with saved User-Agent)" if user_agent else "",
            )
        return len(cookies)

    def _reload_saved_cookies(self) -> None:
        # Drop the (possibly stale) cf_clearance, then reload the freshest cookies from the DB
        # (a peer worker may have just refreshed them via FlareSolverr).
        try:
            for cookie in list(self._session.cookies):
                if cookie.name == "cf_clearance":
                    self._session.cookies.clear(cookie.domain, cookie.path, cookie.name)
        except Exception:
            pass
        self._load_saved_cookies()

    # ------------------------------------------------------------------ #
    # URL helpers
    # ------------------------------------------------------------------ #

    def _headers(self) -> dict[str, str]:
        return {
            "User-Agent": _RNM_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": _RNM_BASE + "/",
            "Upgrade-Insecure-Requests": "1",
        }

    def _is_chapter_url(self, url: str) -> bool:
        return _CHAPTER_PATH_RE.match(urllib.parse.urlparse(url).path) is not None

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
            return f"{_RNM_BASE}/novel/{slug}"
        return self._normalize_url(url)

    def _normalize_url(self, url: str, keep_chapter: bool = False) -> str:
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme or "https"
        netloc = (parsed.netloc or "readnovelmtl.com").lower()
        if netloc == "www.readnovelmtl.com":
            netloc = "readnovelmtl.com"
        path = parsed.path.rstrip("/") or "/"
        # Drop tracking query params (?idx=&src=) so URLs de-dupe cleanly.
        return urllib.parse.urlunparse((scheme, netloc, path, "", "", ""))

    def _is_cloudflare_challenge(self, html: str) -> bool:
        head = html[:20000]
        if 'id="content"' in html or "/chapter/" in html or "text-secondary" in html:
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
        title = re.sub(r"\s*[-|]\s*Read ?Novel ?Mtl.*$", "", title, flags=re.IGNORECASE)
        return title.strip()


ReadNovelMtlSpider.complete = (
    "ReadNovelMtl spider complete. Run with: "
    "scrapy crawl readnovelmtl -a novel='https://readnovelmtl.com/novel/<slug>-<id>'"
)
