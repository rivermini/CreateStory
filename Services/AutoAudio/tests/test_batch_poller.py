from core.models import AutoAudioSession
from core.orchestrator.batch import BatchPoller


class FakeBedReadClient:
    def __init__(self, job):
        self.job = job

    def get_batch_job(self, batch_id):
        return self.job


def make_session():
    return AutoAudioSession(
        session_id="test-session",
        created_by_user_id=None,
        phase="auto_scan",
        test_mode=False,
        voice=None,
        status="running",
        current_step=0,
        current_step_desc="",
        current_story="Story",
        progress={"done": 0, "total": 0},
        chapter_progress={"done": 0, "total": 0},
        stories_missing_audio=[],
        logs=[],
        started_at=None,
        finished_at=None,
        error="",
    )


def test_poller_treats_failed_terminal_batch_as_failure():
    job = {
        "status": "failed",
        "chapters": [
            {"chapter_number": 1, "status": "failed", "progress_pct": 0},
            {"chapter_number": 2, "status": "failed", "progress_pct": 0},
        ],
    }
    session = make_session()
    poller = BatchPoller(FakeBedReadClient(job))

    success, completed_files = poller.poll_until_done(session, "batch-1")

    assert success is False
    assert completed_files == []
    assert any(
        log["level"] == "error"
        and "2/2 chapters failed" in log["message"]
        for log in session.logs
    )
