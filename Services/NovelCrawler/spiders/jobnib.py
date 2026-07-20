"""Spider for jobnib.com.

Supports:
  Story URL: scrapy crawl jobnib -a novel="https://jobnib.com/book/story-slug" -a limit=3
  Chapter URL: scrapy crawl jobnib -a novel="https://jobnib.com/book/story-slug-chapter-1" -a limit=2
"""

from __future__ import annotations

import atexit
from concurrent.futures import ThreadPoolExecutor, as_completed
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

try:
    import msvcrt
except ImportError:
    msvcrt = None  # type: ignore[assignment]  # msvcrt is Windows-only; the cookie lock falls back to fcntl

import scrapy
from bs4 import BeautifulSoup, Tag
from scrapy.exceptions import CloseSpider

from configs.base_config import load_site_config
from models.chapter import Chapter
from spiders.base_spider import BaseSpider, SelectorConfig
from utils.cleaner import build_promo_patterns, clean_chapter_content
from utils.proxy import get_proxy_url, requests_proxies


logger = logging.getLogger(__name__)

_BOOK_PATH_RE = re.compile(r"^/book/([^/?#]+)/?$", re.IGNORECASE)
# WordPress adds a numeric collision suffix when a chapter slug has already
# been used (for example ``-chapter-246-2``). The first number is still the
# displayed chapter number; the final number only makes the URL unique.
_CHAPTER_SUFFIX_RE = re.compile(r"-chapter-(\d+)(?:-\d+)?$", re.IGNORECASE)
_SPACE_RE = re.compile(r"\s+")
_JOBNIB_BASE = "https://jobnib.com"
_JOBNIB_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/149.0.0.0 Safari/537.36"
)


