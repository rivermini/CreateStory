from __future__ import annotations

import sys
import types
from pathlib import Path

from bs4 import BeautifulSoup

try:
    import scrapy  # noqa: F401
except ModuleNotFoundError:
    scrapy_stub = types.ModuleType("scrapy")
    scrapy_stub.Spider = type("Spider", (), {"__init__": lambda self, *args, **kwargs: None})
    scrapy_stub.Request = type("Request", (), {})
    scrapy_stub.http = types.SimpleNamespace(Response=type("Response", (), {}))
    exceptions_stub = types.ModuleType("scrapy.exceptions")
    exceptions_stub.CloseSpider = type("CloseSpider", (Exception,), {})
    sys.modules["scrapy"] = scrapy_stub
if "scrapy.exceptions" not in sys.modules:
    exceptions_stub = types.ModuleType("scrapy.exceptions")
    exceptions_stub.CloseSpider = type("CloseSpider", (Exception,), {})
    sys.modules["scrapy.exceptions"] = exceptions_stub

from api.services.jobnib_batch_service import (
    JobnibBatchRow,
    JobnibBatchService,
    JobnibBatchState,
    JobnibSessionRequired,
    classify_jobnib_error,
    contains_locked_markers,
    extract_homepage_story_refs,
    extract_import_refs,
    extract_jobnib_status,
)
from api.services.jobnib_browser_capture_service import (
    BrowserCaptureError,
    JobnibBrowserCaptureService,
    validate_captured_segments,
)
from spiders.jobnib import JobnibSpider, _JobnibBrowser
from scrapy.exceptions import CloseSpider


FIXTURES = Path(__file__).parent / "fixtures" / "jobnib"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def make_spider(monkeypatch) -> JobnibSpider:
    monkeypatch.setattr(JobnibSpider, "_load_saved_session", lambda self: ([], ""))
    return JobnibSpider(novel="https://jobnib.com/book/completed-fixture", limit=10)


