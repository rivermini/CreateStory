"""Results routes — list output files, preview, download, and combine."""

import json
import os
import re
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from api.models.crawl_request import CrawlResult, OutputFile
from api.services.crawler_service import chapter_record_from_output_file, get_crawl_service
from api.services.file_service import CrawlPathError, get_file_service
from api.service_auth import require_owner
from utils.sanitize import sanitize_filename


class DeleteRequest(BaseModel):
    crawl_ids: list[str]


def _read_chapter_file(filepath: Path) -> list[dict]:
    """Read a chapter output file, supporting both formatted JSON and JSONL formats."""
    with open(filepath, "r", encoding="utf-8") as fh:
        raw = fh.read().strip()

    if not raw:
        return []

    if "\n" in raw:
        results: list[dict] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                results.append(json.loads(line))
            except json.JSONDecodeError:
                return [json.loads(raw)]
        return results
    else:
        return [json.loads(raw)]


def _extract_novel_metadata_from_files(output_dir: Path, chapter_files: list) -> Optional[dict]:
    """Read individual chapter files and return novel_metadata from the first entry that has it."""
    files_sorted = sorted(chapter_files, key=lambda f: f.chapter_number)
    for file_meta in files_sorted:
        filepath = output_dir / file_meta.filename
        try:
            chapters = _read_chapter_file(filepath)
            if chapters:
                first = chapters[0]
                if isinstance(first, dict) and first.get("novel_metadata"):
                    return first["novel_metadata"]
        except Exception:
            continue
    return None


def _make_combined_filename(crawl_id: str, output_dir: Path, chapter_files: list, output_format: str = "md", site_name: str = "") -> str:
    ext = "json"
    if chapter_files:
        first_file = chapter_files[0].filename
        m = re.match(r"(.*)_chapter_\d+", first_file)
        if m:
            prefix = m.group(1)
            if site_name and prefix.startswith(f"{site_name}_"):
                prefix = prefix[len(site_name) + 1:]
            return f"{prefix}_combined_{crawl_id}.{ext}"
    return f"combined_{crawl_id}.{ext}"


router = APIRouter(prefix="/api/results", tags=["Results"])


