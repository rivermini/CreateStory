from __future__ import annotations

import asyncio
import json

import httpx

from api.models.settings import SettingsUpdateRequest
from api.routes import settings


def test_worker_settings_are_aggregated_through_service_apis(monkeypatch):
    requested: list[tuple[str, str]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requested.append((request.method, str(request.url)))
        if request.url.path == "/api/auto-audio/settings":
            return httpx.Response(
                200,
                json={**settings._AUTO_DEFAULTS, "auto_audio_rest_seconds": 9},
                request=request,
            )
        return httpx.Response(200, json={"concurrency": 2}, request=request)

    monkeypatch.setenv("SERVICE_URLS_AutoAudio", "http://auto-audio:8004")
    monkeypatch.setenv("SERVICE_URLS_BedReadVoices", "http://voices:8001")
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    auto, tts = asyncio.run(settings._load_worker_settings(client))
    asyncio.run(client.aclose())

    assert auto["auto_audio_rest_seconds"] == 9
    assert tts == {"tts_concurrency": 2}
    assert requested == [
        ("GET", "http://auto-audio:8004/api/auto-audio/settings"),
        ("GET", "http://voices:8001/api/tts/concurrency"),
    ]


def test_combined_settings_update_is_routed_to_each_owner(monkeypatch):
    calls: list[tuple[str, str, dict]] = []
    saved_gateway: list[dict] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content or b"{}")
        calls.append((request.method, request.url.path, payload))
        if request.url.path == "/api/auto-audio/settings":
            return httpx.Response(
                200,
                json={**settings._AUTO_DEFAULTS, **payload},
                request=request,
            )
        return httpx.Response(200, json={"concurrency": payload["concurrency"]}, request=request)

    class _Repo:
        def __init__(self, _db) -> None:
            pass

        def upsert_setting(self, _key: str, value: dict) -> dict:
            saved_gateway.append(dict(value))
            return value

    monkeypatch.setenv("SERVICE_URLS_AutoAudio", "http://auto-audio:8004")
    monkeypatch.setenv("SERVICE_URLS_BedReadVoices", "http://voices:8001")
    monkeypatch.setattr(settings, "SharedStateRepository", _Repo)
    monkeypatch.setattr(settings, "_load_gateway_settings", lambda _db: dict(settings._GATEWAY_DEFAULTS))
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    response = asyncio.run(settings.update_settings(
        SettingsUpdateRequest(
            theme="dark",
            auto_audio_rest_seconds=7,
            tts_concurrency=2,
        ),
        object(),
        client,
        None,
    ))
    asyncio.run(client.aclose())

    assert calls == [
        ("PUT", "/api/auto-audio/settings", {"auto_audio_rest_seconds": 7}),
        ("POST", "/api/tts/concurrency", {"concurrency": 2}),
    ]
    assert saved_gateway[-1]["theme"] == "dark"
    assert "auto_audio_rest_seconds" not in saved_gateway[-1]
    assert response.theme == "dark"
    assert response.auto_audio_rest_seconds == 7
    assert response.tts_concurrency == 2
