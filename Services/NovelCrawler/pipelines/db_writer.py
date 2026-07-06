"""Scrapy pipeline that stores scraped data in SQLite."""

import sqlite3
from pathlib import Path

import scrapy

from core.pipeline_base import BasePipeline


class SqliteWriterPipeline(BasePipeline):
    def __init__(self, db_path: str = "data/novels.db"):
        self.db_path = Path(db_path)
        self.conn: sqlite3.Connection | None = None

    @classmethod
    def from_crawler(cls, crawler):
        db_path = crawler.settings.get("SQLITE_DB_PATH", "data/novels.db")
        return cls(db_path=db_path)

    def open_spider(self, spider: scrapy.Spider) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self) -> None:
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS novels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT UNIQUE NOT NULL,
                title TEXT,
                cover_url TEXT,
                source_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS chapters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                novel_slug TEXT NOT NULL,
                chapter_number INTEGER NOT NULL,
                title TEXT,
                content TEXT,
                source_url TEXT,
                word_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (novel_slug) REFERENCES novels(slug),
                UNIQUE(novel_slug, chapter_number)
            )
        """)
        self.conn.commit()

    def process_item(self, item: dict, spider: scrapy.Spider) -> dict:
        if self.conn is None:
            return item

        novel_slug = item.get("novel_slug", "")
        content = item.get("content", "")

        self.conn.execute(
            """INSERT OR IGNORE INTO novels (slug, title, source_url)
               VALUES (?, ?, ?)""",
            (novel_slug, item.get("novel_title", ""), item.get("source_url", "")),
        )

        self.conn.execute(
            """INSERT OR REPLACE INTO chapters
               (novel_slug, chapter_number, title, content, source_url, word_count)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                novel_slug,
                item.get("chapter_number", 0),
                item.get("title", ""),
                content,
                item.get("source_url", ""),
                len(content.split()),
            ),
        )
        self.conn.commit()
        self.item_count += 1
        return item

    def close_spider(self, spider: scrapy.Spider) -> None:
        super().close_spider(spider)
        if self.conn:
            self.conn.close()
