"""Spider for jobnib.com.

Supports:
  Story URL: scrapy crawl jobnib -a novel="https://jobnib.com/book/story-slug" -a limit=3
  Chapter URL: scrapy crawl jobnib -a novel="https://jobnib.com/book/story-slug-chapter-1" -a limit=2
"""

from __future__ import annotations

import atexit
from concurrent.futures import ThreadPoolExecutor, as_completed
import fcntl
import json
import logging
import os
import re
import secrets
import shutil
import string
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
_CHAPTER_SUFFIX_RE = re.compile(r"-chapter-(\d+)$", re.IGNORECASE)
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
                except CloseSpider:
                    for pending in futures:
                        pending.cancel()
                    raise
                except Exception as exc:
                    for pending in futures:
                        pending.cancel()
                    raise CloseSpider(
                        f"[jobnib] Failed while crawling chapter {chapter_ref.get('chapter_number')}: {exc}"
                    ) from exc

                if chapter is None:
                    continue
                self._log_crawled_chapter(chapter)
                yield chapter
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

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
            "User-Agent": _JOBNIB_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": _JOBNIB_BASE + "/",
        }
        resp = requests.get(
            url,
            headers=headers,
            timeout=timeout,
            proxies=requests_proxies("jobnib"),
        )
        resp.raise_for_status()
        return resp.text

    def _crawl_chapter(self, chapter_ref: dict[str, Any], include_metadata: bool) -> Chapter | None:
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

        if status != "complete" or word_count < 500:
            raise CloseSpider(
                "[jobnib] Could not unlock full chapter content. "
                "Jobnib protects chapter segments behind Cloudflare/Turnstile AJAX. "
                "Open the chapter in the visible crawler browser and complete the site verification, then retry."
            )

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
        try:
            unlocked = self._fetch_chapter_segments_with_requests(chapter_url, shell_html)
            content, status = self._extract_visible_chapter_content(BeautifulSoup(unlocked, "html.parser"))
            if status == "complete" and len(content.split()) >= 500:
                return unlocked
            self.logger.info("[jobnib] AJAX unlock returned %s content; falling back to browser.", status)
        except Exception as exc:
            self.logger.info("[jobnib] AJAX unlock failed for %s: %s; falling back to browser.", chapter_url, exc)
        with self._browser_lock:
            return self._get_browser().unlock_chapter(chapter_url, timeout=90)

    def _fetch_chapter_segments_with_requests(self, chapter_url: str, shell_html: str) -> str:
        import requests

        post_id, first_nonce = self._extract_jobnib_post_and_nonce(shell_html)
        if not post_id or not first_nonce:
            raise ValueError("missing Jobnib post id or nonce")

        session = requests.Session()
        headers = {
            "User-Agent": os.getenv("JOBNIB_USER_AGENT", _JOBNIB_USER_AGENT),
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": chapter_url,
        }
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
        if not next_nonce:
            raise ValueError("missing segment 2 nonce")

        seg2_resp = session.post(
            ajax_url,
            data={
                "action": "jobnib_load",
                "post_id": post_id,
                "segment": "2",
                "nonce": next_nonce,
                "cf_token": self._synthetic_turnstile_token(),
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

        return self._merge_segment_html(
            shell_html=shell_html,
            post_id=post_id,
            segment_html={
                1: seg1_data["data"].get("content", ""),
                2: seg2_data["data"].get("content", ""),
            },
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

    def _synthetic_turnstile_token(self) -> str:
        alphabet = string.ascii_letters + string.digits + "_-"
        return "0." + "".join(secrets.choice(alphabet) for _ in range(1700))

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
        links_by_number: dict[int, dict[str, Any]] = {}
        story_slug = self._story_slug_from_url(story_url)

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
            number = self._chapter_number_from_slug(slug)
            if number is None:
                continue

            link_story_slug = self._strip_chapter_suffix(slug)
            if story_slug and link_story_slug != story_slug:
                continue

            title = self._clean_text(anchor.get("title") or anchor.get_text(" ", strip=True))
            title = re.sub(r"^Ch\.\s*\d+\s+", "", title, flags=re.IGNORECASE)
            if not title or re.fullmatch(r"Ch\.\s*\d+", title, flags=re.IGNORECASE):
                title = f"Chapter {number}"

            existing = links_by_number.get(number)
            if existing and existing.get("title") and existing["title"] != f"Chapter {number}":
                continue
            links_by_number[number] = {
                "chapter_number": number,
                "title": title,
                "url": absolute,
            }

        return [links_by_number[num] for num in sorted(links_by_number)]

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
        status_el = soup.select_one(".status")
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
    def __init__(self, logger: logging.Logger):
        self.logger = logger
        self._driver: Any = None
        self._xvfb_process: subprocess.Popen[Any] | None = None
        self._profile_dir = Path(os.getenv("JOBNIB_CHROME_PROFILE", Path(tempfile.gettempdir()) / "jobnib_crawler_profile"))
        self._cookie_file = Path(__file__).parent.parent / "handlers" / "selenium_cookies_jobnib_com.json"
        self._persist_cookies = True
        atexit.register(self.close)

    def fetch_page(self, url: str, timeout: int = 60) -> str:
        driver = self._driver_or_start()
        driver.get(url)
        self._wait_for_page(timeout)
        self._dismiss_overlays()
        self._save_cookies()
        return driver.page_source

    def unlock_chapter(self, url: str, timeout: int = 90) -> str:
        driver = self._driver_or_start()
        driver.get(url)
        self._wait_for_page(timeout)
        self._dismiss_overlays()

        post_id = self._post_id()
        if not post_id:
            return driver.page_source

        self._click_start(post_id)
        self._wait_for_segment(post_id, 1, timeout=timeout / 2)
        self._dismiss_overlays()
        self._click_next(post_id)
        self._wait_for_segment(post_id, 2, timeout=timeout / 2)
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
        options.add_argument(f"--user-agent={os.getenv('JOBNIB_USER_AGENT', _JOBNIB_USER_AGENT)}")
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
                self._driver = uc.Chrome(options=options, headless=headless, use_subprocess=True)
            except Exception as exc:
                if not headless:
                    raise
                self.logger.warning("[jobnib] undetected Chrome failed in headless mode (%s); retrying with Selenium.", exc)
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
        if self._persist_cookies:
            self._inject_cookies()
        return self._driver

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

    def _wait_for_page(self, timeout: int) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                title = self._driver.title or ""
                has_entry = self._driver.execute_script("return !!document.querySelector('.entry-content, .seriestucon')")
                if "Just a moment" not in title and has_entry:
                    return
            except Exception:
                pass
            time.sleep(0.5)

    def _click_start(self, post_id: str) -> None:
        try:
            self._driver.execute_script(
                "window.__cfRLUnblockHandlers = true; "
                "var fn = window['jnStart' + arguments[0]]; "
                "if (typeof fn === 'function') { fn(); return true; } "
                "return false;",
                post_id,
            )
            return
        except Exception as exc:
            self.logger.debug("[jobnib] Direct start call failed for post %s: %s", post_id, exc)
        self._click_selector(f"#jn-btn-{post_id}-1")

    def _click_next(self, post_id: str) -> None:
        try:
            self._driver.execute_script(
                "window.__cfRLUnblockHandlers = true; "
                "var fn = window['jnNext' + arguments[0]]; "
                "if (typeof fn === 'function') { fn(1); return true; } "
                "return false;",
                post_id,
            )
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
                length = self._driver.execute_script(
                    "var el=document.querySelector(arguments[0]); return el ? (el.innerText || '').length : 0;",
                    selector,
                )
                if int(length or 0) > 100:
                    return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

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
        if not self._cookie_file.exists():
            return
        try:
            self._driver.get(_JOBNIB_BASE)
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
            self.logger.info("[jobnib] Loaded %d cookie(s) from %s", len(cookies), self._cookie_file.name)
        except Exception as exc:
            self.logger.debug("[jobnib] Could not inject saved cookies: %s", exc)

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
                    else:
                        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                    f.seek(0)
                    json.dump(cookies, f, indent=2)
                    f.truncate()
                finally:
                    if os.name == "nt" and msvcrt is not None:
                        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except Exception as exc:
            self.logger.debug("[jobnib] Could not save cookies: %s", exc)

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
            self.logger.warning("[jobnib] webdriver-manager failed (%s); falling back to Selenium Manager.", exc)
            return None

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
