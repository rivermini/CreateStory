"""Site detection and chapter listing routes."""

import logging
import re
import threading
import time
import urllib.parse
from typing import Optional

from bs4 import BeautifulSoup
from fastapi import APIRouter, Query

from api.models.site_info import (
    BinarySearchTotalResponse,
    ChapterEntry,
    ChapterListResponse,
    SiteDetectResponse,
    SiteInfoResponse,
)
from api.services.site_service import get_site_service

router = APIRouter(prefix="/api/sites", tags=["Sites"])

logger = logging.getLogger(__name__)

# In-memory cache for binary search results keyed by story URL.
# Value: {"total": int, "fetched_at": float, "done": bool}
_binary_search_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()


def is_novelworm_chapter_url(url: str) -> bool:
    return bool(re.search(r"/\d{3,}/?$", url.rstrip("/")))


def is_chapter_url(url: str) -> bool:
    from urllib.parse import urlparse

    parsed = urlparse(url.strip("/"))
    path = parsed.path.lower()

    if "wattpad" in parsed.netloc:
        chapter_match = re.search(r"/\d+/chapter-\d+", path)
        if chapter_match:
            return True
        return False

    if "novelworm" in parsed.netloc:
        return is_novelworm_chapter_url(url)

    return False


def _fetch_novelworm_chapters(story_url: str, timeout: int = 30) -> tuple[list[ChapterEntry], Optional[str], Optional[int], Optional[str]]:
    try:
        from handlers.selenium_handler import _get_browser
        browser = _get_browser()
    except Exception as exc:
        logger.warning("[novelworm] Could not get Selenium browser: %s", exc)
        return [], f"Selenium unavailable: {exc}", None, None

    try:
        final_url, status, body, headers, _ = browser.fetch(story_url, timeout=timeout, skip_scroll=True)
    except Exception as exc:
        logger.warning("[novelworm] Selenium fetch failed for story page: %s", exc)
        return [], f"Selenium fetch failed: {exc}", None, None

    html = body.decode("utf-8", errors="replace")
    story_title = _extract_novelworm_story_title(html)
    entries, warning, _ = _parse_novelworm_chapters_from_html(html, story_url)

    # Kick off binary search in a background thread — return immediately so the
    # frontend gets the TOC chapters right away.  Frontend polls /api/sites/chapters/total
    # to retrieve the result when it's ready.
    _start_binary_search_background(browser, story_url)

    # Return the TOC count as total until binary search finishes.
    # Frontend can distinguish "unknown total" vs "this is the actual total" via the /total endpoint.
    return entries, warning, None, story_title


def _start_binary_search_background(browser, story_url: str) -> None:
    """Spawn a daemon thread to run binary search and cache the result."""
    url_key = story_url.rstrip("/")

    with _cache_lock:
        # Skip if already cached (with fresh TTL of 1 hour)
        entry = _binary_search_cache.get(url_key)
        if entry and entry["done"] and (time.time() - entry["fetched_at"]) < 3600:
            return
        # Mark as in-progress (idempotent — safe to call twice)
        _binary_search_cache[url_key] = {
            "total": None,
            "done": False,
            "fetched_at": time.time(),
        }

    def _run():
        total = _novelworm_binary_search_total(browser, story_url)
        with _cache_lock:
            _binary_search_cache[url_key] = {
                "total": total,
                "done": True,
                "fetched_at": time.time(),
            }
        logger.info("[novelworm] Binary search background done: %d chapters for %s", total, story_url)

    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _novelworm_binary_search_total(browser, story_url: str, max_guess: int = 5000) -> int:
    """Run binary search to find the highest valid chapter number for a NovelWorm story."""
    def fetch_title(url: str) -> bool:
        try:
            _, _, body, _, _ = browser.fetch(url, timeout=10, skip_scroll=True)
            html = body.decode("utf-8", errors="replace")
            return _extract_chapter_title_from_html(html) != ""
        except Exception:
            return False

    def extract_chapter_num(url: str) -> int | None:
        m = re.search(r"/(\d+)/?$", url.rstrip("/"))
        return int(m.group(1)) if m else None

    low, high = 1, max_guess
    best = 0

    while low <= high:
        mid = (low + high) // 2
        url = f"{story_url.rstrip('/')}/{str(mid).zfill(6)}"
        if fetch_title(url):
            best = mid
            low = mid + 1
        else:
            high = mid - 1

    # Refine around the boundary in chunks of 10, then 100
    for delta in [10, 100]:
        check_url = f"{story_url.rstrip('/')}/{str(best + delta).zfill(6)}"
        if fetch_title(check_url):
            low, high = best + 1, best + delta * 2
            while low <= high:
                mid = (low + high) // 2
                url = f"{story_url.rstrip('/')}/{str(mid).zfill(6)}"
                if fetch_title(url):
                    best = mid
                    low = mid + 1
                else:
                    high = mid - 1
            break

    return best


