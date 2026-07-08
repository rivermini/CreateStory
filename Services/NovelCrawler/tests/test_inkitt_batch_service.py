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

from api.services.inkitt_batch_service import extract_completed_story_refs, extract_story_quality


def test_extract_completed_story_refs_skips_ongoing() -> None:
    html = """
    <main>
      <article>
        <h4><a href="/stories/111">Complete Story</a></h4>
        <p>Summary text goes here for the card.</p>
        <p>Romance by Jane Doe • Complete • 20 chapters</p>
        <p>Show Reviews (66)</p>
      </article>
      <article>
        <h4><a href="/stories/222">Ongoing Story</a></h4>
        <p>Romance by John Doe • Ongoing • 11 chapters</p>
        <p>Show Reviews (12)</p>
      </article>
    </main>
    """

    refs = extract_completed_story_refs(BeautifulSoup(html, "html.parser"), "romance", "Romance")

    assert len(refs) == 1
    assert refs[0]["story_id"] == "111"
    assert refs[0]["title"] == "Complete Story"
    assert refs[0]["author"] == "Jane Doe"
    assert refs[0]["total_chapters"] == 20
    assert refs[0]["review_count"] == 66


def test_extract_story_quality_rating_reviews_and_reads() -> None:
    html = """
    <section>
      <dl>
        <dt>Rating</dt>
        <dd>4.8 66 reviews</dd>
      </dl>
      <p>12.5K reads</p>
      <a href="/genres/romance">Romance</a>
      <a href="/topics/werewolf">Werewolf</a>
    </section>
    """

    quality = extract_story_quality(BeautifulSoup(html, "html.parser"))

    assert quality["rating"] == 4.8
    assert quality["review_count"] == 66
    assert quality["read_count"] == 12500
    assert quality["tags"] == ["Romance", "Werewolf"]