class JobnibSpider(BaseSpider):
    name = "jobnib"
    config_name = "jobnib"
    download_delay = 0.0

    custom_settings = {
        "DOWNLOAD_DELAY": 0.0,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 8,
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
            raise ValueError("Spider argument 'novel' is required (a full Jobnib story or chapter URL).")

        cfg = load_site_config(self.config_name)
        self._config = cfg
        self._submit_delay = self._float_setting(os.getenv("JOBNIB_DELAY"), cfg.get("rate_limit"), 0.0)
        self.download_delay = self._submit_delay
        self._concurrency = self._resolve_concurrency(cfg)
        self.selector_config: SelectorConfig = self.build_selector_config(cfg)
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))
        self.novel_slug = self._story_slug_from_url(self.start_urls[0])
        self._story_title = ""
        self._metadata: dict[str, Any] = {}
        self._chapters_crawled = 0
        self._seen_urls: set[str] = set()
        self._browser: _JobnibBrowser | None = None
        self._seen_lock = threading.Lock()
        self._browser_lock = threading.Lock()
        self._abort_event = threading.Event()
        self._saved_cookies, self._saved_user_agent = self._load_saved_session()

    async def start(self):
        start_url = self._normalize_url(self.start_urls[0])
        if self._is_chapter_url(start_url):
            chapter_number = self._chapter_number_from_url(start_url) or 1
            selected = [
                {
                    "chapter_number": chapter_number + offset,
                    "title": "",
                    "url": self._chapter_url_for_number(start_url, chapter_number + offset),
                }
                for offset in range(self.limit)
            ]
        else:
            html = self._fetch_page_html(start_url)
            soup = BeautifulSoup(html, "html.parser")
            self._story_title = self._extract_story_title(soup)
            self._metadata = self._extract_story_metadata(soup, start_url)
            links = self._collect_chapter_links(soup, start_url)
            if not links:
                self.logger.warning("[jobnib] No chapter links found on story page; trying chapter 1 URL pattern.")
                links = [{
                    "chapter_number": 1,
                    "title": "",
                    "url": self._chapter_url_for_number(start_url, 1),
                }]
            selected = self._select_chapters(links)

        self.limit = len(selected)
        self.logger.info("[jobnib/story=%s] found %d selected chapter(s).", self.novel_slug, len(selected))

        workers = min(self._concurrency, len(selected))
        if workers <= 1:
            for index, chapter_ref in enumerate(selected):
                if index > 0 and self._submit_delay > 0:
                    time.sleep(self._submit_delay)
                chapter = self._crawl_chapter(chapter_ref, include_metadata=index == 0)
                if chapter is None:
                    continue
                self._log_crawled_chapter(chapter)
                yield chapter
            return

        self.logger.info(
            "[jobnib] Crawling with %d worker(s), submit delay %.2fs.",
            workers,
            self._submit_delay,
        )
        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="jobnib")
        futures = {}
        try:
            for index, chapter_ref in enumerate(selected):
                if index > 0 and self._submit_delay > 0:
                    time.sleep(self._submit_delay)
                future = executor.submit(self._crawl_chapter, chapter_ref, index == 0)
                futures[future] = chapter_ref

            for future in as_completed(futures):
                chapter_ref = futures[future]
                try:
                    chapter = future.result()
                except CloseSpider as exc:
                    self._abort_event.set()
                    for pending in futures:
                        pending.cancel()
                    reason = self._close_spider_reason(exc) or f"[jobnib] Failed while crawling chapter {chapter_ref.get('chapter_number')}."
                    self.logger.error("[jobnib] Stopping crawl while crawling chapter %s: %s", chapter_ref.get("chapter_number"), reason)
                    raise CloseSpider(reason) from exc
                except Exception as exc:
                    self._abort_event.set()
                    for pending in futures:
                        pending.cancel()
                    reason = f"[jobnib] Failed while crawling chapter {chapter_ref.get('chapter_number')}: {exc}"
                    self.logger.error(reason)
                    raise CloseSpider(reason) from exc

                if chapter is None:
                    continue
                self._log_crawled_chapter(chapter)
                yield chapter
        finally:
            executor.shutdown(wait=True, cancel_futures=True)

    def _float_setting(self, raw: Any, fallback: Any, default: float) -> float:
        value = raw if raw is not None else fallback
        if value is None:
            return default
        try:
            return max(0.0, float(value))
        except (TypeError, ValueError):
            return default

    def _resolve_concurrency(self, config: dict) -> int:
        raw = os.getenv("JOBNIB_CONCURRENCY", config.get("concurrency", 6))
        try:
            return max(1, min(16, int(raw)))
        except (TypeError, ValueError):
            return 6

    def _log_crawled_chapter(self, chapter: Chapter) -> None:
        self._chapters_crawled += 1
        self.logger.info(
            "[%d/%d] Crawled chapter %d: %s",
            self._chapters_crawled,
            self.limit,
            chapter.chapter_number,
            chapter.title or "(untitled)",
        )

    def _close_spider_reason(self, exc: CloseSpider) -> str:
        reason = getattr(exc, "reason", None)
        if reason:
            return str(reason)
        if exc.args:
            return str(exc.args[0])
        return ""

    def _allow_partial_chapters(self) -> bool:
        value = os.environ.get("JOBNIB_ALLOW_PARTIAL", "false").strip().lower()
        return value in {"1", "true", "yes", "on"}

    def _partial_min_words(self) -> int:
        raw = os.environ.get("JOBNIB_PARTIAL_MIN_WORDS", "100")
        try:
            return max(1, int(raw.strip()))
        except (AttributeError, ValueError):
            return 1

    def _minimum_chapter_words(self) -> int:
        raw = os.environ.get("JOBNIB_MIN_CHAPTER_WORDS", "100")
        try:
            return max(1, int(raw.strip()))
        except (AttributeError, ValueError):
            return 100

    def build_selector_config(self, config: dict) -> SelectorConfig:
        selectors = config.get("selectors", {})
        return SelectorConfig(
            chapter_list=selectors.get("chapter_list", "a[href*='/book/'][href*='-chapter-']"),
            chapter_body=selectors.get("chapter_body", ".entry-content"),
            next_chapter=selectors.get("next_chapter", ".nav-next a, a[rel='next']"),
            novel_title=selectors.get("novel_title", "h1.entry-title, .entry-title, h1"),
            cover_image=selectors.get("cover_image", ".thumb img, .bigcover img, meta[property='og:image']"),
            author=selectors.get("author", ".author-content a, .author a, meta[name='author']"),
        )

    def _fetch_page_html(self, url: str) -> str:
        try:
            html = self._fetch_page_html_with_requests(url)
            if not self._is_cloudflare_challenge(html):
                return html
            self.logger.info("[jobnib] Requests fetch hit a Cloudflare challenge; retrying with browser.")
        except Exception as exc:
            self.logger.debug("[jobnib] Requests fetch failed for %s: %s; retrying with browser.", url, exc)

        with self._browser_lock:
            browser = self._get_browser()
            html = browser.fetch_page(url, timeout=60)
        if self._is_cloudflare_challenge(html):
            raise CloseSpider(
                "[jobnib] Cloudflare challenge did not clear. "
                "Run with visible Chrome available and retry, or open Jobnib once in the crawler browser profile."
            )
        return html

    def _fetch_page_html_with_requests(self, url: str, timeout: int = 30) -> str:
        import requests

        headers = {
            "User-Agent": os.getenv("JOBNIB_USER_AGENT") or self._saved_user_agent or _JOBNIB_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": _JOBNIB_BASE + "/",
        }
        session = requests.Session()
        session.headers.update(headers)
        for cookie in self._saved_cookies:
            session.cookies.set(
                str(cookie.get("name") or ""),
                str(cookie.get("value") or ""),
                domain=str(cookie.get("domain") or ".jobnib.com"),
                path=str(cookie.get("path") or "/"),
            )
        resp = session.get(
            url,
            timeout=timeout,
            proxies=requests_proxies("jobnib"),
        )
        resp.raise_for_status()
        return resp.text

    def _crawl_chapter(self, chapter_ref: dict[str, Any], include_metadata: bool) -> Chapter | None:
        if self._abort_event.is_set():
            return None

        chapter_url = self._normalize_url(chapter_ref["url"])
        with self._seen_lock:
            if chapter_url in self._seen_urls:
                return None
            self._seen_urls.add(chapter_url)

        chapter_number = int(chapter_ref["chapter_number"])
        html = self._fetch_page_html(chapter_url)
        soup = BeautifulSoup(html, "html.parser")
        novel_title = self._story_title or self._extract_series_title(soup) or self._story_title_from_chapter_title(soup)
        chapter_title = self._extract_chapter_title(soup) or chapter_ref.get("title") or f"Chapter {chapter_number}"

        content, status = self._extract_visible_chapter_content(soup)
        if status != "complete":
            self.logger.info(
                "[jobnib/%d] Chapter shell is not fully unlocked (%s); trying AJAX unlock flow.",
                chapter_number,
                status,
            )
            unlocked_html = self._fetch_unlocked_chapter_html(chapter_url, html)
            soup = BeautifulSoup(unlocked_html, "html.parser")
            content, status = self._extract_visible_chapter_content(soup)

        cleaned_content = clean_chapter_content(content, self._promo_patterns)
        word_count = len(cleaned_content.split())

        partial_min_words = self._partial_min_words()
        if status == "partial" and self._allow_partial_chapters() and word_count >= partial_min_words:
            self.logger.warning(
                "[jobnib/%d] Saving partial chapter content (%d words); a later protected segment stayed locked.",
                chapter_number,
                word_count,
            )
        elif status != "complete" or word_count < self._minimum_chapter_words():
            reason = (
                f"[jobnib/{chapter_number}] Could not unlock full chapter content "
                f"(status={status}, words={word_count}). "
                "Jobnib is still returning preview-only or bot-detected chapter segments."
            )
            self.logger.error("%s URL=%s", reason, chapter_url)
            raise CloseSpider(reason)

        if word_count < 1000:
            self.logger.warning(
                "[jobnib/%d] Chapter '%s' has only %d words.",
                chapter_number,
                chapter_title,
                word_count,
            )

        metadata = self._metadata if include_metadata and self._metadata else None
        return Chapter(
            novel_slug=self._story_slug_from_url(chapter_url),
            novel_title=novel_title or self._story_title or self.novel_slug,
            chapter_number=chapter_number,
            title=chapter_title,
            content=cleaned_content,
            source_url=chapter_url,
            novel_metadata=metadata,
        )

    def _fetch_unlocked_chapter_html(self, chapter_url: str, shell_html: str) -> str:
        ajax_errors: list[str] = []
        for attempt in range(1, 4):
            try:
                attempt_shell = shell_html if attempt == 1 else self._fetch_page_html_with_requests(chapter_url)
                unlocked = self._fetch_chapter_segments_with_requests(chapter_url, attempt_shell)
                content, status = self._extract_visible_chapter_content(BeautifulSoup(unlocked, "html.parser"))
                word_count = len(clean_chapter_content(content, self._promo_patterns).split())
                if status == "complete" and word_count >= self._minimum_chapter_words():
                    return unlocked
                if status == "partial" and self._allow_partial_chapters() and word_count >= self._partial_min_words():
                    self.logger.info(
                        "[jobnib] AJAX unlock returned partial content (%d words); keeping unlocked segment 1.",
                        word_count,
                    )
                    return unlocked
                self.logger.info(
                    "[jobnib] AJAX unlock returned %s content (%d words) on attempt %d; minimum is %d.",
                    status,
                    word_count,
                    attempt,
                    self._partial_min_words(),
                )
            except Exception as exc:
                ajax_errors.append(str(exc))
                self.logger.info("[jobnib] AJAX unlock attempt %d failed for %s: %s", attempt, chapter_url, exc)
                time.sleep(0.5 * attempt)

        self.logger.info(
            "[jobnib] AJAX unlock failed for %s after %d attempt(s): %s; falling back to browser.",
            chapter_url,
            len(ajax_errors),
            "; ".join(ajax_errors[-2:]) if ajax_errors else "no usable content",
        )
        if self._abort_event.is_set():
            raise CloseSpider("[jobnib] Crawl aborted before browser unlock could start.")
        post_id, _ = self._extract_jobnib_post_and_nonce(shell_html)
        unlock_script = self._extract_jobnib_unlock_script(shell_html, post_id)
        with self._browser_lock:
            if self._abort_event.is_set():
                raise CloseSpider("[jobnib] Crawl aborted before browser unlock could start.")
            unlocked = self._get_browser().unlock_chapter(chapter_url, timeout=90, unlock_script=unlock_script)
        content, status = self._extract_visible_chapter_content(BeautifulSoup(unlocked, "html.parser"))
        self.logger.info(
            "[jobnib] Browser unlock returned %s content (%d words) for %s.",
            status,
            len(clean_chapter_content(content, self._promo_patterns).split()),
            chapter_url,
        )
        return unlocked

    def _fetch_chapter_segments_with_requests(self, chapter_url: str, shell_html: str) -> str:
        import requests

        post_id, first_nonce = self._extract_jobnib_post_and_nonce(shell_html)
        if not post_id or not first_nonce:
            raise ValueError("missing Jobnib post id or nonce")

        session = requests.Session()
        headers = {
            "User-Agent": os.getenv("JOBNIB_USER_AGENT") or self._saved_user_agent or _JOBNIB_USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": chapter_url,
        }
        for cookie in self._saved_cookies:
            session.cookies.set(
                str(cookie.get("name") or ""),
                str(cookie.get("value") or ""),
                domain=str(cookie.get("domain") or ".jobnib.com"),
                path=str(cookie.get("path") or "/"),
            )
        ajax_headers = {
            **headers,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
        }
        ajax_url = f"{_JOBNIB_BASE}/wp-admin/admin-ajax.php"
        proxies = requests_proxies("jobnib")

        seg1_resp = session.get(
            ajax_url,
            params={
                "action": "jobnib_load",
                "post_id": post_id,
                "segment": "1",
                "nonce": first_nonce,
            },
            headers=ajax_headers,
            timeout=30,
            proxies=proxies,
        )
        seg1_resp.raise_for_status()
        seg1_data = seg1_resp.json()
        if not seg1_data.get("success") or not isinstance(seg1_data.get("data"), dict):
            raise ValueError(f"segment 1 rejected: {seg1_data.get('data')}")

        next_nonce = seg1_data["data"].get("next_nonce") or self._fetch_segment_nonce(
            session=session,
            ajax_url=ajax_url,
            post_id=post_id,
            segment=2,
            headers=ajax_headers,
            proxies=proxies,
        )
        segment_html = {1: seg1_data["data"].get("content", "")}
        try:
            if not next_nonce:
                raise ValueError("missing segment 2 nonce")

            seg2_resp = session.post(
                ajax_url,
                data={
                    "action": "jobnib_load",
                    "post_id": post_id,
                    "segment": "2",
                    "nonce": next_nonce,
                },
                headers={
                    **ajax_headers,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout=30,
                proxies=proxies,
            )
            seg2_resp.raise_for_status()
            seg2_data = seg2_resp.json()
            if not seg2_data.get("success") or not isinstance(seg2_data.get("data"), dict):
                raise ValueError(f"segment 2 rejected: {seg2_data.get('data')}")
            segment_html[2] = seg2_data["data"].get("content", "")
        except Exception as exc:
            if not self._allow_partial_chapters():
                raise
            self.logger.warning(
                "[jobnib] Segment 2 stayed locked for post %s (%s); keeping segment 1 only.",
                post_id,
                exc,
            )

        return self._merge_segment_html(
            shell_html=shell_html,
            post_id=post_id,
            segment_html=segment_html,
        )

    def _fetch_segment_nonce(
        self,
        session: Any,
        ajax_url: str,
        post_id: str,
        segment: int,
        headers: dict[str, str],
        proxies: dict[str, str] | None,
    ) -> str:
        resp = session.get(
            ajax_url,
            params={
                "action": "jobnib_nonce",
                "post_id": post_id,
                "segment": str(segment),
            },
            headers=headers,
            timeout=30,
            proxies=proxies,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("success") and isinstance(data.get("data"), dict):
            return str(data["data"].get("nonce") or "")
        return ""

    def _extract_jobnib_post_and_nonce(self, html: str) -> tuple[str, str]:
        soup = BeautifulSoup(html, "html.parser")
        nonce_el = soup.select_one("[id^='jn-nonce-'][data-n1]")
        post_id = ""
        nonce = ""
        if nonce_el:
            match = re.search(r"jn-nonce-(\d+)", nonce_el.get("id", ""))
            post_id = match.group(1) if match else ""
            nonce = str(nonce_el.get("data-n1") or "")
        if not post_id:
            article = soup.select_one("article[id^='post-']")
            if article:
                post_id = re.sub(r"\D+", "", article.get("id", ""))
        return post_id, nonce

    def _extract_jobnib_unlock_script(self, html: str, post_id: str) -> str:
        if not post_id:
            return ""
        soup = BeautifulSoup(html, "html.parser")
        for script in soup.find_all("script"):
            text = script.string or script.get_text() or ""
            if f"jnStart{post_id}" in text and "jobnib_load" in text:
                return str(text)
        return ""

    def _merge_segment_html(self, shell_html: str, post_id: str, segment_html: dict[int, str]) -> str:
        soup = BeautifulSoup(shell_html, "html.parser")
        for segment, html in segment_html.items():
            content_el = soup.select_one(f"#jn-content-{post_id}-{segment}")
            if content_el is None:
                continue
            content_el.clear()
            segment_soup = BeautifulSoup(html or "", "html.parser")
            for child in list(segment_soup.contents):
                content_el.append(child.extract())
            content_el["style"] = "display:block;"

            for selector in (f"#jn-lock-{post_id}-{segment}", f"#jn-coll-{post_id}-{segment}"):
                lock_el = soup.select_one(selector)
                if lock_el is not None:
                    lock_el["style"] = "display:none;"

            nav_el = soup.select_one(f"#jn-nav-{post_id}-{segment}")
            if nav_el is not None:
                nav_el["style"] = "display:none;"

        preview = soup.select_one(f"#jn-pre-{post_id}")
        if preview is not None:
            preview["style"] = "display:none;"
        return str(soup)

    def _extract_visible_chapter_content(self, soup: BeautifulSoup) -> tuple[str, str]:
        entry = soup.select_one(".entry-content")
        if entry is None:
            return "", "missing-entry"

        segment_texts: list[str] = []
        has_segment_shell = bool(entry.select("[id^='jn-seg-'], [id^='jn-content-']"))
        locked_segments = 0
        empty_segments = 0

        for content_el in entry.select("[id^='jn-content-']"):
            text = self._extract_prose_from_container(content_el)
            if text:
                segment_texts.append(text)
            else:
                empty_segments += 1

        for lock_el in entry.select("[id^='jn-lock-']"):
            style = lock_el.get("style", "")
            if "display:none" not in style.replace(" ", "").lower():
                locked_segments += 1

        if segment_texts and locked_segments == 0:
            return "\n\n".join(segment_texts), "complete"

        preview = entry.select_one("[id^='jn-pre-']")
        preview_text = self._extract_prose_from_container(preview) if preview else ""
        if preview_text and not has_segment_shell:
            return preview_text, "complete"

        if segment_texts:
            return "\n\n".join(segment_texts), "partial"
        if preview_text:
            return preview_text, "preview-only"
        return "", "empty"

    def _extract_prose_from_container(self, container: Tag | None) -> str:
        if container is None:
            return ""

        clone = BeautifulSoup(str(container), "html.parser")
        root = clone.find()
        if root is None:
            return ""

        for unwanted in root.select(
            "script, style, noscript, iframe, ins, .adsbygoogle, .code-block, "
            "[id^='jn-lock-'], [id^='jn-nav-'], [id^='jn-coll-'], button"
        ):
            unwanted.decompose()

        lines: list[str] = []
        if root.select("p"):
            candidates = root.select("p")
        else:
            candidates = [root]

        for elem in candidates:
            text = self._clean_text(elem.get_text(" ", strip=True))
            if not self._is_content_line(text):
                continue
            lines.append(text)

        if len(lines) <= 1:
            raw_lines = [
                self._clean_text(line)
                for line in root.get_text("\n", strip=True).splitlines()
            ]
            lines = [line for line in raw_lines if self._is_content_line(line)]

        unique: list[str] = []
        seen: set[str] = set()
        for line in lines:
            if line not in seen:
                seen.add(line)
                unique.append(line)
        return "\n\n".join(unique)

    def _is_content_line(self, text: str) -> bool:
        if not text:
            return False
        lower = text.lower()
        blocked_labels = [
            "part 1 of", "part 2 of", "tap to start", "start reading",
            "continue to part", "read part 1", "locked", "tap to re-read",
            "you have reached the end", "all chapter", "previous", "next",
            "options", "ad blocker detected", "disable your ad blocker",
            "original content from jobnib.com",
        ]
        if any(label in lower for label in blocked_labels):
            return False
        if not re.search(r"[A-Za-z0-9]", text):
            return False
        return True

    def _collect_chapter_links(self, soup: BeautifulSoup, story_url: str) -> list[dict[str, Any]]:
        """Return stable TOC-order refs without collapsing multi-volume chapter numbers."""
        refs: list[dict[str, Any]] = []
        seen_urls: set[str] = set()

        for anchor in soup.select(self.selector_config.chapter_list):
            href = anchor.get("href")
            if not href:
                continue

            absolute = self._normalize_url(urllib.parse.urljoin(_JOBNIB_BASE, href))
            parsed = urllib.parse.urlparse(absolute)
            match = _BOOK_PATH_RE.match(parsed.path)
            if not match:
                continue

            slug = match.group(1)
            displayed_number = self._chapter_number_from_slug(slug)
            if displayed_number is None and "chapter" not in (anchor.get_text(" ", strip=True) or "").lower():
                continue
            if absolute in seen_urls or absolute == self._normalize_url(story_url):
                continue
            seen_urls.add(absolute)

            title = self._clean_text(anchor.get("title") or anchor.get_text(" ", strip=True))
            title = re.sub(r"^Ch\.\s*\d+\s+", "", title, flags=re.IGNORECASE)
            sequence_index = len(refs) + 1
            if not title or re.fullmatch(r"Ch\.\s*\d+", title, flags=re.IGNORECASE):
                title = f"Chapter {displayed_number or sequence_index}"
            volume_label = self._chapter_volume_label(anchor)
            refs.append({
                "chapter_number": sequence_index,
                "sequence_index": sequence_index,
                "displayed_chapter_number": displayed_number,
                "volume_label": volume_label,
                "title": title,
                "url": absolute,
            })

        return refs

    def _chapter_volume_label(self, anchor: Tag) -> str:
        current: Tag | None = anchor
        for _ in range(5):
            current = current.parent if isinstance(current.parent, Tag) else None
            if current is None:
                break
            heading = current.find_previous(["h2", "h3", "h4"])
            if heading:
                text = self._clean_text(heading.get_text(" ", strip=True))
                if re.search(r"\b(?:vol(?:ume)?|book)\b", text, re.IGNORECASE):
                    return text
        return ""

    def _select_chapters(self, links: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if self._range_start is not None and self._range_end is not None:
            return [
                link for link in links
                if self._range_start <= int(link["chapter_number"]) <= self._range_end
            ]
        return links[:self.limit]

    def _extract_story_metadata(self, soup: BeautifulSoup, source_url: str) -> dict[str, Any]:
        title = self._extract_story_title(soup)
        cover = self._extract_image_url(soup)
        description = self._meta_content(soup, "meta[name='description']") or ""
        status_el = soup.select_one(".sertostat, .status")
        status = self._clean_text(status_el.get_text(" ", strip=True)) if status_el else ""
        metadata = {
            "source_url": source_url,
            "title": title,
            "cover_url": cover,
            "description": description,
            "status": status,
        }
        return {key: value for key, value in metadata.items() if value}

    def _extract_story_title(self, soup: BeautifulSoup) -> str:
        for selector in [
            ".seriestuheader h1",
            ".entry-title",
            "h1",
            "meta[property='og:title']",
        ]:
            value = self._selector_text_or_content(soup, selector)
            if value:
                return self._clean_story_title(value)
        return ""

    def _extract_series_title(self, soup: BeautifulSoup) -> str:
        script_title = ""
        for script in soup.find_all("script"):
            text = script.get_text()
            match = re.search(r'"series_title"\s*:\s*"((?:\\.|[^"\\])*)"', text)
            if match:
                try:
                    script_title = json.loads(f'"{match.group(1)}"')
                except json.JSONDecodeError:
                    script_title = match.group(1)
                break
        if script_title:
            return self._clean_text(script_title)

        title = self._extract_chapter_title(soup)
        return self._clean_story_title(title)

    def _story_title_from_chapter_title(self, soup: BeautifulSoup) -> str:
        return self._clean_story_title(self._extract_chapter_title(soup))

    def _extract_chapter_title(self, soup: BeautifulSoup) -> str:
        for selector in [
            "h1.entry-title",
            ".entry-title",
            "meta[property='og:title']",
            "title",
        ]:
            value = self._selector_text_or_content(soup, selector)
            if value:
                return self._clean_chapter_title(value)
        return ""

    def _selector_text_or_content(self, soup: BeautifulSoup, selector: str) -> str:
        element = soup.select_one(selector)
        if not element:
            return ""
        if element.name == "meta":
            return self._clean_text(element.get("content", ""))
        return self._clean_text(element.get_text(" ", strip=True))

    def _extract_image_url(self, soup: BeautifulSoup) -> str:
        for selector in [self.selector_config.cover_image, "meta[property='og:image']"]:
            element = soup.select_one(selector)
            if not element:
                continue
            url = element.get("content") if element.name == "meta" else element.get("src")
            if url:
                return urllib.parse.urljoin(_JOBNIB_BASE, url)
        return ""

    def _meta_content(self, soup: BeautifulSoup, selector: str) -> str:
        element = soup.select_one(selector)
        if not element:
            return ""
        return self._clean_text(element.get("content", ""))

    def _clean_story_title(self, title: str) -> str:
        title = self._clean_text(title)
        title = re.sub(r"\s+-\s+Jobnib\s*$", "", title, flags=re.IGNORECASE)
        title = re.sub(r"\s+[–-]\s+Chapter\s+\d+\s*$", "", title, flags=re.IGNORECASE)
        return title.strip()

    def _clean_chapter_title(self, title: str) -> str:
        title = self._clean_text(title)
        title = re.sub(r"\s+-\s+Jobnib\s*$", "", title, flags=re.IGNORECASE)
        return title.strip()

    def _clean_text(self, text: str) -> str:
        return _SPACE_RE.sub(" ", text.replace("\ufeff", " ")).strip()

    def _get_browser(self) -> "_JobnibBrowser":
        if self._browser is None:
            self._browser = _JobnibBrowser(logger=self.logger)
        return self._browser

    def _load_saved_session(self) -> tuple[list[dict[str, Any]], str | None]:
        try:
            from api.services.jobnib_cookie_service import load_jobnib_cookies

            return load_jobnib_cookies()
        except Exception:
            return [], None

    def _is_chapter_url(self, url: str) -> bool:
        return self._chapter_number_from_url(url) is not None

    def _chapter_number_from_url(self, url: str) -> Optional[int]:
        parsed = urllib.parse.urlparse(url)
        match = _BOOK_PATH_RE.match(parsed.path)
        if not match:
            return None
        return self._chapter_number_from_slug(match.group(1))

    def _chapter_number_from_slug(self, slug: str) -> Optional[int]:
        match = _CHAPTER_SUFFIX_RE.search(slug.rstrip("/"))
        return int(match.group(1)) if match else None

    def _story_slug_from_url(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        match = _BOOK_PATH_RE.match(parsed.path)
        if not match:
            return "jobnib-unknown"
        return self._strip_chapter_suffix(match.group(1))

    def _strip_chapter_suffix(self, slug: str) -> str:
        return _CHAPTER_SUFFIX_RE.sub("", slug.rstrip("/"))

    def _chapter_url_for_number(self, url: str, chapter_number: int) -> str:
        parsed = urllib.parse.urlparse(url)
        match = _BOOK_PATH_RE.match(parsed.path)
        if not match:
            return url
        slug = self._strip_chapter_suffix(match.group(1))
        path = f"/book/{slug}-chapter-{chapter_number}"
        return urllib.parse.urlunparse((parsed.scheme or "https", parsed.netloc or "jobnib.com", path, "", "", ""))

    def _normalize_url(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme or "https"
        netloc = parsed.netloc or "jobnib.com"
        path = parsed.path.rstrip("/") or "/"
        return urllib.parse.urlunparse((scheme, netloc.lower(), path, "", "", ""))

    def _is_cloudflare_challenge(self, html: str) -> bool:
        head = html[:20000]
        if ("entry-content" in html or "seriestucon" in html) and ("jnStart" in html or "-chapter-" in html):
            return False
        return (
            "Just a moment" in head
            or "Enable JavaScript and cookies to continue" in head
            or "Performing security verification" in head
        )

    def parse_chapter(self, response: scrapy.http.Response, chapter_index: int) -> Generator[Chapter, None, None]:
        raise NotImplementedError("JobnibSpider uses direct Selenium browser flow.")

    def closed(self, reason: str) -> None:
        if self._browser is not None:
            self._browser.close()
        self.logger.info("")
        self.logger.info("=" * 45)
        self.logger.info("  Jobnib crawl complete.")
        self.logger.info("  %d chapter(s) saved.", self._chapters_crawled)
        self.logger.info("=" * 45)
        self.logger.info("")


class _JobnibBrowser:
    def __init__(self, logger: logging.Logger, user_agent: str | None = None):
        self.logger = logger
        self._driver: Any = None
        self._xvfb_process: subprocess.Popen[Any] | None = None
        self._profile_dir = Path(os.getenv("JOBNIB_CHROME_PROFILE", Path(tempfile.gettempdir()) / "jobnib_crawler_profile"))
        self._cookie_file = Path(__file__).parent.parent / "handlers" / "selenium_cookies_jobnib_com.json"
        self._persist_cookies = True
        self._chromedriver_path: str | None = None
        self._saved_user_agent = (user_agent or self._load_saved_user_agent() or "").strip()
        atexit.register(self.close)

    def fetch_page(self, url: str, timeout: int = 60) -> str:
        driver = self._driver_or_start()
        self._set_page_load_timeout(timeout)
        try:
            driver.get(url)
        except Exception as exc:
            if not self._is_timeout_error(exc):
                raise
            self.logger.warning("[jobnib] Browser page load timed out for %s; continuing with current DOM.", url)
        self._wait_for_page(timeout)
        self._dismiss_overlays()
        self._save_cookies()
        return driver.page_source

    def unlock_chapter(self, url: str, timeout: int = 90, unlock_script: str = "") -> str:
        driver = self._driver_or_start()
        self._set_page_load_timeout(timeout)
        try:
            driver.get(url)
        except Exception as exc:
            if not self._is_timeout_error(exc):
                raise
            self.logger.warning("[jobnib] Browser page load timed out for %s; continuing with current DOM.", url)
        self._wait_for_page(timeout)
        self._dismiss_overlays()

        post_id = self._post_id()
        if not post_id:
            self.logger.warning("[jobnib] Browser page has no Jobnib post id after navigation. %s", self._page_state())
            return driver.page_source

        self._ensure_unlock_script(post_id, unlock_script=unlock_script)
        self._click_start(post_id)
        if not self._wait_for_segment(post_id, 1, timeout=timeout / 2):
            self.logger.warning("[jobnib] Browser did not unlock segment 1 for post %s. %s", post_id, self._page_state())
        self._dismiss_overlays()
        self._click_next(post_id)
        if not self._wait_for_segment(post_id, 2, timeout=timeout / 2):
            self.logger.warning("[jobnib] Browser did not unlock segment 2 for post %s. %s", post_id, self._page_state())
        self._dismiss_overlays()
        self._save_cookies()
        return driver.page_source

    def _driver_or_start(self):
        if self._driver is not None:
            try:
                self._driver.current_url
                return self._driver
            except Exception:
                self.close()

        self._remove_stale_profile_locks()
        headless = self._should_run_headless()
        if self._env_flag("JOBNIB_HEADLESS") is None and headless and self._start_virtual_display():
            headless = False
        use_uc = self._should_use_undetected_chromedriver(headless)
        uc = None

        if use_uc:
            try:
                import undetected_chromedriver as uc

                Options = uc.ChromeOptions
            except Exception as exc:
                self.logger.warning("[jobnib] undetected-chromedriver unavailable (%s); using Selenium.", exc)
                use_uc = False

        if not use_uc:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.chrome.service import Service

        options = Options()
        if headless:
            options.add_argument("--headless=new")
        options.add_argument("--window-size=1400,1000")
        options.add_argument(f"--user-agent={self._resolved_user_agent()}")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-infobars")
        options.add_argument("--disable-background-networking")
        options.add_argument("--disable-background-timer-throttling")
        options.add_argument("--disable-backgrounding-occluded-windows")
        options.add_argument("--disable-breakpad")
        options.add_argument("--disable-component-extensions-with-background-pages")
        options.add_argument("--disable-hang-monitor")
        options.add_argument("--disable-renderer-backgrounding")
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
        if (headless or self._xvfb_process is not None) and not os.environ.get("JOBNIB_CHROME_PROFILE"):
            self._profile_dir = Path(tempfile.gettempdir()) / f"jobnib_crawler_profile_{os.getpid()}"
            if self._profile_dir.exists():
                shutil.rmtree(self._profile_dir, ignore_errors=True)
            self._profile_dir.mkdir(parents=True, exist_ok=True)
        options.add_argument(f"--user-data-dir={self._profile_dir}")
        options.add_argument("--profile-directory=Default")

        proxy_url = get_proxy_url("jobnib")
        if proxy_url:
            options.add_argument(f"--proxy-server={proxy_url}")

        mode = "headless" if headless else "visible"
        driver_kind = "undetected-chromedriver" if use_uc else "Selenium"
        self.logger.info(
            "[jobnib] Starting %s Chrome via %s. Binary=%s Profile=%s",
            mode,
            driver_kind,
            getattr(options, "binary_location", None) or "auto-detect",
            self._profile_dir,
        )
        self._persist_cookies = (not headless) or (self._env_flag("JOBNIB_USE_COOKIES") is True)

        if use_uc and uc is not None:
            try:
                self._driver = self._start_undetected_driver(uc, options, headless)
            except Exception as exc:
                self.logger.warning("[jobnib] undetected Chrome failed (%s); retrying with Selenium.", exc)
                if isinstance(exc, TimeoutError):
                    self._rotate_profile_dir(options, prefix="jobnib_crawler_selenium_profile")
                use_uc = False

        if not use_uc:
            from selenium import webdriver
            from selenium.webdriver.chrome.service import Service

            chromedriver_path = self._resolve_chromedriver()
            service = Service(executable_path=chromedriver_path) if chromedriver_path else Service()
            try:
                self._driver = webdriver.Chrome(service=service, options=options)
            except Exception as exc:
                # A persistent profile can retain a truncated Preferences file
                # after Chromium is killed during a challenge. Keep the
                # persistent cookies, but retry the browser with a clean profile
                # instead of surfacing ChromeDriver's opaque JSON parse error.
                self.logger.warning(
                    "[jobnib] Selenium could not start with profile %s (%s); retrying with a fresh profile.",
                    self._profile_dir,
                    self._short_error(exc),
                )
                self._rotate_profile_dir(options, prefix="jobnib_crawler_selenium_profile")
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
        if self._persist_cookies:
            self._inject_cookies()
        return self._driver

    def _resolved_user_agent(self) -> str:
        """Use the exact UA paired with saved Cloudflare cookies when available."""
        return os.getenv("JOBNIB_USER_AGENT") or self._saved_user_agent or _JOBNIB_USER_AGENT

    def _load_saved_user_agent(self) -> str | None:
        try:
            from api.services.jobnib_cookie_service import load_jobnib_cookies

            _cookies, user_agent = load_jobnib_cookies()
            return user_agent
        except Exception:
            return None

    def _remove_stale_profile_locks(self) -> None:
        """Remove Chromium ownership markers left by a crashed/recreated container.

        This runs only when this browser object has no live driver and browser
        access is serialized by the caller. A clean Chrome shutdown removes the
        markers itself; their presence here means startup cannot safely reuse the
        persistent profile without clearing them first.
        """
        self._profile_dir.mkdir(parents=True, exist_ok=True)
        removed: list[str] = []
        for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
            marker = self._profile_dir / name
            try:
                if marker.is_symlink() or marker.exists():
                    marker.unlink()
                    removed.append(name)
            except OSError as exc:
                self.logger.warning("[jobnib] Could not remove stale Chromium marker %s: %s", marker, exc)
        if removed:
            self.logger.info("[jobnib] Removed stale Chromium profile marker(s): %s.", ", ".join(removed))

    def _start_undetected_driver(self, uc: Any, options: Any, headless: bool) -> Any:
        chrome_major = self._chrome_major_version()
        uc_kwargs: dict[str, Any] = {
            "options": options,
            "headless": headless,
            "use_subprocess": True,
        }
        if chrome_major:
            uc_kwargs["version_main"] = chrome_major
            self.logger.info("[jobnib] Using ChromeDriver major %s for installed Chrome.", chrome_major)

        timeout = self._positive_int_env("JOBNIB_UC_STARTUP_TIMEOUT", 25)
        result: list[tuple[str, Any]] = []
        abandoned = threading.Event()

        def _launch() -> None:
            try:
                driver = uc.Chrome(**uc_kwargs)
                if abandoned.is_set():
                    try:
                        driver.quit()
                    except Exception:
                        pass
                    return
                result.append(("driver", driver))
            except Exception as exc:
                if not abandoned.is_set():
                    result.append(("error", exc))

        thread = threading.Thread(target=_launch, name="jobnib-uc-start", daemon=True)
        thread.start()
        thread.join(timeout=timeout)
        if thread.is_alive():
            abandoned.set()
            raise TimeoutError(f"undetected-chromedriver did not finish startup within {timeout}s")
        if not result:
            raise RuntimeError("undetected-chromedriver startup ended without returning a driver")
        kind, value = result[0]
        if kind == "error":
            raise value
        return value

    def _rotate_profile_dir(self, options: Any, prefix: str) -> None:
        self._profile_dir = Path(tempfile.mkdtemp(prefix=f"{prefix}_{os.getpid()}_"))
        self._replace_chrome_argument(options, "--user-data-dir=", f"--user-data-dir={self._profile_dir}")
        self.logger.info("[jobnib] Retrying browser startup with fresh profile %s.", self._profile_dir)

    def _replace_chrome_argument(self, options: Any, prefix: str, replacement: str) -> None:
        arguments = getattr(options, "arguments", None)
        if isinstance(arguments, list):
            for index, argument in enumerate(arguments):
                if isinstance(argument, str) and argument.startswith(prefix):
                    arguments[index] = replacement
                    return
        options.add_argument(replacement)

    def _positive_int_env(self, name: str, default: int) -> int:
        raw = os.environ.get(name)
        if raw is None:
            return default
        try:
            value = int(raw.strip())
        except (AttributeError, ValueError):
            return default
        return value if value > 0 else default

    def _set_page_load_timeout(self, timeout: int) -> None:
        try:
            self._driver.set_page_load_timeout(max(15, int(timeout)))
        except Exception:
            pass

    def _is_timeout_error(self, exc: Exception) -> bool:
        text = f"{type(exc).__name__}: {exc}".lower()
        return "timeout" in text or "timed out" in text

    def _is_driver_connection_error(self, exc: Exception) -> bool:
        text = f"{type(exc).__name__}: {exc}".lower()
        return any(
            fragment in text
            for fragment in (
                "connection refused",
                "remote disconnected",
                "failed to establish a new connection",
                "invalid session id",
                "chrome not reachable",
                "disconnected",
            )
        )

    def _short_error(self, exc: Exception) -> str:
        text = f"{type(exc).__name__}: {exc}".replace("\n", " ").strip()
        return text[:500]

    def _env_flag(self, name: str) -> bool | None:
        value = os.environ.get(name)
        if value is None:
            return None
        return value.strip().lower() in {"1", "true", "yes", "on"}

    def _should_run_headless(self) -> bool:
        explicit = self._env_flag("JOBNIB_HEADLESS")
        if explicit is not None:
            return explicit
        if Path("/.dockerenv").exists() or os.environ.get("container"):
            return True
        if os.name != "nt" and not os.environ.get("DISPLAY"):
            return True
        return False

    def _start_virtual_display(self) -> bool:
        if os.name == "nt" or os.environ.get("DISPLAY"):
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
            try:
                process = subprocess.Popen(
                    [xvfb, display, "-screen", "0", "1400x1000x24", "-nolisten", "tcp"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                time.sleep(0.25)
                if process.poll() is None:
                    os.environ["DISPLAY"] = display
                    self._xvfb_process = process
                    self.logger.info("[jobnib] Started Xvfb display %s for visible Chrome.", display)
                    return True
            except Exception as exc:
                self.logger.debug("[jobnib] Could not start Xvfb on %s: %s", display, exc)
            try:
                process.terminate()
            except Exception:
                pass
        return False

    def _should_use_undetected_chromedriver(self, headless: bool) -> bool:
        explicit = self._env_flag("JOBNIB_USE_UC")
        if explicit is not None:
            return explicit
        return not headless

    def _wait_for_page(self, timeout: int) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                title = self._driver.title or ""
                has_entry = self._driver.execute_script("return !!document.querySelector('.entry-content, .seriestucon')")
                if "Just a moment" not in title and has_entry:
                    return True
            except Exception as exc:
                if self._is_driver_connection_error(exc):
                    raise RuntimeError(f"Jobnib browser session died while waiting for page: {self._short_error(exc)}") from exc
            time.sleep(0.5)
        self.logger.warning("[jobnib] Browser did not reach a chapter/story DOM within %ds. %s", timeout, self._page_state())
        return False

    def _ensure_unlock_script(self, post_id: str, unlock_script: str = "") -> None:
        try:
            has_start = self._driver.execute_script(
                "return typeof window['jnStart' + arguments[0]] === 'function';",
                post_id,
            )
            if has_start:
                return

            scripts = self._driver.execute_script(
                """
                return Array.from(document.scripts)
                  .filter(function(script) {
                    return (script.textContent || '').indexOf('jnStart' + arguments[0]) >= 0;
                  })
                  .map(function(script) { return script.textContent || ''; });
                """,
                post_id,
            )
        except Exception as exc:
            self.logger.debug("[jobnib] Could not inspect delayed unlock scripts for post %s: %s", post_id, exc)
            scripts = []

        if not scripts:
            if unlock_script:
                self.logger.info("[jobnib] Using unlock script captured from raw chapter HTML for post %s.", post_id)
                scripts = [unlock_script]
            else:
                self.logger.warning("[jobnib] No delayed Jobnib unlock script found for post %s. %s", post_id, self._page_state())
                return

        script = str(scripts[0])
        script = script.replace(
            "function tsPass(t){",
            "function tsPass(t){window.__jobnibTurnstileToken=(t||'');",
        )
        script = script.replace(
            "function tsErr(){",
            "function tsErr(){window.__jobnibTurnstileError=(Array.from(arguments).map(String).join(',')||'error');",
        )

        try:
            self._driver.execute_script("window.__cfRLUnblockHandlers = true;")
            script_error = self._driver.execute_script(
                """
                try {
                  (0, eval)(arguments[0]);
                  return '';
                } catch (err) {
                  return String((err && (err.stack || err.message)) || err);
                }
                """,
                script,
            )
            if script_error:
                raise RuntimeError(str(script_error))
            time.sleep(0.8)
            has_start = self._driver.execute_script(
                "return typeof window['jnStart' + arguments[0]] === 'function';",
                post_id,
            )
            if has_start:
                self.logger.info("[jobnib] Activated delayed unlock script for post %s.", post_id)
            else:
                self.logger.warning("[jobnib] Delayed unlock script executed but start function is still missing for post %s.", post_id)
        except Exception as exc:
            self.logger.warning("[jobnib] Could not activate delayed unlock script for post %s: %s", post_id, self._short_error(exc))

    def _click_start(self, post_id: str) -> None:
        try:
            handled = self._driver.execute_script(
                "window.__cfRLUnblockHandlers = true; "
                "var fn = window['jnStart' + arguments[0]]; "
                "if (typeof fn === 'function') { fn(); return true; } "
                "return false;",
                post_id,
            )
            if handled:
                return
        except Exception as exc:
            self.logger.debug("[jobnib] Direct start call failed for post %s: %s", post_id, exc)
        self._click_selector(f"#jn-btn-{post_id}-1")

    def _click_next(self, post_id: str) -> None:
        try:
            handled = self._driver.execute_script(
                "window.__cfRLUnblockHandlers = true; "
                "var fn = window['jnNext' + arguments[0]]; "
                "if (typeof fn === 'function') { fn(1); return true; } "
                "return false;",
                post_id,
            )
            if handled:
                return
        except Exception as exc:
            self.logger.debug("[jobnib] Direct next call failed for post %s: %s", post_id, exc)
        self._click_selector(f"#jn-next-{post_id}-1")

    def _click_selector(self, selector: str) -> None:
        try:
            element = self._driver.find_element("css selector", selector)
            self._driver.execute_script("arguments[0].scrollIntoView({block:'center'});", element)
            time.sleep(0.4)
            element.click()
        except Exception as exc:
            self.logger.debug("[jobnib] Native click failed for %s: %s; trying JS click.", selector, exc)
            try:
                self._driver.execute_script(
                    "var el=document.querySelector(arguments[0]); if(el){el.click(); return true;} return false;",
                    selector,
                )
            except Exception as js_exc:
                self.logger.debug("[jobnib] JS click failed for %s: %s", selector, js_exc)

    def _wait_for_segment(self, post_id: str, segment: int, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        selector = f"#jn-content-{post_id}-{segment}"
        while time.monotonic() < deadline:
            self._dismiss_overlays()
            try:
                if segment == 2:
                    turnstile_error = self._driver.execute_script("return window.__jobnibTurnstileError || '';")
                    if turnstile_error:
                        self.logger.warning(
                            "[jobnib] Turnstile failed while unlocking segment 2 for post %s: %s",
                            post_id,
                            turnstile_error,
                        )
                        return False
                length = self._driver.execute_script(
                    "var el=document.querySelector(arguments[0]); return el ? (el.innerText || '').length : 0;",
                    selector,
                )
                if int(length or 0) > 100:
                    return True
            except Exception as exc:
                if self._is_driver_connection_error(exc):
                    raise RuntimeError(f"Jobnib browser session died while waiting for segment {segment}: {self._short_error(exc)}") from exc
            time.sleep(0.5)
        return False

    def _page_state(self) -> str:
        try:
            title = self._driver.title or ""
            current_url = self._driver.current_url or ""
            state = self._driver.execute_script(
                """
                return {
                  hasEntry: !!document.querySelector('.entry-content'),
                  hasSeries: !!document.querySelector('.seriestucon'),
                  hasPost: !!document.querySelector('article[id^="post-"]'),
                  hasTurnstile: !!document.querySelector('[class*="turnstile"], iframe[src*="turnstile"], iframe[src*="cloudflare"]'),
                  hasPreview: !!document.querySelector('[id^="jn-pre-"]'),
                  segmentCount: document.querySelectorAll('[id^="jn-content-"]').length,
                  bodyLength: (document.body && document.body.innerText || '').length
                };
                """
            )
            return f"title={title!r} url={current_url!r} state={state}"
        except Exception as exc:
            return f"browser state unavailable: {self._short_error(exc)}"

    def _post_id(self) -> str:
        try:
            post_id = self._driver.execute_script(
                """
                var el = document.querySelector('article[id^="post-"]');
                return el ? el.id.replace('post-', '') : '';
                """
            )
            return str(post_id or "")
        except Exception:
            return ""

    def _dismiss_overlays(self) -> None:
        try:
            self._driver.execute_script(
                """
                document.querySelectorAll(
                  '#adblock-overlay,.fc-ab-root,.fc-dialog,.google-auto-placed,.adsbygoogle,' +
                  '[id*="overlay"],[class*="overlay"],iframe'
                ).forEach(function(el) {
                  var text = (el.innerText || '').toLowerCase();
                  var id = (el.id || '').toLowerCase();
                  var cls = (el.className || '').toString().toLowerCase();
                  if (
                    id.indexOf('adblock') >= 0 ||
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
        if not self._persist_cookies:
            return
        try:
            self._driver.get(_JOBNIB_BASE)
            cookies = []
            try:
                from api.services.jobnib_cookie_service import load_jobnib_cookies

                cookies, _user_agent = load_jobnib_cookies()
            except Exception:
                cookies = []
            if not cookies and self._cookie_file.exists():
                cookies = json.loads(self._cookie_file.read_text(encoding="utf-8"))
            for cookie in cookies:
                try:
                    self._driver.add_cookie({
                        "name": cookie["name"],
                        "value": cookie["value"],
                        "domain": cookie.get("domain", ".jobnib.com"),
                        "path": cookie.get("path", "/"),
                    })
                except Exception:
                    pass
            if cookies:
                self.logger.info("[jobnib] Loaded %d saved browser cookie(s).", len(cookies))
        except Exception as exc:
            self.logger.debug("[jobnib] Could not inject saved cookies: %s", exc)

    def _save_cookies(self) -> None:
        if not self._persist_cookies:
            return
        try:
            cookies = self._driver.get_cookies()
            if not cookies:
                return
            try:
                from api.services.jobnib_cookie_service import persist_jobnib_cookies

                user_agent = self._driver.execute_script("return navigator.userAgent || '';")
                persist_jobnib_cookies(cookies, str(user_agent or ""))
            except Exception as exc:
                self.logger.debug("[jobnib] Could not persist browser cookies to the database: %s", exc)
            cookie_path = self._cookie_file
            cookie_path.parent.mkdir(parents=True, exist_ok=True)
            cookie_path.touch(exist_ok=True)
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
            self.logger.debug("[jobnib] Could not save cookies: %s", exc)

    def _resolve_chromedriver(self) -> str | None:
        if self._chromedriver_path:
            return self._chromedriver_path

        if os.environ.get("CHROMEDRIVER_PATH"):
            driver_path = os.environ["CHROMEDRIVER_PATH"]
            if self._driver_matches_installed_chrome(driver_path):
                return self._cache_chromedriver(driver_path)
            self.logger.warning("[jobnib] CHROMEDRIVER_PATH points to an incompatible ChromeDriver; trying auto-resolution.")

        found = shutil.which("chromedriver")
        if found and self._driver_matches_installed_chrome(found):
            return self._cache_chromedriver(found)

        for candidate in ("/usr/bin/chromedriver", "/usr/local/bin/chromedriver"):
            if Path(candidate).exists() and self._driver_matches_installed_chrome(candidate):
                return self._cache_chromedriver(candidate)

        try:
            from webdriver_manager.chrome import ChromeDriverManager
            from webdriver_manager.core.os_manager import ChromeType

            chrome_type = ChromeType.CHROMIUM if os.name != "nt" else ChromeType.GOOGLE
            driver_path = ChromeDriverManager(chrome_type=chrome_type).install()
            if self._driver_matches_installed_chrome(driver_path):
                return self._cache_chromedriver(driver_path)
            self.logger.warning("[jobnib] webdriver-manager returned an incompatible ChromeDriver; falling back to Selenium Manager.")
        except Exception as exc:
            self.logger.warning("[jobnib] webdriver-manager failed (%s); falling back to Selenium Manager.", exc)
        return None

    def _cache_chromedriver(self, driver_path: str) -> str:
        self._chromedriver_path = driver_path
        return driver_path

    def _driver_matches_installed_chrome(self, driver_path: str) -> bool:
        chrome_major = self._chrome_major_version()
        driver_major = self._chromedriver_major_version(driver_path)
        if not chrome_major or not driver_major:
            return True
        if chrome_major == driver_major:
            return True
        self.logger.info(
            "[jobnib] Ignoring ChromeDriver %s because driver major %s does not match Chrome major %s.",
            driver_path,
            driver_major,
            chrome_major,
        )
        return False

    def _chromedriver_major_version(self, driver_path: str) -> int | None:
        return self._extract_major_version(self._run_version_command([driver_path, "--version"]))

    def _chrome_major_version(self) -> int | None:
        explicit = os.environ.get("JOBNIB_CHROME_VERSION_MAIN")
        if explicit:
            try:
                return int(explicit.strip())
            except ValueError:
                self.logger.warning("[jobnib] Ignoring invalid JOBNIB_CHROME_VERSION_MAIN=%r.", explicit)

        candidates: list[str] = []
        chrome_bin = os.environ.get("CHROME_BIN")
        if chrome_bin:
            candidates.append(chrome_bin)
        candidates.extend([
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ])
        for name in ("chrome", "chrome.exe", "google-chrome", "chromium", "chromium-browser"):
            found = shutil.which(name)
            if found:
                candidates.append(found)

        seen: set[str] = set()
        for candidate in candidates:
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            if not Path(candidate).exists() and shutil.which(candidate) is None:
                continue
            major = self._extract_major_version(self._run_version_command([candidate, "--version"]))
            if major:
                return major
        return None

    def _extract_major_version(self, text: str) -> int | None:
        match = re.search(r"(\d+)(?:\.\d+){1,3}", text or "")
        if not match:
            return None
        try:
            return int(match.group(1))
        except ValueError:
            return None

    def _run_version_command(self, command: list[str]) -> str:
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=5)
        except Exception:
            return ""
        return f"{result.stdout}\n{result.stderr}"

    def close(self) -> None:
        if self._driver is not None:
            try:
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


JobnibSpider.complete = (
    "Jobnib spider complete. Run with: "
    "scrapy crawl jobnib -a novel='https://jobnib.com/book/...'"
)
