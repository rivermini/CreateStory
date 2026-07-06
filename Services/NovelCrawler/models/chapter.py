"""Chapter item model used by all spiders."""

from dataclasses import asdict, dataclass, field
from typing import Optional


@dataclass
class Chapter:
    novel_slug: str
    novel_title: str
    chapter_number: int
    title: str
    content: str
    source_url: str
    novel_metadata: Optional[dict] = field(default=None)

    def asdict(self) -> dict:
        return asdict(self)
