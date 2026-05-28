"""Shared utilities and models for drive sync routes."""

from pydantic import BaseModel
from typing import Optional

from api.services.drive_service import _RE_SOURCE_SUFFIX


def _is_valid_upload_format(folder_name: str) -> bool:
    """
    Correct format: PREFIX_{...}_{platform} - {title}
    where platform is one of: wp, gd, Goodnovel (case-insensitive).
    Must contain ' - ' after the status prefix AND a valid platform token
    between the prefix and ' - '.
    """
    dash_pos = folder_name.find(" - ")
    if dash_pos == -1:
        return False

    prefix_end = folder_name.find("_")
    if prefix_end == -1 or dash_pos <= prefix_end:
        return False

    between_prefix_and_dash = folder_name[prefix_end:dash_pos]
    return _RE_SOURCE_SUFFIX.search(between_prefix_and_dash) is not None


class DriveChapterPreview(BaseModel):
    file_name: str
    index: int
    title: str
    content_preview: str
    content_length: int
    download_error: bool


class DriveStoryPreview(BaseModel):
    folder_id: str
    folder_name: str
    prefix: str
    display_name: str
    is_completed: bool
    chapter_count: int
    modified_time: Optional[str] = None
    chapters: list[DriveChapterPreview]


class DriveFolderEntry(BaseModel):
    id: str
    name: str
    prefix: str
    display_name: str
    is_completed: bool
    is_valid_format: bool = True
    has_chapter_duplicates: bool = False
    validation_errors: list[str] = []
    chapter_count: Optional[int] = None
    extended_chapter_count: Optional[int] = None
    modified_time: Optional[str] = None


class DriveFolderListResponse(BaseModel):
    folders: list[DriveFolderEntry]
    total: int
    limit: int
    offset: int


class ServerStoryRef(BaseModel):
    id: str
    title: str
    maxChapter: int


class CheckUploadableResponse(BaseModel):
    drive_folders: list[DriveFolderEntry]
    server_stories: list[ServerStoryRef]
    uploadable: list[DriveFolderEntry]
    already_on_server: list[DriveFolderEntry]
    invalid: list[DriveFolderEntry] = []


class UpdatableStoryEntry(BaseModel):
    folder: DriveFolderEntry
    server_story: ServerStoryRef
    new_chapters_count: int = 0
    free_chapters_count: Optional[int] = None
    tags: Optional[list[str]] = None
    has_free_md: bool = False
    has_tags_md: bool = False
    last_updated: Optional[str] = None


class ServerOnlyStoryEntry(BaseModel):
    server_story: ServerStoryRef
    last_updated: Optional[str] = None


class CheckUpdatableResponse(BaseModel):
    all_extended_folders: list
    server_stories: list[ServerStoryRef]
    updatable: list[UpdatableStoryEntry]
    no_update_needed: list[UpdatableStoryEntry]
    no_server_match: list[DriveFolderEntry] = []
    empty_extended: list[DriveFolderEntry] = []
    invalid: list[UpdatableStoryEntry] = []
    no_drive_folder: list[ServerOnlyStoryEntry] = []
