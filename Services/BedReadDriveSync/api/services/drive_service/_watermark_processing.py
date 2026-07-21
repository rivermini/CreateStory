"""Server-side watermark processing for story image uploads."""

from __future__ import annotations

import io
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image


logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_SECONDS = 120
_DEFAULT_MAX_PASSES = 3
_LOSSY_MIN_QUALITY = 50
_LOSSY_MAX_QUALITY = 98
_LOSSY_SEARCH_STEPS = 7


@dataclass(frozen=True)
class WatermarkProcessingResult:
    image_bytes: bytes
    applied: bool
    applied_passes: int
    processing_ms: int
    stop_reason: str
    error: str | None = None
    passes: tuple[dict[str, Any], ...] = ()


def _runtime_script_path() -> Path:
    configured = os.getenv("WATERMARK_PROCESSOR_SCRIPT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[3] / "watermark_runtime" / "process-image.mjs"


def _node_binary() -> str | None:
    configured = os.getenv("WATERMARK_NODE_BINARY", "").strip()
    if configured:
        return configured
    return shutil.which("node") or shutil.which("nodejs")


def _timeout_seconds() -> int:
    try:
        return max(10, int(os.getenv("WATERMARK_PROCESSOR_TIMEOUT_SECONDS", str(_DEFAULT_TIMEOUT_SECONDS))))
    except (TypeError, ValueError):
        return _DEFAULT_TIMEOUT_SECONDS


def _max_passes() -> int:
    try:
        return max(1, min(5, int(os.getenv("WATERMARK_PROCESSOR_MAX_PASSES", str(_DEFAULT_MAX_PASSES)))))
    except (TypeError, ValueError):
        return _DEFAULT_MAX_PASSES


def _save_image(image: Image.Image, image_format: str, source_info: dict[str, Any], **options: Any) -> bytes:
    output = io.BytesIO()
    metadata: dict[str, Any] = {}
    for key in ("exif", "icc_profile"):
        value = source_info.get(key)
        if value:
            metadata[key] = value
    image.save(output, format=image_format, **metadata, **options)
    return output.getvalue()


def _closest_lossy_encoding(
    image: Image.Image,
    image_format: str,
    source_info: dict[str, Any],
    target_bytes: int,
) -> bytes:
    lower = _LOSSY_MIN_QUALITY
    upper = _LOSSY_MAX_QUALITY
    closest: bytes | None = None
    closest_difference = float("inf")

    for _ in range(_LOSSY_SEARCH_STEPS):
        quality = (lower + upper) // 2
        options: dict[str, Any] = {"quality": quality}
        if image_format == "JPEG":
            options.update({"optimize": True, "progressive": True})
        candidate = _save_image(image, image_format, source_info, **options)
        difference = abs(len(candidate) - target_bytes)
        if difference < closest_difference:
            closest = candidate
            closest_difference = difference
        if len(candidate) > target_bytes:
            upper = quality - 1
        else:
            lower = quality + 1

    if closest is None:
        raise RuntimeError(f"Could not encode processed {image_format} image.")
    return closest


def _encode_processed_pixels(
    rgba_bytes: bytes,
    width: int,
    height: int,
    image_format: str,
    source_info: dict[str, Any],
    source_size: int,
) -> bytes:
    image = Image.frombytes("RGBA", (width, height), rgba_bytes)
    if image_format == "JPEG":
        return _closest_lossy_encoding(image.convert("RGB"), image_format, source_info, source_size)
    if image_format == "WEBP":
        return _closest_lossy_encoding(image, image_format, source_info, source_size)
    if image_format == "PNG":
        return _save_image(image, image_format, source_info, optimize=True, compress_level=9)
    raise ValueError(f"Unsupported story image format: {image_format or 'unknown'}")


def _run_node_processor(raw_pixels: bytes, width: int, height: int) -> tuple[bytes | None, dict[str, Any]]:
    node = _node_binary()
    script = _runtime_script_path()
    if not node:
        raise RuntimeError("Node.js is not installed; watermark cleanup is unavailable.")
    if not script.is_file():
        raise RuntimeError(f"Watermark runtime script was not found at {script}.")

    with tempfile.TemporaryDirectory(prefix="createstory-watermark-") as temporary_directory:
        temporary = Path(temporary_directory)
        input_path = temporary / "input.rgba"
        output_path = temporary / "output.rgba"
        result_path = temporary / "result.json"
        input_path.write_bytes(raw_pixels)

        completed = subprocess.run(
            [
                node,
                str(script),
                str(input_path),
                str(output_path),
                str(result_path),
                str(width),
                str(height),
                str(_max_passes()),
            ],
            capture_output=True,
            check=False,
            text=True,
            timeout=_timeout_seconds(),
        )
        result: dict[str, Any] = {}
        if result_path.is_file():
            result = json.loads(result_path.read_text(encoding="utf-8"))
        if completed.returncode != 0:
            detail = result.get("error") or completed.stderr.strip() or f"exit code {completed.returncode}"
            raise RuntimeError(f"Watermark processor failed: {detail}")
        if not result:
            raise RuntimeError("Watermark processor returned no result metadata.")
        if not result.get("applied"):
            return None, result
        if not output_path.is_file():
            raise RuntimeError("Watermark processor reported a match but returned no pixels.")
        return output_path.read_bytes(), result


class WatermarkProcessingMixin:
    """Adds best-effort watermark cleanup before image bytes leave DriveSync."""

    def _process_watermarks_for_upload(
        self,
        image_bytes: bytes,
        filename: str,
        asset_type: str,
    ) -> WatermarkProcessingResult:
        started_at = time.perf_counter()
        try:
            with Image.open(io.BytesIO(image_bytes)) as source:
                image_format = (source.format or "").upper()
                width, height = source.size
                source_info = dict(source.info)
                rgba_bytes = source.convert("RGBA").tobytes()

            processed_pixels, metadata = _run_node_processor(rgba_bytes, width, height)
            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
            passes = tuple(metadata.get("passes") or ())
            if processed_pixels is None:
                return WatermarkProcessingResult(
                    image_bytes=image_bytes,
                    applied=False,
                    applied_passes=0,
                    processing_ms=elapsed_ms,
                    stop_reason=str(metadata.get("stopReason") or "no-match"),
                    passes=passes,
                )

            expected_size = width * height * 4
            if len(processed_pixels) != expected_size:
                raise RuntimeError(
                    f"Watermark processor returned {len(processed_pixels)} bytes; expected {expected_size}."
                )
            encoded = _encode_processed_pixels(
                processed_pixels,
                width,
                height,
                image_format,
                source_info,
                len(image_bytes),
            )
            return WatermarkProcessingResult(
                image_bytes=encoded,
                applied=True,
                applied_passes=int(metadata.get("appliedPassCount") or 1),
                processing_ms=elapsed_ms,
                stop_reason=str(metadata.get("stopReason") or "completed"),
                passes=passes,
            )
        except Exception as exc:
            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
            message = str(exc)
            logger.warning(
                "Watermark cleanup failed for %s image %s; preserving original bytes: %s",
                asset_type,
                filename,
                message,
            )
            return WatermarkProcessingResult(
                image_bytes=image_bytes,
                applied=False,
                applied_passes=0,
                processing_ms=elapsed_ms,
                stop_reason="processor-error",
                error=message,
            )

    def _log_watermark_processing_result(
        self,
        result: WatermarkProcessingResult,
        asset_type: str,
        filename: str,
        job_id: str | None = None,
    ) -> None:
        if not job_id:
            return
        if result.error:
            self.append_job_log(
                job_id,
                "warning",
                f"{asset_type.title()} watermark cleanup failed for {filename}; uploading the original image: {result.error}",
            )
            return
        if result.applied:
            self.append_job_log(
                job_id,
                "info",
                f"{asset_type.title()} watermark cleanup removed {result.applied_passes} detected layer(s) "
                f"in {result.processing_ms} ms (output format and dimensions preserved)",
            )
            return
        self.append_job_log(
            job_id,
            "info",
            f"No supported watermark detected in {asset_type} image {filename} "
            f"({result.processing_ms} ms); uploading the original bytes",
        )
