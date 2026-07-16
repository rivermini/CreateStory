import asyncio
import os

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("INTERNAL_SERVICE_TOKEN", "test-internal-service-token")

from api.routes.drive_sync import uploadability


def _folder(folder_id: str, prefix: str, code: str, title: str) -> dict:
    return {
        "id": folder_id,
        "name": f"{prefix}_{code}_wp - {title}",
        "prefix": prefix,
        "display_name": title,
        "is_completed": prefix in {"DONE", "EXTENDED"},
    }


class _FakeService:
    def get_config(self):
        return object()

    def _build_drive_service(self):
        return object()

    def _batch_check_duplicates_and_count_extended(self, _drive_service, _folder_ids):
        return ({}, {}, {}, {}, {}, {}, {})

    def _load_jobs_raw(self):
        return []


def test_check_uploadable_reports_each_duplicated_drive_story_title(monkeypatch):
    folders = [
        _folder("folder-1", "DONE", "ABC", "Story1"),
        _folder("folder-2", "DONE", "ABCDE", "Story1"),
    ]
    service = _FakeService()

    async def fake_load(_service, *, refresh_drive_folders=False):
        assert refresh_drive_folders is True
        return folders, []

    monkeypatch.setattr(uploadability, "get_drive_sync_service", lambda: service)
    monkeypatch.setattr(uploadability, "_load_drive_folders_and_server_stories", fake_load)

    result = asyncio.run(uploadability.check_uploadable())

    assert result.uploadable == []
    assert {entry.id for entry in result.invalid} == {"folder-1", "folder-2"}
    for entry in result.invalid:
        assert entry.validation_errors == [
            "DUPLICATE STORY TITLE: 'Story1' is used by multiple Drive folders: "
            "DONE_ABCDE_wp - Story1; DONE_ABC_wp - Story1"
        ]


def test_check_uploadable_does_not_treat_prefix_titles_as_duplicates(monkeypatch):
    folders = [
        _folder("folder-1", "DONE", "ABC", "Story1"),
        _folder("folder-2", "DONE", "ABCDE", "Story10"),
    ]
    service = _FakeService()

    async def fake_load(_service, *, refresh_drive_folders=False):
        return folders, []

    monkeypatch.setattr(uploadability, "get_drive_sync_service", lambda: service)
    monkeypatch.setattr(uploadability, "_load_drive_folders_and_server_stories", fake_load)

    result = asyncio.run(uploadability.check_uploadable())

    assert {entry.id for entry in result.uploadable} == {"folder-1", "folder-2"}
    assert result.invalid == []


def test_check_updatable_reports_each_duplicated_extended_story_title(monkeypatch):
    folders = [
        _folder("folder-1", "EXTENDED", "ABC", "Story1"),
        _folder("folder-2", "EXTENDED", "ABCDE", "Story1"),
    ]
    stories = [{"id": "story-1", "title": "Story1", "maxChapter": 4}]
    service = _FakeService()

    async def fake_load(_service, *, refresh_drive_folders=False):
        return folders, stories

    monkeypatch.setattr(uploadability, "get_drive_sync_service", lambda: service)
    monkeypatch.setattr(uploadability, "_load_drive_folders_and_server_stories", fake_load)

    result = asyncio.run(uploadability.check_updatable())

    assert result.updatable == []
    assert {entry.folder.id for entry in result.invalid} == {"folder-1", "folder-2"}
    assert all(
        entry.folder.validation_errors[0].startswith("DUPLICATE STORY TITLE: 'Story1'")
        for entry in result.invalid
    )


def test_reader_finished_update_check_reports_duplicate_story_titles(monkeypatch):
    folders = [
        _folder("folder-1", "EXTENDED", "ABC", "Story1"),
        _folder("folder-2", "EXTENDED", "ABCDE", "Story1"),
    ]
    stories = [{"id": "story-1", "title": "Story1", "maxChapter": 4}]

    class _ReaderService(_FakeService):
        def get_stories_needing_update(self):
            return {"data": {"data": [{"id": "story-1", "title": "Story1"}]}}

        def get_all_server_stories(self):
            return stories

        def list_drive_folders(self, **_kwargs):
            return folders, len(folders)

    monkeypatch.setattr(uploadability, "get_drive_sync_service", _ReaderService)

    result = asyncio.run(uploadability.check_updatable_reader_finished())

    assert result.updatable == []
    assert {entry.folder.id for entry in result.invalid} == {"folder-1", "folder-2"}
    assert result.no_drive_folder == []
