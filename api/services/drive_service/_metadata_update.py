"""MetadataUpdateMixin -- metadata update logic for DriveSyncService."""

from __future__ import annotations

import logging
import re
import ssl
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Optional

from api.services.drive_service._paths import (
    _CATEGORY_MAP,
    _CHECK_BATCH_CHUNK_SIZE,
    _CHECK_BATCH_PAGE_SIZE,
    _DRIVE_CALL_BACKOFF_BASE,
    _DRIVE_CALL_RETRIES,
    _positive_int_from_env,
)

_METADATA_UPDATE_WORKERS = _positive_int_from_env("DRIVE_SYNC_METADATA_WORKERS", 12)
_METADATA_DOWNLOAD_CONCURRENCY = _positive_int_from_env(
    "DRIVE_SYNC_METADATA_DOWNLOAD_CONCURRENCY",
    _METADATA_UPDATE_WORKERS,
)
_METADATA_DOWNLOAD_SEMAPHORE = threading.BoundedSemaphore(_METADATA_DOWNLOAD_CONCURRENCY)
_METADATA_FILE_NAMES = ("Category.md", "free.md", "Push.md", "Synopsis.md", "synopsis.md", "tags.md")
_METADATA_FIELDS = ("category", "free_chapters_count", "push", "synopsis", "tags")
_METADATA_FIELD_FILES = {
    "category": ("category.md",),
    "free_chapters_count": ("free.md",),
    "push": ("push.md",),
    "synopsis": ("synopsis.md",),
    "tags": ("tags.md",),
}
_METADATA_FIELD_PRIMARY_FILE = {
    "category": "Category.md",
    "free_chapters_count": "free.md",
    "push": "Push.md",
    "synopsis": "Synopsis.md",
    "tags": "tags.md",
}
_METADATA_CACHE_SETTING_KEY = "metadata_update_content_cache"
_METADATA_CACHE_MAX_ENTRIES = 5000
_SERVER_VALUES_CACHE_SETTING_KEY = "metadata_update_server_values_cache"
_SERVER_VALUES_CACHE_MAX_ENTRIES = 2000

logger = logging.getLogger(__name__)


class _Phase:
    def __init__(self, name: str):
        self.name = name
        self._t0: float = 0.0

    def __enter__(self):
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, *args):
        elapsed = time.perf_counter() - self._t0
        logger.info("[METADATA-PERF] %s: %.2fs", self.name, elapsed)


# -------------------------------------------------------------------------
# Normalization helpers
# -------------------------------------------------------------------------


def _normalize_for_compare(value: str | None) -> str:
    if value is None:
        return ""
    value = value.strip()
    return re.sub(r"\s+", " ", value)


def _tags_match(folder_tags: list[str], server_tags: list[str]) -> bool:
    folder_set = {t.strip().lower() for t in folder_tags if t.strip()}
    server_set = {t.strip().lower() for t in server_tags if t.strip()}
    return folder_set == server_set


def _categories_match(
    folder_main: str | None,
    folder_sub: str | None,
    server_main: str | None,
    server_subs: list[str],
) -> bool:
    folder_cats = {c.strip().lower() for c in [folder_main, folder_sub] if c and c.strip()}
    server_cats = {c.strip().lower() for c in [server_main] + server_subs if c and c.strip()}
    return folder_cats == server_cats


# -------------------------------------------------------------------------
# Content-only parsers (no Drive API calls -- just raw text)
# -------------------------------------------------------------------------


def _parse_category_content(content: str | None) -> tuple[Optional[str], Optional[str]]:
    """
    Parse Category.md raw content.
    Returns (main_category_name, sub_category_name) from the file content.
    The actual name-to-ID mapping is done by _id_to_name() after extraction.
    """
    if not content:
        return None, None

    main_name: Optional[str] = None
    sub_name: Optional[str] = None

    for line in content.split("\n"):
        stripped = line.strip().strip("\ufeff").lower()
        if not stripped or stripped.startswith("#"):
            continue
        if "main category:" in stripped:
            main_name = stripped.split("main category:", 1)[1].strip()
        elif "sub category:" in stripped:
            sub_name = stripped.split("sub category:", 1)[1].strip()
        elif main_name is None:
            main_name = stripped
        elif sub_name is None:
            sub_name = stripped
            break

    return main_name, sub_name


def _parse_free_content(content: str | None) -> Optional[int]:
    if not content:
        return None
    try:
        return int(content.strip().split("\n")[0])
    except (ValueError, IndexError):
        return None


