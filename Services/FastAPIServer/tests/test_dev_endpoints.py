"""Executable API tests for development endpoint containment."""

import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import require_admin
from api.db import get_db
from api.routes.dev import (
    RUNTIME_TABLES,
    RESET_TARGETS,
    SERVICES_ROOT,
    _clear_directory_contents,
    _reset_worker_services,
    router,
)


def _unused_db():
    yield object()


def _admin():
    return object()


def test_clear_data_returns_404_when_dev_mode_off(monkeypatch) -> None:
    monkeypatch.setenv("DEV_MODE", "false")
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = _unused_db
    app.dependency_overrides[require_admin] = _admin

    response = TestClient(app).post(
        "/api/dev/clear-data",
        json={"confirmation": "CLEAR_BACKEND_DATA"},
    )

    assert response.status_code == 404


def test_clear_directory_contents_missing_path_does_not_raise() -> None:
    """A runtime dir that is absent (e.g. a sibling service that lives in a
    different container) must be skipped silently, never created, never raised."""
    missing = SERVICES_ROOT / "__cleartest_missing_dir__"
    assert not missing.exists()

    deleted, skipped = _clear_directory_contents(missing)

    assert deleted == []
    assert skipped == []
    # Critically, the directory must NOT have been created (the original bug
    # mkdir'd it, which 500s on a non-writable path like '/NovelCrawler').
    assert not missing.exists()


def test_clear_directory_contents_outside_services_is_skipped() -> None:
    """Paths outside the services tree are refused, not deleted, not raised."""
    outside = Path("/NovelCrawler/output/crawl")

    deleted, skipped = _clear_directory_contents(outside)

    assert deleted == []
    assert skipped == [str(outside)]


def test_gateway_runtime_tables_exclude_worker_owned_data() -> None:
    assert RUNTIME_TABLES == [
        "refresh_tokens",
        "app_settings",
        "shared_json_documents",
    ]


def test_gateway_orchestrates_reset_for_every_worker(monkeypatch) -> None:
    requested_urls: list[str] = []

    class _Response:
        status_code = 200

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, url: str):
            requested_urls.append(url)
            return _Response()

    monkeypatch.setattr("api.routes.dev.service_async_client", lambda **_kwargs: _Client())
    monkeypatch.setenv("SERVICE_URLS", "{}")

    reset_services = asyncio.run(_reset_worker_services())

    assert reset_services == [name for name, _url in RESET_TARGETS]
    assert requested_urls == [
        f"{url}/api/dev/reset-state"
        for _name, url in RESET_TARGETS
    ]
