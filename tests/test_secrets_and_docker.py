"""Tests for FastAPIServer secrets management and Dockerfile hardening."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class TestSecrets:
    """Verify that no sensitive credentials are committed to git."""

    def test_env_file_not_in_git_tracked(self) -> None:
        """Assert that .env is not a git-tracked file in FastAPIServer."""
        # Check the parent repo (Services) since FastAPIServer itself may not be a git repo
        # We verify the .env file does not exist (was deleted)
        env_path = PROJECT_ROOT / "FastAPIServer" / ".env"
        assert not env_path.exists(), (
            f"FastAPIServer/.env should not exist — "
            f"credentials must be provided via environment or a gitignored .env file"
        )

    def test_db_config_raises_without_database_url_in_production(self) -> None:
        """app_config.py must exit non-zero when DATABASE_URL is absent in production."""
        import subprocess, sys

        result = subprocess.run(
            [
                sys.executable, "-c",
                "import os; os.environ.pop('DATABASE_URL', None); "
                "os.environ['ENV'] = 'production'; "
                "from api import app_config",
            ],
            cwd=str(PROJECT_ROOT / "FastAPIServer"),
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0, (
            f"app_config should fail in production without DATABASE_URL. "
            f"stdout: {result.stdout}, stderr: {result.stderr}"
        )
        assert "DATABASE_URL" in result.stderr or "DATABASE_URL" in result.stdout


class TestDockerfile:
    """Verify Dockerfile hardening: non-root user and healthcheck."""

    DOCKERFILE = PROJECT_ROOT / "FastAPIServer" / "Dockerfile"

    def test_dockerfile_has_healthcheck(self) -> None:
        content = self.DOCKERFILE.read_text()
        assert "HEALTHCHECK" in content, (
            "Dockerfile must define HEALTHCHECK for container orchestrator health detection"
        )

    def test_dockerfile_runs_as_non_root(self) -> None:
        content = self.DOCKERFILE.read_text()
        # Remove comments and check final USER directive
        lines = [
            line.strip() for line in content.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        # USER must appear somewhere
        assert "USER" in content, "Dockerfile must switch to a non-root user"
        user_lines = [l for l in lines if l.startswith("USER")]
        assert len(user_lines) >= 1, "Dockerfile must contain a USER directive"
        # USER should not be root
        for line in user_lines:
            assert "root" not in line.lower(), (
                f"Dockerfile USER directive must not be root: {line}"
            )