def _parse_push_content(content: str | None) -> tuple[Optional[str], Optional[str]]:
    if not content:
        return None, None
    title: Optional[str] = None
    notif_content: Optional[str] = None
    for line in content.split("\n"):
        stripped = line.strip().strip("\ufeff")
        lowered = stripped.lower()
        if lowered.startswith("title:"):
            title = stripped[6:].strip()
        elif lowered.startswith("content:"):
            notif_content = stripped[8:].strip()
    return title, notif_content


def _parse_synopsis_content(content: str | None) -> Optional[str]:
    if not content:
        return None
    lines = []
    in_section = False
    for line in content.split("\n"):
        stripped = line.strip()
        if stripped.lower().startswith("# synopsis"):
            in_section = True
            continue
        if in_section and stripped.startswith("#"):
            break
        if stripped:
            lines.append(stripped)
    return " ".join(lines) if lines else None


def _parse_tags_content(content: str | None) -> list[str]:
    if not content:
        return []
    tags = []
    for line in content.split("\n"):
        line = line.strip().strip("\ufeff")
        if not line or line.startswith("#"):
            continue
        parts = line.split(",") if "," in line else line.split()
        for tag in parts:
            tag = tag.strip().strip('"').strip("'")
            if tag:
                tags.append(tag)
    return tags


# -------------------------------------------------------------------------
# Category ID <-> name lookup
# -------------------------------------------------------------------------

_CATEGORY_ID_TO_NAME: dict[str, str] = {
    "154971fe-7da7-41c4-91ee-b2a9613d6fa0": "Fantasy",
    "2d2614d9-2b25-4d1f-bb0a-fb333193de19": "Werewolf",
    "17c9779b-7107-4b24-a020-df735e1dd6cb": "Romance",
    "1550cd02-d20b-4fc3-9dce-6c8c5ccaba11": "Billionaire",
    "8dabb3e8-3e6c-4b20-9b48-cb7bd028cecf": "LGBTQ",
}


def _id_to_name(cat_id: str | None) -> str | None:
    if not cat_id:
        return None
    return _CATEGORY_ID_TO_NAME.get(cat_id, cat_id)


_NAME_TO_CATEGORY_ID: dict[str, str] = {
    v.lower(): k for k, v in _CATEGORY_ID_TO_NAME.items()
}


def _name_to_category_id(name: str | None) -> str | None:
    if not name:
        return None
    direct = _NAME_TO_CATEGORY_ID.get(name.strip().lower())
    if direct:
        return direct
    key = name.strip().lower().replace(" ", "").replace("-", "").replace("_", "").replace("+", "")
    mapped = _CATEGORY_MAP.get(key)
    return mapped[0] if mapped else None


# -------------------------------------------------------------------------
# Batch Drive queries -- single OR-chain query per folder chunk
# -------------------------------------------------------------------------


def _batch_list_metadata_files(
    drive_service: Any,
    folder_ids: list[str],
    retry_fn: Callable,
) -> dict[str, dict[str, dict]]:
    """
    Batch-query Drive for all metadata files across all folders at once.
    Runs one Drive API query (with pagination) per folder chunk, using
    OR-chains over folder IDs and metadata filenames.

    Returns { folder_id: { filename_lower: file_info_dict } }
    """
    result: dict[str, dict[str, dict]] = {fid: {} for fid in folder_ids}
    if not folder_ids:
        return result

    name_clause = " or ".join(f"name='{name}'" for name in _METADATA_FILE_NAMES)
    for chunk_start in range(0, len(folder_ids), _CHECK_BATCH_CHUNK_SIZE):
        chunk = folder_ids[chunk_start:chunk_start + _CHECK_BATCH_CHUNK_SIZE]
        parents_clause = " or ".join(f'"{fid}" in parents' for fid in chunk)
        query = (
            f"({parents_clause}) and mimeType!='application/vnd.google-apps.folder' "
            f"and ({name_clause}) and trashed=false"
        )
        page_token: str | None = None
        while True:
            def _call() -> dict:
                return drive_service.files().list(
                    q=query,
                    fields=(
                        "files(id, name, parents, mimeType, modifiedTime, "
                        "md5Checksum, size, headRevisionId),nextPageToken"
                    ),
                    pageSize=_CHECK_BATCH_PAGE_SIZE,
                    pageToken=page_token,
                ).execute()

            try:
                response = retry_fn(_call)
            except (ssl.SSLError, TimeoutError):
                break

            for f in response.get("files", []):
                for parent in f.get("parents", []):
                    if parent in result and f.get("name", "").lower() not in result[parent]:
                        result[parent][f.get("name", "").lower()] = f

            page_token = response.get("nextPageToken")
            if not page_token:
                break

    return result


# -------------------------------------------------------------------------
# Batch download + parse metadata file content
# -------------------------------------------------------------------------


