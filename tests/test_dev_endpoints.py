"""Executable API tests for development endpoint containment."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import require_admin
from api.db import get_db
from api.routes.dev import router


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
