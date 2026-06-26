"""Security and proxy contract regressions."""

from __future__ import annotations

import asyncio

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.db import get_db
from api.proxy import json_proxy
from api.routes import internal


def _unused_db():
    yield object()


def test_internal_config_requires_service_token(monkeypatch) -> None:
    monkeypatch.setattr(
        internal,
        "load_external_api_config",
        lambda _db: {
            "main_be_api_base_url": "https://example.test",
            "main_be_bearer_token": "external-secret",
        },
    )
    app = FastAPI()
    app.include_router(internal.router)
    app.dependency_overrides[get_db] = _unused_db
    client = TestClient(app)

    assert client.get("/internal/v1/bedread/external-api-config").status_code == 401
    response = client.get(
        "/internal/v1/bedread/external-api-config",
        headers={"Authorization": "Bearer test-internal-service-token"},
    )
    assert response.status_code == 200
    assert response.json()["external_api_token"] == "external-secret"


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
    assert b"upstream_unavailable" in response.body
