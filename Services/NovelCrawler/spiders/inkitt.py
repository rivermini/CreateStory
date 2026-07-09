"""Spider for inkitt.com.

Supports:
  Story URL: scrapy crawl inkitt -a novel="https://www.inkitt.com/stories/1698711" -a limit=3
  Chapter URL: scrapy crawl inkitt -a novel="https://www.inkitt.com/stories/1698711/chapters/2" -a limit=1
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import urllib.parse
from pathlib import Path
from typing import Any, Generator, Optional

import requests
import scrapy
from bs4 import BeautifulSoup, Tag

from configs.base_config import load_site_config
from models.chapter import Chapter
from spiders.base_spider import BaseSpider, SelectorConfig
from utils.cleaner import build_promo_patterns, clean_chapter_content
from utils.proxy import requests_proxies


logger = logging.getLogger(__name__)

_STORY_RE = re.compile(r"/stories/(\d+)")
_CHAPTER_RE = re.compile(r"/stories/(\d+)/chapters/(\d+)")
_SPACE_RE = re.compile(r"\s+")


class InkittSpider(BaseSpider):
    name = "inkitt"
    config_name = "inkitt"
    download_delay = 1.5

    _HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/136.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0",
        "Connection": "keep-alive",
        "Referer": "https://www.inkitt.com/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }

    custom_settings = {
        "DOWNLOAD_DELAY": 1.5,
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
            raise ValueError("Spider argument 'novel' is required (a full Inkitt story or chapter URL).")

        cfg = load_site_config(self.config_name)
        self.selector_config: SelectorConfig = self.build_selector_config(cfg)
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))

        story_id = self._extract_story_id(self.start_urls[0])
        if not story_id:
            raise ValueError(f"Could not extract Inkitt story ID from URL: {self.start_urls[0]}")

        self.novel_slug = story_id
        self._chapters_crawled = 0
        self._saved_chapters = 0
        self._session = requests.Session()
        self._session.headers.update(self._HEADERS)
        proxies = requests_proxies("inkitt")
        if proxies:
            self._session.proxies.update(proxies)
        self._cookies_loaded = False
        self._saved_cookie_count = self._load_saved_cookies()

    async def start(self):
        """Start the crawl by fetching the story page directly via requests.Session.

        This method is called by Scrapy's crawler before the scheduler is set up,
        bypassing the Scrapy downloader entirely. We use our requests.Session which
        has the saved cookies (for Cloudflare/login-gated content). Fetches each
        chapter directly and yields Chapter items.
        """
        start_url = self.start_urls[0]
        if not start_url:
            return

        story_id = self._extract_story_id(start_url)
        if not story_id:
            self.logger.warning("[inkitt] Could not extract story ID from %s", start_url)
            return

        try:
            start_html = self._fetch_html(start_url)
        except RuntimeError as e:
            self.logger.error("[inkitt] Failed to fetch start URL: %s", e)
            return

        start_soup = BeautifulSoup(start_html, "html.parser")
        metadata = self._extract_novel_metadata(start_soup, story_id, start_url)
        chapter_links = self._collect_chapter_links(start_soup, story_id, start_url)

        if not chapter_links:
            chapter_number = self._extract_chapter_number(start_url) or 1
            chapter_links = [{
                "chapter_number": chapter_number,
                "title": self._extract_chapter_title(start_soup) or f"Chapter {chapter_number}",
                "url": start_url,
            }]

        selected = self._select_chapters(chapter_links, start_url)
        self.logger.info(
            "[inkitt/story=%s] found %d chapter links, target=%d",
            story_id,
            len(chapter_links),
            len(selected),
        )

        if not selected:
            self.logger.warning("[inkitt/story=%s] No chapters matched the requested range/limit.", story_id)
            return

        for idx, link in enumerate(selected):
            if idx > 0:
                await asyncio.sleep(self.download_delay)

            chapter_url = link["url"]
            html = start_html if self._same_url(chapter_url, start_url) else self._fetch_html(chapter_url)
            soup = BeautifulSoup(html, "html.parser")
            chapter = self._build_chapter_item(
                soup=soup,
                story_id=story_id,
                chapter_url=chapter_url,
                chapter_number=link["chapter_number"],
                fallback_title=link.get("title", ""),
                metadata=metadata if idx == 0 else None,
            )
            if not chapter:
                continue

            self._chapters_crawled += 1
            self._saved_chapters += 1
            self.logger.info(
                "[%s/%d] Crawled chapter %d: %s",
                self.novel_slug,
                self.limit,
                chapter.chapter_number,
                chapter.title or "(untitled)",
            )
            yield chapter

    def start_requests(self):
        """Fallback for Scrapy - delegates to start()."""
        return self.start()

    def _parse_chapter_page(self, response: scrapy.http.Response) -> Generator[Chapter, None, None]:
        """Parse a single Inkitt chapter page and yield a Chapter item.

        Uses the cached start_html for the first chapter (avoids a redundant
        request), or fetches the page via requests.Session for Cloudflare
        cookie handling.
        """
        story_id = response.meta.get("story_id", "")
        chapter_number = response.meta.get("chapter_number", 0)
        fallback_title = response.meta.get("fallback_title", "")
        metadata = response.meta.get("metadata")
        start_html = response.meta.get("start_html")

        # Use cached start_html if available (first chapter), otherwise fetch
        if start_html:
            html = start_html
        else:
            html = self._fetch_html(response.url)

        soup = BeautifulSoup(html, "html.parser")
        chapter = self._build_chapter_item(
            soup=soup,
            story_id=story_id,
            chapter_url=response.url,
            chapter_number=chapter_number,
            fallback_title=fallback_title,
            metadata=metadata,
        )

        if not chapter:
            return

        self._chapters_crawled += 1
        self._saved_chapters += 1
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
            chapter_list=selectors.get("chapter_list", "a[href*='/stories/'][href*='/chapters/']"),
            chapter_body=selectors.get("chapter_body", "article#story-text-container p[data-content]"),
            next_chapter=selectors.get("next_chapter", "a[href*='/chapters/']"),
            novel_title=selectors.get("novel_title", "h1"),
            cover_image=selectors.get("cover_image", "meta[property='og:image']"),
            author=selectors.get("author", "meta[name='author'], .author-link"),
        )

    def _fetch_html(self, url: str) -> str:
        response = self._session.get(url, timeout=30)
        if (self._is_blocked_response(response) or self._is_login_gated_response(response.text)) and not self._cookies_loaded:
            self._saved_cookie_count = self._load_saved_cookies()
            response = self._session.get(url, timeout=30)

        if response.status_code != 200:
            raise RuntimeError(f"[inkitt] HTTP {response.status_code} while fetching {url}")
        if self._is_blocked_response(response):
            raise RuntimeError(
                "[inkitt] Cloudflare challenge did not clear. "
                "Open the story in a browser and save cookies before retrying."
            )
        if self._is_login_gated_response(response.text):
            saved_count = int(getattr(self, "_saved_cookie_count", 0) or 0)
            cookie_state = (
                f"Loaded {saved_count} saved Inkitt cookie(s), but Inkitt still asked for login."
                if saved_count
                else "No saved Inkitt cookies were loaded."
            )
            raise RuntimeError(
                f"[inkitt] Login required for this free/adult-gated page. {cookie_state} "
                "Refresh Inkitt user_credentials/cf_clearance in Settings from the same VPN/IP, then retry."
            )
        return response.text

    def _is_blocked_response(self, response: requests.Response) -> bool:
        text = response.text[:10000]
        return (
            response.status_code in (403, 429)
            or "Just a moment" in text
            or "Attention Required! | Cloudflare" in text
            or "/cdn-cgi/challenge-platform/" in text
        )

    def _load_saved_cookies(self) -> int:
        self._cookies_loaded = True

        db_cookies, user_agent = self._load_cookies_from_db()
        if db_cookies:
            for c in db_cookies:
                self._session.cookies.set(c["name"], c["value"], domain=c.get("domain", ".inkitt.com"), path=c.get("path", "/"))
            if user_agent:
                self._session.headers["User-Agent"] = user_agent
            self.logger.info(
                "[inkitt] Loaded %d cookie(s) from database (with saved User-Agent: %s).",
                len(db_cookies),
                user_agent,
            )
            return len(db_cookies)

        json_cookies = self._load_cookies_from_json()
        if json_cookies:
            for c in json_cookies:
                self._session.cookies.set(c["name"], c["value"], domain=c.get("domain", ".inkitt.com"), path=c.get("path", "/"))
            self.logger.info("[inkitt] Loaded %d cookie(s) from legacy JSON file.", len(json_cookies))
            return len(json_cookies)

        return 0

    def _load_cookies_from_db(self) -> tuple[list[dict[str, Any]], Optional[str]]:
        try:
            from api.db import SessionLocal
            from api.repositories.inkitt_cookie_repository import InkittCookieRepository

            db = SessionLocal()
            try:
                repo = InkittCookieRepository(db)
                rows = repo.get_valid()
                user_agent = repo.get_user_agent()
                cookies = [
                    {"name": r.name, "value": r.value, "domain": r.domain, "path": r.path}
                    for r in rows
                ]
                return cookies, user_agent
            finally:
                db.close()
        except Exception as exc:
            self.logger.debug("[inkitt] Could not load cookies from database: %s", exc)
            return [], None

    def _load_cookies_from_json(self) -> list[dict[str, Any]]:
        cookie_files = [
            Path(__file__).parent.parent / "handlers" / "selenium_cookies_www_inkitt_com.json",
            Path(__file__).parent.parent / "handlers" / "selenium_cookies.json",
        ]

        loaded = 0
        results = []
        for cookie_file in cookie_files:
            if not cookie_file.exists():
                continue
            try:
                raw = json.loads(cookie_file.read_text(encoding="utf-8"))
            except Exception as exc:
                self.logger.debug("[inkitt] Could not read cookie file %s: %s", cookie_file.name, exc)
                continue

            if not isinstance(raw, list):
                continue
            for cookie in raw:
                name = cookie.get("name")
                value = cookie.get("value")
                if not name or value is None:
                    continue
                results.append({"name": name, "value": value, "domain": cookie.get("domain", ".inkitt.com"), "path": cookie.get("path", "/")})
                loaded += 1
            if loaded:
                self.logger.info("[inkitt] Loaded %d saved cookie(s) from %s", loaded, cookie_file.name)
                return results
        return results

    def _is_login_gated_response(self, html: str) -> bool:
        soup = BeautifulSoup(html, "html.parser")
        article = soup.select_one("article#story-text-container") or soup.select_one("article.default-style")
        if article is None:
            return False

        text = self._clean_text(article.get_text(" ", strip=True)).lower()
        if not text:
            return False

        login_indicators = [
            "log in to continue reading",
            "login to continue reading",
            "sign up to continue reading",
            "create an account to continue reading",
            "please log in",
            "please login",
        ]
        if any(indicator in text for indicator in login_indicators):
            return True

        return len(text.split()) < 80 and "log" in text and "read" in text

    def _collect_chapter_links(self, soup: BeautifulSoup, story_id: str, page_url: str) -> list[dict[str, Any]]:
        links_by_number: dict[int, dict[str, Any]] = {}
        for anchor in soup.select(self.selector_config.chapter_list):
            href = anchor.get("href")
            if not href:
                continue
            absolute = urllib.parse.urljoin("https://www.inkitt.com", href)
            match = _CHAPTER_RE.search(urllib.parse.urlparse(absolute).path)
            if not match or match.group(1) != story_id:
                continue

            chapter_number = int(match.group(2))
            title = self._clean_link_title(anchor.get_text(" ", strip=True), chapter_number)
            existing = links_by_number.get(chapter_number)
            if existing and existing.get("title"):
                continue
            links_by_number[chapter_number] = {
                "chapter_number": chapter_number,
                "title": title,
                "url": absolute,
            }

        current_chapter = self._extract_chapter_number(page_url)

        if current_chapter is not None and current_chapter not in links_by_number:
            links_by_number[current_chapter] = {
                "chapter_number": current_chapter,
                "title": self._extract_chapter_title(soup) or f"Chapter {current_chapter}",
                "url": page_url,
            }

        return [links_by_number[n] for n in sorted(links_by_number)]

    def _select_chapters(self, chapter_links: list[dict[str, Any]], start_url: str) -> list[dict[str, Any]]:
        if self._range_start is not None and self._range_end is not None:
            return [
                link for link in chapter_links
                if self._range_start <= link["chapter_number"] <= self._range_end
            ]

        start_chapter = self._extract_chapter_number(start_url) or 1
        selected = [link for link in chapter_links if link["chapter_number"] >= start_chapter]
        return selected[:self.limit]

    def _build_chapter_item(
        self,
        soup: BeautifulSoup,
        story_id: str,
        chapter_url: str,
        chapter_number: int,
        fallback_title: str,
        metadata: Optional[dict],
    ) -> Optional[Chapter]:
        novel_title = self._extract_novel_title(soup)
        chapter_title = self._extract_chapter_title(soup) or fallback_title or f"Chapter {chapter_number}"
        content = self._extract_chapter_content(soup)
        cleaned_content = clean_chapter_content(content, self._promo_patterns)

        word_count = len(cleaned_content.split())
        if word_count < 50:
            self.logger.warning(
                "[inkitt/%d] Chapter %d '%s' has only %d words.",
                chapter_number,
                chapter_number,
                chapter_title,
                word_count,
            )
        if not cleaned_content:
            self.logger.warning("[inkitt/%d] No content extracted from %s", chapter_number, chapter_url)
            return None

        return Chapter(
            novel_slug=story_id,
            novel_title=novel_title or (metadata or {}).get("title", ""),
            chapter_number=chapter_number,
            title=chapter_title,
            content=cleaned_content,
            source_url=chapter_url,
            novel_metadata=metadata,
        )

    def _extract_chapter_content(self, soup: BeautifulSoup) -> str:
        article = soup.select_one("article#story-text-container")
        if article is None:
            article = soup.select_one("article.default-style")
        if article is None:
            return ""

        paragraphs: list[str] = []
        for paragraph in article.select("p[data-content], p"):
            text = self._clean_text(paragraph.get_text(" ", strip=True))
            if text and text not in paragraphs:
                paragraphs.append(text)

        if paragraphs:
            return "\n\n".join(paragraphs)

        title = article.select_one("h2")
        if title is not None:
            title.extract()
        text = article.get_text("\n", strip=True)
        lines = [self._clean_text(line) for line in text.splitlines()]
        return "\n\n".join(line for line in lines if line)

    def _extract_novel_metadata(self, soup: BeautifulSoup, story_id: str, source_url: str) -> dict:
        json_ld = self._extract_article_json_ld(soup)
        image = json_ld.get("image")
        cover_url = ""
        if isinstance(image, dict):
            cover_url = image.get("url") or ""
        elif isinstance(image, str):
            cover_url = image

        author = self._extract_author(soup, json_ld)
        metadata: dict[str, Any] = {
            "source_url": f"https://www.inkitt.com/stories/{story_id}",
            "title": self._extract_novel_title(soup) or json_ld.get("headline"),
            "authors": [author] if author else None,
            "cover_url": cover_url or self._meta_content(soup, "meta[property='og:image']"),
            "description": json_ld.get("description") or self._meta_content(soup, "meta[name='description']"),
            "date_published": json_ld.get("datePublished"),
            "date_modified": json_ld.get("dateModified"),
            "source_chapter_url": source_url,
        }
        return {key: value for key, value in metadata.items() if value}

    def _extract_article_json_ld(self, soup: BeautifulSoup) -> dict:
        for script in soup.select("script[type='application/ld+json']"):
            raw = script.get_text(strip=True)
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            candidates = data if isinstance(data, list) else [data]
            for candidate in candidates:
                if isinstance(candidate, dict) and candidate.get("@type") == "Article":
                    return candidate
        return {}

    def _extract_author(self, soup: BeautifulSoup, json_ld: dict) -> str:
        meta_author = self._meta_content(soup, "meta[name='author']")
        if meta_author:
            return meta_author

        author = json_ld.get("author")
        if isinstance(author, dict):
            name = author.get("name")
            if name:
                return str(name)

        for anchor in soup.select(".author-link"):
            text = self._clean_text(anchor.get_text(" ", strip=True))
            if text and "stories" not in text.lower():
                return text
        return ""

    def _extract_novel_title(self, soup: BeautifulSoup) -> str:
        title = soup.select_one("h1")
        if title:
            return self._clean_text(title.get_text(" ", strip=True))
        json_ld = self._extract_article_json_ld(soup)
        headline = json_ld.get("headline")
        return self._clean_text(str(headline)) if headline else ""

    def _extract_chapter_title(self, soup: BeautifulSoup) -> str:
        for selector in [
            "article#story-text-container h2.chapter-head-title",
            "article#story-text-container h2",
            "h2.chapter-head-title",
        ]:
            element = soup.select_one(selector)
            if element:
                text = self._clean_text(element.get_text(" ", strip=True))
                if text:
                    return text
        return ""

    def _meta_content(self, soup: BeautifulSoup, selector: str) -> str:
        element = soup.select_one(selector)
        if not element:
            return ""
        return self._clean_text(element.get("content", ""))

    def _clean_link_title(self, title: str, chapter_number: int) -> str:
        title = self._clean_text(title)
        title = re.sub(rf"^{chapter_number}\s+", "", title).strip()
        if not title or title.lower() in {"next chapter", "previous chapter"}:
            return f"Chapter {chapter_number}"
        return title

    def _clean_text(self, text: str) -> str:
        text = text.replace("\ufeff", " ")
        return _SPACE_RE.sub(" ", text).strip()

    def _extract_story_id(self, url: str) -> Optional[str]:
        match = _STORY_RE.search(urllib.parse.urlparse(url).path)
        return match.group(1) if match else None

    def _extract_chapter_number(self, url: str) -> Optional[int]:
        match = _CHAPTER_RE.search(urllib.parse.urlparse(url).path)
        if match:
            return int(match.group(2))
        return None

    def _same_url(self, first: str, second: str) -> bool:
        left = urllib.parse.urlparse(first)
        right = urllib.parse.urlparse(second)
        return (
            left.scheme,
            left.netloc.lower(),
            left.path.rstrip("/"),
        ) == (
            right.scheme,
            right.netloc.lower(),
            right.path.rstrip("/"),
        )

    def parse_chapter(self, response: scrapy.http.Response, chapter_index: int = 0):
        """Not used by InkittSpider — parsing is handled by _parse_chapter_page."""
        return

    def closed(self, reason: str) -> None:
        self.logger.info("")
        self.logger.info("=" * 45)
        self.logger.info("  Inkitt crawl complete.")
        self.logger.info("  %d chapter(s) saved.", self._saved_chapters)
        self.logger.info("=" * 45)
        self.logger.info("")


InkittSpider.complete = (
    "Inkitt spider complete. Run with: "
    "scrapy crawl inkitt -a novel='https://www.inkitt.com/stories/...'"
)
