"""Runtime configuration for the FastAPI gateway."""

from __future__ import annotations

import os
import sys
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"

load_dotenv(PROJECT_ROOT / ".env")


class StartupError(Exception):
    """Raised when a required environment variable is missing at startup."""
    pass


def _env_or_file(name: str) -> str | None:
    """Read a secret from NAME or from the file referenced by NAME_FILE."""
    value = os.environ.get(name)
    if value is not None:
        return value.strip()
    file_path = os.environ.get(f"{name}_FILE")
    if not file_path:
        return None
    try:
        return Path(file_path).read_text(encoding="utf-8").strip()
    except OSError as exc:
        print(f"[FATAL] Unable to read {name}_FILE: {exc}", file=sys.stderr)
        sys.exit(1)


def _required_env(name: str) -> str:
    """Return the value of a required env var, or exit with a clear message."""
    value = _env_or_file(name)
    if not value:
        print(
            f"[FATAL] {name} is not set. "
            f"Set {name} or {name}_FILE before starting the server.",
            file=sys.stderr,
        )
        sys.exit(1)
    return value


# Required — no defaults; server will not start without these.
JWT_SECRET_KEY = _required_env("JWT_SECRET_KEY")
if len(JWT_SECRET_KEY) < 32:
    print(
        "[FATAL] JWT_SECRET_KEY is too weak. "
        "Set JWT_SECRET_KEY or JWT_SECRET_KEY_FILE to a value with at least 32 characters.",
        file=sys.stderr,
    )
    sys.exit(1)
INTERNAL_SERVICE_TOKEN = _required_env("INTERNAL_SERVICE_TOKEN")

_DATABASE_URL = _env_or_file("DATABASE_URL")
if _DATABASE_URL:
    DATABASE_URL = _DATABASE_URL
else:
    print(
        "[FATAL] DATABASE_URL is not set. "
        "Please set it in your .env file or environment before starting the server.",
        file=sys.stderr,
    )
    sys.exit(1)


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
# Short access-token lifetime bounds the post-logout window (logout already
# revokes the refresh token; the FE auto-refreshes on 401, so this is
# transparent). Disable/role changes are already immediate via a per-request
# DB re-check in get_current_user (L8).
ACCESS_TOKEN_EXPIRES = timedelta(minutes=_int_env("JWT_ACCESS_TOKEN_MINUTES", 15))
REFRESH_TOKEN_EXPIRES = timedelta(days=_int_env("JWT_REFRESH_TOKEN_DAYS", 14))