def _parse_file_content(fname_lower: str, content: str | None) -> Any:
    """Parse file content based on filename."""
    if content is None or isinstance(content, Exception):
        return content

    if fname_lower == "category.md":
        main_name, sub_name = _parse_category_content(content)
        main_cat_id = _name_to_category_id(main_name)
        sub_cat_id = _name_to_category_id(sub_name)
        return (main_cat_id, [sub_cat_id] if sub_cat_id else [])
    elif fname_lower == "free.md":
        return _parse_free_content(content)
    elif fname_lower == "push.md":
        return _parse_push_content(content)
    elif fname_lower in ("synopsis.md", "synopsis.synopsis.md", "synopsis"):
        return _parse_synopsis_content(content)
    elif fname_lower == "tags.md":
        return _parse_tags_content(content)
    return content


def _normalize_metadata_fields(fields: list[str] | tuple[str, ...] | set[str]) -> list[str]:
    valid = set(_METADATA_FIELDS)
    normalized: list[str] = []
    for field in fields:
        if field in valid and field not in normalized:
            normalized.append(field)
    return normalized


def _field_for_file_name(fname_lower: str) -> str | None:
    for field, file_names in _METADATA_FIELD_FILES.items():
        if fname_lower in file_names:
            return field
    return None


def _summarize_difference(diff: dict) -> dict:
    field = diff.get("field", "")
    return {
        "field": field,
        "file_name": _METADATA_FIELD_PRIMARY_FILE.get(field),
        "folder_value": None,
        "server_value": None,
    }


def _metadata_cache_key(file_info: dict) -> str:
    parts = [
        file_info.get("id", ""),
        file_info.get("modifiedTime", ""),
        file_info.get("md5Checksum", ""),
        file_info.get("size", ""),
        file_info.get("headRevisionId", ""),
        file_info.get("mimeType", ""),
    ]
    return "|".join(str(part) for part in parts)


def _get_metadata_content_cache(service: Any) -> tuple[dict[str, Any], threading.Lock]:
    cache = getattr(service, "_metadata_content_cache", None)
    if cache is None:
        cache = _load_persistent_metadata_cache(service)
        setattr(service, "_metadata_content_cache", cache)
    lock = getattr(service, "_metadata_content_cache_lock", None)
    if lock is None:
        lock = threading.Lock()
        setattr(service, "_metadata_content_cache_lock", lock)
    return cache, lock


def _load_persistent_metadata_cache(service: Any) -> dict[str, Any]:
    if not hasattr(service, "_repo"):
        return {}
    try:
        raw = service._repo.load_app_setting(_METADATA_CACHE_SETTING_KEY)
    except Exception as exc:
        logger.debug("Failed to load metadata cache: %s", exc)
        return {}
    if not isinstance(raw, dict):
        return {}
    entries = raw.get("entries")
    return entries if isinstance(entries, dict) else {}


def _persist_metadata_content_cache(service: Any, cache: dict[str, Any]) -> None:
    if not hasattr(service, "_repo"):
        return
    try:
        if len(cache) > _METADATA_CACHE_MAX_ENTRIES:
            trimmed_items = list(cache.items())[-_METADATA_CACHE_MAX_ENTRIES:]
            cache.clear()
            cache.update(trimmed_items)
        service._repo.save_app_setting(_METADATA_CACHE_SETTING_KEY, {"entries": cache})
    except Exception as exc:
        logger.debug("Failed to persist metadata cache: %s", exc)


def _server_values_cache_key(story_ref: dict) -> str:
    story_id = story_ref.get("id", "")
    version = (
        story_ref.get("updatedAt")
        or story_ref.get("updated_at")
        or story_ref.get("modifiedAt")
        or story_ref.get("modified_at")
        or ""
    )
    return f"{story_id}|{version}"


def _get_server_values_cache(service: Any) -> tuple[dict[str, Any], threading.Lock]:
    cache = getattr(service, "_metadata_server_values_cache", None)
    if cache is None:
        cache = _load_persistent_server_values_cache(service)
        setattr(service, "_metadata_server_values_cache", cache)
    lock = getattr(service, "_metadata_server_values_cache_lock", None)
    if lock is None:
        lock = threading.Lock()
        setattr(service, "_metadata_server_values_cache_lock", lock)
    return cache, lock


def _load_persistent_server_values_cache(service: Any) -> dict[str, Any]:
    if not hasattr(service, "_repo"):
        return {}
    try:
        raw = service._repo.load_app_setting(_SERVER_VALUES_CACHE_SETTING_KEY)
    except Exception as exc:
        logger.debug("Failed to load metadata server values cache: %s", exc)
        return {}
    if not isinstance(raw, dict):
        return {}
    entries = raw.get("entries")
    return entries if isinstance(entries, dict) else {}


