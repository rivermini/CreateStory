"""Abstract base pipeline for all output pipelines."""

from abc import abstractmethod
from pathlib import Path
from typing import Any

import scrapy

from utils.sanitize import sanitize_filename


class BasePipeline:
    item_count: int = 0

    def open_spider(self, spider: scrapy.Spider) -> None:
        self.item_count = 0

    @abstractmethod
    def process_item(self, item: dict[str, Any], spider: scrapy.Spider) -> dict[str, Any]:
        raise NotImplementedError

    def close_spider(self, spider: scrapy.Spider) -> None:
        spider.logger.info("Pipeline %s: processed %d items", self.__class__.__name__, self.item_count)

    def _safe_get(self, item: dict, key: str, default: Any = None) -> Any:
        return item.get(key, default)

    def _resolve_output_dir_and_prefix(self, spider: scrapy.Spider) -> tuple[Path, str]:
        default_dir = spider.settings.get("OUTPUT_DIR", "output")
        output_dir = Path(default_dir)

        site_name = spider.settings.get("SITE_NAME", "")
        novel_name = spider.settings.get("NOVEL_NAME", "")
        slug = getattr(spider, "novel_slug", None) or "unknown"

        if novel_name:
            display_name = sanitize_filename(novel_name)
        else:
            display_name = sanitize_filename(slug)

        status_raw = spider.settings.get("NOVEL_COMPLETED", "")
        status_lower = status_raw.lower() if isinstance(status_raw, str) else ""
        if status_lower == "true":
            status_suffix = "Completed"
        elif status_lower == "false":
            status_suffix = "Ongoing"
        else:
            status_suffix = ""

        if site_name and status_suffix:
            filename_prefix = f"{site_name}_{display_name}_{status_suffix}"
        elif site_name:
            filename_prefix = f"{site_name}_{display_name}"
        elif status_suffix:
            filename_prefix = f"{display_name}_{status_suffix}"
        else:
            filename_prefix = display_name

        output_dir.mkdir(parents=True, exist_ok=True)
        return output_dir, filename_prefix
