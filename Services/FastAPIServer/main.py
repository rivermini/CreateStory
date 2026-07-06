"""
FastAPIServer main.py
=====================
Entry point that launches the FastAPI gateway via uvicorn.

Run with::

    python main.py

The API will be available at http://localhost:8000.
API docs: http://localhost:8000/docs
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

_project_root = Path(__file__).parent.resolve()
load_dotenv(_project_root / ".env")

if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api.main:app",
        host=os.getenv("FASTAPI_HOST", "0.0.0.0"),
        port=8000,
        reload=False,
    )
