"""Scrapy pipeline that writes scraped chapters to separate TXT files."""

from pathlib import Path

import scrapy

from core.pipeline_base import BasePipeline
from utils.sanitize import sanitize_filename


class MdWriterPipeline(BasePipeline):
    active: bool | None = None

    @classmethod
    def from_crawler(cls, crawler):
        return cls()

    def process_item(self, item: dict, spider: scrapy.Spider) -> dict:
        if self.active is None:
            fmt = spider.settings.get("OUTPUT_FORMAT", "both")
            self.active = fmt in ("txt", "both")
            if self.active:
                self._output_dir, self._filename_prefix = self._resolve_output_dir_and_prefix(spider)

        if not self.active:
            return item

        item_dict = item.asdict() if hasattr(item, "asdict") else (item.model_dump() if hasattr(item, "model_dump") else dict(item))
        chapter_number = item_dict.get("chapter_number", 0)
        novel_title = item_dict.get("novel_title", "")
        content = item_dict.get("content", "").replace("\\n", "\n")

        filename = f"{sanitize_filename(self._filename_prefix)}_chapter_{chapter_number}.txt"
        path = self._output_dir / filename

        chapter_title = item_dict.get("chapter_title", novel_title)

        lines = [f"{filename}: {chapter_title}", "", content]
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines))

        spider.logger.info("Wrote chapter %d -> %s", chapter_number, path)
        self.item_count += 1
        return item
