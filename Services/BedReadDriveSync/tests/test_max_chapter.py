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
