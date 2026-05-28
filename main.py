"""
Uvicorn entry point for BedReadDriveSync microservice.

Run with: python main.py
Or:        uvicorn main:app --port 8003 --reload
"""

import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logging.getLogger("api.services.drive_service").setLevel(logging.INFO)

from dotenv import load_dotenv

_project_root = Path(__file__).parent.resolve()
load_dotenv(_project_root / ".env")

if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from api.main import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8003, reload=True)
