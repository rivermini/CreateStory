from __future__ import annotations

from starlette.requests import Request

from api import config
from api.routes import tts


class _FakeTTSService:
    def __init__(self) -> None:
        self.concurrency = 1

    def set_concurrency(self, value: int) -> None:
        self.concurrency = value

    def set_auto_concurrency(self) -> None:
        self.concurrency = 2

    def get_concurrency(self) -> int:
        return self.concurrency


def _operator_request() -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/api/tts/concurrency", "headers": []})
    request.state.create_story_role = "operator"
    return request


def test_concurrency_update_persists_the_owned_setting_shape(monkeypatch):
    service = _FakeTTSService()
    saved: list[dict] = []
    monkeypatch.setattr(tts, "get_tts_service", lambda: service)
    monkeypatch.setattr(tts, "save_tts_settings", lambda value: saved.append(value) or value)

    response = tts.update_concurrency(tts.ConcurrencyRequest(concurrency=2), _operator_request())

    assert response == {"concurrency": 2, "mode": "manual"}
    assert saved == [{"tts_concurrency": 2}]


def test_external_api_configuration_is_read_from_drive_sync(monkeypatch):
    requested: list[str] = []

    class _Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "external_api_base_url": "https://stories.example/api",
                "external_api_token": "secret",
                "external_api_user_id": "user-1",
            }

    class _Client:
        def __init__(self, **_kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def get(self, url: str) -> _Response:
            requested.append(url)
            return _Response()

    monkeypatch.setattr(config.httpx, "Client", _Client)
    monkeypatch.setattr(config, "internal_service_headers", lambda: {"Authorization": "Bearer internal"})
    monkeypatch.setenv("SERVICE_URLS_BedReadDriveSync", "http://drive-sync:8003")
    config._external_config_cache = None
    config._external_config_cache_time = 0

    result = config.load_external_api_config()

    assert requested == ["http://drive-sync:8003/internal/v1/external-api-config"]
    assert result == {
        "main_be_api_base_url": "https://stories.example/api",
        "main_be_user_id": "user-1",
        "main_be_bearer_token": "secret",
    }
