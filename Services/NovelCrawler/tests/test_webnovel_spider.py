from __future__ import annotations

import sys
import types

from bs4 import BeautifulSoup


try:
    import scrapy  # noqa: F401
except ModuleNotFoundError:
    scrapy_stub = types.ModuleType("scrapy")

    class Spider:
        def __init__(self, *args, **kwargs) -> None:
            pass

    class Request:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

    scrapy_stub.Spider = Spider
    scrapy_stub.Request = Request
    scrapy_stub.http = types.SimpleNamespace(Response=type("Response", (), {}))
    sys.modules["scrapy"] = scrapy_stub

from spiders.base_spider import SelectorConfig
from spiders.webnovel import WebNovelSpider


def _spider() -> WebNovelSpider:
    spider = WebNovelSpider.__new__(WebNovelSpider)
    spider.book_id = "35743936500589505"
    spider.novel_slug = "test-story"
    spider.limit = 10
    spider._range_start = None
    spider._range_end = None
    spider.selector_config = SelectorConfig(chapter_list="a[href*='/book/'][href*='_']")
    return spider


def test_catalog_uses_source_ordinal_for_chapter_number() -> None:
    spider = _spider()
    html = """
    <ol>
      <li><a href="/book/test-story_35743936500589505/chapter-4-a_111">4 Chapter 4: A 1 days ago</a></li>
      <li><a href="/book/test-story_35743936500589505/chapter-99-title_222">5 Chapter 99: Title 1 days ago</a></li>
      <li><a href="/book/test-story_35743936500589505/chapter-6-c_333"><span class="i-lock"></span>6 Chapter 6: C 1 days ago</a></li>
    </ol>
    """

    links = spider._collect_chapter_links(BeautifulSoup(html, "html.parser"), "https://www.webnovel.com/book/35743936500589505/catalog")

    assert [link["chapter_number"] for link in links] == [4, 5, 6]
    assert links[1]["title"] == "Chapter 99: Title"
    assert links[2]["locked"] is True


def test_select_chapters_from_range_or_start_chapter_id() -> None:
    spider = _spider()
    links = [
        {"chapter_number": 4, "chapter_id": "111", "url": "https://www.webnovel.com/book/test-story_35743936500589505/chapter-4-a_111"},
        {"chapter_number": 5, "chapter_id": "222", "url": "https://www.webnovel.com/book/test-story_35743936500589505/chapter-99-title_222"},
        {"chapter_number": 6, "chapter_id": "333", "url": "https://www.webnovel.com/book/test-story_35743936500589505/chapter-6-c_333"},
    ]

    spider._range_start = 5
    spider._range_end = 6
    assert [link["chapter_number"] for link in spider._select_chapters(links, links[0]["url"])] == [5, 6]

    spider._range_start = None
    spider._range_end = None
    spider.limit = 2
    assert [link["chapter_number"] for link in spider._select_chapters(links, links[1]["url"])] == [5, 6]


def test_extract_chapter_content_from_cha_words() -> None:
    spider = _spider()
    html = """
    <main>
      <div class="cha-words">
        <p>First paragraph.</p>
        <script>ignored()</script>
        <p>Second paragraph.</p>
      </div>
    </main>
    """

    content = spider._extract_chapter_content(BeautifulSoup(html, "html.parser"))

    assert content == "First paragraph.\n\nSecond paragraph."
