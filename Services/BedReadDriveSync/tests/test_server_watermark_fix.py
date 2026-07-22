from __future__ import annotations

from types import SimpleNamespace

from api.models.drive_sync import JobLogEntry, JobStatus, SyncJob
from api.services.drive_service._server_watermark_fix import (
    _authoritative_story_asset_url,
    _fresh_asset_url,
)
from api.services.drive_service._watermark_processing import WatermarkProcessingResult
from api.services.drive_service.drive_service import DriveSyncService


def _job() -> SyncJob:
    return SyncJob(
        id="repair-job",
        kind="watermark_picture_fix",
        status=JobStatus.QUEUED,
        folder_id="server:story-1",
        folder_name="server-story",
        display_name="Example Story - Fix watermark pictures",
        created_at="2026-07-21T00:00:00+00:00",
        payload={"story_id": "story-1", "story_title": "Example Story"},
    )


def _service(job: SyncJob):
    service = DriveSyncService.__new__(DriveSyncService)
    updates: list[dict] = []
    logs: list[tuple[str, str]] = []

    def update_job(_job_id: str, **fields):
        updates.append(fields)
        for name, value in fields.items():
            if hasattr(job, name):
                setattr(job, name, value)
        return True

    service.get_job = lambda _job_id: job
    service.update_job = update_job
    service.append_job_log = lambda _job_id, level, message: logs.append((level, message))
    service._get_server_story_picture_detail = lambda _story_id: {
        "id": "story-1",
        "title": "Example Story",
        "coverImageUrl": "https://cdn.test/cover.jpg",
        "bannerImageUrl": "https://cdn.test/banner.png",
        "introImageUrl": "https://cdn.test/intro.webp",
    }
    service._download_server_picture = lambda _url, asset: (
        f"ORIGINAL-{asset}".encode(),
        f"{asset}.jpg",
        "image/jpeg",
    )
    service._known_watermark_fix_output_urls = lambda: {
        "cover": set(),
        "banner": set(),
        "intro": set(),
    }
    service._known_intro_url = lambda *_args: None
    return service, updates, logs


def test_fresh_asset_url_bypasses_digitalocean_cdn_and_cache() -> None:
    refreshed = _fresh_asset_url(
        "https://myapp-assets.sfo3.cdn.digitaloceanspaces.com/intro/current.webp?version=2"
    )

    assert refreshed.startswith(
        "https://myapp-assets.sfo3.digitaloceanspaces.com/intro/current.webp?"
    )
    assert "version=2" in refreshed
    assert "_wm_refresh=" in refreshed


def test_successful_story_detail_explicitly_overrides_stale_list_banner_with_missing() -> None:
    raw = {"bannerImageUrl": "https://cdn.test/stale-banner.jpg"}
    detail = {"id": "story-1", "bannerImageUrl": None}

    assert _authoritative_story_asset_url(raw, detail, "bannerImageUrl") is None


def test_story_list_asset_is_only_used_when_detail_request_failed() -> None:
    raw = {"bannerImageUrl": "https://cdn.test/list-banner.jpg"}
    detail = {"detailError": "temporary detail failure"}

    assert (
        _authoritative_story_asset_url(raw, detail, "bannerImageUrl")
        == "https://cdn.test/list-banner.jpg"
    )


def test_story_picture_detail_uses_web_admin_representation() -> None:
    service = DriveSyncService.__new__(DriveSyncService)
    service._config = SimpleNamespace(main_be_api_base_url="https://api.test")
    service._main_be_headers = lambda: {
        "Authorization": "Bearer token",
        "x-platform": "android",
    }
    captured_headers: dict[str, str] = {}

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"data": {"id": "story-1", "bannerImageUrl": None}}

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        @staticmethod
        def get(_url, *, headers, params):
            captured_headers.update(headers)
            assert "_wm_refresh" in params
            return Response()

    service._main_be_client = lambda **_kwargs: Client()

    detail = service._get_server_story_picture_detail("story-1")

    assert detail["bannerImageUrl"] is None
    assert "x-platform" not in captured_headers


def test_server_repair_checks_all_assets_and_uploads_only_changed_images() -> None:
    job = _job()
    service, updates, logs = _service(job)
    processed: list[str] = []
    uploaded: list[tuple[str, bytes]] = []

    def process(image_bytes: bytes, _filename: str, asset_type: str):
        processed.append(asset_type)
        applied = asset_type != "banner"
        return WatermarkProcessingResult(
            image_bytes=b"CLEANED-" + image_bytes,
            applied=applied,
            applied_passes=2 if applied else 0,
            processing_ms=25,
            stop_reason="no-match",
        )

    service._process_watermarks_for_upload = process
    service._upload_cleaned_server_picture = (
        lambda _story_id, asset, image_bytes, _filename, _content_type:
        uploaded.append((asset, image_bytes)) or f"https://cdn.test/new-{asset}.jpg"
    )

    service.sync_watermark_picture_fix_as_job(job.id, "story-1")

    assert processed == ["cover", "banner", "intro"]
    assert [asset for asset, _bytes in uploaded] == ["cover", "intro"]
    assert updates[-1]["status"] == JobStatus.SUCCESS
    assert updates[-1]["payload"]["summary"] == {
        "fixed": 2,
        "already_clean": 1,
        "needs_review": 0,
        "missing": 0,
        "failed": 0,
    }
    assert updates[-1]["payload"]["assets"]["banner"]["status"] == "no_watermark"
    assert any("left unchanged" in message for _level, message in logs)