def _delete_temp_file(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def _zip_file_response(files: list[tuple[Path, str]], filename: str) -> FileResponse:
    temp = tempfile.NamedTemporaryFile(prefix="create_story_", suffix=".zip", delete=False)
    temp_path = temp.name
    temp.close()
    try:
        with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for path, archive_name in files:
                if path.is_file() and not path.is_symlink():
                    archive.write(path, archive_name)
    except Exception:
        _delete_temp_file(temp_path)
        raise
    return FileResponse(
        temp_path,
        media_type="application/zip",
        filename=filename,
        background=BackgroundTask(_delete_temp_file, temp_path),
    )


def _require_progress(crawl_id: str, request: Request):
    try:
        get_file_service().validate_crawl_id(crawl_id)
    except CrawlPathError as exc:
        raise HTTPException(status_code=404, detail="Crawl not found.") from exc
    progress = get_crawl_service().get_progress(crawl_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"Crawl '{crawl_id}' not found.")
    require_owner(request, progress.created_by_user_id)
    return progress


def _safe_output_file(crawl_id: str, filename: str, request: Request) -> Path:
    _require_progress(crawl_id, request)
    try:
        return get_file_service().get_output_file(crawl_id, filename)
    except CrawlPathError as exc:
        raise HTTPException(status_code=403, detail="Access denied: invalid output path.") from exc


@router.get("")
async def list_all_results(request: Request) -> list[dict]:
    """Return a lightweight summary for every crawl session.
    
    Does NOT enumerate output files or extract novel metadata to avoid
    expensive filesystem I/O per session. That data is loaded on demand
    via the per-session /{crawl_id} endpoint.
    """
    crawl_service = get_crawl_service()
    sessions = crawl_service.get_all_sessions()
    role = getattr(request.state, "create_story_role", None)
    user_id = getattr(request.state, "create_story_user_id", None)
    sessions = [
        session
        for session in sessions
        if role == "admin" or (session.created_by_user_id and session.created_by_user_id == user_id)
    ]

    results: list[dict] = []
    for progress in sessions:
        results.append({
            "crawl_id": progress.crawl_id,
            "status": progress.status,
            "spider_name": progress.site_name or "",
            "novel_name": progress.novel_name or "",
            "chapters_crawled": progress.chapters_crawled,
            "chapters_total": progress.chapters_total,
            "started_at": progress.started_at,
            "finished_at": progress.finished_at,
            "error_message": progress.error_message,
            "output_files": [],
            "novel_metadata": None,
            "combined_file": progress.combined_file or None,
            "combined_md_file": progress.combined_md_file or None,
            "source_url": progress.source_url or None,
        })

    status_order = {"running": 0, "completed": 1, "failed": 2, "cancelled": 3, "idle": 4}
    results.sort(key=lambda r: status_order.get(r["status"], 99))
    return results


@router.post("/delete")
async def delete_crawl_sessions(body: DeleteRequest, request: Request) -> dict:
    """Delete one or more crawl sessions and their associated output files."""
    if not body.crawl_ids:
        raise HTTPException(status_code=400, detail="No crawl_ids provided.")

    crawl_service = get_crawl_service()
    for crawl_id in body.crawl_ids:
        _require_progress(crawl_id, request)
    deleted_count = crawl_service.delete_sessions(body.crawl_ids)
    return {"deleted_count": deleted_count}


@router.get("/download-all")
async def download_all_sessions(request: Request) -> FileResponse:
    """Zip all output files from every crawl session."""
    crawl_service = get_crawl_service()
    file_service = get_file_service()
    sessions = crawl_service.get_all_sessions()
    role = getattr(request.state, "create_story_role", None)
    user_id = getattr(request.state, "create_story_user_id", None)
    sessions = [s for s in sessions if role == "admin" or s.created_by_user_id == user_id]

    files: list[tuple[Path, str]] = []
    for progress in sessions:
        crawl_id = progress.crawl_id
        fmt = progress.output_format or "md"
        chapter_files = file_service.list_output_files(crawl_id, fmt=fmt)
        for file_meta in sorted(chapter_files, key=lambda f: f.chapter_number):
            files.append((file_service.get_output_file(crawl_id, file_meta.filename), file_meta.filename))
        for name in (progress.combined_file, progress.combined_md_file):
            if name:
                files.append((file_service.get_output_file(crawl_id, name), name))
    return _zip_file_response(files, "all_sessions.zip")


@router.get("/download-all-combined")
async def download_all_combined(request: Request) -> FileResponse:
    """Zip the combined files from every crawl session."""
    crawl_service = get_crawl_service()
    file_service = get_file_service()
    sessions = crawl_service.get_all_sessions()
    role = getattr(request.state, "create_story_role", None)
    user_id = getattr(request.state, "create_story_user_id", None)
    sessions = [s for s in sessions if role == "admin" or s.created_by_user_id == user_id]

    files: list[tuple[Path, str]] = []
    for progress in sessions:
        for name in (progress.combined_file, progress.combined_md_file):
            if name:
                files.append((file_service.get_output_file(progress.crawl_id, name), name))
    return _zip_file_response(files, "all_combined.zip")


@router.get("/{crawl_id}/download-all")
async def download_all_files(crawl_id: str, request: Request) -> FileResponse:
    """Zip all output files from a crawl session and stream as a single download."""
    crawl_service = get_crawl_service()
    file_service = get_file_service()

    progress = _require_progress(crawl_id, request)

    fmt = progress.output_format or "md"
    chapter_files = file_service.list_output_files(crawl_id, fmt=fmt)

    if not chapter_files:
        raise HTTPException(status_code=404, detail="No output files found for this crawl.")

    novel_name = progress.novel_name
    if novel_name:
        safe_name = re.sub(r'[\\/:*?"<>|]', "_", novel_name)
        zip_name = f"{safe_name}_{crawl_id}.zip"
    else:
        zip_name = f"{crawl_id}.zip"

    files = [
        (file_service.get_output_file(crawl_id, file_meta.filename), file_meta.filename)
        for file_meta in sorted(chapter_files, key=lambda f: f.chapter_number)
    ]
    for name in (progress.combined_file, progress.combined_md_file):
        if name:
            files.append((file_service.get_output_file(crawl_id, name), name))
    return _zip_file_response(files, zip_name)


@router.get("/{crawl_id}", response_model=CrawlResult)
async def get_crawl_result(crawl_id: str, request: Request) -> CrawlResult:
    """Return the complete result for a crawl session."""
    crawl_service = get_crawl_service()
    file_service = get_file_service()

    progress = _require_progress(crawl_id, request)

    output_dir = file_service.get_output_dir(crawl_id)
    fmt = progress.output_format or "md"
    files = file_service.list_output_files(crawl_id, fmt=fmt)
    novel_slug = crawl_service.get_novel_slug_from_crawl_id(crawl_id)

    return CrawlResult(
        crawl_id=crawl_id,
        status=progress.status,
        spider_name=progress.site_name or "",
        novel_slug=novel_slug,
        novel_name=progress.novel_name or None,
        chapters_crawled=progress.chapters_crawled,
        chapters_total=progress.chapters_total,
        started_at=progress.started_at,
        finished_at=progress.finished_at,
        error_message=progress.error_message,
        output_files=files,
        novel_metadata=_extract_novel_metadata_from_files(output_dir, files),
        source_url=progress.source_url or None,
        combined_file=progress.combined_file or None,
        combined_md_file=progress.combined_md_file or None,
    )


@router.get("/{crawl_id}/download")
async def download_file(crawl_id: str, filename: str, request: Request) -> FileResponse:
    """Stream a single output file for download."""
    file_service = get_file_service()
    filepath = _safe_output_file(crawl_id, filename, request)

    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")

    return FileResponse(
        filepath,
        filename=filepath.name,
        media_type="application/octet-stream",
    )


@router.get("/{crawl_id}/preview")
async def preview_file(crawl_id: str, filename: str, request: Request) -> dict:
    """Return a text preview of an output file."""
    file_service = get_file_service()
    filepath = _safe_output_file(crawl_id, filename, request)

    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")

    preview_text, total_lines = file_service.read_file_preview(filepath, max_lines=30)
    return {"filename": filepath.name, "preview": preview_text, "total_lines": total_lines}


@router.get("/{crawl_id}/content")
async def get_file_content(crawl_id: str, filename: str, request: Request) -> dict:
    """Return the full raw content of an output file as a dict with {content: string}."""
    filepath = _safe_output_file(crawl_id, filename, request)

    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")

    try:
        with open(filepath, "r", encoding="utf-8") as fh:
            content = fh.read()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {exc}")

    return {"content": content}


@router.post("/{crawl_id}/combine")
async def combine_chapters(crawl_id: str, request: Request) -> dict:
    """
    Merge all individual chapter files into a single combined Markdown file.
    Mirrors _run_combine naming exactly: {site_name}_{safe_novel_name}_Ongoing.md
    """
    crawl_service = get_crawl_service()
    file_service = get_file_service()

    progress = _require_progress(crawl_id, request)

    output_dir = file_service.get_output_dir(crawl_id)
    output_format = progress.output_format or "md"
    chapter_files = file_service.list_output_files(crawl_id, fmt=output_format)

    if not chapter_files:
        raise HTTPException(status_code=404, detail="No chapter files found to combine.")

    files_sorted = sorted(chapter_files, key=lambda f: f.chapter_number)

    site_name = progress.site_name
    novel_name = progress.novel_name
    completed = progress.completed

    if site_name and novel_name:
        status = "Completed" if completed else "Ongoing" if completed is not None else ""
        safe_name = sanitize_filename(novel_name)
        base_name = f"{site_name}_{safe_name}_{status}" if status else f"{site_name}_{safe_name}"
    elif novel_name:
        status = "Completed" if completed else "Ongoing" if completed is not None else ""
        base_name = f"{sanitize_filename(novel_name)}_{status}" if status else sanitize_filename(novel_name)
    else:
        base_name = crawl_id

    md_filename = f"{sanitize_filename(base_name)}.md"
    md_path = output_dir / md_filename
    md_parts: list[str] = []
    chapters_data: list[dict] = []
    for file_meta in files_sorted:
        filepath = output_dir / file_meta.filename
        try:
            raw = filepath.read_text(encoding="utf-8").strip()
            if raw:
                md_parts.append(raw)
            chapters_data.append(chapter_record_from_output_file(filepath, file_meta.chapter_number))
        except OSError:
            continue
    md_text = "\n\n---\n\n".join(md_parts).rstrip()
    try:
        with open(md_path, "w", encoding="utf-8") as fh:
            fh.write(md_text)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write combined Markdown: {exc}")

    combined_name = f"{sanitize_filename(base_name)}_combined_{crawl_id}.json"
    combined_path = output_dir / combined_name
    combined_payload = {
        "crawl_id": crawl_id,
        "chapter_count": len(files_sorted),
        "chapters": chapters_data,
    }
    try:
        with open(combined_path, "w", encoding="utf-8") as fh:
            json.dump(combined_payload, fh, ensure_ascii=False, indent=2)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write combined JSON: {exc}")

    try:
        size_bytes = md_path.stat().st_size
    except OSError:
        size_bytes = 0

    p = crawl_service.get_progress(crawl_id)
    if p:
        p.combined_file = combined_name
        p.combined_md_file = md_filename
        crawl_service._persist_index()

    return {
        "crawl_id": crawl_id,
        "combined_file": combined_name,
        "combined_md_file": md_filename,
        "size_bytes": size_bytes,
        "chapter_count": len(files_sorted),
    }


@router.get("/{crawl_id}/combined")
async def get_combined_result(crawl_id: str, request: Request) -> dict:
    """
    Return the combined Markdown file content for a crawl session.
    """
    crawl_service = get_crawl_service()
    file_service = get_file_service()

    progress = _require_progress(crawl_id, request)

    output_dir = file_service.get_output_dir(crawl_id)
    output_format = progress.output_format or "md"
    chapter_files = file_service.list_output_files(crawl_id, fmt=output_format)
    novel_slug = crawl_service.get_novel_slug_from_crawl_id(crawl_id)

    md_filename = progress.combined_md_file or ""
    md_path = output_dir / md_filename if md_filename else None

    if not md_path or not md_path.exists():
        try:
            await combine_chapters(crawl_id, request)
        except HTTPException:
            pass
        progress = crawl_service.get_progress(crawl_id)
        if progress is None:
            raise HTTPException(status_code=500, detail="Crawl session lost after combine.")
        md_filename = progress.combined_md_file or ""
        md_path = output_dir / md_filename

    if not md_path or not md_path.exists():
        raise HTTPException(status_code=404, detail="Combined Markdown file not found.")

    try:
        with open(md_path, "r", encoding="utf-8") as fh:
            md_content = fh.read()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read combined Markdown: {exc}")

    try:
        size_bytes = md_path.stat().st_size
    except OSError:
        size_bytes = len(md_content.encode("utf-8"))

    return {
        "crawl_id": crawl_id,
        "status": progress.status,
        "spider_name": progress.site_name or "",
        "novel_slug": novel_slug,
        "novel_name": progress.novel_name or None,
        "chapters_crawled": progress.chapters_crawled,
        "chapters_total": progress.chapters_total,
        "started_at": progress.started_at,
        "finished_at": progress.finished_at,
        "error_message": progress.error_message,
        "output_files": [OutputFile(filename=md_filename, size_bytes=size_bytes, chapter_number=0)],
        "novel_metadata": None,
        "chapter_count": progress.chapters_crawled,
        "combined_md_file": md_filename,
        "md_content": md_content,
    }