def test_browser_removes_stale_persistent_profile_markers(tmp_path, monkeypatch) -> None:
    profile = tmp_path / "jobnib-profile"
    profile.mkdir()
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        (profile / name).write_text("stale", encoding="utf-8")
    monkeypatch.setenv("JOBNIB_CHROME_PROFILE", str(profile))
    browser = _JobnibBrowser(logger=__import__("logging").getLogger("jobnib-test"))

    browser._remove_stale_profile_locks()

    assert not any((profile / name).exists() for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"))


def test_browser_prefers_user_agent_paired_with_saved_session(monkeypatch) -> None:
    monkeypatch.delenv("JOBNIB_USER_AGENT", raising=False)
    browser = _JobnibBrowser(
        logger=__import__("logging").getLogger("jobnib-test"),
        user_agent="Saved Chrome UA",
    )

    assert browser._resolved_user_agent() == "Saved Chrome UA"

    monkeypatch.setenv("JOBNIB_USER_AGENT", "Explicit UA")
    assert browser._resolved_user_agent() == "Explicit UA"


def test_close_spider_reason_is_classified_as_needs_session() -> None:
    from api.services.jobnib_batch_service import classify_jobnib_error, jobnib_exception_message

    error = CloseSpider("Jobnib is still returning preview-only chapter segments.")
    result = classify_jobnib_error(jobnib_exception_message(error), 0, 10)

    assert result["status"] == "needs_session"
    assert "preview-only" in result["error"]


def test_homepage_parser_deduplicates_cards_and_prefers_clean_ranked_title() -> None:
    soup = BeautifulSoup(
        """
        <div class="jn-cover-card"><a class="jn-cover-link tip" href="/book/story-alpha">9.8 Story Alpha</a></div>
        <div class="jn-list-card"><h3 class="jn-list-title"><a href="/book/story-alpha">Story Alpha</a></h3></div>
        <div class="jn-list-card"><a class="jn-list-cta" href="/book/story-alpha">Read</a></div>
        <div class="jn-cover-card"><a class="jn-cover-link tip" href="/book/story-beta">9.0 Story Beta</a></div>
        """,
        "html.parser",
    )

    refs = extract_homepage_story_refs(soup)

    assert len(refs) == 2
    assert refs[0]["title"] == "Story Alpha"
    assert refs[1]["title"] == "Story Beta"


def test_completed_status_uses_sertostat_and_preserves_duplicate_chapter_numbers(monkeypatch) -> None:
    soup = BeautifulSoup(fixture("completed_story.html"), "html.parser")
    spider = make_spider(monkeypatch)

    assert extract_jobnib_status(soup) == "Completed"
    links = spider._collect_chapter_links(soup, "https://jobnib.com/book/completed-fixture")
    assert [item["sequence_index"] for item in links] == [1, 2]
    assert [item["displayed_chapter_number"] for item in links] == [1, 1]
    assert links[0]["url"] != links[1]["url"]
    assert all("other-slug" in item["url"] for item in links)


def test_import_accepts_text_json_rows_and_rejects_non_jobnib_domains() -> None:
    refs = extract_import_refs({
        "stories": [{"title": "Legacy", "url": "https://jobnib.com/book/legacy-story"}],
        "text": "https://jobnib.com/book/text-story\nhttps://example.com/book/nope",
    })
    assert {item["story_id"] for item in refs} == {"legacy-story", "text-story"}


def test_partial_and_challenge_markers_are_never_complete() -> None:
    preview = BeautifulSoup(fixture("preview_chapter.html"), "html.parser").get_text(" ", strip=True)
    challenge = fixture("challenged_chapter.html")
    assert contains_locked_markers(preview)
    assert "needs_session" == classify_jobnib_error("Cloudflare Turnstile challenge")["status"]
    assert "cf-turnstile" in challenge


def test_discovery_scans_homepage_once_and_filters_completed_locally(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(JobnibSpider, "_load_saved_session", lambda self: ([], ""))
    service = JobnibBatchService(output_root=tmp_path)
    batch_id = "abc123ef"
    output = tmp_path / "jobnib_batch" / batch_id
    output.mkdir(parents=True)
    state = JobnibBatchState(
        batch_id=batch_id,
        created_by_user_id="user-1",
        output_dir=str(output),
        log_file=str(output / "batch.log"),
        max_archive_pages=1,
    )
    service._batches[batch_id] = state

    pages = {
        "https://jobnib.com/": fixture("archive_page_1.html").replace('<a rel="next" href="/book/page/2">Next</a>', ""),
        "https://jobnib.com/book/completed-alpha": fixture("completed_story.html").replace("Completed Fixture", "Completed Alpha"),
        "https://jobnib.com/book/completed-gamma": fixture("completed_story.html").replace("Completed Fixture", "Completed Gamma"),
        "https://jobnib.com/book/ongoing-beta": fixture("ongoing_story.html"),
    }
    monkeypatch.setattr(service, "_fetch_html", lambda _batch, url, _interval: pages[url])
    service._run_discovery(batch_id)

    summary = service.get_status(batch_id)
    assert summary["phase"] == "ready"
    assert summary["discovery"]["archive_pages_checked"] == 1
    assert summary["discovery"]["archive_found"] == 2
    assert summary["discovery"]["completed_eligible"] == 1
    assert summary["discovery"]["excluded"] == 1
    assert {row.title for row in state.rows} == {"Completed Alpha"}


def test_three_consecutive_challenges_open_session_circuit_breaker(tmp_path, monkeypatch) -> None:
    service = JobnibBatchService(output_root=tmp_path)
    batch_id = "feed1234"
    output = tmp_path / "jobnib_batch" / batch_id
    output.mkdir(parents=True)
    refs = "".join(f'<a href="/book/challenged-{index}">Story {index}</a>' for index in range(1, 5))
    service._batches[batch_id] = JobnibBatchState(batch_id=batch_id, created_by_user_id="user", output_dir=str(output))

    def fake_fetch(_batch: str, url: str, _interval: float) -> str:
        if url == "https://jobnib.com/":
            return f"<html><body>{refs}</body></html>"
        raise JobnibSessionRequired("Cloudflare session challenge")

    monkeypatch.setattr(service, "_fetch_html", fake_fetch)
    service._run_discovery(batch_id)
    summary = service.get_status(batch_id)
    assert summary["phase"] == "waiting_for_session"
    assert summary["session"]["required"] is True
    assert summary["session"]["consecutive_challenges"] == 3
    assert summary["needs_session_count"] == 3


def test_restart_requeues_running_rows_and_preserves_session_rows(tmp_path) -> None:
    service = JobnibBatchService(output_root=tmp_path)
    state = JobnibBatchState(
        batch_id="deadbeef",
        created_by_user_id="user",
        phase="crawling",
        output_dir=str(tmp_path / "jobnib_batch" / "deadbeef"),
        rows=[
            JobnibBatchRow(1, "Running", "https://jobnib.com/book/running", "running", status="crawling"),
            JobnibBatchRow(2, "Deferred", "https://jobnib.com/book/deferred", "deferred", status="needs_session"),
        ],
    )
    service._batches[state.batch_id] = state
    service._persist_locked()

    restarted = JobnibBatchService(output_root=tmp_path)
    restored = restarted._batches[state.batch_id]
    assert restored.phase == "ready"
    assert restored.rows[0].status == "queued"
    assert restored.rows[1].status == "needs_session"


def _capture_fixture(tmp_path):
    batch_service = JobnibBatchService(output_root=tmp_path)
    batch_id = "cafe1234"
    output = tmp_path / "jobnib_batch" / batch_id
    output.mkdir(parents=True, exist_ok=True)
    row = JobnibBatchRow(
        1,
        "Complete Story",
        "https://jobnib.com/book/complete-story",
        "complete-story",
        status="needs_session",
        completion_status="Completed",
        total_chapters=1,
    )
    batch_service._batches[batch_id] = JobnibBatchState(
        batch_id=batch_id,
        created_by_user_id="user-1",
        phase="waiting_for_session",
        output_dir=str(output),
        rows=[row],
    )
    batch_service._save_chapter_manifest(
        row,
        [{
            "sequence_index": 1,
            "chapter_number": 1,
            "displayed_chapter_number": 1,
            "volume_label": "",
            "title": "Chapter One",
            "url": "https://jobnib.com/book/complete-story-chapter-1",
        }],
        metadata={"title": "Complete Story", "description": "Fixture"},
        status="Completed",
    )
    return batch_service, JobnibBrowserCaptureService(batch_service), batch_id, row


def _full_segment(segment: int) -> dict:
    words = " ".join(f"segment{segment}word{index}" for index in range(70))
    return {
        "segment_id": str(segment),
        "html": f"<div id='jn-content-42-{segment}'><p>{words}</p></div>",
        "text": words,
        # Jobnib hides part one after part two is selected. Hidden populated
        # content is still a valid capture.
        "visible": segment == 2,
    }


def test_browser_capture_pairing_checkpoints_full_segments_and_finishes_story(tmp_path) -> None:
    batch_service, capture_service, batch_id, row = _capture_fixture(tmp_path)
    pairing = capture_service.create_pairing(batch_id=batch_id, owner_user_id="user-1", row_index=1)

    assigned = capture_service.next_assignment(
        batch_id=batch_id,
        pairing_id=pairing["pairing_id"],
        token=pairing["pairing_token"],
    )
    assert assigned["done"] is False
    assert assigned["assignment"]["expected_segment_ids"] == ["1", "2"]

    result = capture_service.submit(
        batch_id=batch_id,
        pairing_id=pairing["pairing_id"],
        token=pairing["pairing_token"],
        payload={
            "assignment_id": assigned["assignment"]["assignment_id"],
            "page_url": assigned["assignment"]["url"],
            "page_title": "Chapter One",
            "segments": [_full_segment(1), _full_segment(2)],
            "locks": [
                {"segment_id": "1", "selector": "#jn-lock-42-1", "text": "", "visible": False},
                {"segment_id": "2", "selector": "#jn-lock-42-2", "text": "", "visible": False},
            ],
            "lock_scan_complete": True,
            "document_html": "",
        },
    )

    assert result["accepted"] is True
    assert result["story_completed"] is True
    assert result["progress"] == {"row_index": 1, "crawled_chapters": 1, "total_chapters": 1}
    assert row.status == "completed"
    assert row.output_file.endswith("_Completed_jn.md")
    assert (output := Path(batch_service._batches[batch_id].output_dir) / row.output_file).is_file()
    assert "segment1word0" in output.read_text(encoding="utf-8")
    assert "segment2word69" in output.read_text(encoding="utf-8")

    # Network retries are idempotent even though finalization removed the
    # checkpoint after writing the completed story.
    duplicate = capture_service.submit(
        batch_id=batch_id,
        pairing_id=pairing["pairing_id"],
        token=pairing["pairing_token"],
        payload={"assignment_id": assigned["assignment"]["assignment_id"]},
    )
    assert duplicate["accepted"] is True
    assert duplicate["duplicate"] is True


def test_browser_capture_rejects_missing_segment_and_visible_lock() -> None:
    try:
        validate_captured_segments(
            expected_segment_ids=["1", "2"],
            segments=[_full_segment(1)],
            locks=[],
            lock_scan_complete=True,
        )
    except BrowserCaptureError as exc:
        assert "missing 2" in str(exc)
    else:
        raise AssertionError("Missing Jobnib segment should be rejected")

    try:
        validate_captured_segments(
            expected_segment_ids=["1", "2"],
            segments=[_full_segment(1), _full_segment(2)],
            locks=[{"selector": "#jn-lock-42-2", "visible": True, "text": "Read Part 1 to unlock"}],
            lock_scan_complete=True,
        )
    except BrowserCaptureError as exc:
        assert exc.status_code == 409
        assert "still visible" in str(exc)
    else:
        raise AssertionError("Visible Jobnib lock should be rejected")


def test_browser_capture_pairing_token_is_batch_bound_and_expires(tmp_path) -> None:
    _batch_service, capture_service, batch_id, _row = _capture_fixture(tmp_path)
    pairing = capture_service.create_pairing(batch_id=batch_id, owner_user_id="user-1")

    try:
        capture_service.status(batch_id="deadbeef", pairing_id=pairing["pairing_id"], token=pairing["pairing_token"])
    except BrowserCaptureError as exc:
        assert exc.status_code == 401
    else:
        raise AssertionError("A pairing token must not cross batch boundaries")

    capture_service._pairings[pairing["pairing_id"]].expires_at = 0
    expired = capture_service.status(
        batch_id=batch_id,
        pairing_id=pairing["pairing_id"],
        token=pairing["pairing_token"],
    )
    assert expired["status"] == "expired"
    try:
        capture_service.next_assignment(
            batch_id=batch_id,
            pairing_id=pairing["pairing_id"],
            token=pairing["pairing_token"],
        )
    except BrowserCaptureError as exc:
        assert exc.status_code == 410
    else:
        raise AssertionError("Expired pairing must not receive assignments")