def test_server_repair_continues_after_one_asset_failure_and_marks_partial_job_error() -> None:
    job = _job()
    service, updates, logs = _service(job)
    processed: list[str] = []
    uploaded: list[str] = []

    def process(image_bytes: bytes, _filename: str, asset_type: str):
        processed.append(asset_type)
        if asset_type == "banner":
            raise RuntimeError("detector unavailable")
        return WatermarkProcessingResult(
            image_bytes=b"CLEANED-" + image_bytes,
            applied=True,
            applied_passes=1,
            processing_ms=10,
            stop_reason="no-match",
        )

    service._process_watermarks_for_upload = process
    service._upload_cleaned_server_picture = (
        lambda _story_id, asset, _image_bytes, _filename, _content_type:
        uploaded.append(asset) or f"https://cdn.test/new-{asset}.jpg"
    )

    service.sync_watermark_picture_fix_as_job(job.id, "story-1")

    assert processed == ["cover", "banner", "intro"]
    assert uploaded == ["cover", "intro"]
    assert updates[-1]["status"] == JobStatus.ERROR
    assert updates[-1]["payload"]["summary"]["failed"] == 1
    assert updates[-1]["payload"]["assets"]["banner"]["status"] == "error"
    assert "detector unavailable" in updates[-1]["payload"]["assets"]["banner"]["error"]
    assert any(level == "error" and "Banner" in message for level, message in logs)


def test_server_repair_processes_only_selected_picture_types() -> None:
    job = _job()
    job.payload["selected_assets"] = ["banner", "intro"]
    service, updates, _logs = _service(job)
    processed: list[str] = []
    uploaded: list[str] = []

    def process(image_bytes: bytes, _filename: str, asset_type: str):
        processed.append(asset_type)
        return WatermarkProcessingResult(
            image_bytes=b"CLEANED-" + image_bytes,
            applied=True,
            applied_passes=1,
            processing_ms=10,
            stop_reason="no-match",
        )

    service._process_watermarks_for_upload = process
    service._upload_cleaned_server_picture = (
        lambda _story_id, asset, _image_bytes, _filename, _content_type:
        uploaded.append(asset) or f"https://cdn.test/new-{asset}.jpg"
    )

    service.sync_watermark_picture_fix_as_job(job.id, "story-1")

    assert processed == ["banner", "intro"]
    assert uploaded == ["banner", "intro"]
    assert set(updates[-1]["payload"]["assets"]) == {"banner", "intro"}
    assert updates[-1]["payload"]["selected_assets"] == ["banner", "intro"]
    assert updates[-1]["payload"]["summary"] == {
        "fixed": 2,
        "already_clean": 0,
        "needs_review": 0,
        "missing": 0,
        "failed": 0,
    }


def test_server_repair_never_processes_its_own_completed_output_again() -> None:
    job = _job()
    job.payload["selected_assets"] = ["cover"]
    service, updates, logs = _service(job)
    service._get_server_story_picture_detail = lambda _story_id: {
        "id": "story-1",
        "title": "Example Story",
        "coverImageUrl": "https://cdn.test/already-fixed.jpg",
    }
    service._known_watermark_fix_output_urls = lambda: {
        "cover": {"https://cdn.test/already-fixed.jpg"},
        "banner": set(),
        "intro": set(),
    }
    processed: list[str] = []
    service._process_watermarks_for_upload = (
        lambda _bytes, _filename, asset: processed.append(asset)
    )

    service.sync_watermark_picture_fix_as_job(job.id, "story-1")

    assert processed == []
    assert updates[-1]["status"] == JobStatus.SUCCESS
    assert updates[-1]["payload"]["assets"]["cover"]["skip_reason"] == "already-repaired-output"
    assert updates[-1]["payload"]["summary"]["already_clean"] == 1
    assert any("already a completed repair output" in message for _level, message in logs)


def test_intro_url_falls_back_to_persistent_upload_log_when_story_api_omits_it() -> None:
    service = DriveSyncService.__new__(DriveSyncService)
    upload_job = SyncJob(
        id="upload-job",
        kind="upload_single",
        status=JobStatus.SUCCESS,
        folder_id="drive-folder",
        folder_name="DONE_TEST2_ink - AutoInkit",
        display_name="AutoInkit",
        created_at="2026-07-21T00:00:00+00:00",
        logs=[JobLogEntry(
            timestamp="2026-07-21T00:00:00+00:00",
            level="info",
            message="Intro image uploaded: https://cdn.test/intro/autoinkit.webp",
        )],
    )
    service.list_jobs = lambda *_args: ([upload_job], 1, {})

    assert service._known_intro_url("story-1", "AutoInkit") == "https://cdn.test/intro/autoinkit.webp"
