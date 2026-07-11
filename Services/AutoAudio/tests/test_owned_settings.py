from __future__ import annotations

from core import config


def test_auto_audio_settings_are_persisted_in_the_owned_shape(monkeypatch):
    saved: list[tuple[str, dict]] = []
    monkeypatch.setattr(config, "_get_app_setting", lambda _key: {})
    monkeypatch.setattr(
        config,
        "_save_app_setting",
        lambda key, value: saved.append((key, dict(value))) or value,
    )
    config.reset_owned_settings_cache()

    result = config.update_owned_settings({
        "auto_audio_rest_seconds": 12,
        "auto_audio_upload_workers": 4,
        "unknown_gateway_setting": "ignored",
    })

    assert result["auto_audio_rest_seconds"] == 12
    assert result["auto_audio_upload_workers"] == 4
    assert "unknown_gateway_setting" not in result
    assert saved[0][0] == "auto_audio_settings"


def test_external_api_configuration_is_read_directly_from_drive_sync(monkeypatch):
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
    monkeypatch.setattr(config, "_get_drivesync_url", lambda: "http://drive-sync:8003")
    config._external_config_cache = None
    config._external_config_cache_time = 0

    base_url, headers = config._get_external_api_config()

    assert requested == ["http://drive-sync:8003/internal/v1/external-api-config"]
    assert base_url == "https://stories.example/api"
    assert headers == {"x-user-id": "user-1", "Authorization": "Bearer secret"}
