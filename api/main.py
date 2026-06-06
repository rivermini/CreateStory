"""FastAPI application entry point for the NovelCrawler microservice."""

import logging
import signal
import sys
from contextlib import asynccontextmanager
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("api.main")

from dotenv import load_dotenv

_project_root = Path(__file__).parent.parent.resolve()
load_dotenv(_project_root / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

_project_root = Path(__file__).parent.parent.resolve()
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from api.db import init_db
from api.routes import crawl, results, sites


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("NovelCrawler startup: initializing database...")
    init_db()
    try:
        from api.services.crawler_service import get_crawl_service
        _ = get_crawl_service()
    except Exception as exc:
        logger.warning("Crawler service preload failed: %s", exc)
    try:
        from api.repositories.inkitt_cookie_repository import migrate_json_to_db
        from api.db import SessionLocal
        db = SessionLocal()
        try:
            migrated = migrate_json_to_db(db)
            if migrated > 0:
                logger.info("Migrated %d Inkitt cookie(s) from JSON file to database.", migrated)
        finally:
            db.close()
    except Exception as exc:
        logger.warning("Inkitt cookie migration failed: %s", exc)
    try:
        from handlers.selenium_handler import _get_browser
        browser = _get_browser()
        browser._resolve_chromedriver()
    except Exception as exc:
        logger.warning("Startup ChromeDriver preload failed: %s", exc)
    yield

app = FastAPI(
    title="Nova NovelCrawler API",
    description="REST + SSE API for multi-site novel scraping. Handles site detection and Scrapy crawl execution.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sites.router)
app.include_router(crawl.router)
app.include_router(results.router)


@app.get("/", tags=["Health"])
def root() -> dict:
    return {"status": "ok", "service": "Nova NovelCrawler API", "version": "1.0.0"}


@app.on_event("shutdown")
async def on_shutdown():
    try:
        from handlers.selenium_handler import _get_browser
        browser = _get_browser()
        browser.close()
        logger.info("Selenium browser closed on shutdown.")
    except Exception as exc:
        logger.warning("Shutdown browser close failed: %s", exc)


@app.get("/api", tags=["Health"])
def api_info() -> dict:
    return {
        "title": "Nova NovelCrawler API",
        "version": "1.0.0",
        "features": ["crawling", "site-detection", "results"],
        "docs_url": "/docs",
        "redoc_url": "/redoc",
    }


@app.post("/api/dev/reset-state", tags=["Development"])
def reset_runtime_state() -> dict:
    from api.services.crawler_service import get_crawl_service

    get_crawl_service().reset_runtime_state()
    return {"reset": True}
