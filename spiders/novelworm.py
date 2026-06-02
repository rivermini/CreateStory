"""
Spider for novelworm.com.

Supports:
  Story URL: scrapy crawl novelworm -a novel="https://www.novelworm.com/..." -a limit=10
  Chapter URL: scrapy crawl novelworm -a novel="https://www.novelworm.com/.../000001" -a limit=5
"""

import json
import logging
import re
import time
import urllib.parse
from pathlib import Path
from typing import Generator

import scrapy
from bs4 import BeautifulSoup
from scrapy.http import Response, TextResponse

from configs.base_config import load_site_config
from handlers.selenium_handler import _site_cookie_file as _get_cookie_file
from models.chapter import Chapter
from spiders.base_spider import BaseSpider, SelectorConfig
from utils.cleaner import clean_chapter_content


logger = logging.getLogger(__name__)

_PROMO_PATTERNS = [
    "Share this story", "Report", "Add to library", "Vote", "Report Story",
]


class NovelWormSpider(BaseSpider):
    name = "novelworm"
    config_name = "novelworm"

    _SELECTOR_CHAPTER_BODY = ".chapter-content p, .reading-content p, .chapter-text p"
    _SELECTOR_NEXT_CHAPTER = "a.next-chapter, a[class*='next'], .chapter-nav a:last-child"
    _SELECTOR_CHAPTER_TITLE = ".chapter-title, h2.chapter-title, .chapter-header h2"
    _SELECTOR_NOVEL_TITLE = ".story-title, .story-header h1, .story-info h1"
    _SELECTOR_AUTHOR = ".author-name, .author a, [class*='author']"

    def __init__(self, *args, novel: str = "", limit: int = 1, chapter_range: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls: list[str] = [novel.strip()] if novel.strip() else []
        self.limit: int = max(1, int(limit))
        self._range_start: int | None = None
        self._range_end: int | None = None

        if chapter_range:
            parts = chapter_range.split("-")
            if len(parts) == 2:
                try:
                    self._range_start = max(1, int(parts[0].strip()))
                    self._range_end = max(self._range_start, int(parts[1].strip()))
                    self.logger.info("Chapter range: %d to %d", self._range_start, self._range_end)
                except ValueError:
                    self.logger.warning("Invalid chapter_range '%s' — ignoring.", chapter_range)

        if not self.start_urls:
            raise ValueError(
                "Spider argument 'novel' is required (a full NovelWorm chapter or story URL)."
            )

        cfg = load_site_config(self.config_name)
        self.selector_config: SelectorConfig = self.build_selector_config(cfg)

        self._chapters_crawled: int = 0
        self._seen_urls: set[str] = set()
        self._is_story_url_mode: bool = False
        self._story_title: str = ""
        self._story_author: str = ""

    async def start(self):
        url = self.start_urls[0]
        if self._is_story_url(url):
            async for req in self._start_from_story_page():
                yield req
        else:
            async for req in self._start_from_chapter_url():
                yield req

    def _is_story_url(self, url: str) -> bool:
        return not bool(re.search(r"/\d{3,}$", url.rstrip("/")))

    def _extract_story_slug(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        segments = [s for s in parsed.path.strip("/").split("/") if s]
        if not segments:
            return "unknown"
        return segments[0]

    def _chapter_number_from_url(self, url: str) -> int | None:
        match = re.search(r"/(\d+)/?$", url.rstrip("/"))
        if match:
            return int(match.group(1))
        return None

    async def _start_from_story_page(self) -> Generator:
        story_url = self.start_urls[0]
        story_slug = self._extract_story_slug(story_url)

        self.logger.info("[novelworm/story=%s] Detecting story URL — collecting chapter links.", story_slug)
        self._is_story_url_mode = True

        try:
            chapter_links = self._collect_chapter_links_via_selenium(story_url, limit=self.limit)
        except Exception as exc:
            self.logger.error("[novelworm/story=%s] Failed to collect chapter links: %s", story_slug, exc)
            chapter_links = []

        if not chapter_links:
            self.logger.warning("[novelworm/story=%s] No chapter links found.", story_slug)
            first_chapter_url = f"{story_url.rstrip('/')}/000001"
            req = self._build_chapter_request(first_chapter_url, chapter_index=0)
            if req:
                yield req
            return

        start_idx = (self._range_start - 1) if self._range_start is not None else 0
        fetch_count = (
            (self._range_end - self._range_start + 1)
            if self._range_start is not None and self._range_end is not None
            else self.limit
        )

        for i, link in enumerate(chapter_links[start_idx:start_idx + fetch_count]):
            chapter_url = link.get("url", "")
            if not chapter_url:
                continue
            if not chapter_url.startswith("http"):
                chapter_url = urllib.parse.urljoin("https://www.novelworm.com", chapter_url)
            chapter_index = start_idx + i
            req = self._build_chapter_request(chapter_url, chapter_index=chapter_index)
            if req:
                yield req
            if i > 0:
                time.sleep(0.5)

    def _collect_chapter_links_via_selenium(self, story_url: str, limit: int = 0) -> list[dict]:
        limit = max(1, limit)
        try:
            from handlers.selenium_handler import _get_browser
            browser = _get_browser()
        except Exception as exc:
            self.logger.warning("[novelworm] Could not get Selenium browser: %s", exc)
            return self._collect_chapter_links_from_html(story_url)

        self.logger.info("[novelworm] Loading story page with Selenium: %s", story_url)

        try:
            final_url, status, body, headers, _ = browser.fetch(story_url, timeout=60, skip_scroll=True)
        except Exception as exc:
            self.logger.warning("[novelworm] Selenium fetch failed: %s", exc)
            return self._collect_chapter_links_from_html(story_url)

        html = body.decode("utf-8", errors="replace")

        if not self._story_title:
            self._story_title = self._extract_story_title_from_html(html)

        toc_links = self._parse_chapter_links_from_html(html, story_url)
        total = self._binary_search_total_chapters(browser, story_url)
        self.logger.info("[novelworm/story=%s] Binary search found ~%d total chapters.", self._extract_story_slug(story_url), total)

        all_links: dict[int, dict] = {}
        for link in toc_links:
            num = link.get("chapter_number") or 0
            if num > 0 and num not in all_links:
                all_links[num] = link

        # Fill in any missing chapters with sequential URLs (titles are re-discovered during actual crawl).
        scan_limit = min(limit, total) if total > 0 else limit
        for ch in range(1, scan_limit + 1):
            if ch in all_links:
                continue
            url = f"{story_url.rstrip('/')}/{str(ch).zfill(6)}"
            # Skip title scan — Cloudflare blocks each fetch and it is slow.
            # Chapter title will be discovered from the actual chapter page during crawling.
            all_links[ch] = {"url": url, "title": "", "chapter_number": ch}

        sorted_links = sorted(all_links.values(), key=lambda x: x.get("chapter_number") or 0)

        if sorted_links:
            self.logger.info("[novelworm] Collected %d chapter link(s).", len(sorted_links))
        else:
            self.logger.warning("[novelworm] No chapter links found via URL scanning.")

        return sorted_links

    def _binary_search_total_chapters(self, browser, story_url: str, max_guess: int = 5000) -> int:
        low, high = 1, max_guess
        best = 0

        while low <= high:
            mid = (low + high) // 2
            url = f"{story_url.rstrip('/')}/{str(mid).zfill(6)}"
            title = self._fetch_chapter_title_via_selenium(browser, url, timeout=10)
            if title:
                best = mid
                low = mid + 1
            else:
                high = mid - 1

        for delta in [10, 100]:
            check = best + delta
            url = f"{story_url.rstrip('/')}/{str(check).zfill(6)}"
            if self._fetch_chapter_title_via_selenium(browser, url, timeout=10):
                low, high = best + 1, best + delta * 2
                while low <= high:
                    mid = (low + high) // 2
                    url = f"{story_url.rstrip('/')}/{str(mid).zfill(6)}"
                    if self._fetch_chapter_title_via_selenium(browser, url, timeout=10):
                        best = mid
                        low = mid + 1
                    else:
                        high = mid - 1
                break

        self.logger.info("[novelworm/story=%s] Binary search concluded: %d chapters.", self._extract_story_slug(story_url), best)
        return best

    def _fetch_chapter_title_via_selenium(self, browser, chapter_url: str, timeout: int = 15) -> str:
        try:
            _, _, body, _, _ = browser.fetch(chapter_url, timeout=timeout, skip_scroll=True)
            html = body.decode("utf-8", errors="replace")
            return self._extract_chapter_title_from_html(html)
        except Exception:
            return ""

    def _fetch_chapter_via_selenium_with_retry(self, chapter_url: str) -> Response | None:
        try:
            from handlers.selenium_handler import _get_browser
            browser = _get_browser()
        except Exception as exc:
            self.logger.warning("[novelworm] Could not get Selenium browser for retry: %s", exc)
            return None

        try:
            final_url, status, body, headers, scroll_result = browser.fetch_with_retry(
                chapter_url, timeout=90, skip_scroll=False, max_retries=1
            )
            resp = TextResponse(
                url=final_url,
                status=status,
                headers=headers,
                body=body,
                request=None,
                encoding="utf-8",
            )
            if scroll_result:
                resp._scroll_paragraphs = scroll_result
            return resp
        except Exception as exc:
            self.logger.warning("[novelworm] Retry fetch failed for %s: %s", chapter_url, exc)
            return None

    def _extract_chapter_title_from_html(self, html: str) -> str:
        soup = BeautifulSoup(html, "html.parser")
        og = soup.select_one("meta[property='og:title']")
        if og:
            content = og.get("content", "").strip()
            if content:
                return content

        selectors = [
            "h1.chapter-title", ".chapter-header h1", ".chapter-title",
            "[class*='chapter-title']", "h1",
        ]
        for sel in selectors:
            el = soup.select_one(sel)
            if el:
                text = el.get_text(strip=True)
                if text and len(text) > 2:
                    return text

        body = soup.select_one(".read-pc-body") or soup.select_one("article") or soup
        if body:
            for elem in body.find_all(["h1", "h2", "h3", "span", "div"]):
                text = elem.get_text(strip=True)
                if re.search(r"(?:^|\s)(?:\d+\s+)?Chapter\s+\d+", text, re.IGNORECASE):
                    return text
        return ""

    def _extract_story_title_from_html(self, html: str) -> str:
        soup = BeautifulSoup(html, "html.parser")
        selectors = [
            "h1.story-title", ".story-header h1", ".story-info h1",
            "[class*='story-title']", "h1[class*='title']", "meta[property='og:title']",
        ]
        for sel in selectors:
            if sel.startswith("meta"):
                el = soup.select_one(sel)
                if el:
                    content = el.get("content", "").strip()
                    if content:
                        return content
            else:
                el = soup.select_one(sel)
                if el:
                    text = el.get_text(strip=True)
                    if text:
                        return text
        return ""

    def _collect_chapter_links_from_html(self, url: str) -> list[dict]:
        import requests as _requests
        try:
            resp = _requests.get(url, timeout=30)
            resp.raise_for_status()
            html = resp.text
        except Exception as exc:
            self.logger.warning("[novelworm] Failed to fetch story page: %s", exc)
            return []
        return self._parse_chapter_links_from_html(html, url)

    def _parse_chapter_links_from_html(self, html: str, base_url: str) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        links: list[dict] = []

        container_selectors = [
            ".chapter-list", ".table-of-contents", ".chapters", ".chapter-item",
            "[class*='chapter-list']", "[class*='toc']", "ul.chapters", "ol.chapters",
        ]

        containers = []
        for sel in container_selectors:
            found = soup.select(sel)
            containers.extend(found)

        for container in containers if containers else [soup]:
            anchors = container.find_all("a", href=True) if containers else soup.find_all("a", href=True)
            for a in anchors:
                href = a.get("href", "")
                if not href:
                    continue
                if not href.startswith("http"):
                    href = urllib.parse.urljoin(base_url, href)
                if "novelworm.com" not in href:
                    continue
                story_slug = self._extract_story_slug(base_url)
                if story_slug not in href:
                    continue

                title = a.get("title") or a.get_text(strip=True) or ""
                chapter_num = self._chapter_number_from_url(href)
                if chapter_num is None:
                    num_match = re.search(r"chapter\s*(\d+)", title, re.IGNORECASE)
                    if num_match:
                        chapter_num = int(num_match.group(1))

                links.append({"url": href, "title": title, "chapter_number": chapter_num or 0})

        seen: set[str] = set()
        unique_links: list[dict] = []
        for link in links:
            if link["url"] not in seen:
                seen.add(link["url"])
                unique_links.append(link)

        unique_links.sort(key=lambda x: x.get("chapter_number") or 0)
        return unique_links

    def _build_chapter_request(self, chapter_url: str, chapter_index: int) -> scrapy.Request:
        return scrapy.Request(
            chapter_url,
            callback=self._parse_chapter_page,
            errback=self._handle_error,
            meta={
                "retry_count": 0,
                "chapter_index": chapter_index,
                "selenium": True,
                "selenium_timeout": 30,
                "skip_scroll": False,
            },
            dont_filter=True,
        )

    async def _start_from_chapter_url(self) -> Generator:
        start_url = self.start_urls[0]
        chapter_index = self._chapter_number_from_url(start_url) or 0
        req = self._build_chapter_request(start_url, chapter_index=chapter_index)
        yield req

    def _parse_chapter_page(self, response: Response) -> Generator:
        chapter_index = response.meta.get("chapter_index", 0)
        chapter_number = chapter_index + 1

        if self._is_story_url_mode:
            if self._range_start is not None and self._range_end is not None:
                if chapter_number > self._range_end:
                    self.logger.info("Chapter %d is beyond range end — skipping.", chapter_number)
                    return
                if chapter_number < self._range_start:
                    self.logger.info("Chapter %d is before range start — skipping.", chapter_number)
                    return

        if self._chapters_crawled >= self.limit:
            self.logger.info("Limit reached (%d/%d) — stopping.", self._chapters_crawled, self.limit)
            return

        url_normalized = self._normalize_url(response.url)
        if url_normalized in self._seen_urls:
            return
        self._seen_urls.add(url_normalized)

        novel_title = self._extract_novel_title(response)
        chapter_title = self._extract_chapter_title(response)

        if not chapter_title:
            chapter_title = novel_title or f"Chapter {chapter_number}"

        self._chapters_crawled += 1
        content = self._extract_chapter_content(response)
        cleaned_content = clean_chapter_content(content)

        word_count = len(cleaned_content.split())

        # Retry with fresh Selenium session if content is missing or very short
        if word_count < 50 and response.meta.get("selenium") and response.meta.get("retry_count", 0) == 0:
            self.logger.warning(
                "Chapter %d '%s' has only %d words — retrying with fresh browser session.",
                chapter_number, chapter_title or "(untitled)", word_count
            )
            retry_result = self._fetch_chapter_via_selenium_with_retry(response.url)
            if retry_result:
                content = self._extract_chapter_content(retry_result)
                cleaned_content = clean_chapter_content(content)
                word_count = len(cleaned_content.split())
                self.logger.warning(
                    "Retry: chapter %d now has %d words.",
                    chapter_number, word_count
                )

        if word_count < 100:
            self.logger.warning("Chapter %d '%s' has only %d words.", chapter_number, chapter_title or "(untitled)", word_count)

        yield Chapter(
            novel_slug=self._extract_story_slug(response.url),
            novel_title=novel_title or self._story_title,
            chapter_number=chapter_number,
            title=chapter_title,
            content=cleaned_content,
            source_url=response.url,
            novel_metadata=None,
        )

        self.logger.info("[%d/%d] Crawled chapter %d: %s", self._chapters_crawled, self.limit, chapter_number, chapter_title or "(untitled)")

        if not self._is_story_url_mode and self._chapters_crawled < self.limit:
            next_chapter_url = self._extract_next_chapter_url(response)
            if next_chapter_url:
                next_url = response.urljoin(next_chapter_url)
                if next_url not in self._seen_urls:
                    yield scrapy.Request(
                        next_url,
                        callback=self._parse_chapter_page,
                        errback=self._handle_error,
                        meta={
                            "retry_count": 0,
                            "chapter_index": chapter_index + 1,
                            "selenium": True,
                            "selenium_timeout": 30,
                            "skip_scroll": False,
                        },
                    )

    def _extract_novel_title(self, response: Response) -> str:
        for sel in [
            ".story-title::text", ".story-header h1::text", ".story-info h1::text",
            "h1.story-title::text", "[class*='story-title']::text", "h1::text",
        ]:
            title = response.css(sel).get()
            if title:
                return title.strip()
        return ""

    def _extract_chapter_title(self, response: Response) -> str:
        for sel in [
            ".chapter-title::text", "h2.chapter-title::text", ".chapter-header h2::text",
            "[class*='chapter-title']::text", ".chapter-number::text",
        ]:
            title = response.css(sel).get()
            if title:
                return title.strip()
        return ""

    def _extract_chapter_content(self, response: Response) -> str:
        if hasattr(response, "_scroll_paragraphs") and response._scroll_paragraphs:
            paragraphs = response._scroll_paragraphs
            self.logger.debug("[novelworm] Using %d pre-scrolled paragraphs", len(paragraphs))
            return "\n\n".join(paragraphs)

        paragraphs = self._extract_via_beautifulsoup(response.text, response.url)
        if paragraphs:
            self.logger.debug("[novelworm] BeautifulSoup parsed %d paragraphs", len(paragraphs))
            return "\n\n".join(paragraphs)

        # Scroll returned empty or failed — try additional selectors as last resort
        seen: set[str] = set()
        paragraphs: list[str] = []

        from core.scroll_utils import is_garbage_text

        fallback_selectors = [
            ".read-pc-body", ".read-pc-body-center", ".reading-content",
            ".chapter-text", ".story-text", ".chapter-content",
            "article", "main",
        ]
        for sel in fallback_selectors:
            container = response.css(sel)
            if not container:
                continue
            for p in container.css("p::text, span::text, div::text").getall():
                text = p.strip()
                if text and len(text) > 10 and text not in seen:
                    if is_garbage_text(text):
                        continue
                    if not any(pattern.lower() in text.lower() for pattern in _PROMO_PATTERNS):
                        seen.add(text)
                        paragraphs.append(text)

        if paragraphs:
            if len(paragraphs) < 3:
                self.logger.debug(
                    "[novelworm] Fallback selectors: only %d paragraph(s) — likely TOC/sidebar, skipping",
                    len(paragraphs),
                )
            else:
                self.logger.debug("[novelworm] Fallback selectors parsed %d paragraphs", len(paragraphs))
                return "\n\n".join(paragraphs)
        paragraphs = []

        self.logger.warning("[novelworm] No chapter content found on %s", response.url)
        return ""

    def _extract_via_beautifulsoup(self, html: str, url: str = "") -> list[str]:
        soup = BeautifulSoup(html, "html.parser")

        # NovelWorm: chapter text lives in .content > .content-font elements.
        # Sidebar recommendations use separate .content containers — exclude them.
        content_containers = soup.select(".content > .content-font")
        if content_containers:
            paragraphs = [el.get_text(separator="\n", strip=True) for el in content_containers]
            paragraphs = [p for p in paragraphs if p]
            if paragraphs:
                self.logger.debug(
                    "[novelworm] BeautifulSoup: extracted %d paragraphs from .content > .content-font",
                    len(paragraphs),
                )
                return paragraphs

        # Generic fallback
        body_container = (
            soup.select_one(".read-pc-body")
            or soup.select_one(".read-pc-body-center")
            or soup.find("div", class_=re.compile(r"read-pc-body"))
        )
        if body_container is None:
            self.logger.debug("[novelworm] BeautifulSoup: no content container found")
            return []

        # Detect TOC/sidebar: look for links that are chapter titles (many "Chapter N" links)
        toc_links = body_container.select("a[href*='/0000']")
        if len(toc_links) > 5:
            self.logger.debug(
                "[novelworm] BeautifulSoup: detected TOC page (%d chapter links) — skipping body",
                len(toc_links),
            )
            return []

        prose_indicators = {
            "you", "the", "and", "was", "were", "are", "his", "her", "had",
            "with", "that", "this", "from", "she", "he", "they", "them",
            "but", "not", "for", "when", "would", "could", "what", "who",
            "which", "been", "their", "there", "here", "all", "have", "has",
            "out", "into", "your", "its", "one", "two", "over", "just",
            "more", "very", "only", "some", "any", "than", "then", "after",
            "back", "down", "even", "like", "know", "said", "well", "came",
            "looked", "felt", "seemed", "went", "asked", "told", "wanted",
            "thought", "didn't", "don't", "it's", "i'm", "you're", "we're",
            "they're", "can't", "won't", "isn't", "wasn't", "aren't",
            "doesn't", "how", "why", "where", "nothing", "something",
            "anything", "everything", "because", "about", "around", "still",
        }
        seen: set[str] = set()
        paragraphs: list[str] = []

        for elem in body_container.find_all(["span", "p", "div"]):
            text = elem.get_text(separator=" ", strip=True)
            if not text or len(text) < 10:
                continue

            if text.isupper() and len(text) < 50:
                continue

            if re.search(r"(?:^|\s)(?:\d*)?chapter\s+\d+", text, re.IGNORECASE):
                continue

            nav_labels = {
                "see all reviews", "next chapter", "previous", "prev chapter",
                "chapter list", "table of contents", "report story",
                "share this story", "add to library", "vote", "leave a reply",
                "post comment", "load more", "there are no comments yet",
            }
            lower = text.lower()
            if any(label in lower for label in nav_labels):
                if len(text) < 200:
                    continue
                break

            if "next" in lower and "previous" in lower:
                break

            words = set(lower.split()) - {""}
            prose_word_count = sum(1 for w in words if w in prose_indicators)
            total_words = len(words)
            if total_words > 0 and prose_word_count / total_words < 0.03:
                if len(text) < 200:
                    continue
                break

            if text not in seen:
                seen.add(text)
                paragraphs.append(text)

        if not paragraphs:
            self.logger.debug("[novelworm] BeautifulSoup: 0 paragraphs extracted from .read-pc-body")
        elif len(paragraphs) < 3:
            self.logger.debug(
                "[novelworm] BeautifulSoup: only %d paragraph(s) — likely TOC/sidebar, skipping",
                len(paragraphs),
            )
            return []

        return paragraphs

    def _extract_next_chapter_url(self, response: Response) -> str | None:
        for sel in [
            "a.next-chapter::attr(href)", "a[class*='next']::attr(href)",
            ".chapter-nav a:last-child::attr(href)", "footer a[rel='next']::attr(href)",
            "a[href*='/next']::attr(href)", ".pagination a.next::attr(href)",
        ]:
            href = response.css(sel).get()
            if href:
                return href

        chapter_num = self._chapter_number_from_url(response.url)
        if chapter_num is not None:
            next_num = chapter_num + 1
            next_url = re.sub(r"/\d+/?$", f"/{str(next_num).zfill(6)}", response.url.rstrip("/"))
            if next_url != response.url:
                return next_url
        return None

    def parse_chapter(self, response: Response, chapter_index: int) -> Generator[Chapter, None, None]:
        yield from self._parse_chapter_page(response)

    @staticmethod
    def _normalize_url(url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        return parsed._replace(query="", fragment="").geturl().rstrip("/")

    def closed(self, reason: str) -> None:
        self.logger.info("")
        self.logger.info("=" * 45)
        self.logger.info("  NovelWorm crawl complete.")
        self.logger.info("  %d chapter(s) crawled.", self._chapters_crawled)
        self.logger.info("=" * 45)
        self.logger.info("")


NovelWormSpider.complete = (
    "NovelWorm spider complete. Run with: "
    "scrapy crawl novelworm -a novel='https://www.novelworm.com/...'"
)
