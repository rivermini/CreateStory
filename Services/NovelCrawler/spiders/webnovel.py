"""Spider for webnovel.com.

Supports:
  Story URL:   scrapy crawl webnovel -a novel="https://www.webnovel.com/book/title_123..." -a limit=3
  Catalog URL: scrapy crawl webnovel -a novel="https://www.webnovel.com/book/123.../catalog" -a limit=3
  Chapter URL: scrapy crawl webnovel -a novel="https://www.webnovel.com/book/title_123.../chapter-1-name_456..." -a limit=2

WebNovel catalog and chapter pages are rendered HTML, but Cloudflare often blocks
plain HTTP clients. The spider replays user-saved WebNovel cookies plus their
matching browser User-Agent when available. It only saves chapter text returned
to that session; locked/preview-only chapters are skipped.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Generator, Optional

import scrapy
from bs4 import BeautifulSoup, Tag

try:
    from curl_cffi import requests as _http
    _IMPERSONATE = "chrome"
except ImportError:  # pragma: no cover - service requirements install curl_cffi
    import requests as _http  # type: ignore[no-redef]
    _IMPERSONATE = None

from configs.base_config import load_site_config
from models.chapter import Chapter
from spiders.base_spider import BaseSpider, SelectorConfig
from utils.cleaner import build_promo_patterns, clean_chapter_content
from utils.proxy import requests_proxies


logger = logging.getLogger(__name__)

_BASE = "https://www.webnovel.com"
_BOOK_ID_RE = re.compile(r"/book/(?:[^/?#]+_)?(?P<book_id>\d+)(?:/catalog)?/?$", re.IGNORECASE)
_BOOK_SLUG_ID_RE = re.compile(r"/book/(?P<slug>[^/?#]+)_(?P<book_id>\d+)(?:/catalog)?/?$", re.IGNORECASE)
_CHAPTER_RE = re.compile(
    r"/book/(?P<slug>[^/?#]+)_(?P<book_id>\d+)/(?P<chapter_slug>[^/?#]+)_(?P<chapter_id>\d+)/?$",
    re.IGNORECASE,
)
_CHAPTER_NUMBER_RE = re.compile(r"\bchapter\s+(\d+)\b", re.IGNORECASE)
_LEADING_ORDINAL_RE = re.compile(r"^\s*(\d+)\s+(.+)$", re.DOTALL)
_RECENT_TIME_RE = re.compile(
    r"\s+\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\s*$",
    re.IGNORECASE,
)
_SPACE_RE = re.compile(r"[\s\u00a0]+")
_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/136.0.0.0 Safari/537.36"
)
_ERROR_WORDS_RE = re.compile(r"\b(error|exception|failed|traceback|critical|warning|retry|retrying)\b", re.IGNORECASE)


@dataclass(frozen=True)
class WebNovelHttpResponse:
    status_code: int
    text: str
    url: str


def is_cloudflare_challenge(status_code: int, html: str) -> bool:
    head = (html or "")[:12000]
    return (
        status_code in (403, 503)
        or "Just a moment" in head
        or "Enable JavaScript and cookies to continue" in head
        or "/cdn-cgi/challenge-platform/" in head
        or "cf_chl_opt" in head
    )


class WebNovelHttpClient:
    """HTTP client that replays saved WebNovel cookies and User-Agent."""

    DEFAULT_HEADERS = {
        "User-Agent": _DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0",
        "Referer": _BASE + "/",
    }

    def __init__(
        self,
        timeout: int = 30,
        retries: int = 2,
        cookies: Optional[list[dict[str, Any]]] = None,
        user_agent: Optional[str] = None,
        load_db_cookies: bool = True,
    ) -> None:
        self.timeout = timeout
        self.retries = retries
        self._thread_local = threading.local()
        if cookies is None and load_db_cookies:
            cookies, user_agent = self._load_db_cookies()
        self._cookies = cookies or []
        self._user_agent = user_agent or _DEFAULT_USER_AGENT

    def _session(self):
        session = getattr(self._thread_local, "session", None)
        if session is None:
            session = _http.Session(impersonate=_IMPERSONATE) if _IMPERSONATE else _http.Session()
            session.headers.update({**self.DEFAULT_HEADERS, "User-Agent": self._user_agent})
            proxies = requests_proxies("webnovel")
            if proxies:
                session.proxies.update(proxies)
            for cookie in self._cookies:
                name = str(cookie.get("name") or "")
                value = str(cookie.get("value") or "")
                if not name:
                    continue
                session.cookies.set(
                    name,
                    value,
                    domain=str(cookie.get("domain") or ".webnovel.com"),
                    path=str(cookie.get("path") or "/"),
                )
            self._thread_local.session = session
        return session

    def get(self, url: str, referer: str | None = None, timeout: int | None = None) -> WebNovelHttpResponse:
        headers = {}
        if referer:
            headers["Referer"] = referer

        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                resp = self._session().get(url, headers=headers, timeout=timeout or self.timeout)
                return WebNovelHttpResponse(
                    status_code=int(getattr(resp, "status_code", 0) or 0),
                    text=str(getattr(resp, "text", "") or ""),
                    url=str(getattr(resp, "url", url) or url),
                )
            except Exception as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(0.5 * (attempt + 1))

        raise RuntimeError(str(last_error) if last_error else "WebNovel request failed")

    @staticmethod
    def _load_db_cookies() -> tuple[list[dict[str, Any]], Optional[str]]:
        try:
            from api.services.webnovel_cookie_service import load_webnovel_cookies

            return load_webnovel_cookies()
        except Exception:
            return [], None


class WebNovelSpider(BaseSpider):
    name = "webnovel"
    config_name = "webnovel"
    download_delay = 1.0

    custom_settings = {
        "DOWNLOAD_DELAY": 1.0,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 2,
    }

    def __init__(self, *args, novel: str = "", limit: int = 1, chapter_range: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls: list[str] = [novel.strip()] if novel.strip() else []
        if not self.start_urls:
            raise ValueError("Spider argument 'novel' is required (a full WebNovel story, catalog, or chapter URL).")

        self.limit = max(1, int(limit))
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

        cfg = load_site_config(self.config_name)
        self.selector_config = self.build_selector_config(cfg)
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))
        self._concurrency = self._resolve_concurrency(cfg)
        self._submit_delay = self._float_setting(os.getenv("WEBNOVEL_DELAY"), cfg.get("rate_limit"), 1.0)
        self.download_delay = self._submit_delay

        start_url = self._normalize_url(self.start_urls[0])
        self.book_id = self._book_id_from_url(start_url)
        if not self.book_id:
            raise ValueError(f"Could not extract a WebNovel book ID from URL: {self.start_urls[0]}")
        self.novel_slug = self._story_slug_from_url(start_url) or f"webnovel-{self.book_id}"
        self._story_title = ""
        self._metadata: dict[str, Any] = {}
        self._chapters_crawled = 0
        self._seen_urls: set[str] = set()
        self._seen_lock = threading.Lock()
        self._client = WebNovelHttpClient()

    async def start(self):
        start_url = self._normalize_url(self.start_urls[0])
        catalog_url = self._catalog_url(start_url)

        try:
            catalog_html = self._fetch_html(catalog_url, referer=start_url)
            catalog_soup = BeautifulSoup(catalog_html, "html.parser")
            self._metadata = self._extract_story_metadata(catalog_soup, self._story_url_from_catalog(catalog_url))
            self._story_title = self._metadata.get("title", "")
            links = self._collect_chapter_links(catalog_soup, catalog_url)
        except Exception as exc:
            self.logger.warning("[webnovel] Catalog fetch failed for %s: %s", catalog_url, exc)
            links = []

        if not links and self._is_chapter_url(start_url):
            chapter_number = self._chapter_number_from_url(start_url) or 1
            links = [{
                "chapter_number": chapter_number,
                "title": "",
                "url": start_url,
                "chapter_id": self._chapter_id_from_url(start_url) or "",
                "locked": None,
            }]

        selected = self._select_chapters(links, start_url)
        if not selected:
            self.logger.warning("[webnovel/story=%s] No chapters matched the requested range/limit.", self.novel_slug)
            return

        self.limit = len(selected)
        self.logger.info("[webnovel/story=%s] selected %d chapter(s).", self.novel_slug, len(selected))

        workers = min(self._concurrency, len(selected))
        if workers <= 1:
            for index, ref in enumerate(selected):
                if index > 0 and self._submit_delay > 0:
                    time.sleep(self._submit_delay)
                chapter = self._crawl_chapter(ref, include_metadata=index == 0)
                if chapter is None:
                    continue
                self._log_crawled_chapter(chapter)
                yield chapter
            return

        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="webnovel")
        futures = {}
        try:
            for index, ref in enumerate(selected):
                if index > 0 and self._submit_delay > 0:
                    time.sleep(self._submit_delay)
                futures[executor.submit(self._crawl_chapter, ref, index == 0)] = ref

            for future in as_completed(futures):
                ref = futures[future]
                try:
                    chapter = future.result()
                except Exception as exc:
                    self.logger.warning("[webnovel/%s] Chapter fetch skipped: %s", ref.get("chapter_number"), exc)
                    continue
                if chapter is None:
                    continue
                self._log_crawled_chapter(chapter)
                yield chapter
        finally:
            executor.shutdown(wait=True, cancel_futures=True)

    def build_selector_config(self, config: dict) -> SelectorConfig:
        selectors = config.get("selectors", {})
        return SelectorConfig(
            chapter_list=selectors.get("chapter_list", "a[href*='/book/'][href*='_']"),
            chapter_body=selectors.get("chapter_body", ".cha-words p"),
            next_chapter=selectors.get("next_chapter", "a[href*='/chapter-']"),
            novel_title=selectors.get("novel_title", "h1, h2"),
            cover_image=selectors.get("cover_image", "meta[property='og:image']"),
            author=selectors.get("author", "meta[name='author']"),
        )

    def _crawl_chapter(self, ref: dict[str, Any], include_metadata: bool) -> Chapter | None:
        chapter_url = self._normalize_url(str(ref["url"]))
        with self._seen_lock:
            if chapter_url in self._seen_urls:
                return None
            self._seen_urls.add(chapter_url)

        if ref.get("locked") is True:
            self.logger.info(
                "[webnovel/%s] Chapter appears locked in the catalog; trying page in case saved cookies unlock it.",
                ref.get("chapter_number"),
            )

        html = self._fetch_html(chapter_url, referer=self._story_url_from_chapter(chapter_url))
        soup = BeautifulSoup(html, "html.parser")
        content = self._extract_chapter_content(soup)
        cleaned = clean_chapter_content(content, self._promo_patterns)
        word_count = len(cleaned.split())

        if word_count < 80 and self._looks_locked_or_preview(soup):
            self.logger.warning(
                "[webnovel/%s] Skipping locked or preview-only chapter.",
                ref.get("chapter_number"),
            )
            return None
        if not cleaned:
            self.logger.warning("[webnovel/%s] No content extracted from %s", ref.get("chapter_number"), chapter_url)
            return None
        if word_count < 200:
            self.logger.warning(
                "[webnovel/%s] Chapter '%s' has only %d words.",
                ref.get("chapter_number"),
                ref.get("title") or "(untitled)",
                word_count,
            )

        chapter_number = int(ref["chapter_number"])
        chapter_title = self._extract_chapter_title(soup) or str(ref.get("title") or f"Chapter {chapter_number}")
        novel_title = self._story_title or self._extract_story_title(soup) or self.novel_slug
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

    def _fetch_html(self, url: str, referer: str | None = None, timeout: int = 30) -> str:
        response = self._client.get(url, referer=referer or _BASE + "/", timeout=timeout)
        if response.status_code == 404:
            raise RuntimeError(f"WebNovel returned HTTP 404 for {url}")
        if is_cloudflare_challenge(response.status_code, response.text):
            raise RuntimeError(
                "WebNovel returned a Cloudflare challenge. "
                "Save fresh WebNovel cf_clearance cookies and the matching User-Agent in Settings."
            )
        if response.status_code != 200:
            raise RuntimeError(f"WebNovel returned HTTP {response.status_code} for {url}")
        return response.text

    def _collect_chapter_links(self, soup: BeautifulSoup, page_url: str) -> list[dict[str, Any]]:
        entries_by_key: dict[str, dict[str, Any]] = {}
        selector_config = getattr(
            self,
            "selector_config",
            SelectorConfig(chapter_list="a[href*='/book/'][href*='_']"),
        )
        chapter_selector = getattr(selector_config, "chapter_list", "") or "a[href*='/book/'][href*='_']"
        if chapter_selector == SelectorConfig().chapter_list:
            chapter_selector = "a[href*='/book/'][href*='_']"
        book_id = getattr(self, "book_id", None)
        novel_slug = getattr(self, "novel_slug", "")
        for anchor in soup.select(chapter_selector):
            href = anchor.get("href")
            if not href:
                continue
            absolute = self._normalize_url(urllib.parse.urljoin(_BASE, str(href)))
            match = _CHAPTER_RE.search(urllib.parse.urlparse(absolute).path)
            if not match:
                continue
            if book_id and match.group("book_id") != book_id:
                continue

            title_attr = str(anchor.get("title") or "").strip()
            visible_text = self._clean_text(anchor.get_text(" ", strip=True))
            ordinal, title_from_text = self._parse_catalog_anchor_text(visible_text)
            title = self._clean_chapter_title(title_attr or title_from_text)
            if not title or title.lower() == "read":
                title = self._title_from_chapter_slug(match.group("chapter_slug"))

            chapter_number = ordinal or self._number_from_title(title) or self._number_from_title(match.group("chapter_slug")) or 0
            if chapter_number <= 0:
                continue

            parent = anchor.find_parent("li") or anchor
            locked = self._catalog_entry_looks_locked(parent)
            key = match.group("chapter_id") or absolute
            previous = entries_by_key.get(key)
            if previous and previous.get("title") and previous.get("title").lower() != "read":
                continue
            entries_by_key[key] = {
                "chapter_number": chapter_number,
                "title": title,
                "url": absolute,
                "chapter_id": match.group("chapter_id"),
                "locked": locked,
            }

            if match.group("slug") and (novel_slug.startswith("webnovel-") or not novel_slug):
                self.novel_slug = match.group("slug")
                novel_slug = self.novel_slug

        return sorted(entries_by_key.values(), key=lambda item: int(item["chapter_number"]))

    def _select_chapters(self, links: list[dict[str, Any]], start_url: str) -> list[dict[str, Any]]:
        if self._range_start is not None and self._range_end is not None:
            return [
                link
                for link in links
                if self._range_start <= int(link["chapter_number"]) <= self._range_end
            ]

        if self._is_chapter_url(start_url):
            start_id = self._chapter_id_from_url(start_url)
            start_number = None
            if start_id:
                for link in links:
                    if str(link.get("chapter_id")) == start_id:
                        start_number = int(link["chapter_number"])
                        break
            if start_number is None:
                start_number = self._chapter_number_from_url(start_url) or 1
        else:
            start_number = 1

        selected = [link for link in links if int(link["chapter_number"]) >= start_number]
        return selected[: self.limit]

    def _extract_chapter_content(self, soup: BeautifulSoup) -> str:
        container = soup.select_one(".cha-words")
        if container is None:
            container = soup.select_one("main article") or soup.select_one("article") or soup.select_one("main")
        if container is None:
            return ""

        for junk in container.select(
            "script, style, ins, iframe, .adsbygoogle, .j_para_comment, .cha-comment, .j_comment, button"
        ):
            junk.decompose()

        paragraphs = []
        paragraph_nodes = container.select("p") or []
        for paragraph in paragraph_nodes:
            text = self._clean_text(paragraph.get_text(" ", strip=True))
            if text:
                paragraphs.append(text)
        if paragraphs:
            return "\n\n".join(paragraphs)

        lines = [self._clean_text(line) for line in container.get_text("\n", strip=True).splitlines()]
        return "\n\n".join(line for line in lines if line)

    def _extract_chapter_title(self, soup: BeautifulSoup) -> str:
        for selector in [".cha-tit h1", ".cha-tit", "h1", "h2"]:
            element = soup.select_one(selector)
            if element:
                text = self._clean_text(element.get_text(" ", strip=True))
                if text and text.lower() not in {"webnovel.com", "webnovel"}:
                    return text
        og_title = self._meta_content(soup, "meta[property='og:title']")
        if og_title:
            match = re.search(r"(Chapter\s+\d+[^|-]*)", og_title, re.IGNORECASE)
            if match:
                return self._clean_text(match.group(1))
        return ""

    def _extract_story_metadata(self, soup: BeautifulSoup, source_url: str) -> dict[str, Any]:
        title = self._extract_story_title(soup)
        author = self._extract_author(soup)
        description = self._meta_content(soup, "meta[name='description']") or self._meta_content(
            soup, "meta[property='og:description']"
        )
        cover = self._meta_content(soup, "meta[property='og:image']")
        body_text = self._clean_text(soup.get_text(" ", strip=True))
        chapter_count = None
        count_match = re.search(r"\b(\d{1,5})\s+Chapters\b", body_text, re.IGNORECASE)
        if count_match:
            chapter_count = int(count_match.group(1))

        tags = []
        for anchor in soup.select("a[href*='/tags/'], a[href*='/tag/'], a[href*='/stories/novel-']"):
            text = self._clean_text(anchor.get_text(" ", strip=True)).strip("#")
            if text and text.lower() not in {"about", "table of contents", "read"}:
                tags.append(text)
        tags = list(dict.fromkeys(tags))

        metadata = {
            "source_url": source_url,
            "title": title,
            "author": author,
            "authors": [author] if author else None,
            "cover_url": cover,
            "description": description,
            "num_parts": chapter_count,
            "tags": tags or None,
        }
        return {key: value for key, value in metadata.items() if value}

    def _extract_story_title(self, soup: BeautifulSoup) -> str:
        for selector in [".det-info h1", ".book-info h1", "h1", "h2"]:
            element = soup.select_one(selector)
            if element:
                text = self._clean_text(element.get_text(" ", strip=True))
                if text and not text.lower().startswith("chapter "):
                    return text
        title = self._meta_content(soup, "meta[property='og:title']")
        if title:
            title = re.sub(r"\s+-\s+WebNovel.*$", "", title, flags=re.IGNORECASE)
            title = re.sub(r"\s+Novel Read Free.*$", "", title, flags=re.IGNORECASE)
            return self._clean_text(title)
        return ""

    def _extract_author(self, soup: BeautifulSoup) -> str:
        author = self._meta_content(soup, "meta[name='author']")
        if author:
            return author
        text = soup.get_text("\n", strip=True)
        match = re.search(r"Author:\s*([^\n\r]+)", text, re.IGNORECASE)
        if match:
            return self._clean_text(match.group(1))
        return ""

    def _meta_content(self, soup: BeautifulSoup, selector: str) -> str:
        element = soup.select_one(selector)
        return self._clean_text(str(element.get("content") or "")) if element else ""

    def _looks_locked_or_preview(self, soup: BeautifulSoup) -> bool:
        text = self._clean_text(soup.get_text(" ", strip=True)).lower()
        indicators = [
            "unlock this chapter",
            "batch unlock chapters",
            "locked chapter",
            "download the app",
            "privileged chapters",
            "use coins",
        ]
        return any(indicator in text for indicator in indicators)

    def _catalog_entry_looks_locked(self, element: Tag) -> bool:
        html = str(element)
        return bool(re.search(r"i-lock|unlock|locked", html, re.IGNORECASE))

    def _parse_catalog_anchor_text(self, text: str) -> tuple[Optional[int], str]:
        cleaned = self._clean_text(_RECENT_TIME_RE.sub("", text or ""))
        match = _LEADING_ORDINAL_RE.match(cleaned)
        if not match:
            return None, cleaned
        try:
            ordinal = int(match.group(1))
        except ValueError:
            ordinal = None
        return ordinal, self._clean_text(match.group(2))

    def _clean_chapter_title(self, title: str) -> str:
        title = self._clean_text(_RECENT_TIME_RE.sub("", title or ""))
        return title.strip()

    def _number_from_title(self, value: str) -> Optional[int]:
        match = _CHAPTER_NUMBER_RE.search((value or "").replace("-", " "))
        return int(match.group(1)) if match else None

    def _title_from_chapter_slug(self, slug: str) -> str:
        text = urllib.parse.unquote(slug or "")
        text = re.sub(r"[-_]+", " ", text).strip()
        return text.title() if text else ""

    def _book_id_from_url(self, url: str) -> Optional[str]:
        path = urllib.parse.urlparse(url).path
        match = _CHAPTER_RE.search(path)
        if match:
            return match.group("book_id")
        match = _BOOK_ID_RE.search(path) or _BOOK_SLUG_ID_RE.search(path)
        return match.group("book_id") if match else None

    def _story_slug_from_url(self, url: str) -> Optional[str]:
        path = urllib.parse.urlparse(url).path
        match = _CHAPTER_RE.search(path) or _BOOK_SLUG_ID_RE.search(path)
        return match.group("slug") if match else None

    def _is_chapter_url(self, url: str) -> bool:
        return bool(_CHAPTER_RE.search(urllib.parse.urlparse(url).path))

    def _chapter_id_from_url(self, url: str) -> Optional[str]:
        match = _CHAPTER_RE.search(urllib.parse.urlparse(url).path)
        return match.group("chapter_id") if match else None

    def _chapter_number_from_url(self, url: str) -> Optional[int]:
        match = _CHAPTER_RE.search(urllib.parse.urlparse(url).path)
        if not match:
            return None
        return self._number_from_title(match.group("chapter_slug"))

    def _catalog_url(self, url: str) -> str:
        book_id = self._book_id_from_url(url)
        if not book_id:
            return url
        return f"{_BASE}/book/{book_id}/catalog"

    def _story_url_from_catalog(self, catalog_url: str) -> str:
        if self.novel_slug and self.book_id:
            return f"{_BASE}/book/{self.novel_slug}_{self.book_id}"
        return catalog_url.replace("/catalog", "")

    def _story_url_from_chapter(self, chapter_url: str) -> str:
        match = _CHAPTER_RE.search(urllib.parse.urlparse(chapter_url).path)
        if match:
            return f"{_BASE}/book/{match.group('slug')}_{match.group('book_id')}"
        return _BASE + "/"

    def _normalize_url(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme or "https"
        netloc = (parsed.netloc or "www.webnovel.com").lower()
        path = parsed.path.rstrip("/") or "/"
        return urllib.parse.urlunparse((scheme, netloc, path, "", "", ""))

    def _clean_text(self, text: str) -> str:
        return _SPACE_RE.sub(" ", (text or "").replace("\ufeff", " ")).strip()

    def _resolve_concurrency(self, config: dict) -> int:
        raw = os.getenv("WEBNOVEL_CONCURRENCY", config.get("concurrency", 2))
        try:
            return max(1, min(6, int(raw)))
        except (TypeError, ValueError):
            return 2

    def _float_setting(self, raw: Any, fallback: Any, default: float) -> float:
        value = raw if raw is not None else fallback
        if value is None:
            return default
        try:
            return max(0.0, float(value))
        except (TypeError, ValueError):
            return default

    def _log_crawled_chapter(self, chapter: Chapter) -> None:
        self._chapters_crawled += 1
        title = chapter.title or "(untitled)"
        title = _ERROR_WORDS_RE.sub(lambda m: f"{m.group(1)[0]}***", title)
        self.logger.info(
            "[%d/%d] Crawled chapter %d: %s",
            self._chapters_crawled,
            self.limit,
            chapter.chapter_number,
            title,
        )

    def parse_chapter(self, response: scrapy.http.Response, chapter_index: int = 0) -> Generator[Chapter, None, None]:
        raise NotImplementedError("WebNovelSpider uses a direct requests flow via start().")

    def closed(self, reason: str) -> None:
        self.logger.info("")
        self.logger.info("=" * 45)
        self.logger.info("  WebNovel crawl complete.")
        self.logger.info("  %d chapter(s) saved.", self._chapters_crawled)
        self.logger.info("=" * 45)
        self.logger.info("")


WebNovelSpider.complete = (
    "WebNovel spider complete. Run with: "
    "scrapy crawl webnovel -a novel='https://www.webnovel.com/book/<slug>_<bookId>'"
)
