import pytest
from unittest.mock import MagicMock
from api.services.drive_service.drive_service import DriveSyncService
from api.services.drive_service._drive_api import DriveAPIMixin

def test_parse_max_chapter_file_not_found(monkeypatch):
    svc = DriveSyncService.__new__(DriveSyncService)
    
    # Mock methods
    svc._find_metadata_file = MagicMock(return_value=None)
    
    logs = []
    svc._append_log = lambda level, msg, name, job_id=None: logs.append((level, msg))
    
    res = svc._parse_max_chapter_file(None, "folder-id", "Story Title")
    assert res is None
    assert any("not found" in m for l, m in logs)

def test_parse_max_chapter_file_empty(monkeypatch):
    svc = DriveSyncService.__new__(DriveSyncService)
    
    svc._find_metadata_file = MagicMock(return_value={"id": "file-123", "name": "max_chapter.md"})
    monkeypatch.setattr(DriveAPIMixin, "_get_file_content", lambda self, ds, fid: "   \n\r  ")
    
    logs = []
    svc._append_log = lambda level, msg, name, job_id=None: logs.append((level, msg))
    
    res = svc._parse_max_chapter_file(None, "folder-id", "Story Title")
    assert res is None
    assert any("empty" in m for l, m in logs)

def test_parse_max_chapter_file_valid_number(monkeypatch):
    svc = DriveSyncService.__new__(DriveSyncService)
    
    svc._find_metadata_file = MagicMock(return_value={"id": "file-123", "name": "max_chapter.md"})
    monkeypatch.setattr(DriveAPIMixin, "_get_file_content", lambda self, ds, fid: "\ufeff42\n")
    
    logs = []
    svc._append_log = lambda level, msg, name, job_id=None: logs.append((level, msg))
    
    res = svc._parse_max_chapter_file(None, "folder-id", "Story Title")
    assert res == 42
    assert len(logs) == 0

def test_parse_max_chapter_file_contains_text_with_digits(monkeypatch):
    svc = DriveSyncService.__new__(DriveSyncService)
    
    svc._find_metadata_file = MagicMock(return_value={"id": "file-123", "name": "max_chapter.md"})
    monkeypatch.setattr(DriveAPIMixin, "_get_file_content", lambda self, ds, fid: "Chapters count is 105")
    
    logs = []
    svc._append_log = lambda level, msg, name, job_id=None: logs.append((level, msg))
    
    res = svc._parse_max_chapter_file(None, "folder-id", "Story Title")
    assert res == 105
    assert any(l == "warning" and "contains non-numeric text" in m for l, m in logs)

def test_parse_max_chapter_file_contains_text_no_digits(monkeypatch):
    svc = DriveSyncService.__new__(DriveSyncService)
    
    svc._find_metadata_file = MagicMock(return_value={"id": "file-123", "name": "max_chapter.md"})
    monkeypatch.setattr(DriveAPIMixin, "_get_file_content", lambda self, ds, fid: "invalid text")
    
    logs = []
    svc._append_log = lambda level, msg, name, job_id=None: logs.append((level, msg))
    
    res = svc._parse_max_chapter_file(None, "folder-id", "Story Title")
    assert res is None
    assert any(l == "warning" and "contains non-numeric text" in m for l, m in logs)


def test_parse_max_chapter_content():
    from api.services.drive_service._metadata_update import _parse_max_chapter_content
    
    assert _parse_max_chapter_content("45") == 45
    assert _parse_max_chapter_content("  120\n") == 120
    assert _parse_max_chapter_content("Chapter 99") == 99
    assert _parse_max_chapter_content("invalid") is None
    assert _parse_max_chapter_content(None) is None


