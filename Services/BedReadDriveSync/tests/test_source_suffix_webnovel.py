from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("INTERNAL_SERVICE_TOKEN", "test-internal-service-token")

from api.routes.drive_sync.utils import _is_valid_upload_format
from api.services.drive_service.drive_service import DriveSyncService


def test_webnovel_source_suffix_parsing() -> None:
    svc = DriveSyncService.__new__(DriveSyncService)

    assert svc._extract_story_name("DONE_my-story_wn") == "my-story"
    assert svc._extract_reference_platform("DONE_my-story_wn") == "WebNovel"
    assert svc._extract_reference_platform("DONE_my-story_webnovel") == "WebNovel"


def test_webnovel_upload_format_tokens() -> None:
    assert _is_valid_upload_format("DONE_my-story_wn - My Story") == (True, "wn", "WebNovel")
    assert _is_valid_upload_format("DONE_my-story_webnovel - My Story") == (True, "wn", "WebNovel")


def test_jobnib_source_suffix_and_upload_tokens() -> None:
    svc = DriveSyncService.__new__(DriveSyncService)

    assert svc._extract_story_name("DONE_my-story_jn") == "my-story"
    assert svc._extract_reference_platform("DONE_my-story_jn") == "Jobnib"
    assert svc._extract_reference_platform("DONE_my-story_jobnib") == "Jobnib"
    assert _is_valid_upload_format("DONE_my-story_jn - My Story") == (True, "jn", "Jobnib")
    assert _is_valid_upload_format("DONE_my-story_jobnib - My Story") == (True, "jn", "Jobnib")
