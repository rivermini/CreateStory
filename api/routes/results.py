"""Results routes — list output files, preview, download, and combine."""

import json
import re
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from urllib.parse import quote

from api.models.crawl_request import CrawlResult, OutputFile
from api.services.crawler_service import get_crawl_service
from api.services.file_service import get_file_service
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


def _make_combined_filename(crawl_id: str, output_dir: Path, chapter_files: list, output_format: str = "jsonl", site_name: str = "") -> str:
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


@router.get("")
async def list_all_results() -> list[dict]:
    """Return a summary for every crawl session ever created."""
    crawl_service = get_crawl_service()
    file_service = get_file_service()
    sessions = crawl_service.get_all_sessions()

    results: list[dict] = []
    for progress in sessions:
        crawl_id = progress.crawl_id
        output_dir = file_service.get_output_dir(crawl_id)
        fmt = progress.output_format or "jsonl"
        chapter_files = file_service.list_output_files(crawl_id, fmt=fmt)

        novel_metadata: Optional[dict] = None
        if chapter_files:
            novel_metadata = _extract_novel_metadata_from_files(output_dir, chapter_files)

        results.append({
            "crawl_id": crawl_id,
            "status": progress.status,
            "spider_name": progress.site_name or "",
            "novel_name": progress.novel_name or "",
            "chapters_crawled": progress.chapters_crawled,
            "chapters_total": progress.chapters_total,
            "started_at": progress.started_at,
            "finished_at": progress.finished_at,
            "error_message": progress.error_message,
            "output_files": [
                {"filename": f.filename, "size_bytes": f.size_bytes, "chapter_number": f.chapter_number}
                for f in chapter_files
            ],
            "novel_metadata": novel_metadata,
            "combined_file": progress.combined_file or None,
            "combined_txt_file": progress.combined_txt_file or None,
            "source_url": progress.source_url or None,
        })

    status_order = {"running": 0, "completed": 1, "failed": 2, "cancelled": 3, "idle": 4}
    results.sort(key=lambda r: status_order.get(r["status"], 99))
    return results


@router.post("/delete")
async def delete_crawl_sessions(request: DeleteRequest) -> dict:
    """Delete one or more crawl sessions and their associated output files."""
    if not request.crawl_ids:
        raise HTTPException(status_code=400, detail="No crawl_ids provided.")

    crawl_service = get_crawl_service()
    deleted_count = crawl_service.delete_sessions(request.crawl_ids)
    return {"deleted_count": deleted_count}


@router.get("/download-all")
async def download_all_sessions() -> StreamingResponse:
    """Zip all output files from every crawl session."""
    crawl_service = get_crawl_service()
    file_service = get_file_service()
    sessions = crawl_service.get_all_sessions()

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for progress in sessions:
            crawl_id = progress.crawl_id
            output_dir = file_service.get_output_dir(crawl_id)
            fmt = progress.output_format or "jsonl"
            chapter_files = file_service.list_output_files(crawl_id, fmt=fmt)
            for file_meta in sorted(chapter_files, key=lambda f: f.chapter_number):
                fp = output_dir / file_meta.filename
                if fp.exists():
                    zf.write(fp, file_meta.filename)
            if progress.combined_file:
                cp = output_dir / progress.combined_file
                if cp.exists():
                    zf.write(cp, progress.combined_file)
            if progress.combined_txt_file:
                tp = output_dir / progress.combined_txt_file
                if tp.exists():
                    zf.write(tp, progress.combined_txt_file)

    buffer.seek(0)
    zip_bytes = buffer.getvalue()
    return StreamingResponse(
        iter([zip_bytes]),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=\"all_sessions.zip\"", "Content-Length": str(len(zip_bytes))},
    )


@router.get("/download-all-combined")
async def download_all_combined() -> StreamingResponse:
    """Zip the combined files from every crawl session."""
    crawl_service = get_crawl_service()
    file_service = get_file_service()
    sessions = crawl_service.get_all_sessions()

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for progress in sessions:
            crawl_id = progress.crawl_id
            output_dir = file_service.get_output_dir(crawl_id)
            if progress.combined_file:
                cp = output_dir / progress.combined_file
                if cp.exists():
                    zf.write(cp, progress.combined_file)
            if progress.combined_txt_file:
                tp = output_dir / progress.combined_txt_file
                if tp.exists():
                    zf.write(tp, progress.combined_txt_file)

    buffer.seek(0)
    zip_bytes = buffer.getvalue()
    return StreamingResponse(
        iter([zip_bytes]),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=\"all_combined.zip\"", "Content-Length": str(len(zip_bytes))},
    )