def _persist_server_values_cache(service: Any, cache: dict[str, Any]) -> None:
    if not hasattr(service, "_repo"):
        return
    try:
        if len(cache) > _SERVER_VALUES_CACHE_MAX_ENTRIES:
            trimmed_items = list(cache.items())[-_SERVER_VALUES_CACHE_MAX_ENTRIES:]
            cache.clear()
            cache.update(trimmed_items)
        service._repo.save_app_setting(_SERVER_VALUES_CACHE_SETTING_KEY, {"entries": cache})
    except Exception as exc:
        logger.debug("Failed to persist metadata server values cache: %s", exc)


def _batch_get_server_values(
    service: Any,
    story_refs: list[dict],
) -> dict[str, dict | None]:
    """Return extracted server metadata values, cached by story ID and updatedAt."""
    if not story_refs:
        return {}

    _get_server_values_cache(service)
    cache, cache_lock = _get_server_values_cache(service)
    values_by_id: dict[str, dict | None] = {}
    refs_to_fetch: list[dict] = []

    for story_ref in story_refs:
        story_id = story_ref.get("id")
        if not story_id:
            continue
        cache_key = _server_values_cache_key(story_ref)
        with cache_lock:
            cached = cache.get(cache_key)
        if isinstance(cached, dict):
            values_by_id[story_id] = cached
        else:
            refs_to_fetch.append(story_ref)

    if refs_to_fetch:
        stories_full = _batch_fetch_server_stories(
            service,
            [ref["id"] for ref in refs_to_fetch if ref.get("id")],
        )
        for story_ref in refs_to_fetch:
            story_id = story_ref.get("id", "")
            story_full = stories_full.get(story_id)
            if story_full is None:
                values_by_id[story_id] = None
                continue
            server_vals = _extract_server_values(story_full)
            values_by_id[story_id] = server_vals
            cache_key = _server_values_cache_key(story_ref)
            with cache_lock:
                cache[cache_key] = server_vals
        _persist_server_values_cache(service, cache)

    return values_by_id


def _retry_metadata_download(func: Callable[[], Any]) -> Any:
    """Retry metadata file downloads without sharing the list-query semaphore."""
    from googleapiclient.errors import HttpError

    last_exc: Optional[BaseException] = None
    for attempt in range(_DRIVE_CALL_RETRIES):
        try:
            with _METADATA_DOWNLOAD_SEMAPHORE:
                return func()
        except (ssl.SSLError, TimeoutError) as exc:
            last_exc = exc
            if attempt < _DRIVE_CALL_RETRIES - 1:
                backoff = _DRIVE_CALL_BACKOFF_BASE * (attempt + 1)
                logger.warning(
                    "Metadata download failed (attempt %d/%d, concurrency=%d), retrying in %.1fs: %s",
                    attempt + 1,
                    _DRIVE_CALL_RETRIES,
                    _METADATA_DOWNLOAD_CONCURRENCY,
                    backoff,
                    exc,
                )
                time.sleep(backoff)
            continue
        except HttpError:
            raise
    if last_exc is not None:
        raise last_exc


def _download_metadata_text(drive_service: Any, file_info: dict) -> str:
    """Download a known markdown metadata file directly as UTF-8 text."""
    from googleapiclient.http import MediaIoBaseDownload
    import io
    from urllib.parse import quote, urlencode

    def _download() -> str:
        file_id = file_info["id"]
        mime_type = file_info.get("mimeType") or ""
        if mime_type.startswith("application/vnd.google-apps"):
            if "folder" in mime_type:
                return ""
            path = f"https://www.googleapis.com/drive/v3/files/{quote(file_id, safe='')}/export"
            url = f"{path}?{urlencode({'mimeType': 'text/plain'})}"
        else:
            path = f"https://www.googleapis.com/drive/v3/files/{quote(file_id, safe='')}"
            url = f"{path}?{urlencode({'alt': 'media'})}"

        http = getattr(drive_service, "_http", None)
        if http is not None:
            response, content = http.request(url, method="GET")
            status = int(getattr(response, "status", 0) or response.get("status", 0) or 0)
            if 200 <= status < 300:
                return content.decode("utf-8", errors="replace")
            preview = content[:200].decode("utf-8", errors="replace") if content else ""
            raise RuntimeError(f"Drive metadata download HTTP {status}: {preview}")

        if mime_type.startswith("application/vnd.google-apps"):
            request = drive_service.files().export_media(fileId=file_id, mimeType="text/plain")
        else:
            request = drive_service.files().get_media(fileId=file_id)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        fh.seek(0)
        return fh.read().decode("utf-8", errors="replace")

    return _retry_metadata_download(_download)


