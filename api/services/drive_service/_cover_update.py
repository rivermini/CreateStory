"""CoverUpdateMixin — cover update logic for DriveSyncService."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from api.models.drive_sync import DriveSyncConfig

_COVER_UPDATE_FOLDER_PREFIXES = {"DONE", "EXTENDED"}


def _is_cover_update_folder(folder: dict) -> bool:
    return folder.get("prefix") in _COVER_UPDATE_FOLDER_PREFIXES


def _normalize_cover_status(status: Optional[str]) -> str:
    if status in {"no_cover_file", "no_cover1_file"}:
        return "no_cover1_file"
    return status or "unknown"


def _cover_history_id(folder_id: str, status: str) -> str:
    suffix = "no_cover_file" if _normalize_cover_status(status) == "no_cover1_file" else status
    return f"cover-{folder_id}-{suffix}"


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


class CoverUpdateMixin:
    """
    Mix-in providing cover-update logic.

    Adds to DriveSyncService:
      - _find_cover1_file
      - _upload_story_cover_from_folder
      - _record_cover_update
      - check_extended_folders_for_cover
    """

    def _find_cover1_file(self, drive_service: Any, folder_id: str) -> Optional[dict]:
        """
        Search a story folder for 'cover1.jpg' (case-insensitive).
        Returns the file dict or None.
        """
        page_token = None
        while True:
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{folder_id}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false",
                    fields="files(id, name),nextPageToken",
                    pageSize=100,
                    pageToken=page_token,
                ).execute()
            try:
                from api.services.drive_service._drive_api import DriveAPIMixin
                response = DriveAPIMixin._retry_drive_call(self, _call)
            except Exception:
                break
            files = response.get("files", [])
            for f in files:
                if f.get("name", "").lower() == "cover1.jpg":
                    return f
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return None

    def _upload_story_cover_from_folder(self, story_id: str, folder_id: str) -> tuple[bool, Optional[str]]:
        """
        Download cover1.jpg from Drive and POST it to main BE /api/v1/story/{id}/upload-cover.
        Returns (success, cover_url_or_error_message).
        """
        from api.services.drive_service._drive_api import DriveAPIMixin

        try:
            drive_service = self._build_drive_service()
        except Exception as exc:
            return False, f"Failed to authenticate with Google Drive: {exc}"

        cover_file = self._find_cover1_file(drive_service, folder_id)
        if cover_file is None:
            return False, "cover1.jpg not found in Drive folder"

        try:
            cover_bytes = DriveAPIMixin._download_cover_image_bytes(self, drive_service, cover_file["id"])
        except Exception as exc:
            return False, f"Failed to download cover1.jpg from Drive: {exc}"

        try:
            cover_url = self._upload_cover_image(story_id, cover_bytes, cover_file["name"])
        except Exception as exc:
            return False, f"Failed to upload cover to main BE: {exc}"

        if cover_url:
            return True, cover_url
        return False, "Cover upload returned no URL"

    def _record_cover_update(
        self,
        story_id: Optional[str],
        story_title: str,
        folder_id: str,
        folder_name: str,
        status: str,
        cover_file_name: Optional[str] = None,
        cover_url: Optional[str] = None,
        error: Optional[str] = None,
    ) -> dict:
        """Persist a cover update record to the DB. Returns the saved record dict."""
        now = datetime.now(timezone.utc)
        normalized_status = _normalize_cover_status(status)
        entry = {
            "id": _cover_history_id(folder_id, normalized_status),
            "story_id": story_id or "",
            "story_title": story_title,
            "folder_id": folder_id,
            "folder_name": folder_name,
            "display_name": story_title or folder_name,
            "cover_file_name": cover_file_name,
            "status": normalized_status,
            "cover_url": cover_url,
            "error": error,
            "finished_at": now.isoformat(),
            "last_updated": now,
            "created_at": now,
            "updated_at": now,
        }
        self._repo.save_cover_update_history(entry)
        return entry

    def get_cover_update_histories_for_cover_update_folders(self) -> list[dict]:
        """
        Return the latest updated/no-cover history row for current DONE_/EXTENDED_ folders.
        """
        drive_folders_raw, _ = self.list_drive_folders(limit=10000, offset=0)
        cover_update_folders_by_id = {
            f.get("id"): f
            for f in drive_folders_raw
            if _is_cover_update_folder(f) and f.get("id")
        }

        latest_by_folder_id: dict[str, dict] = {}
        for history in self._repo.load_cover_update_histories():
            folder_id = history.get("folder_id")
            status = _normalize_cover_status(history.get("status"))
            if folder_id not in cover_update_folders_by_id or status not in {"updated", "no_cover1_file"}:
                continue
            if folder_id in latest_by_folder_id:
                continue
            folder = cover_update_folders_by_id[folder_id]
            latest_by_folder_id[folder_id] = {
                **history,
                "status": status,
                "story_title": history.get("story_title") or folder.get("display_name", ""),
                "folder_name": folder.get("name", history.get("folder_name", "")),
            }

        return list(latest_by_folder_id.values())

    def get_cover_update_histories_for_extended_folders(self) -> list[dict]:
        """Backward-compatible alias for older route code."""
        return self.get_cover_update_histories_for_cover_update_folders()

    def check_extended_folders_for_cover(self) -> dict:
        """
        Scan all DONE_/EXTENDED_ folders, check for cover1.jpg, cross-reference
        against cover_update_histories and server stories.
        Returns categorized results.
        """
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")

        drive_folders_raw, _ = self.list_drive_folders(limit=10000, offset=0)
        cover_update_folders = [f for f in drive_folders_raw if _is_cover_update_folder(f)]

        cover_histories = self._repo.load_cover_update_histories()
        history_by_folder_id: dict[str, dict] = {}
        for history in cover_histories:
            folder_id = history.get("folder_id")
            if folder_id and folder_id not in history_by_folder_id:
                history_by_folder_id[folder_id] = history

        server_stories = self.get_all_server_stories()
        server_by_title_lower: dict[str, dict] = {}
        for s in server_stories:
            title = s.get("title", "").strip().lower()
            if title:
                server_by_title_lower[title] = s

        drive_service = self._build_drive_service()
        cover_files_by_folder_id = self._batch_find_cover1_files(
            drive_service,
            [folder["id"] for folder in cover_update_folders],
        )

        can_update: list[dict] = []
        updated: list[dict] = []
        no_cover1: list[dict] = []
        no_server_match: list[dict] = []

        for folder in cover_update_folders:
            folder_id = folder["id"]
            folder_name = folder["name"]
            display_name = folder.get("display_name", "")
            title_lower = display_name.lower()

            history = history_by_folder_id.get(folder_id)
            history_status = _normalize_cover_status(history.get("status")) if history else None
            server_story = server_by_title_lower.get(title_lower)

            cover1 = cover_files_by_folder_id.get(folder_id)

            entry_base = {
                "story_id": server_story.get("id") if server_story else None,
                "story_title": display_name,
                "folder_id": folder_id,
                "folder_name": folder_name,
                "cover_file_name": cover1.get("name") if cover1 else None,
            }

            if cover1 is None:
                saved = self._record_cover_update(
                    story_id=server_story.get("id") if server_story else None,
                    story_title=display_name,
                    folder_id=folder_id,
                    folder_name=folder_name,
                    status="no_cover1_file",
                    cover_file_name=None,
                    error="No cover1 file",
                )
                entry = {**entry_base, "status": "no_cover1_file", "last_updated": _iso(saved.get("last_updated"))}
                no_cover1.append(entry)
                continue

            if history_status == "no_cover1_file":
                entry = {
                    **entry_base,
                    "status": "no_cover1_file",
                    "last_updated": history.get("last_updated") if history else None,
                }
                no_cover1.append(entry)
                continue

            if server_story is None:
                entry = {**entry_base, "status": "no_server_match", "last_updated": history.get("last_updated") if history else None}
                no_server_match.append(entry)
                continue

            if history_status == "updated":
                entry = {**entry_base, "status": "updated", "last_updated": history.get("last_updated")}
                updated.append(entry)
            else:
                entry = {**entry_base, "status": "can_update", "last_updated": None}
                can_update.append(entry)

        return {
            "can_update": can_update,
            "updated": updated,
            "no_cover1_file": no_cover1,
            "no_server_match": no_server_match,
        }
