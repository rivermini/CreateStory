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


def _required_env(name: str) -> str:
    """Return the value of a required env var, or exit with a clear message."""
    value = os.environ.get(name)
    if value is None:
        print(
            f"[FATAL] {name} is not set. "
            f"Please set it in your .env file or environment before starting the server.",
            file=sys.stderr,
        )
        sys.exit(1)
    return value


# Required — no defaults; server will not start without these.
JWT_SECRET_KEY = _required_env("JWT_SECRET_KEY")
_BOOTSTRAP_PASSWORD_DEFAULT = "+E8ep0m7(h5ut#Q$"
BOOTSTRAP_ADMIN_PASSWORD = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", _BOOTSTRAP_PASSWORD_DEFAULT)

_DATABASE_URL = os.environ.get("DATABASE_URL")
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
ACCESS_TOKEN_EXPIRES = timedelta(minutes=_int_env("JWT_ACCESS_TOKEN_MINUTES", 30))
REFRESH_TOKEN_EXPIRES = timedelta(days=_int_env("JWT_REFRESH_TOKEN_DAYS", 14))
BOOTSTRAP_ADMIN_EMAIL = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@gmail.com")
