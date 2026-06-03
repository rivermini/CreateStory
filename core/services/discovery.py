"""Story discovery logic for the AutoAudio service."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from core.models import AutoAudioSession, MissingChapterInfo, StoryMissingAudio
from core.services.external_api import ExternalAPIClient


class StoryDiscovery:
    """Discovers which stories have chapters missing audio."""

    def __init__(self, api_client: ExternalAPIClient) -> None:
        self._api = api_client
        self._max_workers = 8

    def _fetch_story_with_chapters(
        self,
        story_id: str,
        story_metadata: dict[str, dict],
    ) -> Optional[dict]:
        chapters = self._api.fetch_story_chapters(story_id)
        if not chapters:
            return None
        return {
            "storyId": story_id,
            **story_metadata.get(story_id, {}),
            "_chapters": chapters,
        }

    def _fetch_existing_voice(self, story_id: str) -> Optional[str]:
        existing_audio = self._api.fetch_story_audio(story_id)
        for audio in existing_audio:
            voice = audio.get("voice", "")
            if voice:
                return voice
        return None

    def discover(
        self,
        session: AutoAudioSession,
        story_ids: list[str],
        story_metadata: Optional[dict[str, dict]] = None,
    ) -> list[StoryMissingAudio]:
        session.set_step(2, "Discovering stories with missing audio")

        if story_metadata is None:
            story_metadata = {}

        if session.test_mode:
            session.add_log(2, f"Test mode: checking {len(story_ids)} test story IDs")
            stories_raw: list[dict] = []
            for sid in story_ids:
                entry = self._fetch_story_with_chapters(sid, story_metadata)
                if entry:
                    if "title" not in entry or not entry["title"]:
                        entry["title"] = f"Test Story {sid[:8]}"
                    stories_raw.append(entry)
        else:
            session.add_log(2, f"Discovering stories with missing audio among {len(story_ids)} stories...")
            stories_raw = []
            max_workers = min(self._max_workers, max(1, len(story_ids)))
            executor = ThreadPoolExecutor(max_workers=max_workers)
            try:
                future_by_story_id = {
                    executor.submit(self._fetch_story_with_chapters, sid, story_metadata): sid
                    for sid in story_ids
                }
                for future in as_completed(future_by_story_id):
                    if session._stopping:
                        break
                    try:
                        entry = future.result()
                    except Exception as exc:
                        sid = future_by_story_id[future]
                        session.add_log(
                            2,
                            f"Failed to fetch chapters for story {sid}: {exc}",
                            level="warning",
                        )
                        continue
                    if entry:
                        stories_raw.append(entry)
            finally:
                executor.shutdown(wait=not session._stopping, cancel_futures=session._stopping)

        session.add_log(2, f"Found {len(stories_raw)} stories to check — starting chapter checks...")

        missing_audio_stories: list[StoryMissingAudio] = []

        for idx, raw_story in enumerate(stories_raw):
            if session._stopping:
                session.add_log(2, "Stop requested, halting discovery", level="warning")
                break

            story_id = raw_story.get("storyId") or raw_story.get("story_id")
            if not story_id:
                continue
            story_title = raw_story.get("title", "Untitled")

            session.set_step(2, "Discovering stories with missing audio", story=story_title)

            if "_chapters" in raw_story:
                chapters = raw_story["_chapters"]
            else:
                chapters = self._api.fetch_story_chapters(story_id)

            missing: list[MissingChapterInfo] = []
            for ch in chapters:
                if session._stopping:
                    break

                chapter_id = ch.get("chapterId") or ch.get("id") or ""
                chapter_index = ch.get("index") or ch.get("chapterNumber") or ch.get("chapter_number") or 0
                title = ch.get("title", f"Chapter {chapter_index}")
                audio_url = ch.get("audioUrl") or ch.get("audio_url") or ""
                if not audio_url:
                    missing.append(MissingChapterInfo(
                        chapter_id=str(chapter_id),
                        chapter_index=chapter_index,
                        title=title,
                    ))

            if missing:
                missing_audio_stories.append(StoryMissingAudio(
                    story_id=str(story_id),
                    story_title=story_title,
                    missing_chapters=missing,
                    existing_voice=None,
                ))

        if missing_audio_stories:
            max_workers = min(self._max_workers, len(missing_audio_stories))
            executor = ThreadPoolExecutor(max_workers=max_workers)
            try:
                future_by_story = {
                    executor.submit(self._fetch_existing_voice, s.story_id): s
                    for s in missing_audio_stories
                }
                for future in as_completed(future_by_story):
                    if session._stopping:
                        break
                    story = future_by_story[future]
                    try:
                        story.existing_voice = future.result()
                    except Exception:
                        story.existing_voice = None
            finally:
                executor.shutdown(wait=not session._stopping, cancel_futures=session._stopping)

        stopped = session._stopping
        session.add_log(
            2,
            f"Found {len(missing_audio_stories)} stories with missing audio"
            f"{' (stopped early)' if stopped else ''}",
        )
        return missing_audio_stories
