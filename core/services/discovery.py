"""Story discovery logic for the AutoAudio service."""

from __future__ import annotations

from typing import Optional

from core.models import AutoAudioSession, MissingChapterInfo, StoryMissingAudio
from core.services.external_api import ExternalAPIClient


class StoryDiscovery:
    """Discovers which stories have chapters missing audio."""

    def __init__(self, api_client: ExternalAPIClient) -> None:
        self._api = api_client

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
                chapters = self._api.fetch_story_chapters(sid)
                if chapters:
                    entry = {**story_metadata.get(sid, {}), "storyId": sid, "_chapters": chapters}
                    if "title" not in entry or not entry["title"]:
                        entry["title"] = f"Test Story {sid[:8]}"
                    stories_raw.append(entry)
        else:
            session.add_log(2, f"Discovering stories with missing audio among {len(story_ids)} stories...")
            stories_raw = [
                {"storyId": sid, **story_metadata.get(sid, {}),
                 "_chapters": self._api.fetch_story_chapters(sid)}
                for sid in story_ids
                if self._api.fetch_story_chapters(sid)
            ]

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
                existing_voice: Optional[str] = None
                existing_audio = self._api.fetch_story_audio(story_id)
                if existing_audio:
                    for audio in existing_audio:
                        v = audio.get("voice", "")
                        if v:
                            existing_voice = v
                            break

                missing_audio_stories.append(StoryMissingAudio(
                    story_id=str(story_id),
                    story_title=story_title,
                    missing_chapters=missing,
                    existing_voice=existing_voice,
                ))

        stopped = session._stopping
        session.add_log(
            2,
            f"Found {len(missing_audio_stories)} stories with missing audio"
            f"{' (stopped early)' if stopped else ''}",
        )
        return missing_audio_stories
