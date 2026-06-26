"""Fast GoodNovel API client.

GoodNovel (goodnovel.com) is a Vue SPA whose chapter reading route
(``/book/<slug>_<bookId>/Chapter-NNNN_<chapterId>``) returns HTTP 410 to plain
HTTP clients — it is rendered client-side. Its backend JSON API, however, is open
for free chapters: **no signature, no auth token, no encryption**. We talk to it
directly instead of rendering pages with a headless browser.

Endpoints (all POST with a JSON body), host ``https://api-akm.goodnovel.com``::

    /hwyc/book/detail     {bookId}             -> book metadata (data.book)
    /hwyc/chapter/list    {bookId}             -> full table of contents (data.records)
    /hwyc/chapter/detail  {bookId, chapterId}  -> chapter content (data.content)

Free chapters (``charge == false``) return the full ``data.content`` as plain
text. Paywalled chapters (``charge == true``) return only a truncated
``data.previewContent`` plus ``data.price`` — unlocking them needs a logged-in
account that has spent coins (not implemented here).

The ``api-akm.goodnovel.com`` host sits behind Akamai bot management, which
rejects plain ``requests`` (urllib3) on a TLS/JA3 fingerprint regardless of
headers. We therefore use ``curl_cffi`` with Chrome impersonation, which presents
a real-browser TLS fingerprint. ``requests`` is kept as a (Akamai-blocked)
fallback only so the module still imports if ``curl_cffi`` is unavailable.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Optional

try:
    from curl_cffi import requests as _http
    _IMPERSONATE = "chrome"
except ImportError:  # pragma: no cover - curl_cffi is a hard runtime dependency
    import requests as _http  # type: ignore[no-redef]
    _IMPERSONATE = None

from utils.proxy import requests_proxies

logger = logging.getLogger(__name__)


class GoodNovelApiError(RuntimeError):
    """Raised when GoodNovel returns an unusable API response."""


_BOOK_ID_RE = re.compile(r"/book/[^/]+_(\d+)", re.IGNORECASE)
_SLUG_RE = re.compile(r"/book/([^/]+)_\d+", re.IGNORECASE)
_TRAILING_ID_RE = re.compile(r"_(\d+)$")
_CHAPTER_NUM_RE = re.compile(r"(\d+)")


@dataclass(frozen=True)
class GoodNovelChapterRef:
    id: str
    book_id: str
    chapter_number: int
    title: str
    charge: bool
    unlock: bool
    resource_url: str
    url: str

    @property
    def readable(self) -> bool:
        """True if this chapter's full text is obtainable for free.

        That means it's either universally free (``not charge``) or the current
        account has already unlocked it (``unlock``, when authenticated).
        """
        return (not self.charge) or self.unlock

    @property
    def locked(self) -> bool:
        return not self.readable


@dataclass(frozen=True)
class GoodNovelStory:
    slug: str
    book_id: str
    title: str
    author: str
    detail: dict[str, Any]
    metadata: dict[str, Any]
    chapters: list[GoodNovelChapterRef] = field(default_factory=list)


@dataclass(frozen=True)
class GoodNovelChapterContent:
    ref: GoodNovelChapterRef
    title: str
    content: str
    word_num: int
    is_locked: bool
    price: int
    preview_content: str


class GoodNovelApiClient:
    BASE_URL = "https://www.goodnovel.com"
    API_BASE_URL = "https://api-akm.goodnovel.com"

    # No User-Agent here: curl_cffi's impersonate=chrome supplies a matching
    # UA + sec-ch-ua + TLS fingerprint, and overriding the UA alone would break
    # the impersonation's internal consistency.
    DEFAULT_HEADERS = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "Referer": BASE_URL + "/",
    }

    def __init__(
        self,
        timeout: int = 20,
        retries: int = 2,
        cookies: Optional[dict[str, str]] = None,
        user_agent: Optional[str] = None,
        load_db_cookies: bool = True,
    ) -> None:
        self.timeout = timeout
        self.retries = retries
        self._thread_local = threading.local()
        self._user_agent = user_agent

        # Auth is cookie-based: replaying a logged-in account's cookies lets the
        # API return content for chapters that account can read for free.
        if cookies is not None:
            self._cookies: dict[str, str] = dict(cookies)
        elif load_db_cookies:
            self._cookies = self._load_db_cookies()
        else:
            self._cookies = {}
        self.authenticated: bool = bool(self._cookies)
        self._cookies_invalidated: bool = False

    @staticmethod
    def _load_db_cookies() -> dict[str, str]:
        try:
            from api.services.goodnovel_cookie_service import load_goodnovel_cookies

            cookies, _user_agent = load_goodnovel_cookies()
            return cookies or {}
        except Exception:
            return {}

    def _invalidate_cookies(self) -> None:
        """Stop sending cookies after the API rejects them (expired/invalid login).

        Lets the crawl degrade gracefully to anonymous (free chapters still work)
        instead of failing every request once the saved login is no longer valid.
        """
        if not self._cookies_invalidated:
            logger.warning(
                "[goodnovel] Saved login cookies were rejected by the API "
                "(expired/invalid) — falling back to anonymous (free chapters only)."
            )
        self._cookies = {}
        self.authenticated = False
        self._cookies_invalidated = True

    # -- HTTP plumbing -----------------------------------------------------

    def _session(self):
        session = getattr(self._thread_local, "session", None)
        if session is None:
            # curl_cffi's Session accepts impersonate=; plain requests.Session does not.
            session = _http.Session(impersonate=_IMPERSONATE) if _IMPERSONATE else _http.Session()
            session.headers.update(self.DEFAULT_HEADERS)
            if self._user_agent:
                session.headers["User-Agent"] = self._user_agent
            proxies = requests_proxies("goodnovel")
            if proxies:
                session.proxies.update(proxies)
            self._thread_local.session = session
        return session

    def _post(self, path: str, body: dict[str, Any]) -> Any:
        """POST a JSON body and return the decoded ``data`` payload.

        GoodNovel wraps responses as ``{"status": 0, "data": {...}, "msg": ...}``
        where ``status == 0`` means success.
        """
        url = urllib.parse.urljoin(self.API_BASE_URL, path)
        last_error: Exception | None = None
        cookies = self._cookies or None

        for attempt in range(self.retries + 1):
            try:
                resp = self._session().post(url, json=body, timeout=self.timeout, cookies=cookies)
                resp.raise_for_status()
                payload = resp.json()
                if not isinstance(payload, dict):
                    raise GoodNovelApiError(f"Unexpected GoodNovel payload type: {type(payload).__name__}")
                status = payload.get("status")
                if status not in (0, "0", None):
                    # A non-zero status while sending cookies means the saved login was
                    # rejected (e.g. expired TOKEN → status 100). Drop the cookies and
                    # retry this request anonymously so free chapters still come through,
                    # rather than failing the whole crawl. A valid login always returns 0.
                    if cookies:
                        self._invalidate_cookies()
                        cookies = None
                        # Drop this thread's session so its cookie jar (which retained the
                        # rejected cookies) is rebuilt empty — otherwise the retry resends them.
                        self._thread_local.session = None
                        continue
                    raise GoodNovelApiError(payload.get("msg") or f"GoodNovel API returned status {status}")
                return payload.get("data")
            except Exception as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(0.35 * (attempt + 1))

        raise GoodNovelApiError(str(last_error) if last_error else "GoodNovel API request failed")

    # -- URL parsing -------------------------------------------------------

    def book_id_from_url(self, url_or_id: str) -> str:
        """Extract the numeric bookId from a GoodNovel URL or accept a bare id."""
        text = (url_or_id or "").strip()
        if text.isdigit():
            return text

        match = _BOOK_ID_RE.search(text)
        if match:
            return match.group(1)

        # Bare slug like "The-Alpha-s-Contract_31000725726"
        match = _TRAILING_ID_RE.search(text.split("/")[0])
        if match:
            return match.group(1)

        raise GoodNovelApiError(f"Could not extract a GoodNovel bookId from: {url_or_id!r}")

    def slug_from_url(self, url_or_id: str, fallback: str = "") -> str:
        match = _SLUG_RE.search(url_or_id or "")
        if match:
            return match.group(1)
        return fallback or "goodnovel-unknown"

    def chapter_url(self, slug: str, book_id: str, resource_url: str) -> str:
        book_segment = f"{slug}_{book_id}"
        resource = (resource_url or "").lstrip("/")
        base = f"{self.BASE_URL}/book/{book_segment}"
        return f"{base}/{resource}" if resource else base

    # -- API calls ---------------------------------------------------------

    def get_book_detail(self, book_id: str) -> dict[str, Any]:
        data = self._post("/hwyc/book/detail", {"bookId": str(book_id)})
        if not isinstance(data, dict):
            raise GoodNovelApiError("GoodNovel book detail response was not an object")
        book = data.get("book")
        if isinstance(book, dict):
            return book
        return data

    def get_chapter_list(self, book_id: str, slug: str = "") -> list[GoodNovelChapterRef]:
        data = self._post("/hwyc/chapter/list", {"bookId": str(book_id)})
        records = self._flatten_chapter_records(data)
        if not records:
            raise GoodNovelApiError("GoodNovel chapter list response had no chapters")

        refs: list[GoodNovelChapterRef] = []
        position = 0
        for item in records:
            if not isinstance(item, dict):
                continue
            chapter_id = str(item.get("id") or "")
            if not chapter_id:
                continue
            position += 1
            resource_url = str(item.get("chapterResourceUrl") or "")
            title = str(item.get("chapterName") or f"Chapter {position}").strip()
            refs.append(
                GoodNovelChapterRef(
                    id=chapter_id,
                    book_id=str(book_id),
                    chapter_number=position,
                    title=title,
                    charge=bool(item.get("charge")),
                    unlock=bool(item.get("unlock")),
                    resource_url=resource_url,
                    url=self.chapter_url(slug, str(book_id), resource_url),
                )
            )
        return refs

    def fetch_chapter(self, ref: GoodNovelChapterRef) -> GoodNovelChapterContent:
        data = self._post(
            "/hwyc/chapter/detail",
            {"bookId": str(ref.book_id), "chapterId": str(ref.id)},
        )
        if not isinstance(data, dict):
            raise GoodNovelApiError(f"GoodNovel chapter response was not an object for {ref.url}")

        content = str(data.get("content") or "")
        preview = str(data.get("previewContent") or "")
        is_locked = not content and (bool(ref.charge) or bool(preview))
        title = str(data.get("chapterName") or ref.title or f"Chapter {ref.chapter_number}").strip()

        return GoodNovelChapterContent(
            ref=ref,
            title=title,
            content=content,
            word_num=self._to_int(data.get("wordNum"), 0) or 0,
            is_locked=is_locked,
            price=self._to_int(data.get("price"), 0) or 0,
            preview_content=preview,
        )

    # -- Composite resolvers ----------------------------------------------

    def resolve_story(self, url_or_id: str) -> GoodNovelStory:
        book_id = self.book_id_from_url(url_or_id)
        detail = self.get_book_detail(book_id)
        slug = self.slug_from_url(url_or_id, fallback=self._slug_from_detail(detail))
        chapters = self.get_chapter_list(book_id, slug=slug)
        title = str(detail.get("bookName") or slug)
        author = str(detail.get("pseudonym") or detail.get("authorName") or "")
        metadata = self.metadata_from_detail(detail, total_chapters=len(chapters))

        return GoodNovelStory(
            slug=slug,
            book_id=book_id,
            title=title,
            author=author,
            detail=detail,
            metadata=metadata,
            chapters=chapters,
        )

    def resolve_metadata(self, url_or_id: str) -> tuple[Optional[str], dict[str, Any]]:
        book_id = self.book_id_from_url(url_or_id)
        detail = self.get_book_detail(book_id)
        total = self._to_int(detail.get("chapterCount"), None)
        title = str(detail.get("bookName") or "") or None
        return title, self.metadata_from_detail(detail, total_chapters=total)

    def metadata_from_detail(self, detail: dict[str, Any], total_chapters: Optional[int]) -> dict[str, Any]:
        author = detail.get("pseudonym") or detail.get("authorName")
        cover = str(detail.get("cover") or detail.get("cover2") or "")
        introduction = str(detail.get("introduction") or "").replace("\r\n", "\n").strip()

        metadata = {
            "title": detail.get("bookName"),
            "author": author,
            "authors": [author] if author else None,
            "cover_url": cover or None,
            "description": introduction or None,
            "views": self._to_int(detail.get("readNum") or detail.get("followCount"), None),
            "stars": self._to_int(detail.get("ratings"), None),
            "comment_count": self._to_int(detail.get("commentCount"), None),
            "num_parts": total_chapters or self._to_int(detail.get("chapterCount"), None),
            "language": {"name": detail.get("language")} if detail.get("language") else None,
            "tags": self._tags_from_detail(detail),
            "completed": self._completed_from_detail(detail),
            "mature": self._bool_from(detail.get("mature")),
            "is_paywalled": self._is_paywalled(detail),
        }
        return {key: value for key, value in metadata.items() if value is not None}

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _flatten_chapter_records(data: Any) -> list[dict[str, Any]]:
        """Normalise the chapter-list payload into a flat, ordered list of records.

        ``/hwyc/chapter/list`` returns ``data`` as an array of volumes, each
        ``{volumeName, chapters: [...]}``; ``/hwyc/chapter/list/preview`` returns
        ``{records: [...]}``. Handle both (and a bare chapter array) the same way.
        """
        records: list[dict[str, Any]] = []
        if isinstance(data, list):
            for entry in data:
                if not isinstance(entry, dict):
                    continue
                if isinstance(entry.get("chapters"), list):
                    records.extend(c for c in entry["chapters"] if isinstance(c, dict))
                elif entry.get("id"):
                    records.append(entry)
        elif isinstance(data, dict):
            for key in ("records", "chapters", "list"):
                value = data.get(key)
                if isinstance(value, list):
                    records.extend(c for c in value if isinstance(c, dict))
                    break
        return records

    @staticmethod
    def _slug_from_detail(detail: dict[str, Any]) -> str:
        seo = str(detail.get("seoBookName") or "").strip()
        return seo or "goodnovel-unknown"

    @staticmethod
    def _tags_from_detail(detail: dict[str, Any]) -> list[str]:
        tags: list[str] = []
        for key in ("genreNames", "newTagsNames", "typeTwoNames", "typeOneNames"):
            value = detail.get(key)
            if isinstance(value, list):
                tags.extend(str(item).strip() for item in value if str(item).strip())
            elif isinstance(value, str) and value.strip():
                tags.extend(part.strip() for part in re.split(r"[,;|]", value) if part.strip())
        # Preserve order while removing duplicates.
        seen: set[str] = set()
        unique = []
        for tag in tags:
            if tag not in seen:
                seen.add(tag)
                unique.append(tag)
        return unique

    @staticmethod
    def _completed_from_detail(detail: dict[str, Any]) -> Optional[bool]:
        raw = str(detail.get("writeStatus") or detail.get("contractStatus") or "").strip().lower()
        if raw in {"1", "2", "completed", "complete", "finished", "end"}:
            return True
        if raw in {"0", "ongoing", "serializing", "updating"}:
            return False
        return None

    @staticmethod
    def _is_paywalled(detail: dict[str, Any]) -> Optional[bool]:
        if detail.get("charge") is not None:
            return bool(detail.get("charge"))
        charge_chapters = GoodNovelApiClient._to_int(detail.get("chargeChapterNum"), 0) or 0
        if charge_chapters > 0:
            return True
        if detail.get("free") is not None:
            return not bool(detail.get("free"))
        return None

    @staticmethod
    def _bool_from(value: Any) -> Optional[bool]:
        if value is None or value == "":
            return None
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes"}

    @staticmethod
    def _to_int(value: Any, default: Optional[int] = 0) -> Optional[int]:
        try:
            if value is None or value == "":
                return default
            return int(float(str(value).replace(",", "")))
        except (TypeError, ValueError):
            return default
