from __future__ import annotations

import pytest

from api.services.drive_service import _drive_api as drive_api_module
from api.services.drive_service._watermark_processing import WatermarkProcessingResult
from api.services.drive_service.drive_service import DriveSyncService


class _DrivePlaceholder:
    pass


@pytest.mark.parametrize(
    ("asset_type", "method_name", "finder_name", "uploader_name", "filename", "url_key"),
    [
        (
            "banner",
            "upload_banner_for_new_story",
            "_find_banner1_file",
            "_upload_banner_image",
            "banner.png",
            "banner_url",
        ),
        (
            "intro",
            "upload_intro_for_new_story",
            "_find_intro1_file",
            "_upload_intro_image",
            "intro.jpg",
            "intro_url",
        ),
    ],
)
def test_new_story_images_are_cleaned_between_drive_download_and_upload(
    monkeypatch,
    asset_type: str,
    method_name: str,
    finder_name: str,
    uploader_name: str,
    filename: str,
    url_key: str,
) -> None:
    service = DriveSyncService.__new__(DriveSyncService)
    service._build_drive_service = lambda: _DrivePlaceholder()
    setattr(
        service,
        finder_name,
        lambda _drive, _folder_id, candidate: {"id": "drive-image", "name": filename}
        if candidate == filename
        else None,
    )
    monkeypatch.setattr(
        drive_api_module.DriveAPIMixin,
        "_download_cover_image_bytes",
        lambda *_args: b"ORIGINAL-IMAGE",
    )

    processing_calls: list[tuple[bytes, str, str]] = []

    def process(image_bytes: bytes, image_filename: str, image_asset_type: str):
        processing_calls.append((image_bytes, image_filename, image_asset_type))
        return WatermarkProcessingResult(
            image_bytes=b"CLEANED-IMAGE",
            applied=True,
            applied_passes=2,
            processing_ms=25,
            stop_reason="no-match",
        )

    service._process_watermarks_for_upload = process
    service._log_watermark_processing_result = lambda *_args: None
    uploaded: list[bytes] = []

    def upload(_story_id: str, image_bytes: bytes, _filename: str, _content_type: str):
        uploaded.append(image_bytes)
        return f"https://main.example.com/{filename}"

    setattr(service, uploader_name, upload)

    result = getattr(service, method_name)("story-id", "folder-id", job_id="job-id")

    assert result["uploaded"] is True
    assert result[url_key] == f"https://main.example.com/{filename}"
    assert processing_calls == [(b"ORIGINAL-IMAGE", filename, asset_type)]
    assert uploaded == [b"CLEANED-IMAGE"]


def test_cover_is_cleaned_between_drive_download_and_upload() -> None:
    service = DriveSyncService.__new__(DriveSyncService)
    service._extract_story_name = lambda _name: "Existing Story"
    service._find_synopsis_file = lambda *_args: None
    service._parse_tags_file = lambda *_args: []
    service._parse_category_file = lambda *_args: (None, [])
    service._extract_reference_platform = lambda *_args: None
    service._find_push_file = lambda *_args: None
    service._find_free_md_file = lambda *_args: None
    service._parse_length_file = lambda *_args, **_kwargs: None
    service._find_story_by_title = lambda *_args: "story-id"
    service._find_cover_image_file = lambda *_args: {"id": "cover-file", "name": "cover.jpg"}
    service._download_cover_image_bytes = lambda *_args: b"ORIGINAL-COVER"
    service._get_existing_chapter_indices = lambda *_args: set()
    service._find_chapters_extended_folder = lambda *_args: None
    service._list_files_in_folder = lambda *_args: []
    service._parse_max_chapter_file = lambda *_args, **_kwargs: None
    service.append_job_log = lambda *_args: None
    service._log_watermark_processing_result = lambda *_args: None
    processing_calls: list[tuple[bytes, str, str]] = []

    def process(image_bytes: bytes, filename: str, asset_type: str):
        processing_calls.append((image_bytes, filename, asset_type))
        return WatermarkProcessingResult(
            image_bytes=b"CLEANED-COVER",
            applied=True,
            applied_passes=2,
            processing_ms=25,
            stop_reason="no-match",
        )

    service._process_watermarks_for_upload = process
    uploaded: list[bytes] = []

    def upload(_story_id: str, image_bytes: bytes, _filename: str):
        uploaded.append(image_bytes)
        return "https://main.example.com/cover.jpg"

    service._upload_cover_image = upload

    result = service._process_story_folder_with_job(
        _DrivePlaceholder(),
        {"id": "folder-id", "name": "DONE_nw - Existing Story"},
        "job-id",
    )

    assert result == (0, 0, True, "")
    assert processing_calls == [(b"ORIGINAL-COVER", "cover.jpg", "cover")]
    assert uploaded == [b"CLEANED-COVER"]