def _extract_chapter_title_from_html(html: str) -> str:
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
            if text:
                return text
    return ""


def _extract_novelworm_story_title(html: str) -> Optional[str]:
    soup = BeautifulSoup(html, "html.parser")
    selectors = [
        ("meta[property='og:title']", "content"),
        ("h1.story-title", None),
        (".story-header h1", None),
        (".story-info h1", None),
        ("[class*='story-title']", None),
        ("h1[class*='title']", None),
    ]
    for sel, attr in selectors:
        el = soup.select_one(sel)
        if el:
            if attr:
                val = el.get(attr, "").strip()
            else:
                val = el.get_text(strip=True)
            if val:
                return val
    return None


def _parse_novelworm_chapters_from_html(html: str, base_url: str) -> tuple[list[ChapterEntry], Optional[str], Optional[int]]:
    soup = BeautifulSoup(html, "html.parser")
    entries: list[ChapterEntry] = []

    container_selectors = [
        ".chapter-list", ".table-of-contents", ".chapters", ".chapter-item",
        "[class*='chapter-list']", "[class*='toc']", "ul.chapters", "ol.chapters",
    ]

    containers = []
    for sel in container_selectors:
        found = soup.select(sel)
        containers.extend(found)

    anchor_sources = containers if containers else [soup]
    seen_urls: set[str] = set()

    for container in anchor_sources:
        for a in container.find_all("a", href=True) if containers else soup.find_all("a", href=True):
            href = a.get("href", "")
            if not href:
                continue

            if not href.startswith("http"):
                href = urllib.parse.urljoin(base_url, href)

            if "novelworm.com" not in href:
                continue

            if href in seen_urls:
                continue
            seen_urls.add(href)

            title = a.get("title") or a.get_text(strip=True) or ""

            chapter_num: Optional[int] = None
            num_match = re.search(r"/(\d{3,})/?$", href.rstrip("/"))
            if num_match:
                chapter_num = int(num_match.group(1))

            if chapter_num is None:
                text_num_match = re.search(r"chapter\s*(\d+)", title, re.IGNORECASE)
                if text_num_match:
                    chapter_num = int(text_num_match.group(1))

            entries.append(ChapterEntry(
                chapter_number=chapter_num or 0,
                title=title,
                url=href,
            ))

    entries.sort(key=lambda x: x.chapter_number)
    total_count = len(entries)
    if not entries:
        return [], "No chapter links found on this story page", None

    return entries[:50], None, total_count


def _fetch_wattpad_chapters(story_url: str, timeout: int = 30) -> tuple[list[ChapterEntry], Optional[str], Optional[int]]:
    story_id = _extract_wattpad_story_id(story_url)
    if not story_id:
        return [], "Could not extract Wattpad story ID from URL", None

    api_url = (
        f"https://www.wattpad.com/api/v3/stories/{story_id}"
        f"?fields=id,title,numParts,parts(id,title,url)"
    )

    try:
        from api.services.wattpad_api import get
        resp = get(api_url, story_id=story_id, timeout=timeout)
        if resp.status_code != 200:
            return [], f"Wattpad API returned HTTP {resp.status_code}", None
    except Exception as exc:
        return [], f"Wattpad API request failed: {exc}", None

    try:
        data = resp.json()
    except Exception:
        return [], "Failed to parse Wattpad API response", None

    if not isinstance(data, dict):
        return [], "Unexpected Wattpad API response format", None

    total_count: Optional[int] = data.get("numParts")
    parts: list[dict] = data.get("parts") or []

    if not parts:
        return [], None, total_count

    entries: list[ChapterEntry] = []
    for idx, part in enumerate(parts[:50], start=1):
        part_url = part.get("url")
        if not part_url:
            continue
        chapter_url = urllib.parse.urljoin("https://www.wattpad.com", part_url)
        title = part.get("title") or ""
        entries.append(ChapterEntry(chapter_number=idx, title=title, url=chapter_url))

    return entries, None, total_count


