"""Executable API tests for development endpoint containment."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import require_admin
from api.db import get_db
from api.routes.dev import (
    SERVICES_ROOT,
    _clear_directory_contents,
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
