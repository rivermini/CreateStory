"""Text cleaning utilities for scraped chapter content."""

import re
from typing import Iterable

DEFAULT_PROMO_PATTERNS: list[str] = [
    r"innread\.com", r"bednovel\.com", r"innnovel\.com",
    r"libread\.com", r"libread\.org",
    r"Please keep reading on", r"Keep reading on",
    r"Follow current novels on", r"Search .+ on google",
    r"Please reading on", r"Thank you for reading on",
    r"Share this story", r"Report Story", r"Add to library",
]


def build_promo_patterns(extra: Iterable[str] = ()) -> re.Pattern:
    all_patterns = list(DEFAULT_PROMO_PATTERNS) + list(extra)
    escaped = [re.escape(p) for p in all_patterns]
    combined = "|".join(escaped)
    return re.compile(combined, re.IGNORECASE)


def clean_chapter_content(text: str, promo_patterns: re.Pattern | None = None) -> str:
    if promo_patterns is None:
        promo_patterns = build_promo_patterns()

    lines = text.replace("\r\n", "\n").split("\n")

    cleaned_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if promo_patterns.search(stripped):
            continue
        cleaned_lines.append(stripped)

    return "\n\n".join(cleaned_lines).strip()


def normalize_whitespace(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
