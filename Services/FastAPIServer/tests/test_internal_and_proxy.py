"""Security and proxy contract regressions."""

from __future__ import annotations

import asyncio

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.app_config import INTERNAL_SERVICE_TOKEN
from api.proxy import json_proxy
from api.routes import internal
from api.routes.drive_sync.proxy import drive_get


def test_internal_config_requires_service_token(monkeypatch) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "external_api_base_url": "https://example.test",
                "external_api_token": "external-secret",
                "external_api_user_id": "user-1",
            },
            request=request,
        )

    upstream = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(internal, "get_shared_http_client", lambda: upstream)
    app = FastAPI()
    app.include_router(internal.router)
    client = TestClient(app)

    assert client.get("/internal/v1/bedread/external-api-config").status_code == 401
    response = client.get(
        "/internal/v1/bedread/external-api-config",
        headers={"Authorization": f"Bearer {INTERNAL_SERVICE_TOKEN}"},
    )
    assert response.status_code == 200
    assert response.json()["external_api_token"] == "external-secret"
    asyncio.run(upstream.aclose())


def test_removed_public_token_routes_are_404() -> None:
    app = FastAPI()
    client = TestClient(app)
    assert client.get("/api/bedread/config/external-api").status_code == 404
    assert client.get("/api/drive-sync/config/token").status_code == 404


def test_proxy_preserves_upstream_status_and_json(monkeypatch) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"detail": "conflict"}, request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr("api.proxy.get_shared_http_client", lambda: client)
    response = asyncio.run(json_proxy("GET", "https://worker.test/resource"))
    asyncio.run(client.aclose())

    assert response.status_code == 409
    assert b"conflict" in response.body
    assert b"request_id" in response.body


def test_proxy_maps_connection_failure_to_502(monkeypatch) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr("api.proxy.get_shared_http_client", lambda: client)
    response = asyncio.run(json_proxy("GET", "https://worker.test/resource"))
    asyncio.run(client.aclose())

    assert response.status_code == 502


def test_drive_proxy_maps_connection_failure_to_503(monkeypatch) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr("api.proxy.get_shared_http_client", lambda: client)
    response = asyncio.run(drive_get("/api/drive-sync/jobs"))
    asyncio.run(client.aclose())

    assert response.status_code == 503
    assert b"upstream_unavailable" in response.body
