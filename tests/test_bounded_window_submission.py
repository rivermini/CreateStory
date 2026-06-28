"""Regression test for the bounded-window TTS chapter submission.

Guards the fix for the production `TTSCapacityError('Global TTS queue capacity
reached.')` cascade: a story with more chapters than the global TTS queue cap
must NOT lose its overflow chapters. Chapters that can't be admitted right away
are left `pending` and submitted by the poller as the queue drains — never marked
`failed` and never charged against the per-chapter retry budget.
"""
import os
import types
from threading import Lock

# bedread_service imports api.db at module load, which needs a DATABASE_URL.
# Use an in-process sqlite URL; the test never opens a connection (it skips
# __init__ via object.__new__).
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from api.services.bedread_service import BedReadService, BatchJob, ChapterTask  # noqa: E402
from api.services.tts_service import TTSCapacityError  # noqa: E402


def _make_service(batch):
    svc = object.__new__(BedReadService)  # skip DB-heavy __init__
    svc._lock = Lock()
    svc._submit_lock = Lock()
    svc._chapter_maps = {batch.batch_id: {}}
    svc._batch_jobs = {batch.batch_id: batch}
    svc._persist_jobs = lambda: None
    return svc


def test_overflow_story_defers_instead_of_failing():
    cap, n = 100, 130
    chapters = [ChapterTask(chapter_number=i, title=f"Ch{i}", status="pending") for i in range(1, n + 1)]
    batch = BatchJob(batch_id="b1", story_id="s1", story_title="Big", chapters=chapters, status="running")
    svc = _make_service(batch)

    sim = {"active": 0}  # simulated {queued+processing} count in the shared TTS queue
    svc._tts_service = types.SimpleNamespace(
        get_admission_headroom=lambda: max(0, cap - sim["active"]),
    )

    def fake_queue(batch_id, chapter_number, story_id, voice, lang, speed, format, chapter_map=None):
        if sim["active"] >= cap:
            raise TTSCapacityError("Global TTS queue capacity reached.")
        sim["active"] += 1
        for c in batch.chapters:
            if c.chapter_number == chapter_number:
                c.status = "queued"
                c.job_id = f"job-{chapter_number}"
        return True

    svc._queue_chapter_tts_job = fake_queue

    # Initial submission fills exactly the cap; the rest defer as pending.
    svc._submit_pending_chapters("b1")
    assert sum(c.status == "queued" for c in chapters) == cap
    assert sum(c.status == "pending" for c in chapters) == n - cap
    assert not any(c.status == "failed" for c in chapters)
    assert all(c.retry_count == 0 for c in chapters)

    # Drain 2 jobs per poll tick and let the poller top up until everything is done.
    def drain(k):
        done = 0
        for c in batch.chapters:
            if done >= k:
                break
            if c.status == "queued":
                c.status = "completed"
                sim["active"] -= 1
                done += 1

    ticks = 0
    while any(c.status in ("pending", "queued") for c in chapters):
        drain(2)
        svc._submit_pending_chapters("b1")
        ticks += 1
        assert ticks <= 10_000, "submission did not converge"

    assert sum(c.status == "completed" for c in chapters) == n
    assert not any(c.status == "failed" for c in chapters)
    assert all(c.retry_count == 0 for c in chapters)


def test_no_pending_is_a_noop():
    chapters = [ChapterTask(chapter_number=1, title="Ch1", status="completed")]
    batch = BatchJob(batch_id="b2", story_id="s2", story_title="Done", chapters=chapters, status="running")
    svc = _make_service(batch)

    called = {"n": 0}

    def fake_queue(*a, **k):
        called["n"] += 1
        return True

    svc._queue_chapter_tts_job = fake_queue
    svc._tts_service = types.SimpleNamespace(get_admission_headroom=lambda: 100)

    svc._submit_pending_chapters("b2")
    assert called["n"] == 0  # nothing pending -> no submissions, no headroom check needed


def test_zero_headroom_defers_all():
    chapters = [ChapterTask(chapter_number=i, title=f"Ch{i}", status="pending") for i in range(1, 6)]
    batch = BatchJob(batch_id="b3", story_id="s3", story_title="Full", chapters=chapters, status="running")
    svc = _make_service(batch)

    def fake_queue(*a, **k):
        raise AssertionError("should not submit when headroom is 0")

    svc._queue_chapter_tts_job = fake_queue
    svc._tts_service = types.SimpleNamespace(get_admission_headroom=lambda: 0)

    svc._submit_pending_chapters("b3")
    assert all(c.status == "pending" for c in chapters)
    assert all(c.retry_count == 0 for c in chapters)
