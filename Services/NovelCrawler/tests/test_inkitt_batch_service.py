from __future__ import annotations

import json
import sys
import threading
import types
from concurrent.futures import ThreadPoolExecutor

from bs4 import BeautifulSoup


try:
    import scrapy  # noqa: F401
except ModuleNotFoundError:
    scrapy_stub = types.ModuleType("scrapy")

    class Spider:
        def __init__(self, *args, **kwargs) -> None:
            pass

    class Request:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

    scrapy_stub.Spider = Spider
    scrapy_stub.Request = Request
    scrapy_stub.http = types.SimpleNamespace(Response=type("Response", (), {}))
    sys.modules["scrapy"] = scrapy_stub

from api.services.inkitt_batch_service import (
    InkittBatchRow,
    InkittBatchService,
    InkittBatchState,
    classify_inkitt_crawl_error,
    extract_completed_story_refs,
    extract_completed_story_refs_from_api,
    extract_story_quality,
    should_use_rendered_fallback,
)
from api.services.inkitt_cookie_service import _is_login_gated_response as cookie_check_is_login_gated
from spiders.inkitt import InkittSpider


def test_extract_completed_story_refs_skips_ongoing() -> None:
    html = """
    <main>
      <article>
        <h4><a href="/stories/111">Complete Story</a></h4>
        <p>Summary text goes here for the card.</p>
        <p>Romance by Jane Doe • Complete • 20 chapters</p>
        <p>Show Reviews (66)</p>
      </article>
      <article>
        <h4><a href="/stories/222">Ongoing Story</a></h4>
        <p>Romance by John Doe • Ongoing • 11 chapters</p>
        <p>Show Reviews (12)</p>
      </article>
    </main>
    """

    refs = extract_completed_story_refs(BeautifulSoup(html, "html.parser"), "romance", "Romance")

    assert len(refs) == 1
    assert refs[0]["story_id"] == "111"
    assert refs[0]["title"] == "Complete Story"
    assert refs[0]["author"] == "Jane Doe"
    assert refs[0]["total_chapters"] == 20
    assert refs[0]["review_count"] == 66


def test_extract_completed_story_refs_from_api_skips_patron_and_ongoing() -> None:
    payload = {
        "stories": [
            {
                "id": 111,
                "title": "Free Complete Story",
                "story_status": "complete",
                "for_patrons_only": False,
                "chapters_count": 20,
                "overall_rating_cache": 4.6,
                "reviews_count": 12,
                "user": {"name": "Jane Doe"},
            },
            {
                "id": 222,
                "title": "Paid Complete Story",
                "story_status": "complete",
                "for_patrons_only": True,
            },
            {
                "id": 333,
                "title": "Ongoing Story",
                "story_status": "ongoing",
                "for_patrons_only": False,
            },
        ],
    }

    refs = extract_completed_story_refs_from_api(payload, "romance", "Romance")

    assert len(refs) == 1
    assert refs[0]["story_id"] == "111"
    assert refs[0]["title"] == "Free Complete Story"
    assert refs[0]["author"] == "Jane Doe"
    assert refs[0]["total_chapters"] == 20
    assert refs[0]["rating"] == 4.6
    assert refs[0]["review_count"] == 12


def test_extract_story_quality_rating_reviews_and_reads() -> None:
    html = """
    <section>
      <dl>
        <dt>Rating</dt>
        <dd>4.8 66 reviews</dd>
      </dl>
      <p>12.5K reads</p>
      <a href="/genres/romance">Romance</a>
      <a href="/topics/werewolf">Werewolf</a>
    </section>
    """

    quality = extract_story_quality(BeautifulSoup(html, "html.parser"))

    assert quality["rating"] == 4.8
    assert quality["review_count"] == 66
    assert quality["read_count"] == 12500
    assert quality["tags"] == ["Romance", "Werewolf"]


