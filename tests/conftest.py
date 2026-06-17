"""Pytest fixtures and configuration for FastAPIServer tests."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Provide a default DATABASE_URL for tests that import service modules.
# Service modules (api.db, api.app_config) raise errors at import time if absent.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests")


@pytest.fixture
def mock_env_production(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Set ENV=production and clear DATABASE_URL."""
    monkeypatch.setenv("ENV", "production")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    return monkeypatch


@pytest.fixture
def mock_env_dev(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Set ENV=development with a valid DATABASE_URL."""
    monkeypatch.setenv("ENV", "development")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://test:test@localhost/test")
    monkeypatch.setenv("DEV_MODE", "false")
    return monkeypatch


@pytest.fixture
def mock_env_dev_mode(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Set DEV_MODE=true for dev endpoint tests."""
    monkeypatch.setenv("DEV_MODE", "true")
    monkeypatch.setenv("ENV", "development")
    return monkeypatch


@pytest.fixture
def mock_db_url(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Provide a test DATABASE_URL without affecting the real database."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://test:test@localhost/test")
    return monkeypatch
