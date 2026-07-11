from api.services.drive_service._main_be_client import MainBEClientMixin


def test_story_ref_uses_total_chapters_when_max_chapter_missing():
    story = {
        "id": "story-1",
        "title": "Story",
        "maxChapter": None,
        "totalChapters": 16,
    }

    assert MainBEClientMixin._story_ref_from_api(story) == {
        "id": "story-1",
        "title": "Story",
        "maxChapter": 16,
    }


def test_story_ref_uses_nested_count_when_chapter_fields_missing():
    story = {
        "id": "story-1",
        "title": "Story",
        "maxChapter": None,
        "_count": {"chapters": 16},
    }

    assert MainBEClientMixin._story_ref_from_api(story)["maxChapter"] == 16


def test_resolve_server_chapter_max_uses_actual_existing_chapters():
    service = MainBEClientMixin()
    service._config = object()
    service._current_log = []
    service.append_job_log = lambda *args, **kwargs: None
    service.get_server_chapter_data = lambda story_id, max_chapter=0: {
        "numbers": list(range(1, 17)),
        "titles": {},
    }
    service._get_story_max_chapter = lambda story_id: 0

    assert service.resolve_server_chapter_max("story-1", fallback=0) == 16


def test_resolve_server_chapter_max_ignores_inflated_max_chapter():
    """resolve must reflect ACTUAL chapters present, never the maxChapter target.

    A reskin story can set maxChapter far above the chapters actually uploaded
    (max_chapter.md -> 1198 while only 16 chapters exist). resolve must return 16
    so pending Drive chapters are not hidden as 'up-to-date'.
    """
    service = MainBEClientMixin()
    service._config = object()
    service._current_log = []
    service.append_job_log = lambda *args, **kwargs: None
    service.get_server_chapter_data = lambda story_id, max_chapter=0: {
        "numbers": list(range(1, 17)),
        "titles": {},
    }
    service._get_story_chapter_count = lambda story_id: 16

    assert service.resolve_server_chapter_max("story-1", fallback=1198) == 16


def test_resolve_server_chapter_max_falls_back_to_chapter_count_when_list_empty():
    """When the live chapter list is unavailable, resolve uses chapterCount (the
    actual uploaded count) — never the inflated maxChapter fallback."""
    service = MainBEClientMixin()
    service._config = object()
    service._current_log = []
    service.append_job_log = lambda *args, **kwargs: None
    service.get_server_chapter_data = lambda story_id, max_chapter=0: {"numbers": [], "titles": {}}
    service._get_story_chapter_count = lambda story_id: 6

    assert service.resolve_server_chapter_max("story-1", fallback=1198) == 6