def _extract_wattpad_story_id(url: str) -> Optional[str]:
    match = re.search(r"/story/(\d+)", url)
    if match:
        return match.group(1)
    match = re.search(r"wattpad\.com/(\d+)-", url)
    if match:
        return match.group(1)
    return None


@router.get("/detect", response_model=SiteDetectResponse)
def detect_site(url: str = Query(..., description="Novel URL to detect")) -> SiteDetectResponse:
    """Detect which site a URL belongs to and extract the novel slug."""
    service = get_site_service()
    return service.detect_site(url)


@router.get("", response_model=list[SiteInfoResponse])
def list_sites() -> list[SiteInfoResponse]:
    """Return info for all supported site configs."""
    service = get_site_service()
    return service.list_sites()


@router.get("/chapters", response_model=ChapterListResponse)
def get_chapters(url: str = Query(..., description="Story-level novel URL")) -> ChapterListResponse:
    """Fetch the chapter list (table of contents) for a novel story URL."""
    from urllib.parse import urlparse

    if not url:
        return ChapterListResponse(valid=False, reason="invalid", message="URL is empty")

    if not url.startswith(("http://", "https://")):
        return ChapterListResponse(
            valid=False, reason="invalid", message="URL must start with http:// or https://"
        )

    if is_chapter_url(url):
        return ChapterListResponse(
            valid=False,
            reason="chapter_url",
            message="This URL points to a chapter page. Please provide a story-level URL.",
        )

    service = get_site_service()
    site_info = service._registry.match_url(url)

    if site_info is None:
        known = ", ".join(service._registry.known_domains())
        return ChapterListResponse(
            valid=False, reason="unsupported", message=f"Unsupported site. Known sites: {known}"
        )

    story_url = url
    story_title: Optional[str] = None
    chapters: list[ChapterEntry] = []
    warning: Optional[str] = None
    total_chapter_count: Optional[int] = None

    try:
        if site_info.config_name == "wattpad":
            chapters, fetch_warning, total_chapter_count = _fetch_wattpad_chapters(story_url)
            if fetch_warning:
                warning = fetch_warning
        elif site_info.config_name == "novelworm":
            chapters, fetch_warning, total_chapter_count, fetched_story_title = _fetch_novelworm_chapters(story_url)
            if fetch_warning:
                warning = fetch_warning
            if not story_title and fetched_story_title:
                story_title = fetched_story_title
        else:
            warning = f"Chapter listing is not supported for '{site_info.site_name}'"
    except Exception as exc:
        logger.exception("[chapters] Unexpected error fetching chapter list for %s", story_url)
        warning = f"Failed to fetch chapter list: {exc}"
        chapters = []

    if not chapters:
        warning = warning or "No chapters found on this story page"

    return ChapterListResponse(
        valid=True,
        message="Chapter list fetched successfully" if chapters else "No chapters returned",
        story_title=story_title,
        chapter_count=len(chapters),
        total_chapter_count=total_chapter_count,
        chapters=chapters,
        warning=warning if not chapters else None,
    )


@router.get("/chapters/total", response_model=BinarySearchTotalResponse)
def get_binary_search_total(url: str = Query(..., description="Story-level novel URL")) -> BinarySearchTotalResponse:
    """Poll the binary-search result for NovelWorm stories.

    Returns immediately. The frontend should call this every 1-2 seconds after
    fetching /api/sites/chapters until done=True.
    """
    if not url or not url.startswith(("http://", "https://")):
        return BinarySearchTotalResponse(url=url, total=None, done=False, fetching=False)

    url_key = url.rstrip("/")
    with _cache_lock:
        entry = _binary_search_cache.get(url_key)

    if entry is None:
        # Not started yet — front-end should call /chapters first
        return BinarySearchTotalResponse(url=url, total=None, done=False, fetching=False)

    if entry["done"]:
        return BinarySearchTotalResponse(
            url=url,
            total=entry["total"],
            done=True,
            fetching=False,
        )

    return BinarySearchTotalResponse(
        url=url,
        total=entry["total"],
        done=False,
        fetching=True,
    )
