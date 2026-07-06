"""
Abstract base spider for novel sites.

Subclasses must override:
    name           -- unique spider name, e.g. "wattpad"
    config_name   -- site config file name without .yaml, e.g. "wattpad"
    parse_chapter()-- yield Chapter items from a chapter response

Subclasses may override:
    get_start_urls()     -- provide custom URL list
    build_selector_config() -- build SelectorConfig from loaded config dict
    build_custom_settings() -- extend custom_settings dict
"""

import logging
from abc import abstractmethod
from dataclasses import dataclass, field
from typing import Generator

import scrapy
from scrapy import Spider

from configs.base_config import load_site_config
from models.chapter import Chapter


logger = logging.getLogger(__name__)


@dataclass
class SelectorConfig:
    chapter_list: str = "#idData a"
    chapter_body: str = ".m-read .txt p"
    next_chapter: str = ".nav-mid a:last-child"
    novel_title: str = ".m-desc h1.tit"
    cover_image: str = ".m-imgtxt img"
    author: str = ".m-imgtxt a[href*='/authors/']"


class BaseSpider(Spider):
    name: str = "base_spider"
    config_name: str = ""
    download_delay: float = 2.0
    max_retries: int = 3
    selector_config: SelectorConfig = field(default_factory=SelectorConfig)
    custom_settings: dict = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._chapter_counter: int = 0
        self._url_to_title: dict[str, str] = {}

    def start_requests(self):
        for url in self.get_start_urls():
            yield scrapy.Request(
                url,
                callback=self._parse_novel_page,
                errback=self._handle_error,
                meta={"retry_count": 0},
            )

    def get_start_urls(self) -> list[str]:
        if not self.config_name:
            return []
        cfg = load_site_config(self.config_name)
        return cfg.get("start_urls", [])

    def build_selector_config(self, config: dict) -> SelectorConfig:
        selectors = config.get("selectors", {})
        return SelectorConfig(
            chapter_list=selectors.get("chapter_list", "#idData a"),
            chapter_body=selectors.get("chapter_body", ".m-read .txt p"),
            next_chapter=selectors.get("next_chapter", ".nav-mid a:last-child"),
            novel_title=selectors.get("novel_title", ".m-desc h1.tit"),
            cover_image=selectors.get("cover_image", ".m-imgtxt img"),
            author=selectors.get("author", ".m-imgtxt a[href*='/authors/']"),
        )

    def build_custom_settings(self) -> dict:
        return {
            "DOWNLOAD_DELAY": self.download_delay,
            "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
        }

    def _parse_novel_page(self, response: scrapy.http.Response) -> Generator:
        novel_title = self._extract_novel_title(response)
        chapter_links = self._extract_chapter_links(response)

        self.logger.info(
            "Novel '%s': collected %d chapter links from %s",
            novel_title or response.url,
            len(chapter_links),
            self.selector_config.chapter_list,
        )

        for link in chapter_links:
            chapter_url = response.urljoin(link["url"])
            chapter_title = link.get("title") or ""
            self._url_to_title[chapter_url] = chapter_title
            self._chapter_counter += 1

            yield scrapy.Request(
                chapter_url,
                callback=self._dispatch_parse_chapter,
                errback=self._handle_error,
                meta={
                    "retry_count": 0,
                    "novel_title": novel_title,
                    "chapter_title": chapter_title,
                    "chapter_index": self._chapter_counter,
                },
            )

    def _dispatch_parse_chapter(self, response: scrapy.http.Response) -> Generator:
        chapter_index = response.meta.get("chapter_index", 0)
        yield from self.parse_chapter(response, chapter_index=chapter_index)

    @abstractmethod
    def parse_chapter(self, response: scrapy.http.Response, chapter_index: int) -> Generator[Chapter, None, None]:
        raise NotImplementedError

    def _extract_novel_title(self, response: scrapy.http.Response) -> str:
        title = response.css(self.selector_config.novel_title).get()
        return title.strip() if title else ""

    def _extract_chapter_links(self, response: scrapy.http.Response) -> list[dict[str, str]]:
        sel = response.selector
        anchors = sel.css(self.selector_config.chapter_list)
        links = []
        for a in anchors:
            href = a.attrib.get("href")
            if not href:
                continue
            title = (
                a.attrib.get("title")
                or a.css("::text").get()
                or ""
            ).strip()
            links.append({"url": href, "title": title})
        return links

    def _handle_error(self, failure) -> Generator:
        request = failure.request
        retry_count: int = request.meta.get("retry_count", 0)

        if retry_count < self.max_retries:
            self.logger.warning(
                "Request failed for %s -- retrying (%d/%d)",
                request.url,
                retry_count + 1,
                self.max_retries,
            )
            new_req = request.copy()
            new_req.meta["retry_count"] = retry_count + 1
            yield new_req
        else:
            self.logger.error(
                "Abandoning request after %d retries: %s",
                self.max_retries,
                request.url,
            )
