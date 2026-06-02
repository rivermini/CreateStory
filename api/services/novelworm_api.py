"""Fast NovelWorm API client.

NovelWorm renders its pages from SM4-encrypted JSON API responses.  Using these
endpoints avoids Selenium page rendering and the old URL-probing binary search.
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.parse
from collections import Counter
from dataclasses import dataclass
from typing import Any, Optional

import requests
from bs4 import BeautifulSoup

from utils.sm4 import decrypt_ecb_hex


class NovelWormApiError(RuntimeError):
    """Raised when NovelWorm returns an unusable API response."""


@dataclass(frozen=True)
class NovelWormChapterRef:
    id: str
    book_id: str
    position: int
    index_num: int
    chapter_number: int
    title: str
    index_link: str
    url: str
    is_vip: bool
    unlock: bool


@dataclass(frozen=True)
class NovelWormStory:
    slug: str
    book_id: str
    title: str
    author: str
    detail: dict[str, Any]
    metadata: dict[str, Any]
    chapters: list[NovelWormChapterRef]
    start_index_id: Optional[str] = None


@dataclass(frozen=True)
class NovelWormChapterContent:
    ref: NovelWormChapterRef
    title: str
    content_html: str
    api_data: dict[str, Any]


class NovelWormApiClient:
    BASE_URL = "https://www.novelworm.com"
    CDN_BASE_URL = "https://cdn.novelworm.com"
    SM4_KEY_HEX = "00112233445566778899AABBCCDDEEFF"

    DEFAULT_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/136.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Authorization": "",
        "Cache-Control": "no-cache",
        "client": "web",
        "Referer": BASE_URL + "/",
    }

    def __init__(self, timeout: int = 20, retries: int = 2) -> None:
        self.timeout = timeout
        self.retries = retries
        self._thread_local = threading.local()

    def _session(self) -> requests.Session:
        session = getattr(self._thread_local, "session", None)
        if session is None:
            session = requests.Session()
            session.headers.update(self.DEFAULT_HEADERS)
            self._thread_local.session = session
        return session

    def _get_payload(self, path: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        url = urllib.parse.urljoin(self.BASE_URL, path)
        last_error: Exception | None = None

        for attempt in range(self.retries + 1):
            try:
                resp = self._session().get(url, params=params, timeout=self.timeout)
                resp.raise_for_status()
                payload = resp.json()
                if not isinstance(payload, dict):
                    raise NovelWormApiError(f"Unexpected NovelWorm payload type: {type(payload).__name__}")
                if payload.get("code") not in (None, "200", 200):
                    raise NovelWormApiError(payload.get("msg") or f"NovelWorm API returned code {payload.get('code')}")
                return payload
            except Exception as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(0.35 * (attempt + 1))

        raise NovelWormApiError(str(last_error) if last_error else "NovelWorm API request failed")

    def _decrypt_data(self, payload: dict[str, Any]) -> Any:
        encrypted = payload.get("data")
        if encrypted is None or encrypted == "":
            return encrypted
        if not isinstance(encrypted, str):
            return encrypted

        try:
            text = decrypt_ecb_hex(encrypted, self.SM4_KEY_HEX).decode("utf-8")
        except Exception as exc:
            raise NovelWormApiError(f"Failed to decrypt NovelWorm API response: {exc}") from exc

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    def _get_decrypted(self, path: str, params: Optional[dict[str, Any]] = None) -> Any:
        return self._decrypt_data(self._get_payload(path, params=params))

    def path_param_from_url(self, url_or_slug: str) -> str:
        if url_or_slug.startswith(("http://", "https://")):
            parsed = urllib.parse.urlparse(url_or_slug)
            return parsed.path.strip("/")
        return url_or_slug.strip().strip("/")

    def story_slug_from_url(self, url_or_slug: str) -> str:
        param = self.path_param_from_url(url_or_slug)
        return param.split("/", 1)[0] if param else "unknown"

    def match_url(self, url_or_slug: str) -> dict[str, Any]:
        param = self.path_param_from_url(url_or_slug)
        if not param:
            raise NovelWormApiError("Missing NovelWorm story path")

        data = self._get_decrypted("/book/matchId", {"param": param})
        if not isinstance(data, dict) or not data.get("bookId"):
            raise NovelWormApiError("NovelWorm did not return a book id")
        return data

    def get_book_detail(self, book_id: str) -> dict[str, Any]:
        data = self._get_decrypted(f"/book/queryBookDetail/{book_id}")
        if not isinstance(data, dict):
            raise NovelWormApiError("NovelWorm book detail response was not an object")
        return data

    def get_index_list(self, book_id: str) -> list[NovelWormChapterRef]:
        data = self._get_decrypted(
            "/book/queryIndexList",
            {
                "curr": 1,
                "limit": 8000,
                "bookId": book_id,
                "orderBy": "index_num asc",
            },
        )
        if not isinstance(data, dict) or not isinstance(data.get("list"), list):
            raise NovelWormApiError("NovelWorm chapter index response was not a list")

        raw_items = sorted(data["list"], key=lambda item: self._to_int(item.get("indexNum"), 0))
        parsed_numbers = [self._chapter_number_from_title(item.get("indexName") or "") for item in raw_items]
        number_counts = Counter(num for num in parsed_numbers if num is not None)

        refs: list[NovelWormChapterRef] = []
        used_chapter_numbers: set[int] = set()
        for position, item in enumerate(raw_items, start=1):
            index_num = self._to_int(item.get("indexNum"), position)
            parsed_number = parsed_numbers[position - 1]
            chapter_number_candidate = (
                parsed_number
                if parsed_number is not None and number_counts[parsed_number] == 1
                else position
            )
            chapter_number = chapter_number_candidate
            while chapter_number in used_chapter_numbers:
                chapter_number += 1
            used_chapter_numbers.add(chapter_number)
            index_link = str(item.get("indexLink") or "")
            refs.append(
                NovelWormChapterRef(
                    id=str(item.get("id") or ""),
                    book_id=str(item.get("bookId") or book_id),
                    position=position,
                    index_num=index_num,
                    chapter_number=chapter_number,
                    title=str(item.get("indexName") or f"Chapter {chapter_number}"),
                    index_link=index_link,
                    url=urllib.parse.urljoin(self.BASE_URL + "/", index_link),
                    is_vip=str(item.get("isVip") or "0") == "1",
                    unlock=bool(item.get("unlock")),
                )
            )

        return [ref for ref in refs if ref.id]

    def fetch_chapter(self, ref: NovelWormChapterRef) -> NovelWormChapterContent:
        data = self._get_decrypted(
            "/book/queryBookIndexAbout",
            {"bookId": ref.book_id, "lastBookIndexId": ref.id},
        )
        if not isinstance(data, dict):
            raise NovelWormApiError(f"NovelWorm chapter response was not an object for {ref.url}")

        title = str(data.get("indexName") or ref.title or f"Chapter {ref.chapter_number}")
        content_html = str(data.get("lastBookContent") or "")
        if not content_html:
            raise NovelWormApiError(f"NovelWorm returned empty content for {ref.url}")

        return NovelWormChapterContent(ref=ref, title=title, content_html=content_html, api_data=data)

    def resolve_story(self, url_or_slug: str) -> NovelWormStory:
        match = self.match_url(url_or_slug)
        book_id = str(match["bookId"])
        detail = self.get_book_detail(book_id)
        chapters = self.get_index_list(book_id)
        slug = self.story_slug_from_url(url_or_slug) or str(detail.get("link") or "unknown")
        title = str(detail.get("bookName") or slug)
        author = str(detail.get("authorName") or "")
        metadata = self.metadata_from_detail(detail, total_chapters=len(chapters))

        return NovelWormStory(
            slug=slug,
            book_id=book_id,
            title=title,
            author=author,
            detail=detail,
            metadata=metadata,
            chapters=chapters,
            start_index_id=str(match.get("indexId") or "") or None,
        )

    def resolve_metadata(self, url_or_slug: str) -> tuple[str | None, dict[str, Any]]:
        match = self.match_url(url_or_slug)
        book_id = str(match["bookId"])
        detail = self.get_book_detail(book_id)
        total_chapters: Optional[int] = None
        try:
            total_chapters = len(self.get_index_list(book_id))
        except NovelWormApiError:
            total_chapters = None
        title = str(detail.get("bookName") or "") or None
        return title, self.metadata_from_detail(detail, total_chapters=total_chapters)

    def metadata_from_detail(self, detail: dict[str, Any], total_chapters: Optional[int]) -> dict[str, Any]:
        cover_url = str(detail.get("picUrl") or "")
        if cover_url.startswith("/"):
            cover_url = urllib.parse.urljoin(self.CDN_BASE_URL, cover_url)

        description = self.html_to_text(str(detail.get("bookDesc") or ""))
        tags = self._split_tags(detail.get("tags")) or self._split_tags(detail.get("catName"))
        language = detail.get("language")

        metadata = {
            "title": detail.get("bookName"),
            "author": detail.get("authorName"),
            "authors": [detail.get("authorName")] if detail.get("authorName") else None,
            "cover_url": cover_url or None,
            "description": description or None,
            "views": self._to_int(detail.get("visitCount"), None),
            "stars": self._to_int(detail.get("score"), None),
            "comment_count": self._to_int(detail.get("commentCount"), None),
            "num_parts": total_chapters or self._to_int(detail.get("indexNum"), None),
            "language": {"name": language} if language else None,
            "tags": tags,
            "completed": self._completed_from_detail(detail),
            "mature": None,
            "is_paywalled": str(detail.get("isVip") or "0") == "1",
        }
        return {key: value for key, value in metadata.items() if value is not None}

    @staticmethod
    def html_to_text(html: str) -> str:
        if not html:
            return ""
        soup = BeautifulSoup(html, "html.parser")
        lines = [line.strip() for line in soup.get_text("\n", strip=True).splitlines()]
        return "\n\n".join(line for line in lines if line)

    @staticmethod
    def _split_tags(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if not value:
            return []
        return [part.strip() for part in re.split(r"[,;|]", str(value)) if part.strip()]

    @staticmethod
    def _chapter_number_from_title(title: str) -> Optional[int]:
        match = re.search(r"\bchapter\s+(\d+)\b", title, flags=re.IGNORECASE)
        return int(match.group(1)) if match else None

    @staticmethod
    def _to_int(value: Any, default: Optional[int] = 0) -> Optional[int]:
        try:
            if value is None or value == "":
                return default
            return int(float(str(value).replace(",", "")))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _completed_from_detail(detail: dict[str, Any]) -> Optional[bool]:
        raw = str(detail.get("status") or detail.get("bookStatus") or "").strip().lower()
        if raw in {"completed", "complete", "finished", "1", "2"}:
            return True
        if raw in {"ongoing", "serializing", "updating", "0"}:
            return False
        return None
