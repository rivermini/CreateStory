"""SSE event generator for crawl streaming."""

import asyncio
import json
from typing import AsyncGenerator

from api.services.crawler_service import get_crawl_service


async def crawl_event_generator(crawl_id: str) -> AsyncGenerator[dict, None]:
    """
    Async generator that yields SSE events for a crawl session.

    Yields dicts suitable for sse-starlette's EventSourceResponse:
      {"event": "log",     "data": json_string}
      {"event": "progress", "data": json_string}
      {"event": "done",    "data": json_string}
      {"event": "error",   "data": json_string}
    """
    service = get_crawl_service()
    progress = service.get_progress(crawl_id)
    if progress is None:
        yield {"event": "error", "data": json.dumps({"message": "Crawl not found."})}
        return

    last_seen_idx = 0
    last_status = progress.status

    while True:
        progress = service.get_progress(crawl_id)
        if progress is None:
            yield {"event": "error", "data": json.dumps({"message": "Crawl session lost."})}
            break

        current_status = progress.status

        new_lines = progress.log_lines[last_seen_idx:]
        for entry in new_lines:
            yield {
                "event": "log",
                "data": json.dumps({
                    "timestamp": entry.timestamp,
                    "message": entry.message,
                    "level": entry.level,
                }),
            }
        if new_lines:
            last_seen_idx = len(progress.log_lines)

        should_emit = current_status != last_status
        if not should_emit:
            should_emit = current_status == "running"

        if should_emit:
            payload = {
                "chapters_crawled": progress.chapters_crawled,
                "chapters_total": progress.chapters_total,
                "current_title": progress.current_title,
                "status": current_status,
                "source_url": progress.source_url or None,
                "started_at": progress.started_at,
            }
            if current_status == "failed" and progress.error_message:
                payload["error_message"] = progress.error_message
            yield {"event": "progress", "data": json.dumps(payload)}
            last_status = current_status

        if current_status in ("completed", "failed", "cancelled"):
            payload = {
                "status": current_status,
                "chapters_crawled": progress.chapters_crawled,
                "chapters_total": progress.chapters_total,
                "source_url": progress.source_url or None,
                "started_at": progress.started_at,
            }
            if current_status == "failed":
                payload["error_message"] = progress.error_message
            yield {"event": "done", "data": json.dumps(payload)}
            break

        await asyncio.sleep(0.5)