@router.get("/{crawl_id}/download-all")
async def download_all_files(crawl_id: str) -> StreamingResponse:
    """Zip all output files from a crawl session and stream as a single download."""
    crawl_service = get_crawl_service()
    file_service = get_file_service()

    progress = crawl_service.get_progress(crawl_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"Crawl '{crawl_id}' not found.")

    output_dir = file_service.get_output_dir(crawl_id)
    fmt = progress.output_format or "jsonl"
    chapter_files = file_service.list_output_files(crawl_id, fmt=fmt)

    if not chapter_files:
        raise HTTPException(status_code=404, detail="No output files found for this crawl.")

    novel_name = progress.novel_name
    if novel_name:
        safe_name = re.sub(r'[\\/:*?"<>|]', "_", novel_name)
        zip_name = f"{safe_name}_{crawl_id}.zip"
    else:
        zip_name = f"{crawl_id}.zip"

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_meta in sorted(chapter_files, key=lambda f: f.chapter_number):
            filepath = output_dir / file_meta.filename
            if filepath.exists():
                zf.write(filepath, file_meta.filename)
        if progress.combined_file:
            combined_path = output_dir / progress.combined_file
            if combined_path.exists():
                zf.write(combined_path, progress.combined_file)
        if progress.combined_txt_file:
            combined_txt_path = output_dir / progress.combined_txt_file
            if combined_txt_path.exists():
                zf.write(combined_txt_path, progress.combined_txt_file)

    buffer.seek(0)
    zip_bytes = buffer.getvalue()

    return StreamingResponse(
        iter([zip_bytes]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"', "Content-Length": str(len(zip_bytes))},
    )


@router.get("/{crawl_id}", response_model=CrawlResult)
async def get_crawl_result(crawl_id: str) -> CrawlResult:
    """Return the complete result for a crawl session."""
    crawl_service = get_crawl_service()
    file_service = get_file_service()

    progress = crawl_service.get_progress(crawl_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"Crawl '{crawl_id}' not found.")

    output_dir = file_service.get_output_dir(crawl_id)
    fmt = progress.output_format or "jsonl"
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
        combined_txt_file=progress.combined_txt_file or None,
    )


