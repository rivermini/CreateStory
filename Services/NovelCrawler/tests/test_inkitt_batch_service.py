from __future__ import annotations

import sys
import threading
import types

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
    extract_completed_story_refs,
    extract_completed_story_refs_from_api,
    extract_story_quality,
)


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

    result = service._discover_genre("action", "Action", 1000, 2)

    assert len(result.refs) == 20
    assert result.pages_checked == 2
    assert result.raw_stories_seen == 20
    assert result.stop_reason == "HTTP 429 on page 2 (Retry-After: 60) after 2 retries"
    assert session.calls == 4


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
