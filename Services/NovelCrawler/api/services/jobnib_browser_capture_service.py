"""Short-lived, human-driven browser capture sessions for Jobnib batches.

This module never opens a browser, clicks reader controls, accepts Turnstile
tokens, or calls Jobnib chapter APIs.  It assigns a canonical chapter URL and
accepts only DOM content that the operator has already unlocked in a normal
browser.  The validated prose is committed through JobnibBatchService's
existing checkpoint and final-output path.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from bs4 import BeautifulSoup

from api.services.jobnib_batch_service import (
    JOBNIB_MIN_CHAPTER_WORDS,
    JobnibBatchService,
    clean_text,
    contains_locked_markers,
    get_jobnib_batch_service,
    normalize_capture_chapter_url,
)
from utils.cleaner import clean_chapter_content

_DEFAULT_TTL_SECONDS = max(60, min(1800, int(os.getenv("JOBNIB_BROWSER_CAPTURE_TTL_SECONDS", "900"))))
_MIN_SEGMENT_WORDS = max(1, int(os.getenv("JOBNIB_BROWSER_CAPTURE_MIN_SEGMENT_WORDS", "10")))
_MAX_STORED_REPORTS = 100
_SEGMENT_ID_PATTERN = re.compile(r"(?:^|-)(\d+)$")
_CHALLENGE_MARKERS = (
    "bot detected",
    "checking your browser",
    "enable javascript and cookies",
    "just a moment",
    "performing security verification",
    "read part 1 to unlock",
    "tap to start reading",
    "turnstile",
    "verify you are human",
)


class BrowserCaptureError(ValueError):
    """A capture protocol error with an HTTP status suitable for API routes."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class BrowserCapturePairing:
    pairing_id: str
    token_digest: str
    batch_id: str
    owner_user_id: str
    target_row_index: int | None
    idle_ttl_seconds: int
    created_at: float
    last_activity_at: float
    expires_at: float
    status: str = "active"
    closed_at: float | None = None
    active_assignment: dict[str, Any] | None = None
    submitted_chapters: int = 0
    reports: list[dict[str, Any]] = field(default_factory=list)
    completed_assignments: dict[str, dict[str, Any]] = field(default_factory=dict)


