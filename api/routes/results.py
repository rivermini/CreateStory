"""Results routes — proxy to NovelCrawler."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter(prefix="/api/results", tags=["Results"])


def _nc_url() -> str:
    return os.environ.get("SERVICE_URLS_NovelCrawler", "http://localhost:8002").rstrip("/")


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    """Forward a GET request to NovelCrawler."""
    import httpx

    url = f"{_nc_url()}{path}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url, params=params or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    """Forward a POST request to NovelCrawler."""
    import httpx

    url = f"{_nc_url()}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=json_body or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_download(path: str, params: dict | None = None) -> StreamingResponse:
    """Forward a download request to NovelCrawler and stream the response."""
    import httpx

    url = f"{_nc_url()}{path}"
    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        resp = await client.get(url, params=params or {})
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "application/octet-stream")
        headers = {k: v for k, v in resp.headers.items() if k.lower() not in ("host", "connection")}
        return StreamingResponse(
            resp.aiter_bytes(),
            media_type=content_type,
            headers=headers,
        )


@router.get("")
async def list_all_results() -> JSONResponse:
    """Return a summary for every crawl session."""
    return await _proxy_get("/api/results")


@router.get("/download-all")
async def download_all_sessions() -> StreamingResponse:
    """Zip the output files from every crawl session."""
    return await _proxy_download("/api/results/download-all")


@router.get("/download-all-combined")
async def download_all_combined() -> StreamingResponse:
    """Zip the combined files from every crawl session."""
    return await _proxy_download("/api/results/download-all-combined")


@router.post("/delete")
async def delete_crawl_sessions(request: dict) -> JSONResponse:
    """Delete one or more crawl sessions."""
    return await _proxy_post("/api/results/delete", json_body=request)


@router.get("/download-combined-all")
async def download_combined_all() -> StreamingResponse:
    """Zip the combined files."""
    return await _proxy_download("/api/results/download-all-combined")


@router.get("/{crawl_id}/download-all")
async def download_all_files(crawl_id: str) -> StreamingResponse:
    """Zip all output files from a crawl session."""
    return await _proxy_download(f"/api/results/{crawl_id}/download-all")


@router.get("/{crawl_id}")
async def get_crawl_result(crawl_id: str) -> JSONResponse:
    """Return the complete result for a crawl session."""
    return await _proxy_get(f"/api/results/{crawl_id}")


@router.get("/{crawl_id}/download")
async def download_file(crawl_id: str, filename: str = Query(...)) -> StreamingResponse:
    """Stream a single output file for download."""
    return await _proxy_download(f"/api/results/{crawl_id}/download", params={"filename": filename})


@router.get("/{crawl_id}/preview")
async def preview_file(crawl_id: str, filename: str = Query(...)) -> JSONResponse:
    """Return a text preview of an output file."""
    return await _proxy_get(f"/api/results/{crawl_id}/preview", params={"filename": filename})


@router.get("/{crawl_id}/content")
async def get_file_content(crawl_id: str, filename: str = Query(...)) -> JSONResponse:
    """Return the full raw content of an output file."""
    return await _proxy_get(f"/api/results/{crawl_id}/content", params={"filename": filename})


@router.post("/{crawl_id}/combine")
async def combine_chapters(crawl_id: str) -> JSONResponse:
    """Merge all individual chapter JSON files into a single combined file."""
    return await _proxy_post(f"/api/results/{crawl_id}/combine")


@router.get("/{crawl_id}/combined")
async def get_combined_result(crawl_id: str) -> JSONResponse:
    """Return the combined result for a crawl."""
    return await _proxy_get(f"/api/results/{crawl_id}/combined")
