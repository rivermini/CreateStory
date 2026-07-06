"""Scrapy pipeline that writes scraped chapters to separate JSON files."""

import json
from pathlib import Path

import scrapy

from core.pipeline_base import BasePipeline
from utils.sanitize import sanitize_filename


class JsonWriterPipeline(BasePipeline):
    def __init__(self):
        self.active: bool | None = None
        self._output_dir: Path | None = None
        self._filename_prefix: str = ""

    @classmethod
    def from_crawler(cls, crawler):
        return cls()

    def process_item(self, item: dict, spider: scrapy.Spider) -> dict:
        if self.active is None:
            fmt = spider.settings.get("OUTPUT_FORMAT", "both")
            self.active = fmt in ("jsonl", "both")
            if self.active:
                self._output_dir, self._filename_prefix = self._resolve_output_dir_and_prefix(spider)

        if not self.active:
            return item

        item_dict = item.asdict() if hasattr(item, "asdict") else (item.model_dump() if hasattr(item, "model_dump") else dict(item))
        chapter_number = item_dict.get("chapter_number", 0)

        filename = f"{sanitize_filename(self._filename_prefix)}_chapter_{chapter_number}.json"
        path = self._output_dir / filename

        with open(path, "w", encoding="utf-8") as fh:
            json.dump(item_dict, fh, ensure_ascii=False, indent=2)

        spider.logger.info("Wrote chapter %d -> %s", chapter_number, path)
        self.item_count += 1
        return item

    def close_spider(self, spider: scrapy.Spider) -> None:
        super().close_spider(spider)
        spider.logger.info("JsonWriterPipeline: wrote %d chapter file(s)", self.item_count)
