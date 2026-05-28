"""Root-level Scrapy settings entry point."""

import os
import sys
from pathlib import Path

_self_dir = Path(__file__).parent.resolve()
if str(_self_dir) not in sys.path:
    sys.path.insert(0, str(_self_dir))

env = os.getenv("SCRAPY_ENV", "dev")

if env == "prod":
    from settings.prod_settings import *  # noqa: F401,F403
else:
    from settings.default_settings import *  # noqa: F401,F403