def _batch_download_and_parse(
    service: Any,
    file_map: dict[str, dict[str, dict]],
) -> dict[str, dict[str, Any]]:
    """
    Download content for every metadata file in file_map and parse it.
    Downloads run in ThreadPoolExecutor (up to DRIVE_SYNC_METADATA_WORKERS).
    Returns: { folder_id: { filename_lower: parsed_value } }
    """
    all_tasks: list[tuple[str, str, dict]] = []
    for folder_id, files in file_map.items():
        for fname_lower, file_info in files.items():
            all_tasks.append((folder_id, fname_lower, file_info))

    if not all_tasks:
        return {}

    _get_metadata_content_cache(service)
    worker_count = min(_METADATA_UPDATE_WORKERS, len(all_tasks))
    parsed: dict[str, dict[str, Any]] = {fid: {} for fid in file_map}

    def _worker(folder_id: str, fname_lower: str, file_info: dict) -> tuple[str, str, Any]:
        try:
            cache, cache_lock = _get_metadata_content_cache(service)
            cache_key = _metadata_cache_key(file_info)
            with cache_lock:
                if cache_key in cache:
                    return (folder_id, fname_lower, cache[cache_key])
            content = _download_metadata_text(service._build_drive_service(), file_info)
            parsed_value = _parse_file_content(fname_lower, content)
            with cache_lock:
                cache[cache_key] = parsed_value
            return (folder_id, fname_lower, parsed_value)
        except Exception as exc:
            return (folder_id, fname_lower, exc)

    if worker_count <= 1:
        drive_svc = service._build_drive_service()
        for folder_id, fname_lower, file_info in all_tasks:
            try:
                cache, cache_lock = _get_metadata_content_cache(service)
                cache_key = _metadata_cache_key(file_info)
                with cache_lock:
                    if cache_key in cache:
                        parsed[folder_id][fname_lower] = cache[cache_key]
                        continue
                content = _download_metadata_text(drive_svc, file_info)
                parsed_value = _parse_file_content(fname_lower, content)
                with cache_lock:
                    cache[cache_key] = parsed_value
                parsed[folder_id][fname_lower] = parsed_value
            except Exception as exc:
                parsed[folder_id][fname_lower] = exc
    else:
        # Each worker thread gets its own httplib2 transport via _build_drive_service().
        with ThreadPoolExecutor(
            max_workers=worker_count, thread_name_prefix="metadata-dl"
        ) as executor:
            futures = {}
            for folder_id, fname_lower, file_info in all_tasks:
                future = executor.submit(
                    _worker, folder_id, fname_lower, file_info
                )
                futures[future] = (folder_id, fname_lower)
            for future in as_completed(futures):
                fid, fl = futures[future]
                try:
                    _, _, val = future.result()
                    parsed[fid][fl] = val
                except Exception as exc:
                    parsed[fid][fl] = exc

    cache, _ = _get_metadata_content_cache(service)
    _persist_metadata_content_cache(service, cache)
    return parsed


# -------------------------------------------------------------------------
# Batch server story fetch
# -------------------------------------------------------------------------


def _batch_fetch_server_stories(
    service: Any,
    story_ids: list[str],
) -> dict[str, dict | None]:
    if not story_ids:
        return {}

    def _worker(story_id: str) -> tuple[str, dict | None]:
        try:
            return (story_id, _fetch_story_impl(service, story_id))
        except Exception as exc:
            logger.warning("Failed to fetch story %s: %s", story_id, exc)
            return (story_id, None)

    worker_count = min(_METADATA_UPDATE_WORKERS, len(story_ids))
    results: dict[str, dict | None] = {}

    with ThreadPoolExecutor(
        max_workers=worker_count, thread_name_prefix="metadata-story"
    ) as executor:
        futures = {executor.submit(_worker, sid): sid for sid in story_ids}
        for future in as_completed(futures):
            sid = futures[future]
            try:
                rid, story = future.result()
                results[rid] = story
            except Exception as exc:
                logger.warning("Worker for %s raised: %s", sid, exc)
                results[sid] = None

    return results


def _fetch_story_impl(service: Any, story_id: str) -> dict:
    if service._config is None:
        raise RuntimeError("Drive sync config not set.")

    url = f"{service._config.main_be_api_base_url.rstrip('/')}/api/v1/story/{story_id}"
    headers = {
        "Authorization": f"Bearer {service._config.main_be_bearer_token}",
        "x-user-id": service._config.main_be_user_id or "",
    }
    with service._main_be_client(timeout=60.0) as client:
        resp = client.get(url, headers=headers)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Story fetch HTTP {resp.status_code}")
        body = resp.json()
        if isinstance(body, dict) and "data" in body:
            return body.get("data", {})
        return body


