"""Tests for FastAPIServer /api/dev/* endpoint guards."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEV_PY = PROJECT_ROOT / "FastAPIServer" / "api" / "routes" / "dev.py"


class TestDevEndpoints:
    """Verify dev endpoints are gated behind DEV_MODE."""

    def test_clear_data_returns_404_when_dev_mode_off(self) -> None:
        """POST /api/dev/clear-data must return 404 when DEV_MODE is not set."""
        source = DEV_PY.read_text()

        assert "DEV_MODE" in source, (
            "clear-data endpoint must check DEV_MODE environment variable"
        )
        assert 'os.getenv("DEV_MODE"' in source, (
            "clear-data endpoint must read DEV_MODE from environment"
        )
        assert "HTTPException(status_code=404" in source, (
            "clear-data endpoint must return 404 (not 403) when DEV_MODE is off, "
            "to avoid disclosing that the endpoint exists"
        )

    def test_clear_data_checks_dev_mode_within_function(self) -> None:
        """The DEV_MODE check must appear in the clear-data function body."""
        source = DEV_PY.read_text()

        # Extract the clear-data function body using a regex
        match = re.search(
            r"async def clear_backend_data\((.+?)\n(?=async def |def |class |#|$)",
            source,
            re.DOTALL,
        )
        assert match, "Could not find clear_backend_data function"
        func_body = match.group(0)

        # DEV_MODE guard must appear before the confirmation check in this function
        dev_mode_pos = func_body.find("DEV_MODE")
        confirm_pos = func_body.find("confirmation")
        assert dev_mode_pos != -1, "DEV_MODE check not found in clear-data function"
        assert confirm_pos != -1, "confirmation check not found in clear-data function"
        assert dev_mode_pos < confirm_pos, (
            "DEV_MODE guard must appear before the confirmation check in clear-data endpoint"
        )