@router.get("/{crawl_id}/download")
async def download_file(crawl_id: str, filename: str) -> StreamingResponse:
    """Stream a single output file for download."""
    file_service = get_file_service()

    output_dir = file_service.get_output_dir(crawl_id)
    filepath = (output_dir / filename).resolve()

    if not str(filepath).startswith(str(output_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected.")

    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")

    content, mime_type = file_service.get_file_content(filepath)

    return StreamingResponse(
        iter([content]),
        media_type=mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{quote(filepath.name)}"',
            "Content-Length": str(len(content)),
        },
    )


@router.get("/{crawl_id}/preview")
async def preview_file(crawl_id: str, filename: str) -> dict:
    """Return a text preview of an output file."""
    file_service = get_file_service()

    output_dir = file_service.get_output_dir(crawl_id)
    filepath = (output_dir / filename).resolve()

    if not str(filepath).startswith(str(output_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected.")

    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")

    preview_text, total_lines = file_service.read_file_preview(filepath, max_lines=30)
    return {"filename": filepath.name, "preview": preview_text, "total_lines": total_lines}


@router.get("/{crawl_id}/content")
async def get_file_content(crawl_id: str, filename: str) -> dict:
    """Return the full raw content of an output file as a dict with {content: string}."""
    file_service = get_file_service()

    output_dir = file_service.get_output_dir(crawl_id)
    filepath = (output_dir / filename).resolve()

    if not str(filepath).startswith(str(output_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected.")

    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")

    try:
        with open(filepath, "r", encoding="utf-8") as fh:
            content = fh.read()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {exc}")

    return {"content": content}


@router.post("/{crawl_id}/combine")
async def combine_chapters(crawl_id: str) -> dict:
    """
    Merge all individual chapter files into a single combined TXT file.
    Mirrors _run_combine naming exactly: {site_name}_{safe_novel_name}_Ongoing.txt
    """
    crawl_service = get_crawl_service()
    file_service = get_file_service()

    progress = crawl_service.get_progress(crawl_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"Crawl '{crawl_id}' not found.")

    output_dir = file_service.get_output_dir(crawl_id)
    output_format = progress.output_format or "jsonl"
    chapter_files = file_service.list_output_files(crawl_id, fmt=output_format)

    if not chapter_files:
        raise HTTPException(status_code=404, detail="No chapter files found to combine.")

    files_sorted = sorted(chapter_files, key=lambda f: f.chapter_number)

    # Build base_name exactly like _run_combine does
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

        if output_format == "txt":
            txt_filename = f"{sanitize_filename(base_name)}.txt"
            txt_path = output_dir / txt_filename
            txt_parts: list[str] = []
            for file_meta in files_sorted:
                filepath = output_dir / file_meta.filename
                try:
                    raw = filepath.read_text(encoding="utf-8").strip()
                    if raw:
                        txt_parts.append(raw)
                except OSError:
                    continue
            txt_text = "\n\n---\n\n".join(txt_parts).rstrip()
            try:
                with open(txt_path, "w", encoding="utf-8") as fh:
                    fh.write(txt_text)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to write combined TXT: {exc}")

            combined_name = f"{sanitize_filename(base_name)}_combined_{crawl_id}.json"
            try:
                size_bytes = txt_path.stat().st_size
            except OSError:
                size_bytes = 0

            p = crawl_service.get_progress(crawl_id)
            if p:
                p.combined_file = combined_name
                p.combined_txt_file = txt_filename
                crawl_service._persist_index()

            return {
                "crawl_id": crawl_id,
                "combined_file": combined_name,
                "combined_txt_file": txt_filename,
                "size_bytes": size_bytes,
                "chapter_count": len(files_sorted),
            }

        # jsonl: write combined .json
    combined: list[dict] = []
    novel_metadata: Optional[dict] = None
    for file_meta in files_sorted:
        filepath = output_dir / file_meta.filename
        chapters = _read_chapter_file(filepath)
        for obj in chapters:
            if "chapter" not in obj or obj["chapter"] == 0:
                obj["chapter"] = file_meta.chapter_number
            combined.append(obj)
            if novel_metadata is None and isinstance(obj, dict) and obj.get("novel_metadata"):
                novel_metadata = obj["novel_metadata"]

    combined_name = f"{sanitize_filename(base_name)}_combined_{crawl_id}.json"
    combined_path = output_dir / combined_name
    combined_payload = {
        "crawl_id": crawl_id,
        "chapter_count": len(combined),
        "novel_metadata": novel_metadata,
        "chapters": combined,
    }
    try:
        with open(combined_path, "w", encoding="utf-8") as fh:
            json.dump(combined_payload, fh, ensure_ascii=False, indent=2)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write combined JSON: {exc}")

    p = crawl_service.get_progress(crawl_id)
    if p:
        p.combined_file = combined_name
        crawl_service._persist_index()

    try:
        size_bytes = combined_path.stat().st_size
    except OSError:
        size_bytes = 0

    return {
        "crawl_id": crawl_id,
        "combined_file": combined_name,
        "combined_txt_file": None,
        "size_bytes": size_bytes,
        "chapter_count": len(files_sorted),
    }


@router.get("/{crawl_id}/combined")
async def get_combined_result(crawl_id: str) -> dict:
    """
    Return the combined result for a crawl.
    For TXT format: reads the combined .txt file directly (raw text).
    For JSON format: reads and parses the combined .json file.
    """
    crawl_service = get_crawl_service()
    file_service = get_file_service()

    progress = crawl_service.get_progress(crawl_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"Crawl '{crawl_id}' not found.")

    output_dir = file_service.get_output_dir(crawl_id)
    output_format = progress.output_format or "jsonl"
    chapter_files = file_service.list_output_files(crawl_id, fmt=output_format)
    novel_slug = crawl_service.get_novel_slug_from_crawl_id(crawl_id)

    is_text = output_format == "txt"

    if is_text:
        # Use the stored TXT filename from _run_combine
        txt_filename = progress.combined_txt_file or ""
        txt_path = output_dir / txt_filename if txt_filename else None

        if not txt_path or not txt_path.exists():
            # Trigger combine inline — mirrors _run_combine naming
            try:
                await combine_chapters(crawl_id)
            except HTTPException:
                pass
            progress = crawl_service.get_progress(crawl_id)
            if progress is None:
                raise HTTPException(status_code=500, detail="Crawl session lost after combine.")
            txt_filename = progress.combined_txt_file or ""
            txt_path = output_dir / txt_filename

        if not txt_path or not txt_path.exists():
            raise HTTPException(status_code=404, detail="Combined TXT file not found.")

        try:
            with open(txt_path, "r", encoding="utf-8") as fh:
                txt_content = fh.read()
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Failed to read combined TXT: {exc}")

        try:
            size_bytes = txt_path.stat().st_size
        except OSError:
            size_bytes = len(txt_content.encode("utf-8"))

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
            "output_files": [OutputFile(filename=txt_filename, size_bytes=size_bytes, chapter_number=0)],
            "novel_metadata": None,
            "chapter_count": progress.chapters_crawled,
            "combined_txt_file": txt_filename,
            "txt_content": txt_content,
        }

    # jsonl/json: use _make_combined_filename for the JSON file
    combined_name = _make_combined_filename(crawl_id, output_dir, chapter_files, output_format=output_format, site_name=progress.site_name)
    combined_path = output_dir / combined_name

    if not combined_path.exists():
        if not chapter_files:
            raise HTTPException(status_code=404, detail="No chapter files found to combine.")
        try:
            await combine_chapters(crawl_id)
        except HTTPException:
            pass

        progress = crawl_service.get_progress(crawl_id)
        if progress is None:
            raise HTTPException(status_code=500, detail="Crawl session lost after combine.")
        combined_name = _make_combined_filename(crawl_id, output_dir, chapter_files, output_format=output_format, site_name=progress.site_name)
        combined_path = output_dir / combined_name

    try:
        with open(combined_path, "r", encoding="utf-8") as fh:
            combined_data = json.load(fh)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse combined JSON: {exc}")

    try:
        size_bytes = combined_path.stat().st_size
    except OSError:
        size_bytes = 0

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
        "output_files": [OutputFile(filename=combined_name, size_bytes=size_bytes, chapter_number=0)],
        "novel_metadata": combined_data.get("novel_metadata"),
        "chapter_count": combined_data.get("chapter_count", 0),
        "chapters": combined_data.get("chapters", []),
    }