# -------------------------------------------------------------------------
# Folder values extraction from pre-fetched data maps
# -------------------------------------------------------------------------


def _extract_folder_values(
    folder_id: str,
    file_map: dict[str, dict[str, dict]],
    parsed: dict[str, dict[str, Any]],
) -> dict:
    files = file_map.get(folder_id, {})
    pdata = parsed.get(folder_id, {})

    def _val(key: str) -> Any:
        v = pdata.get(key)
        return v if not isinstance(v, Exception) else None

    cat_data = _val("category.md")
    if isinstance(cat_data, (tuple, list)) and len(cat_data) >= 2:
        main_cat_id, sub_cat_ids = cat_data
        main_cat_name = _id_to_name(main_cat_id)
        sub_cat_names = [_id_to_name(sid) for sid in (sub_cat_ids or []) if sid]
    else:
        main_cat_name, sub_cat_names = None, []

    free_count = _val("free.md")
    if isinstance(free_count, (int, float)):
        free_count = int(free_count)
    else:
        free_count = None

    push_data = _val("push.md")
    push_title: Optional[str] = None
    push_content: Optional[str] = None
    if isinstance(push_data, (tuple, list)) and len(push_data) >= 2:
        push_title, push_content = push_data

    synopsis: Optional[str] = None
    for key in files.keys():
        if key in ("synopsis.md", "synopsis.synopsis.md", "Synopsis.md"):
            syn = _val(key)
            if syn is not None and not isinstance(syn, Exception):
                synopsis = syn
                break

    tags: list[str] = []
    t = _val("tags.md")
    if isinstance(t, list):
        tags = t

    return {
        "main_category": main_cat_name,
        "sub_category": sub_cat_names[0] if sub_cat_names else None,
        "free_chapters_count": free_count,
        "push_title": push_title,
        "push_content": push_content,
        "synopsis": synopsis,
        "tags": tags,
    }


def _extract_server_values(story: dict) -> dict:
    notif = story.get("notificationConfig") or {}
    return {
        "main_category": (story.get("mainCategory") or {}).get("name"),
        "sub_categories": [c.get("name") for c in (story.get("categories") or []) if c.get("name")],
        "free_chapters_count": story.get("freeChaptersCount") or 0,
        "push_title": notif.get("title"),
        "push_content": notif.get("content"),
        "synopsis": story.get("synopsis"),
        "tags": story.get("tags") or [],
    }


# -------------------------------------------------------------------------
# Diff computation
# -------------------------------------------------------------------------


def _compute_differences(folder_vals: dict, server_vals: dict) -> list[dict]:
    diffs: list[dict] = []

    if not _categories_match(
        folder_vals["main_category"],
        folder_vals["sub_category"],
        server_vals["main_category"],
        server_vals["sub_categories"],
    ):
        diffs.append({
            "field": "category",
            "folder_value": {
                "main_category": folder_vals["main_category"],
                "sub_category": folder_vals["sub_category"],
            },
            "server_value": {
                "main_category": server_vals["main_category"],
                "sub_categories": server_vals["sub_categories"],
            },
        })

    if folder_vals["free_chapters_count"] is not None:
        if folder_vals["free_chapters_count"] != server_vals["free_chapters_count"]:
            diffs.append({
                "field": "free_chapters_count",
                "folder_value": folder_vals["free_chapters_count"],
                "server_value": server_vals["free_chapters_count"],
            })

    folder_push = folder_vals.get("push_title") or folder_vals.get("push_content")
    server_push = server_vals.get("push_title") or server_vals.get("push_content")
    if folder_push is not None:
        folder_str = f"{folder_vals.get('push_title') or ''}|{folder_vals.get('push_content') or ''}"
        server_str = f"{server_vals.get('push_title') or ''}|{server_vals.get('push_content') or ''}"
        if _normalize_for_compare(folder_str) != _normalize_for_compare(server_str):
            diffs.append({
                "field": "push",
                "folder_value": {
                    "title": folder_vals.get("push_title"),
                    "content": folder_vals.get("push_content"),
                },
                "server_value": {
                    "title": server_vals.get("push_title"),
                    "content": server_vals.get("push_content"),
                },
            })

    if folder_vals["synopsis"] is not None:
        if _normalize_for_compare(folder_vals["synopsis"]) != _normalize_for_compare(server_vals["synopsis"]):
            diffs.append({
                "field": "synopsis",
                "folder_value": folder_vals["synopsis"],
                "server_value": server_vals["synopsis"],
            })

    if not _tags_match(folder_vals["tags"], server_vals["tags"]):
        diffs.append({
            "field": "tags",
            "folder_value": folder_vals["tags"],
            "server_value": server_vals["tags"],
        })

    return diffs