def test_metadata_update_max_chapter_diff():
    from api.services.drive_service._metadata_update import _compute_differences
    
    # Matching values
    folder_vals = {"max_chapter": 50, "main_category": "Fantasy", "sub_category": None, "free_chapters_count": 0, "push_title": None, "push_content": None, "synopsis": None, "tags": []}
    server_vals = {"max_chapter": 50, "main_category": "Fantasy", "sub_categories": [], "free_chapters_count": 0, "push_title": None, "push_content": None, "synopsis": None, "tags": []}
    
    diffs = _compute_differences(folder_vals, server_vals)
    assert not any(d["field"] == "max_chapter" for d in diffs)
    
    # Different values
    folder_vals["max_chapter"] = 60
    diffs = _compute_differences(folder_vals, server_vals)
    max_ch_diff = next((d for d in diffs if d["field"] == "max_chapter"), None)
    assert max_ch_diff is not None
    assert max_ch_diff["folder_value"] == 60
    assert max_ch_diff["server_value"] == 50


def test_extract_server_values_with_max_chapter():
    from api.services.drive_service._metadata_update import _extract_server_values
    
    story = {
        "maxChapter": 72,
        "freeChaptersCount": 5,
        "synopsis": "Cool novel",
        "tags": ["romance"],
        "mainCategory": {"name": "Romance"},
    }
    vals = _extract_server_values(story)
    assert vals["max_chapter"] == 72


def test_metadata_update_max_chapter_missing_server_key():
    from api.services.drive_service._metadata_update import _compute_differences
    
    # server_vals does not have max_chapter (to mock old cached values)
    folder_vals = {"max_chapter": 15, "main_category": "Fantasy", "sub_category": None, "free_chapters_count": 0, "push_title": None, "push_content": None, "synopsis": None, "tags": []}
    server_vals = {"main_category": "Fantasy", "sub_categories": [], "free_chapters_count": 0, "push_title": None, "push_content": None, "synopsis": None, "tags": []}
    
    diffs = _compute_differences(folder_vals, server_vals)
    max_ch_diff = next((d for d in diffs if d["field"] == "max_chapter"), None)
    assert max_ch_diff is not None
    assert max_ch_diff["folder_value"] == 15
    assert max_ch_diff["server_value"] == 0


def test_metadata_update_cache_miss_when_missing_max_chapter(monkeypatch):
    from api.services.drive_service._metadata_update import _batch_get_server_values
    
    svc = DriveSyncService.__new__(DriveSyncService)
    
    # Old cache item missing 'max_chapter'
    old_cached = {
        "main_category": "Fantasy",
        "sub_categories": [],
        "free_chapters_count": 0,
        "push_title": None,
        "push_content": None,
        "synopsis": None,
        "tags": [],
    }
    
    # Setup cache: mock retrieve
    import threading
    cache = {"story-123|": old_cached}
    svc._metadata_server_values_cache = cache
    svc._metadata_server_values_cache_lock = threading.Lock()
    
    # Mock fallback db repository so it does not connect
    svc._repo = MagicMock()
    svc._repo.load_app_setting = MagicMock(return_value={"entries": cache})
    svc._repo.save_app_setting = MagicMock()
    
    # Mock server fetch
    fetched_story = {
        "id": "story-123",
        "title": "A Story",
        "maxChapter": 42,
        "freeChaptersCount": 0,
        "synopsis": None,
        "tags": [],
        "mainCategory": {"name": "Fantasy"},
    }
    
    # Patch _batch_fetch_server_stories to return the fetched story (mocking actual server hit)
    from api.services.drive_service import _metadata_update as mu_module
    monkeypatch.setattr(mu_module, "_batch_fetch_server_stories", lambda service, ids: {"story-123": fetched_story})
    
    # Request values
    res = _batch_get_server_values(svc, [{"id": "story-123"}])
    
    # Verify that story-123 was fetched and cache was updated with max_chapter
    assert "story-123" in res
    assert res["story-123"]["max_chapter"] == 42
    assert "story-123|" in cache
    assert cache["story-123|"]["max_chapter"] == 42



