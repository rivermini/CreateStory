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


def test_resolve_server_chapter_max_keeps_larger_metadata_value():
    service = MainBEClientMixin()
    service._config = object()
    service._current_log = []
    service.append_job_log = lambda *args, **kwargs: None
    service.get_server_chapter_data = lambda story_id, max_chapter=26: {
        "numbers": list(range(1, 17)),
        "titles": {},
    }
    service._get_story_max_chapter = lambda story_id: 26

    assert service.resolve_server_chapter_max("story-1", fallback=26) == 26
