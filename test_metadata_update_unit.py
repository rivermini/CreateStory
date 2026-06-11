"""Fast in-memory checks for metadata update helpers."""

from __future__ import annotations

from api.services.drive_service._metadata_update import (
    _batch_list_metadata_files,
    _parse_file_content,
)


class _Execute:
    def __init__(self, response: dict):
        self._response = response

    def execute(self) -> dict:
        return self._response


class _Files:
    def __init__(self) -> None:
        self.list_calls: list[dict] = []

    def list(self, **kwargs) -> _Execute:
        self.list_calls.append(kwargs)
        return _Execute({
            "files": [
                {
                    "id": "free-file",
                    "name": "free.md",
                    "parents": ["folder-1"],
                    "mimeType": "text/markdown",
                },
                {
                    "id": "tags-file",
                    "name": "tags.md",
                    "parents": ["folder-2"],
                    "mimeType": "text/markdown",
                },
            ],
            "nextPageToken": None,
        })


class _Drive:
    def __init__(self) -> None:
        self._files = _Files()

    def files(self) -> _Files:
        return self._files


def test_batch_list_metadata_files_uses_one_query_for_one_chunk() -> None:
    drive = _Drive()

    result = _batch_list_metadata_files(
        drive,
        ["folder-1", "folder-2"],
        lambda fn: fn(),
    )

    assert len(drive._files.list_calls) == 1
    call = drive._files.list_calls[0]
    assert "name='Category.md' or name='free.md'" in call["q"]
    assert "files(id, name, parents, mimeType)" in call["fields"]
    assert result["folder-1"]["free.md"]["id"] == "free-file"
    assert result["folder-2"]["tags.md"]["id"] == "tags-file"


def test_parse_file_content_maps_known_metadata_types() -> None:
    assert _parse_file_content("free.md", "12\n") == 12
    assert _parse_file_content("push.md", "Title: Hi\nContent: There") == ("Hi", "There")
    assert _parse_file_content("tags.md", "alpha, beta") == ["alpha", "beta"]
    category = _parse_file_content("category.md", "Main Category: Billionaire Romance")
    assert category == ("1550cd02-d20b-4fc3-9dce-6c8c5ccaba11", [])
