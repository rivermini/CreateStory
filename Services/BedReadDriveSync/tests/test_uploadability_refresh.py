import asyncio
import os

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("INTERNAL_SERVICE_TOKEN", "test-internal-service-token")

from api.routes.drive_sync.uploadability import _load_drive_folders_and_server_stories


class _FakeService:
    def __init__(self) -> None:
        self.list_kwargs = None

    def list_drive_folders(self, **kwargs):
        self.list_kwargs = kwargs
        return ([{"id": "folder-1"}], 1)

    def get_all_server_stories(self):
        return [{"id": "story-1"}]


def test_uploadability_loader_can_force_fresh_drive_folder_listing():
    service = _FakeService()

    folders, stories = asyncio.run(
        _load_drive_folders_and_server_stories(service, refresh_drive_folders=True)
    )

    assert service.list_kwargs == {"limit": 10000, "offset": 0, "refresh": True}
    assert folders == [{"id": "folder-1"}]
    assert stories == [{"id": "story-1"}]
