"""Small, site-neutral helpers shared by persistent crawler batch services."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, TypeVar

T = TypeVar("T")


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def validate_batch_id(batch_id: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{8}", batch_id or ""))


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)


def filter_rows(rows: Iterable[T], status: str) -> list[T]:
    values = list(rows)
    if status == "all":
        return values
    return [row for row in values if getattr(row, "status", None) == status]


def parse_local_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def estimate_progress(
    *,
    total_stories: int,
    processed_stories: int,
    known_total_chapters: int,
    crawled_chapters: int,
    elapsed_seconds: float,
) -> dict[str, Any]:
    remaining_stories = max(0, total_stories - processed_stories)
    average_known = known_total_chapters / max(1, processed_stories) if processed_stories else 0.0
    estimated_total = max(known_total_chapters, int(round(known_total_chapters + remaining_stories * average_known)))
    remaining_chapters = max(0, estimated_total - crawled_chapters)
    chapters_per_hour = (crawled_chapters * 3600 / elapsed_seconds) if elapsed_seconds >= 30 and crawled_chapters else None
    remaining_seconds = (remaining_chapters * 3600 / chapters_per_hour) if chapters_per_hour else None
    finished_at = None
    if remaining_seconds is not None:
        finished_at = datetime.fromtimestamp(datetime.now().timestamp() + remaining_seconds).strftime("%Y-%m-%d %H:%M:%S")
    return {
        "remaining_stories": remaining_stories,
        "remaining_chapters": remaining_chapters,
        "known_remaining_chapters": max(0, known_total_chapters - crawled_chapters),
        "estimated_total_chapters": estimated_total,
        "known_total_chapters": known_total_chapters,
        "elapsed_seconds": max(0, int(elapsed_seconds)),
        "chapters_per_hour": chapters_per_hour,
        "recent_chapters_per_hour": chapters_per_hour,
        "effective_chapters_per_hour": chapters_per_hour,
        "stories_per_hour": (processed_stories * 3600 / elapsed_seconds) if elapsed_seconds >= 30 and processed_stories else None,
        "recent_stories_per_hour": None,
        "estimated_remaining_seconds": remaining_seconds,
        "estimated_finished_at": finished_at,
        "source": "all_time_chapters" if chapters_per_hour else ("complete" if remaining_stories == 0 else "insufficient_data"),
    }