def test_discover_genre_reports_stop_reason_and_keeps_partial_results(monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._request_lock = threading.Lock()
    service._last_request_at = 0.0

    class FakeResponse:
        def __init__(self, status_code: int, payload: dict, headers: dict | None = None) -> None:
            self.status_code = status_code
            self._payload = payload
            self.headers = headers or {}

        def json(self) -> dict:
            return self._payload

    class FakeSession:
        def __init__(self) -> None:
            self.calls = 0

        def get(self, *_args, **_kwargs) -> FakeResponse:
            self.calls += 1
            if self.calls == 1:
                return FakeResponse(
                    200,
                    {
                        "stories": [
                            {
                                "id": index,
                                "title": f"Story {index}",
                                "story_status": "complete",
                                "for_patrons_only": False,
                                "chapters_count": 10,
                            }
                            for index in range(1, 21)
                        ],
                    },
                )
            return FakeResponse(429, {}, {"Retry-After": "60"})

    session = FakeSession()
    monkeypatch.setattr(service, "_make_session", lambda: session)
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_DISCOVER_RETRY_TIMES", 2)
    monkeypatch.setattr("api.services.inkitt_batch_service.random.uniform", lambda _start, _end: 0)
    monkeypatch.setattr("api.services.inkitt_batch_service.time.sleep", lambda _seconds: None)

    result = service._discover_genre(None, "action", "Action", 1000, 2)

    assert len(result.refs) == 20
    assert result.pages_checked == 2
    assert result.raw_stories_seen == 20
    assert result.stop_reason == "HTTP 429 on page 2 (Retry-After: 60) after 2 retries"
    assert session.calls == 4


def test_discover_genre_retries_transient_500(monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._request_lock = threading.Lock()
    service._last_request_at = 0.0

    class FakeResponse:
        def __init__(self, status_code: int, payload: dict) -> None:
            self.status_code = status_code
            self._payload = payload
            self.headers = {}

        def json(self) -> dict:
            return self._payload

    class FakeSession:
        def __init__(self) -> None:
            self.calls = 0

        def get(self, *_args, **_kwargs) -> FakeResponse:
            self.calls += 1
            if self.calls == 1:
                return FakeResponse(500, {})
            return FakeResponse(
                200,
                {
                    "stories": [
                        {
                            "id": 111,
                            "title": "Recovered Story",
                            "story_status": "complete",
                            "for_patrons_only": False,
                            "chapters_count": 10,
                        }
                    ],
                },
            )

    session = FakeSession()
    monkeypatch.setattr(service, "_make_session", lambda: session)
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_DISCOVER_RETRY_TIMES", 2)
    monkeypatch.setattr("api.services.inkitt_batch_service.random.uniform", lambda _start, _end: 0)
    monkeypatch.setattr("api.services.inkitt_batch_service.time.sleep", lambda _seconds: None)

    result = service._discover_genre(None, "action", "Action", 1000, 2)

    assert len(result.refs) == 1
    assert result.refs[0]["story_id"] == "111"
    assert result.stop_reason == "short page 1 (1 story row(s))"
    assert session.calls == 2


def test_discover_genre_can_resume_from_later_page(monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._request_lock = threading.Lock()
    service._last_request_at = 0.0

    class FakeResponse:
        status_code = 200
        headers: dict = {}

        def json(self) -> dict:
            return {
                "stories": [
                    {
                        "id": 444,
                        "title": "Resume Story",
                        "story_status": "complete",
                        "for_patrons_only": False,
                        "chapters_count": 10,
                    }
                ]
            }

    class FakeSession:
        def __init__(self) -> None:
            self.pages: list[int] = []

        def get(self, *_args, **kwargs) -> FakeResponse:
            self.pages.append(int(kwargs["params"]["page"]))
            return FakeResponse()

    session = FakeSession()
    monkeypatch.setattr(service, "_make_session", lambda: session)

    result = service._discover_genre(None, "action", "Action", 1000, 1, start_page=4)

    assert session.pages == [4]
    assert result.start_page == 4
    assert result.last_success_page == 4
    assert result.stop_reason == "short page 4 (1 story row(s))"
    assert result.terminal is True


def test_discover_genre_writes_live_progress_logs(tmp_path, monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._lock = threading.Lock()
    service._batches = {}
    service._index_file = tmp_path / "batch_index.json"
    service._last_persist_at = 0.0
    service._request_lock = threading.Lock()
    service._last_request_at = 0.0
    service._history_lock = threading.Lock()
    service._discovery_progress_file = tmp_path / "discovery_progress.json"
    state = InkittBatchState(batch_id="aaaaaaaa", created_by_user_id=None)
    service._batches[state.batch_id] = state

    class FakeResponse:
        status_code = 200
        headers: dict = {}

        def __init__(self, page: int) -> None:
            self.page = page

        def json(self) -> dict:
            count = 20 if self.page < 26 else 1
            return {
                "stories": [
                    {
                        "id": self.page * 1000 + index,
                        "title": f"Story {self.page}-{index}",
                        "story_status": "complete",
                        "for_patrons_only": False,
                        "chapters_count": 10,
                    }
                    for index in range(count)
                ]
            }

    class FakeSession:
        def get(self, *_args, **kwargs) -> FakeResponse:
            return FakeResponse(int(kwargs["params"]["page"]))

    monkeypatch.setattr(service, "_make_session", lambda: FakeSession())
    monkeypatch.setattr("api.services.inkitt_batch_service.time.sleep", lambda _seconds: None)

    result = service._discover_genre("aaaaaaaa", "action", "Action", 1000, 1)

    assert result.last_success_page == 26
    assert any("Action: discovery worker started" in line for line in state.log_lines)
    assert any("Action: scanning page 1/1000" in line for line in state.log_lines)
    assert any("Action: scanning page 25/1000" in line for line in state.log_lines)
    progress = service._load_discovery_progress()
    assert progress["action"]["last_success_page"] == 25
    assert progress["action"]["stop_reason"] == "in progress at page 25"


def test_discover_genre_labels_page_cap_500(monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._request_lock = threading.Lock()
    service._last_request_at = 0.0

    class FakeResponse:
        def __init__(self, status_code: int, payload: dict) -> None:
            self.status_code = status_code
            self._payload = payload
            self.headers = {}

        def json(self) -> dict:
            return self._payload

    class FakeSession:
        def __init__(self) -> None:
            self.calls = 0

        def get(self, *_args, **_kwargs) -> FakeResponse:
            self.calls += 1
            if self.calls <= 500:
                return FakeResponse(
                    200,
                    {
                        "stories": [
                            {
                                "id": self.calls * 1000 + index,
                                "title": f"Story {self.calls}-{index}",
                                "story_status": "complete",
                                "for_patrons_only": False,
                                "chapters_count": 10,
                            }
                            for index in range(20)
                        ],
                    },
                )
            return FakeResponse(500, {})

    session = FakeSession()
    monkeypatch.setattr(service, "_make_session", lambda: session)
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_DISCOVER_RETRY_TIMES", 0)
    monkeypatch.setattr("api.services.inkitt_batch_service.time.sleep", lambda _seconds: None)

    result = service._discover_genre(None, "drama", "Drama", 1000, 1)

    assert len(result.refs) == 10_000
    assert result.pages_checked == 501
    assert result.raw_stories_seen == 10_000
    assert result.stop_reason == "probable Inkitt page cap at page 501 after 10000 API story row(s)"


def test_record_discovery_progress_persists_terminal_state(tmp_path) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._history_lock = threading.Lock()
    service._discovery_progress_file = tmp_path / "discovery_progress.json"

    service._record_discovery_progress(
        "drama",
        "Drama",
        result=type(
            "Result",
            (),
            {
                "start_page": 1,
                "pages_checked": 501,
                "raw_stories_seen": 10_000,
                "last_success_page": 500,
                "stop_reason": "probable Inkitt page cap at page 501 after 10000 API story row(s)",
                "terminal": True,
            },
        )(),
    )

    progress = service._load_discovery_progress()

    assert progress["drama"]["last_success_page"] == 500
    assert progress["drama"]["terminal"] is True
    assert "page cap" in progress["drama"]["stop_reason"]


def test_rendered_fallback_uses_global_request_delay(monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._request_lock = threading.Lock()
    service._last_request_at = 10.0

    class FakeBrowser:
        def fetch_with_retry(self, *_args, **_kwargs):
            return "<html></html>", 200, "", {}, ["Rendered chapter text"]

    fake_module = types.ModuleType("handlers.selenium_handler")
    fake_module._get_browser = lambda: FakeBrowser()
    monkeypatch.setitem(sys.modules, "handlers.selenium_handler", fake_module)
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_RENDERED_FALLBACK", True)
    monkeypatch.setattr(service, "_fetch_rendered_with_flaresolverr", lambda _url: "")
    monotonic_values = iter([12.0, 15.0])
    slept: list[float] = []
    monkeypatch.setattr("api.services.inkitt_batch_service.time.monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr("api.services.inkitt_batch_service.time.sleep", slept.append)

    content = service._fetch_rendered_chapter_content("https://www.inkitt.com/stories/1/chapters/1", 5.0)

    assert content == "Rendered chapter text"
    assert slept == [3.0]
    assert service._last_request_at == 15.0


def test_rendered_fallback_extracts_from_returned_body_when_paragraph_list_is_empty(monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._request_lock = threading.Lock()
    service._last_request_at = 0.0

    html = """
    <html>
      <body>
        <article id="story-text-container">
          <h2>Chapter 2</h2>
          <p data-content="true">This rendered body has real readable chapter text.</p>
          <p data-content="true">The fallback should parse this body instead of the final URL.</p>
        </article>
      </body>
    </html>
    """

    class FakeBrowser:
        def fetch_with_retry(self, *_args, **_kwargs):
            return "https://www.inkitt.com/stories/98825/chapters/2", 200, html.encode("utf-8"), {}, None

    fake_module = types.ModuleType("handlers.selenium_handler")
    fake_module._get_browser = lambda: FakeBrowser()
    monkeypatch.setitem(sys.modules, "handlers.selenium_handler", fake_module)
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_RENDERED_FALLBACK", True)
    monkeypatch.setattr(service, "_fetch_rendered_with_flaresolverr", lambda _url: "")

    class FakeInkittSpider:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def _extract_chapter_content(self, soup: BeautifulSoup) -> str:
            return "\n\n".join(paragraph.get_text(" ", strip=True) for paragraph in soup.select("article p"))

    monkeypatch.setattr("api.services.inkitt_batch_service.InkittSpider", FakeInkittSpider)

    content = service._fetch_rendered_chapter_content("https://www.inkitt.com/stories/98825/chapters/2", 0)

    assert "real readable chapter text" in content
    assert "final URL" in content


def test_rendered_fallback_prefers_flaresolverr_and_forwards_only_login_cookie(monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._request_lock = threading.Lock()
    service._last_request_at = 0.0
    captured: dict = {}

    fake_module = types.ModuleType("api.services.flaresolverr_client")
    fake_module.is_configured = lambda: True

    def fake_solve(url, max_timeout_ms, cookies):
        captured.update({"url": url, "timeout": max_timeout_ms, "cookies": cookies})
        return {
            "status_code": 200,
            "html": "<article id='story-text-container'><p data-content='true'>Rendered full chapter prose.</p></article>",
        }

    fake_module.solve = fake_solve
    monkeypatch.setitem(sys.modules, "api.services.flaresolverr_client", fake_module)
    monkeypatch.setattr(
        "api.services.inkitt_batch_service.load_saved_inkitt_cookies",
        lambda: ([
            {"name": "user_credentials", "value": "login", "domain": ".inkitt.com", "path": "/"},
            {"name": "cf_clearance", "value": "browser-bound", "domain": ".inkitt.com", "path": "/"},
        ], "Browser UA"),
    )
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_RENDERED_FALLBACK", True)

    content = service._fetch_rendered_chapter_content("https://www.inkitt.com/stories/1/chapters/5", 0)

    assert content == "Rendered full chapter prose."
    assert captured["timeout"] == 90_000
    assert [cookie["name"] for cookie in captured["cookies"]] == ["user_credentials"]


def test_inkitt_extractor_prefers_article_with_real_prose() -> None:
    spider = InkittSpider.__new__(InkittSpider)
    html = """
    <article id="story-text-container"><h2>Chapter 1</h2></article>
    <article id="story-text-container" class="default-style">
      <h2>Chapter 1</h2>
      <p data-content="true">The real chapter starts here with enough prose to win selection.</p>
      <p data-content="true">A second paragraph keeps this article ahead of the title-only copy.</p>
    </article>
    """

    content = spider._extract_chapter_content(BeautifulSoup(html, "html.parser"))

    assert "real chapter starts here" in content
    assert "second paragraph" in content


def test_rendered_fallback_skips_long_static_chapter_with_ui_markers(monkeypatch) -> None:
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_RENDERED_FALLBACK_WORDS", 120)
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_RENDERED_FALLBACK_SUSPICIOUS_WORDS", 800)
    long_chapter = " ".join(["chapterword"] * 2500) + "\n\nAbout the Author\n\nNext Chapter"

    assert should_use_rendered_fallback(long_chapter) is False


def test_rendered_fallback_keeps_short_and_suspicious_chapters_safe(monkeypatch) -> None:
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_RENDERED_FALLBACK_WORDS", 120)
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_RENDERED_FALLBACK_TINY_WORDS", 12)
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_RENDERED_FALLBACK_SUSPICIOUS_WORDS", 800)

    short_real_chapter = "I hope that you all enjoyed reading this book. Maybe I will continue the story later. Thank you for reading."
    assert should_use_rendered_fallback(short_real_chapter) is False
    assert should_use_rendered_fallback("Tiny text only") is True
    assert should_use_rendered_fallback(" ".join(["word"] * 200) + " About the Author") is True


def test_import_discovered_catalog_merges_and_creates_ready_batch(tmp_path) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._lock = threading.Lock()
    service._batches = {}
    service._batch_root = tmp_path
    service._batch_root.mkdir(parents=True, exist_ok=True)
    service._index_file = tmp_path / "batch_index.json"
    service._discovered_story_index_file = tmp_path / "discovered_story_index.json"
    service._exported_story_index_file = tmp_path / "exported_story_index.json"
    service._last_persist_at = 0.0
    service._history_lock = threading.Lock()

    payload = {
        "kind": "inkitt_discovered_catalog",
        "version": 1,
        "stories": [
            {
                "story_id": "111",
                "title": "Restored Story",
                "url": "https://www.inkitt.com/stories/111",
                "genre": "Action",
                "genre_slug": "action",
                "author": "Author",
                "total_chapters": 12,
                "rating": 4.7,
                "review_count": 9,
                "read_count": 1000,
            }
        ],
    }

    result = service.import_discovered_catalog(payload, created_by_user_id="user-1")
    export = service.export_discovered_catalog()

    assert result["imported_count"] == 1
    assert result["new_count"] == 1
    assert result["total_count"] == 1
    assert result["queued_count"] == 1
    assert result["batch"]["phase"] == "ready"
    assert result["batch"]["total_stories"] == 1
    assert export["story_count"] == 1
    assert export["stories"][0]["story_id"] == "111"


def test_import_discovered_catalog_queues_only_imported_file_refs(tmp_path) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._lock = threading.Lock()
    service._batches = {}
    service._batch_root = tmp_path
    service._batch_root.mkdir(parents=True, exist_ok=True)
    service._index_file = tmp_path / "batch_index.json"
    service._discovered_story_index_file = tmp_path / "discovered_story_index.json"
    service._exported_story_index_file = tmp_path / "exported_story_index.json"
    service._last_persist_at = 0.0
    service._history_lock = threading.Lock()
    service._discovered_story_index_file.write_text(
        json.dumps({
            "stories": {
                "222": {
                    "story_id": "222",
                    "title": "Already Cataloged Story",
                    "url": "https://www.inkitt.com/stories/222",
                    "genre": "Drama",
                    "genre_slug": "drama",
                }
            }
        }),
        encoding="utf-8",
    )

    payload = {
        "kind": "inkitt_batch_discovered_catalog",
        "version": 1,
        "stories": [
            {
                "story_id": "111",
                "title": "Imported Batch Story",
                "url": "https://www.inkitt.com/stories/111",
                "genre": "Action",
                "genre_slug": "action",
            }
        ],
    }

    result = service.import_discovered_catalog(payload, created_by_user_id="user-1")
    export = service.export_discovered_catalog()

    assert result["imported_count"] == 1
    assert result["new_count"] == 1
    assert result["total_count"] == 2
    assert result["queued_count"] == 1
    assert result["batch"]["total_stories"] == 1
    assert export["story_count"] == 2
    restored_batch_id = result["batch"]["batch_id"]
    assert [row.story_id for row in service._batches[restored_batch_id].rows] == ["111"]


def test_export_batch_catalog_only_includes_selected_batch() -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._lock = threading.Lock()
    service._batches = {
        "aaaaaaaa": InkittBatchState(
            batch_id="aaaaaaaa",
            created_by_user_id="user-1",
            batch_name="Selected batch",
            selected_genres=["action"],
            rows=[
                InkittBatchRow(
                    index=1,
                    genre="Action",
                    genre_slug="action",
                    title="Selected Story",
                    url="https://www.inkitt.com/stories/111",
                    story_id="111",
                    author="Author One",
                    total_chapters=12,
                    rating=4.7,
                    review_count=9,
                    read_count=1000,
                )
            ],
        ),
        "bbbbbbbb": InkittBatchState(
            batch_id="bbbbbbbb",
            created_by_user_id="user-1",
            batch_name="Other batch",
            selected_genres=["drama"],
            rows=[
                InkittBatchRow(
                    index=1,
                    genre="Drama",
                    genre_slug="drama",
                    title="Other Story",
                    url="https://www.inkitt.com/stories/222",
                    story_id="222",
                )
            ],
        ),
    }

    export = service.export_batch_catalog("aaaaaaaa")

    assert export["kind"] == "inkitt_batch_discovered_catalog"
    assert export["batch_id"] == "aaaaaaaa"
    assert export["batch_name"] == "Selected batch"
    assert export["story_count"] == 1
    assert export["selected_genres"] == ["action"]
    assert [story["story_id"] for story in export["stories"]] == ["111"]


def test_retry_failed_rows_are_prioritized_for_next_crawl(tmp_path) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._lock = threading.Lock()
    service._batches = {}
    service._batch_root = tmp_path
    service._index_file = tmp_path / "batch_index.json"
    service._last_persist_at = 0.0
    service._history_lock = threading.Lock()
    rows = [
        InkittBatchRow(
            index=1,
            genre="Action",
            genre_slug="action",
            title="Normal Queued",
            url="https://www.inkitt.com/stories/1",
            story_id="1",
            status="queued",
        ),
        InkittBatchRow(
            index=2,
            genre="Action",
            genre_slug="action",
            title="Failed Story",
            url="https://www.inkitt.com/stories/2",
            story_id="2",
            status="failed",
            error="No readable free chapter content.",
        ),
    ]
    state = InkittBatchState(
        batch_id="aaaaaaaa",
        created_by_user_id=None,
        rows=rows,
        phase="ready",
        output_dir=str(tmp_path / "aaaaaaaa"),
    )
    service._batches[state.batch_id] = state

    service.retry_failed("aaaaaaaa", row_index=2)
    available = service._available_rows_for_crawl_locked(state, max_stories=2)

    assert rows[1].status == "queued"
    assert rows[1].error == ""
    assert rows[1].retry_priority > rows[0].retry_priority
    assert [row.index for row in available] == [2, 1]


def test_login_gate_during_story_fetch_is_retryable_failed_row(monkeypatch, tmp_path) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._is_cancel_requested = lambda _batch_id: False

    class FakeSpider:
        def __init__(self, *args, **kwargs) -> None:
            pass

    def fake_fetch(*_args, **_kwargs):
        raise RuntimeError("[inkitt] Login required for this free/adult-gated page.")

    monkeypatch.setattr("api.services.inkitt_batch_service.InkittSpider", FakeSpider)
    service._fetch_spider_html = fake_fetch

    row = InkittBatchRow(
        index=1,
        genre="Action",
        genre_slug="action",
        title="Beautiful Killer",
        url="https://www.inkitt.com/stories/317829",
        story_id="317829",
        status="queued",
    )

    result = service._crawl_one("aaaaaaaa", row, tmp_path, 0)

    assert result["status"] == "failed"
    assert "fresh login cookies" in result["error"]
    assert "same VPN/IP" in result["error"]


def test_subscription_gate_is_skipped_not_retried() -> None:
    result = classify_inkitt_crawl_error("[inkitt] subscription required to read this page.")

    assert result["status"] == "skipped"
    assert "paid/subscription" in result["error"]


def test_http_410_is_skipped_as_removed_story() -> None:
    result = classify_inkitt_crawl_error(
        "[inkitt] HTTP 410 while fetching https://www.inkitt.com/stories/212657"
    )

    assert result["status"] == "skipped"
    assert "removed or unpublished" in result["error"]


def test_stale_saved_cookies_fall_back_to_clean_anonymous_session(monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)

    class FakeResponse:
        status_code = 200
        headers: dict = {}

        def __init__(self, text: str) -> None:
            self.text = text

    class FakeSession:
        def __init__(self, response: FakeResponse) -> None:
            self.response = response
            self.calls = 0

        def get(self, *_args, **_kwargs) -> FakeResponse:
            self.calls += 1
            return self.response

    stale_session = FakeSession(FakeResponse("log in to continue reading"))
    anonymous_session = FakeSession(FakeResponse("full public chapter text"))
    monkeypatch.setattr(service, "_make_anonymous_session", lambda: anonymous_session)

    class FakeSpider:
        _session = stale_session
        _saved_cookie_count = 2

        @staticmethod
        def _is_blocked_response(_response) -> bool:
            return False

        @staticmethod
        def _is_login_gated_response(text: str) -> bool:
            return "log in to continue" in text

    spider = FakeSpider()
    html = service._fetch_spider_html(spider, "https://www.inkitt.com/stories/1", 0)

    assert html == "full public chapter text"
    assert stale_session.calls == 1
    assert anonymous_session.calls == 1
    assert spider._session is anonymous_session
    assert spider._saved_cookie_count == 0


def test_static_story_sessions_can_download_concurrently() -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    barrier = threading.Barrier(2, timeout=2)
    state_lock = threading.Lock()
    active = 0
    max_active = 0

    class FakeSession:
        def get(self, *_args, **_kwargs):
            nonlocal active, max_active
            with state_lock:
                active += 1
                max_active = max(max_active, active)
            barrier.wait()
            with state_lock:
                active -= 1
            return types.SimpleNamespace(status_code=200, text="ok", headers={})

    sessions = [FakeSession(), FakeSession()]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda session: service._throttled_get(session, "https://example.test", 0), sessions))

    assert [response.status_code for response in responses] == [200, 200]
    assert max_active == 2


def test_short_real_chapter_text_is_not_mistaken_for_login_gate() -> None:
    spider = InkittSpider.__new__(InkittSpider)
    readable_short_chapters = [
        "Epilogue If more than three people read this, I might write one.",
        "Prologue Earth 2.0 is ready to receive guests.",
        "History With logic and hope, read the future in the other books.",
        "Rewrite Thank you to everyone that has read this book; I apologize for the delay.",
    ]

    for text in readable_short_chapters:
        html = f"<article id='story-text-container'><p>{text}</p></article>"
        assert spider._is_login_gated_response(html) is False
        assert cookie_check_is_login_gated(html) is False


def test_explicit_inkitt_login_wall_is_detected() -> None:
    spider = InkittSpider.__new__(InkittSpider)
    html = "<article id='story-text-container'><p>Log in to continue reading this chapter.</p></article>"

    assert spider._is_login_gated_response(html) is True
    assert cookie_check_is_login_gated(html) is True


def test_inkitt_story_landing_page_without_chapter_links_does_not_create_fake_chapter() -> None:
    spider = InkittSpider.__new__(InkittSpider)
    spider.selector_config = types.SimpleNamespace(chapter_list="a[href*='/stories/'][href*='/chapters/']")
    html = """
    <main>
      <h1>Beautiful Killer</h1>
      <article id="story-text-container">
        <h2>Summary</h2>
        <p>This is only a story summary, not a readable chapter.</p>
      </article>
    </main>
    """

    links = spider._collect_chapter_links(
        BeautifulSoup(html, "html.parser"),
        "317829",
        "https://www.inkitt.com/stories/317829",
    )

    assert links == []


def test_inkitt_direct_chapter_url_is_kept_when_no_chapter_list_is_visible() -> None:
    spider = InkittSpider.__new__(InkittSpider)
    spider.selector_config = types.SimpleNamespace(chapter_list="a[href*='/stories/'][href*='/chapters/']")
    html = """
    <article id="story-text-container">
      <h2>Not A Chapter</h2>
      <p>I hope that you all enjoyed reading this book.</p>
    </article>
    """

    links = spider._collect_chapter_links(
        BeautifulSoup(html, "html.parser"),
        "317829",
        "https://www.inkitt.com/stories/317829/chapters/42",
    )

    assert len(links) == 1
    assert links[0]["chapter_number"] == 42
    assert links[0]["url"] == "https://www.inkitt.com/stories/317829/chapters/42"


def test_single_chapter_story_landing_page_with_real_content_is_kept() -> None:
    spider = InkittSpider.__new__(InkittSpider)
    spider.selector_config = types.SimpleNamespace(chapter_list="a[href*='/stories/'][href*='/chapters/']")
    html = """
    <article id="story-text-container">
      <h2>Earth's history</h2>
      <p data-content="true">This is the real and only chapter.</p>
    </article>
    """

    links = spider._collect_chapter_links(
        BeautifulSoup(html, "html.parser"),
        "262970",
        "https://www.inkitt.com/stories/262970",
    )

    assert links == [{
        "chapter_number": 1,
        "title": "Earth's history",
        "url": "https://www.inkitt.com/stories/262970",
    }]


def test_story_without_chapter_list_is_skipped_with_zero_chapters(monkeypatch, tmp_path) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._is_cancel_requested = lambda _batch_id: False
    service._fetch_spider_html = lambda *_args, **_kwargs: "<html><h1>No Chapters</h1></html>"

    class FakeSpider:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def _extract_novel_metadata(self, *_args, **_kwargs) -> dict:
            return {"title": "No Chapters"}

        def _collect_chapter_links(self, *_args, **_kwargs) -> list:
            return []

    monkeypatch.setattr("api.services.inkitt_batch_service.InkittSpider", FakeSpider)
    row = InkittBatchRow(
        index=1,
        genre="Action",
        genre_slug="action",
        title="No Chapters",
        url="https://www.inkitt.com/stories/317829",
        story_id="317829",
        total_chapters=1,
        status="queued",
    )

    result = service._crawl_one("aaaaaaaa", row, tmp_path, 0)

    assert result["status"] == "skipped"
    assert result["total_chapters"] == 0
    assert result["crawled_chapters"] == 0
    assert result["error"] == "No chapter list found."


def test_empty_inkitt_chapter_does_not_fail_story_when_later_chapters_are_readable(monkeypatch, tmp_path) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._promo_patterns = None
    service._is_cancel_requested = lambda _batch_id: False
    service._update_row_progress = lambda *_args, **_kwargs: None
    logs: list[str] = []
    service._log_batch = lambda _batch_id, message, force=False: logs.append(message)
    service._fetch_rendered_chapter_content = lambda *_args, **_kwargs: ""

    story_html = "<html><h1>Map Then Story</h1><p>Status Complete</p></html>"
    chapter_one_html = "<article id='story-text-container'><h2>World Map</h2></article>"
    chapter_two_html = """
    <article id="story-text-container">
      <h2>Chapter 2</h2>
      <p data-content="true">This readable chapter should keep the story exportable.</p>
      <p data-content="true">The crawler should not fail the whole story because chapter one is blank.</p>
    </article>
    """

    def fake_fetch(_spider, url, _delay):
        if url.endswith("/chapters/1"):
            return chapter_one_html
        if url.endswith("/chapters/2"):
            return chapter_two_html
        return story_html

    service._fetch_spider_html = fake_fetch

    class FakeSpider:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def _extract_novel_metadata(self, *_args, **_kwargs) -> dict:
            return {"title": "Map Then Story", "authors": ["Author"]}

        def _collect_chapter_links(self, *_args, **_kwargs) -> list[dict]:
            return [
                {"chapter_number": 1, "title": "World Map", "url": "https://www.inkitt.com/stories/1/chapters/1"},
                {"chapter_number": 2, "title": "Chapter 2", "url": "https://www.inkitt.com/stories/1/chapters/2"},
            ]

        def _same_url(self, first: str, second: str) -> bool:
            return first == second

        def _extract_chapter_content(self, soup: BeautifulSoup) -> str:
            return "\n\n".join(paragraph.get_text(" ", strip=True) for paragraph in soup.select("article p"))

        def _extract_chapter_title(self, soup: BeautifulSoup) -> str:
            title = soup.select_one("h2")
            return title.get_text(" ", strip=True) if title else ""

    monkeypatch.setattr("api.services.inkitt_batch_service.InkittSpider", FakeSpider)
    row = InkittBatchRow(
        index=1,
        genre="Action",
        genre_slug="action",
        title="Map Then Story",
        url="https://www.inkitt.com/stories/1",
        story_id="1",
        status="queued",
    )

    result = service._crawl_one("aaaaaaaa", row, tmp_path, 0)

    assert result["status"] == "completed"
    assert result["total_chapters"] == 2
    assert result["crawled_chapters"] == 1
    assert result["error"] == ""
    assert any("skipped chapter 1" in line for line in logs)

    info = json.loads((tmp_path / result["metadata_file"]).read_text(encoding="utf-8"))
    assert info["skipped_chapters"][0]["chapter_number"] == 1


def test_summary_estimates_remaining_crawl_time_across_whole_batch(tmp_path) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._batch_root = tmp_path
    rows = [
        InkittBatchRow(
            index=1,
            genre="Action",
            genre_slug="action",
            title="Done",
            url="https://www.inkitt.com/stories/1",
            story_id="1",
            status="completed",
            total_chapters=10,
            crawled_chapters=10,
        ),
        InkittBatchRow(
            index=2,
            genre="Action",
            genre_slug="action",
            title="Partial",
            url="https://www.inkitt.com/stories/2",
            story_id="2",
            status="queued",
            total_chapters=20,
            crawled_chapters=5,
        ),
        InkittBatchRow(
            index=3,
            genre="Action",
            genre_slug="action",
            title="Waiting",
            url="https://www.inkitt.com/stories/3",
            story_id="3",
            status="queued",
            total_chapters=30,
            crawled_chapters=0,
        ),
    ]
    state = InkittBatchState(
        batch_id="aaaaaaaa",
        created_by_user_id=None,
        rows=rows,
        phase="ready",
        output_dir=str(tmp_path / "aaaaaaaa"),
        crawl_runs=[{
            "run_id": "run123",
            "started_at": "2026-07-09 10:00:00",
            "finished_at": "2026-07-09 10:10:00",
            "target_stories": 3,
            "completed_count": 1,
            "failed_count": 0,
            "skipped_count": 0,
            "status": "completed",
        }],
    )

    summary = service._summary_locked(state)
    estimate = summary["crawl_estimate"]

    assert summary["crawled_chapters"] == 15
    assert estimate["remaining_stories"] == 2
    assert estimate["remaining_chapters"] == 45
    assert estimate["estimated_total_chapters"] == 60
    assert estimate["elapsed_seconds"] == 600
    assert estimate["chapters_per_hour"] == 90.0
    assert estimate["estimated_remaining_seconds"] == 1800
    assert estimate["source"] == "all_time_chapters"


def test_active_crawl_run_summary_reports_live_story_and_chapter_progress() -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    state = InkittBatchState(
        batch_id="aaaaaaaa",
        created_by_user_id=None,
        phase="crawling",
        rows=[
            InkittBatchRow(
                index=1,
                genre="Action",
                genre_slug="action",
                title="Done",
                url="https://www.inkitt.com/stories/1",
                story_id="1",
                status="completed",
                crawl_run_id="run123",
                total_chapters=10,
                crawled_chapters=10,
            ),
            InkittBatchRow(
                index=2,
                genre="Action",
                genre_slug="action",
                title="In progress",
                url="https://www.inkitt.com/stories/2",
                story_id="2",
                status="crawling",
                crawl_run_id="run123",
                total_chapters=20,
                crawled_chapters=7,
            ),
            InkittBatchRow(
                index=3,
                genre="Action",
                genre_slug="action",
                title="Queued",
                url="https://www.inkitt.com/stories/3",
                story_id="3",
                status="queued",
                crawl_run_id="run123",
            ),
        ],
        crawl_runs=[{
            "run_id": "run123",
            "started_at": "2026-07-10 10:00:00",
            "finished_at": None,
            "target_stories": 3,
            "completed_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "status": "crawling",
        }],
    )

    run = service._crawl_run_summaries_locked(state)[0]

    assert run["processed_count"] == 1
    assert run["completed_count"] == 1
    assert run["crawled_chapters"] == 17
    assert run["total_chapters"] == 30


def test_summary_adjusts_remaining_chapters_by_observed_yield(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("api.services.inkitt_batch_service.INKITT_ESTIMATE_YIELD_CONFIDENCE_STORIES", 3)
    service = InkittBatchService.__new__(InkittBatchService)
    service._batch_root = tmp_path
    rows = [
        InkittBatchRow(
            index=1,
            genre="Action",
            genre_slug="action",
            title="Done 1",
            url="https://www.inkitt.com/stories/1",
            story_id="1",
            status="completed",
            total_chapters=10,
            crawled_chapters=10,
        ),
        InkittBatchRow(
            index=2,
            genre="Action",
            genre_slug="action",
            title="Done 2",
            url="https://www.inkitt.com/stories/2",
            story_id="2",
            status="completed",
            total_chapters=10,
            crawled_chapters=10,
        ),
        InkittBatchRow(
            index=3,
            genre="Action",
            genre_slug="action",
            title="Skipped",
            url="https://www.inkitt.com/stories/3",
            story_id="3",
            status="skipped",
            total_chapters=0,
            crawled_chapters=0,
        ),
        InkittBatchRow(
            index=4,
            genre="Action",
            genre_slug="action",
            title="Remaining",
            url="https://www.inkitt.com/stories/4",
            story_id="4",
            status="queued",
            total_chapters=90,
            crawled_chapters=0,
        ),
    ]
    state = InkittBatchState(
        batch_id="aaaaaaaa",
        created_by_user_id=None,
        rows=rows,
        phase="ready",
        output_dir=str(tmp_path / "aaaaaaaa"),
        crawl_runs=[{
            "run_id": "run123",
            "started_at": "2026-07-09 10:00:00",
            "finished_at": "2026-07-09 10:10:00",
            "target_stories": 4,
            "completed_count": 2,
            "failed_count": 0,
            "skipped_count": 1,
            "status": "completed",
        }],
    )

    estimate = service._summary_locked(state)["crawl_estimate"]

    assert estimate["known_remaining_chapters"] == 90
    assert estimate["raw_remaining_chapters"] == 90
    assert estimate["chapter_yield_ratio"] == 0.6667
    assert estimate["remaining_chapters"] == 60
    assert estimate["estimated_total_chapters"] == 80


def test_crawl_rows_stops_taking_new_rows_after_pause(tmp_path, monkeypatch) -> None:
    service = InkittBatchService.__new__(InkittBatchService)
    service._lock = threading.Lock()
    service._batches = {}
    service._batch_root = tmp_path
    service._index_file = tmp_path / "batch_index.json"
    service._last_persist_at = 0.0
    service._history_lock = threading.Lock()
    service._discovered_story_index_file = tmp_path / "discovered_story_index.json"
    service._exported_story_index_file = tmp_path / "exported_story_index.json"

    output_dir = tmp_path / "output"
    output_dir.mkdir()
    rows = [
        InkittBatchRow(
            index=index,
            genre="Action",
            genre_slug="action",
            title=f"Story {index}",
            url=f"https://www.inkitt.com/stories/{index}",
            story_id=str(index),
            status="queued",
            crawl_run_id="run123",
        )
        for index in range(1, 4)
    ]
    state = InkittBatchState(
        batch_id="aaaaaaaa",
        created_by_user_id=None,
        rows=rows,
        phase="crawling",
        crawl_concurrency=1,
        output_dir=str(output_dir),
        crawl_runs=[{
            "run_id": "run123",
            "started_at": "2026-07-08 10:00:00",
            "finished_at": None,
            "target_stories": 3,
            "completed_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "status": "crawling",
        }],
    )
    service._batches[state.batch_id] = state

    calls: list[int] = []

    def fake_crawl_one(batch_id, row, _output_dir, _delay):
        calls.append(row.index)
        with service._lock:
            service._batches[batch_id].cancel_requested = True
        return {"status": "queued", "error": ""}

    monkeypatch.setattr(service, "_crawl_one", fake_crawl_one)

    service._crawl_thread("aaaaaaaa", "run123")

    assert calls == [1]
    assert [row.status for row in rows] == ["queued", "queued", "queued"]
    assert state.phase == "ready"
    assert state.cancel_requested is False
    assert state.crawl_runs[0]["status"] == "paused"