def _extract_field_detail(field: str, folder_vals: dict, server_vals: dict) -> dict:
    if field == "category":
        folder_value: Any = {
            "main_category": folder_vals["main_category"],
            "sub_category": folder_vals["sub_category"],
        }
        server_value: Any = {
            "main_category": server_vals["main_category"],
            "sub_categories": server_vals["sub_categories"],
        }
    elif field == "free_chapters_count":
        folder_value = folder_vals["free_chapters_count"]
        server_value = server_vals["free_chapters_count"]
    elif field == "push":
        folder_value = {
            "title": folder_vals.get("push_title"),
            "content": folder_vals.get("push_content"),
        }
        server_value = {
            "title": server_vals.get("push_title"),
            "content": server_vals.get("push_content"),
        }
    elif field == "synopsis":
        folder_value = folder_vals["synopsis"]
        server_value = server_vals["synopsis"]
    elif field == "tags":
        folder_value = folder_vals["tags"]
        server_value = server_vals["tags"]
    else:
        folder_value = None
        server_value = None

    return {
        "field": field,
        "file_name": _METADATA_FIELD_PRIMARY_FILE.get(field),
        "folder_value": folder_value,
        "server_value": server_value,
    }


def _build_metadata_payload_from_folder_values(folder_vals: dict, fields: list[str]) -> dict:
    payload: dict[str, Any] = {}

    if "category" in fields:
        main_cat_id = _name_to_category_id(folder_vals.get("main_category"))
        if main_cat_id:
            payload["mainCategoryId"] = main_cat_id
        sub_cat_id = _name_to_category_id(folder_vals.get("sub_category"))
        if sub_cat_id:
            payload["subCategoryIds"] = [sub_cat_id]

    if "free_chapters_count" in fields and folder_vals.get("free_chapters_count") is not None:
        payload["freeChaptersCount"] = int(folder_vals["free_chapters_count"])

    if "push" in fields and (folder_vals.get("push_title") is not None or folder_vals.get("push_content") is not None):
        payload["notificationConfig"] = {
            "title": folder_vals.get("push_title") or "",
            "content": folder_vals.get("push_content") or "",
        }

    if "synopsis" in fields and folder_vals.get("synopsis") is not None:
        payload["synopsis"] = folder_vals.get("synopsis") or ""

    if "tags" in fields:
        payload["tags"] = folder_vals.get("tags") or []

    return payload


def _empty_server_values() -> dict:
    return {
        "main_category": None,
        "sub_categories": [],
        "free_chapters_count": 0,
        "push_title": None,
        "push_content": None,
        "synopsis": None,
        "tags": [],
    }


def _empty_folder_values() -> dict:
    return {
        "main_category": None,
        "sub_category": None,
        "free_chapters_count": None,
        "push_title": None,
        "push_content": None,
        "synopsis": None,
        "tags": [],
    }


# -------------------------------------------------------------------------
# Main mixin
# -------------------------------------------------------------------------