class JobnibBrowserCaptureService:
    def __init__(self, batch_service: JobnibBatchService | None = None) -> None:
        self._batch_service = batch_service or get_jobnib_batch_service()
        self._lock = threading.RLock()
        self._pairings: dict[str, BrowserCapturePairing] = {}

    def create_pairing(
        self,
        *,
        batch_id: str,
        owner_user_id: str,
        ttl_seconds: int = _DEFAULT_TTL_SECONDS,
        row_index: int | None = None,
    ) -> dict[str, Any]:
        ttl = max(60, min(1800, int(ttl_seconds)))
        self._batch_service.validate_browser_capture_scope(batch_id, row_index)
        now = time.time()
        token = secrets.token_urlsafe(32)
        pairing = BrowserCapturePairing(
            pairing_id=secrets.token_hex(16),
            token_digest=_token_digest(token),
            batch_id=batch_id,
            owner_user_id=owner_user_id,
            target_row_index=row_index,
            idle_ttl_seconds=ttl,
            created_at=now,
            last_activity_at=now,
            expires_at=now + ttl,
        )
        with self._lock:
            self._expire_locked(now)
            # One writer per batch prevents two browser companions from racing
            # the same checkpoint even when they target different rows.
            for existing in self._pairings.values():
                if existing.batch_id == batch_id and existing.status == "active":
                    existing.status = "closed"
                    existing.closed_at = now
                    existing.active_assignment = None
            self._pairings[pairing.pairing_id] = pairing
        return {
            "pairing_id": pairing.pairing_id,
            "pairing_token": token,
            "batch_id": pairing.batch_id,
            "row_index": pairing.target_row_index,
            "status": pairing.status,
            "created_at": _iso(pairing.created_at),
            "expires_at": _iso(pairing.expires_at),
            "idle_ttl_seconds": pairing.idle_ttl_seconds,
        }

    def status(self, *, batch_id: str, pairing_id: str, token: str) -> dict[str, Any]:
        with self._lock:
            pairing = self._authenticate_locked(batch_id, pairing_id, token, allow_inactive=True)
            if pairing.status == "active":
                self._touch_locked(pairing)
            return self._status_locked(pairing)

    def next_assignment(self, *, batch_id: str, pairing_id: str, token: str) -> dict[str, Any]:
        with self._lock:
            pairing = self._authenticate_locked(batch_id, pairing_id, token)
            self._touch_locked(pairing)
            if pairing.active_assignment is not None:
                return self._next_response_locked(pairing, done=False)
            target_row_index = pairing.target_row_index

        try:
            candidate = self._batch_service.get_browser_capture_candidate(batch_id, target_row_index)
        except KeyError as exc:
            raise BrowserCaptureError(str(exc), 404) from exc
        except ValueError as exc:
            raise BrowserCaptureError(str(exc), 409) from exc

        with self._lock:
            pairing = self._authenticate_locked(batch_id, pairing_id, token)
            self._touch_locked(pairing)
            if candidate is None:
                pairing.active_assignment = None
                return self._next_response_locked(pairing, done=True)
            pairing.active_assignment = {
                "assignment_id": secrets.token_hex(16),
                **candidate,
            }
            return self._next_response_locked(pairing, done=False)

    def submit(
        self,
        *,
        batch_id: str,
        pairing_id: str,
        token: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        assignment_id = str(payload.get("assignment_id") or "")
        with self._lock:
            pairing = self._authenticate_locked(batch_id, pairing_id, token)
            self._touch_locked(pairing)
            prior = pairing.completed_assignments.get(assignment_id)
            if prior is not None:
                return {**prior, "duplicate": True, "expires_at": _iso(pairing.expires_at)}
            assignment = dict(pairing.active_assignment or {})
            if not assignment or assignment_id != assignment.get("assignment_id"):
                raise BrowserCaptureError("The capture assignment is missing, stale, or belongs to another pairing.", 409)

        normalized_url = normalize_capture_chapter_url(str(payload.get("page_url") or ""))
        if normalized_url != assignment["url"]:
            raise BrowserCaptureError("The captured page URL does not match the assigned Jobnib chapter.", 409)
        content, checksum, word_count = validate_captured_segments(
            expected_segment_ids=list(assignment["expected_segment_ids"]),
            segments=list(payload.get("segments") or []),
            locks=list(payload.get("locks") or []),
            lock_scan_complete=payload.get("lock_scan_complete") is True,
            document_html=str(payload.get("document_html") or ""),
        )
        title = clean_text(str(payload.get("page_title") or assignment.get("chapter_title") or ""))[:500]
        try:
            progress = self._batch_service.save_browser_capture_chapter(
                batch_id,
                row_index=int(assignment["row_index"]),
                sequence_index=int(assignment["sequence_index"]),
                chapter_url=normalized_url,
                chapter_title=title,
                content=content,
                checksum=checksum,
            )
        except KeyError as exc:
            raise BrowserCaptureError(str(exc), 404) from exc
        except ValueError as exc:
            raise BrowserCaptureError(str(exc), 409) from exc

        with self._lock:
            pairing = self._authenticate_locked(batch_id, pairing_id, token)
            self._touch_locked(pairing)
            response = {
                "accepted": True,
                "duplicate": bool(progress.get("already_checkpointed")),
                "assignment_id": assignment_id,
                "checksum": checksum,
                "word_count": word_count,
                "story_completed": bool(progress["story_completed"]),
                "progress": {
                    "row_index": int(progress["row_index"]),
                    "crawled_chapters": int(progress["crawled_chapters"]),
                    "total_chapters": int(progress["total_chapters"]),
                },
                "expires_at": _iso(pairing.expires_at),
            }
            pairing.completed_assignments[assignment_id] = dict(response)
            pairing.submitted_chapters += 0 if progress.get("already_checkpointed") else 1
            pairing.active_assignment = None
            return response

    def report(
        self,
        *,
        batch_id: str,
        pairing_id: str,
        token: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        with self._lock:
            pairing = self._authenticate_locked(batch_id, pairing_id, token)
            self._touch_locked(pairing)
            assignment_id = str(payload.get("assignment_id") or "")
            if assignment_id and assignment_id != (pairing.active_assignment or {}).get("assignment_id"):
                raise BrowserCaptureError("The reported assignment is stale or belongs to another pairing.", 409)
            pairing.reports.append({
                "at": _iso(time.time()),
                "assignment_id": assignment_id or None,
                "kind": str(payload.get("kind") or "info"),
                "message": clean_text(str(payload.get("message") or ""))[:1000],
            })
            pairing.reports = pairing.reports[-_MAX_STORED_REPORTS:]
            released = bool(payload.get("release_assignment"))
            if released:
                pairing.active_assignment = None
            return {
                "accepted": True,
                "status": pairing.status,
                "reported_events": len(pairing.reports),
                "assignment_released": released,
                "expires_at": _iso(pairing.expires_at),
            }

    def close(
        self,
        *,
        batch_id: str,
        pairing_id: str,
        token: str,
        reason: str = "",
    ) -> dict[str, Any]:
        with self._lock:
            pairing = self._authenticate_locked(batch_id, pairing_id, token, allow_inactive=True)
            now = time.time()
            pairing.status = "closed"
            pairing.closed_at = now
            pairing.active_assignment = None
            if reason:
                pairing.reports.append({
                    "at": _iso(now),
                    "assignment_id": None,
                    "kind": "info",
                    "message": clean_text(reason)[:1000],
                })
            return {
                "pairing_id": pairing.pairing_id,
                "batch_id": pairing.batch_id,
                "status": pairing.status,
                "closed_at": _iso(now),
                "submitted_chapters": pairing.submitted_chapters,
            }

    def _authenticate_locked(
        self,
        batch_id: str,
        pairing_id: str,
        token: str,
        *,
        allow_inactive: bool = False,
    ) -> BrowserCapturePairing:
        pairing = self._pairings.get(pairing_id)
        supplied_digest = _token_digest(token)
        if (
            pairing is None
            or pairing.batch_id != batch_id
            or not token
            or not secrets.compare_digest(pairing.token_digest, supplied_digest)
        ):
            raise BrowserCaptureError("Invalid browser-capture pairing credentials.", 401)
        if pairing.status == "active" and pairing.expires_at <= time.time():
            pairing.status = "expired"
            pairing.active_assignment = None
        if not allow_inactive and pairing.status != "active":
            raise BrowserCaptureError(f"This browser-capture pairing is {pairing.status}.", 410)
        return pairing

    def _touch_locked(self, pairing: BrowserCapturePairing) -> None:
        now = time.time()
        pairing.last_activity_at = now
        pairing.expires_at = now + pairing.idle_ttl_seconds

    def _expire_locked(self, now: float) -> None:
        for pairing in self._pairings.values():
            if pairing.status == "active" and pairing.expires_at <= now:
                pairing.status = "expired"
                pairing.active_assignment = None

    def _next_response_locked(self, pairing: BrowserCapturePairing, *, done: bool) -> dict[str, Any]:
        return {
            "pairing_id": pairing.pairing_id,
            "batch_id": pairing.batch_id,
            "status": pairing.status,
            "expires_at": _iso(pairing.expires_at),
            "done": done,
            "assignment": dict(pairing.active_assignment) if pairing.active_assignment else None,
        }

    def _status_locked(self, pairing: BrowserCapturePairing) -> dict[str, Any]:
        summary = self._batch_service.get_status(pairing.batch_id)
        return {
            "pairing_id": pairing.pairing_id,
            "batch_id": pairing.batch_id,
            "status": pairing.status,
            "created_at": _iso(pairing.created_at),
            "last_activity_at": _iso(pairing.last_activity_at),
            "expires_at": _iso(pairing.expires_at),
            "submitted_chapters": pairing.submitted_chapters,
            "reported_events": len(pairing.reports),
            "active_assignment": dict(pairing.active_assignment) if pairing.active_assignment else None,
            "batch": {
                "phase": summary["phase"],
                "total_stories": summary["total_stories"],
                "completed_count": summary["completed_count"],
                "needs_session_count": summary["needs_session_count"],
                "total_chapters": summary["total_chapters"],
                "crawled_chapters": summary["crawled_chapters"],
            },
        }


def validate_captured_segments(
    *,
    expected_segment_ids: list[str],
    segments: list[dict[str, Any]],
    locks: list[dict[str, Any]],
    lock_scan_complete: bool,
    document_html: str = "",
) -> tuple[str, str, int]:
    """Validate complete content from an already-unlocked Jobnib browser DOM."""
    if not lock_scan_complete:
        raise BrowserCaptureError("The companion did not complete its Jobnib lock scan.")
    if not segments:
        raise BrowserCaptureError("No Jobnib content segments were captured.")

    by_id: dict[str, dict[str, Any]] = {}
    for segment in segments:
        segment_id = _normalize_segment_id(str(segment.get("segment_id") or ""))
        if segment_id in by_id:
            raise BrowserCaptureError(f"Jobnib segment {segment_id} was submitted more than once.")
        by_id[segment_id] = segment
    if set(by_id) != set(expected_segment_ids):
        missing = sorted(set(expected_segment_ids) - set(by_id))
        unexpected = sorted(set(by_id) - set(expected_segment_ids))
        details = []
        if missing:
            details.append(f"missing {', '.join(missing)}")
        if unexpected:
            details.append(f"unexpected {', '.join(unexpected)}")
        raise BrowserCaptureError(f"Captured Jobnib segments do not match the assignment ({'; '.join(details)}).")

    for lock in locks:
        if lock.get("visible") is True:
            selector = clean_text(str(lock.get("selector") or "Jobnib reader lock"))[:160]
            raise BrowserCaptureError(f"Full chapter capture rejected because {selector} is still visible.", 409)
        if _contains_challenge_marker(str(lock.get("text") or "")) and lock.get("visible") is not False:
            raise BrowserCaptureError("Full chapter capture rejected because a Jobnib challenge remains visible.", 409)

    prose_by_id: dict[str, str] = {}
    hashes: set[str] = set()
    for segment_id in expected_segment_ids:
        html = str(by_id[segment_id].get("html") or "").strip()
        if not html:
            raise BrowserCaptureError(f"Jobnib segment {segment_id} is empty.")
        prose = _extract_segment_prose(html)
        word_count = len(prose.split())
        if word_count < _MIN_SEGMENT_WORDS:
            raise BrowserCaptureError(
                f"Jobnib segment {segment_id} has only {word_count} words; it is not populated."
            )
        if contains_locked_markers(prose) or _contains_challenge_marker(prose):
            raise BrowserCaptureError(f"Jobnib segment {segment_id} still contains reader-lock or challenge text.", 409)
        segment_hash = hashlib.sha256(prose.encode("utf-8")).hexdigest()
        if segment_hash in hashes:
            raise BrowserCaptureError("Two captured Jobnib segments contain identical prose.")
        hashes.add(segment_hash)
        prose_by_id[segment_id] = prose

    if document_html:
        _validate_optional_document(document_html, expected_segment_ids)

    content = clean_chapter_content("\n\n".join(prose_by_id[item] for item in expected_segment_ids))
    word_count = len(content.split())
    if word_count < JOBNIB_MIN_CHAPTER_WORDS:
        raise BrowserCaptureError(
            f"The combined Jobnib chapter has only {word_count} words; minimum is {JOBNIB_MIN_CHAPTER_WORDS}."
        )
    if contains_locked_markers(content) or _contains_challenge_marker(content):
        raise BrowserCaptureError("The combined Jobnib chapter still contains lock or challenge text.", 409)
    checksum = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return content, checksum, word_count


def _extract_segment_prose(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for unwanted in soup.select(
        "script, style, noscript, iframe, ins, .adsbygoogle, .code-block, "
        "[id^='jn-lock-'], [id^='jn-nav-'], [id^='jn-coll-'], button"
    ):
        unwanted.decompose()
    paragraphs = soup.select("p")
    candidates = paragraphs if paragraphs else [soup]
    values: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        value = clean_text(candidate.get_text(" ", strip=True))
        if value and value not in seen:
            seen.add(value)
            values.append(value)
    return clean_chapter_content("\n\n".join(values))


def _validate_optional_document(document_html: str, expected_segment_ids: list[str]) -> None:
    soup = BeautifulSoup(document_html, "html.parser")
    found: set[str] = set()
    for element in soup.select("[id^='jn-content-']"):
        try:
            found.add(_normalize_segment_id(str(element.get("id") or "")))
        except BrowserCaptureError:
            continue
    if found and not set(expected_segment_ids).issubset(found):
        raise BrowserCaptureError("The captured Jobnib document is missing an expected content container.")


def _normalize_segment_id(value: str) -> str:
    match = _SEGMENT_ID_PATTERN.search(value.strip())
    if not match:
        raise BrowserCaptureError("A captured Jobnib segment has an invalid identifier.")
    return match.group(1)


def _contains_challenge_marker(value: str) -> bool:
    lowered = clean_text(value).lower()
    return any(marker in lowered for marker in _CHALLENGE_MARKERS)


def _token_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _iso(value: float) -> str:
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat().replace("+00:00", "Z")


_browser_capture_service: JobnibBrowserCaptureService | None = None


def get_jobnib_browser_capture_service() -> JobnibBrowserCaptureService:
    global _browser_capture_service
    if _browser_capture_service is None:
        _browser_capture_service = JobnibBrowserCaptureService()
    return _browser_capture_service