class MetadataUpdateMixin:
    """
    Mix-in providing metadata-update logic.

    Adds to DriveSyncService:
      - check_extended_folders_for_metadata
    """

    def check_extended_folders_for_metadata(self) -> dict:
        """
        Scan all DONE_/EXTENDED_ folders, batch-fetch all metadata and server
        data, compare values, and return categorized results.

        Performance: uses one Drive list query per folder chunk + parallel
        cached/direct downloads for matched story folders. The response only
        includes changed field names; detailed values are loaded per field.
        """
        from api.services.drive_service._cover_update import _is_cover_update_folder
        from api.services.drive_service._drive_api import DriveAPIMixin

        if self._config is None:
            raise RuntimeError("Drive sync config not set.")

        # Step 1: List folders + server stories
        with _Phase("1-list_drive_folders"):
            drive_folders_raw, _ = self.list_drive_folders(limit=10000, offset=0)
        target_folders = [f for f in drive_folders_raw if _is_cover_update_folder(f)]
        if not target_folders:
            return {"can_update": [], "all_match": [], "no_server_match": []}

        with _Phase("2-get_all_server_stories"):
            all_server_stories = self.get_all_server_stories()
        server_by_title: dict[str, dict] = {}
        for s in all_server_stories:
            title = s.get("title", "").strip().lower()
            if title:
                server_by_title[title] = s

        # Step 2: Match folders -> server stories
        folder_story_map: dict[str, dict] = {}
        unmatched_folders: list[dict] = []

        for folder in target_folders:
            title_lower = folder.get("display_name", "").strip().lower()
            server_story = server_by_title.get(title_lower)
            if server_story:
                folder_story_map[folder["id"]] = server_story
            else:
                unmatched_folders.append(folder)

        matched_ids = list(folder_story_map.keys())

        # Step 3: Get server metadata values, using updatedAt-versioned cache when possible.
        with _Phase("3-batch_get_server_values"):
            server_values_by_story_id = _batch_get_server_values(
                self,
                [folder_story_map[fid] for fid in matched_ids],
            )

        # Step 4: Batch-list all metadata files
        drive_svc = self._build_drive_service()

        def _retry_fn(fn: Callable) -> Any:
            return DriveAPIMixin._retry_drive_call(self, fn)

        all_folder_ids = matched_ids
        with _Phase("4-batch_list_metadata_files"):
            file_map = _batch_list_metadata_files(drive_svc, all_folder_ids, _retry_fn)

        # Step 5: Batch-download + parse file content
        with _Phase("5-batch_download_and_parse"):
            parsed = _batch_download_and_parse(self, file_map)

        # Step 6: Build results
        with _Phase("6-build_results"):
            can_update: list[dict] = []
            all_match: list[dict] = []

            for folder in target_folders:
                folder_id = folder.get("id", "")
                folder_name = folder.get("name", "")
                display_name = folder.get("display_name", "")

                server_ref = folder_story_map.get(folder_id)
                if server_ref is None:
                    continue

                story_id = server_ref.get("id", "")
                server_vals = server_values_by_story_id.get(story_id)
                if server_vals is None:
                    can_update.append(_no_match_entry(folder_id, folder_name, display_name, story_id))
                    continue

                folder_vals = _extract_folder_values(folder_id, file_map, parsed)
                diffs = _compute_differences(folder_vals, server_vals)

                entry = {
                    "story_id": story_id,
                    "story_title": display_name,
                    "folder_id": folder_id,
                    "folder_name": folder_name,
                    "server": _empty_server_values(),
                    "folder_values": _empty_folder_values(),
                    "differences": [_summarize_difference(diff) for diff in diffs],
                    "status": "can_update" if diffs else "all_match",
                }
                if diffs:
                    can_update.append(entry)
                else:
                    all_match.append(entry)

            no_server_match = [
                _no_match_entry(f.get("id", ""), f.get("name", ""), f.get("display_name", ""))
                for f in unmatched_folders
            ]

        return {
            "can_update": can_update,
            "all_match": all_match,
            "no_server_match": no_server_match,
        }

    def get_metadata_field_difference_detail(self, folder_id: str, story_id: str, field: str) -> dict:
        field = _normalize_metadata_fields([field])[0] if field in _METADATA_FIELDS else ""
        if not field:
            raise ValueError("Unknown metadata field.")
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")

        from api.services.drive_service._drive_api import DriveAPIMixin

        drive_svc = self._build_drive_service()

        def _retry_fn(fn: Callable) -> Any:
            return DriveAPIMixin._retry_drive_call(self, fn)

        file_map = _batch_list_metadata_files(drive_svc, [folder_id], _retry_fn)
        parsed = _batch_download_and_parse(self, file_map)
        folder_vals = _extract_folder_values(folder_id, file_map, parsed)
        story_full = _fetch_story_impl(self, story_id)
        server_vals = _extract_server_values(story_full)
        diffs = _compute_differences(folder_vals, server_vals)
        is_different = any(diff.get("field") == field for diff in diffs)
        return {
            **_extract_field_detail(field, folder_vals, server_vals),
            "is_different": is_different,
        }

    def build_metadata_update_payload_from_folder(
        self,
        folder_id: str,
        fields: list[str] | tuple[str, ...] | set[str],
    ) -> dict:
        selected_fields = _normalize_metadata_fields(fields)
        if not selected_fields:
            return {}
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")

        from api.services.drive_service._drive_api import DriveAPIMixin

        drive_svc = self._build_drive_service()

        def _retry_fn(fn: Callable) -> Any:
            return DriveAPIMixin._retry_drive_call(self, fn)

        file_map = _batch_list_metadata_files(drive_svc, [folder_id], _retry_fn)
        parsed = _batch_download_and_parse(self, file_map)
        folder_vals = _extract_folder_values(folder_id, file_map, parsed)
        return _build_metadata_payload_from_folder_values(folder_vals, selected_fields)


def _no_match_entry(
    folder_id: str,
    folder_name: str,
    display_name: str,
    story_id: str | None = None,
) -> dict:
    return {
        "story_id": story_id,
        "story_title": display_name,
        "folder_id": folder_id,
        "folder_name": folder_name,
        "server": {
            **_empty_server_values(),
        },
        "folder_values": {
            **_empty_folder_values(),
        },
        "differences": [],
        "status": "no_server_match",
    }
