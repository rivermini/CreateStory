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

from ._watermark_inpainting import (
    detect_opaque_watermark,
    is_safe_flat_sparkle_candidate,
    reconstruct_opaque_watermark,
    reconstruct_watermark_regions,
)


logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_SECONDS = 120
_DEFAULT_MAX_PASSES = 1
_LOSSY_MIN_QUALITY = 50
_LOSSY_MAX_QUALITY = 98
_LOSSY_SEARCH_STEPS = 7
# Mirrors the node runtime's minimum original-pixel evidence gates. A cleaned
# corner that still clears every minimum has a humanly visible sparkle ghost.
_PRIMARY_RESIDUE_MIN_SCORE = 0.2
_PRIMARY_RESIDUE_MIN_GRADIENT = 0.12
_PRIMARY_RESIDUE_MIN_LUMINANCE = 0.25
_PRIMARY_REGION_GROWTH = 0.30


@dataclass(frozen=True)
class WatermarkProcessingResult:
    image_bytes: bytes
    applied: bool
    applied_passes: int
    processing_ms: int
    stop_reason: str
    error: str | None = None
    passes: tuple[dict[str, Any], ...] = ()
    needs_review: bool = False
    method: str = "none"
    region: tuple[int, int, int, int] | None = None
    confidence: float | None = None


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


def _regions_intersect(
    first: tuple[int, int, int, int],
    second: tuple[int, int, int, int],
) -> bool:
    return (
        first[0] < second[2]
        and first[2] > second[0]
        and first[1] < second[3]
        and first[3] > second[1]
    )


def _expanded_primary_region(
    region: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = region
    growth = max(4, round((x1 - x0) * _PRIMARY_REGION_GROWTH))
    return (
        max(0, x0 - growth),
        max(0, y0 - growth),
        min(width, x1 + growth),
        min(height, y1 + growth),
    )


def _encoded_sparkle_residue(
    encoded_bytes: bytes,
    width: int,
    height: int,
    region: tuple[int, int, int, int],
) -> bool:
    """Re-detect on the exact upload bytes; True when a ghost survives the repair.

    The SDK's template position can slightly undersize a small sparkle's halo,
    so a shaped repaint may leave a pale echo — and the size-matched lossy
    re-encode can sharpen that echo back above detection thresholds. Evidence
    on the encoded output that still clears every original-evidence minimum at
    the same corner means the repair is not visually complete.
    """
    try:
        with Image.open(io.BytesIO(encoded_bytes)) as decoded:
            pixels = decoded.convert("RGBA").tobytes()
        _, metadata = _run_node_processor(pixels, width, height)
    except Exception:
        # Verification is a best-effort extra guard on an already validated
        # reconstruction; a runtime hiccup here must not discard the repair.
        return False
    passes = tuple(metadata.get("passes") or ())
    position = (passes[0].get("position") if passes else None) or {}
    if not position:
        return False
    found = (
        int(position["x"]),
        int(position["y"]),
        int(position["x"] + position["width"]),
        int(position["y"] + position["height"]),
    )
    if not _regions_intersect(found, region):
        return False
    if bool(metadata.get("applied")):
        return True
    evidence = ((passes[0].get("validation") or {}).get("evidence")) or {}
    return (
        evidence.get("polarity") == "light"
        and float(evidence.get("score") or 0) >= _PRIMARY_RESIDUE_MIN_SCORE
        and float(evidence.get("gradientScore") or 0) >= _PRIMARY_RESIDUE_MIN_GRADIENT
        and float(evidence.get("luminanceScore") or 0) >= _PRIMARY_RESIDUE_MIN_LUMINANCE
    )


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
                rgb_image = source.convert("RGB")

            # Thin borders and frames are valid artwork. Automatic mode only
            # handles independently validated logo/sparkle families.
            working_image = rgb_image
            opaque_detection = detect_opaque_watermark(working_image)
            opaque = reconstruct_opaque_watermark(working_image, opaque_detection)
            opaque_applied = False
            opaque_method = "none"
            if opaque.detected:
                elapsed_ms = round((time.perf_counter() - started_at) * 1000)
                if not opaque.applied or opaque.image is None:
                    return WatermarkProcessingResult(
                        image_bytes=image_bytes,
                        applied=False,
                        applied_passes=0,
                        processing_ms=elapsed_ms,
                        stop_reason="opaque-reconstruction-unavailable",
                        error=opaque.error or "Opaque watermark reconstruction was not available.",
                        needs_review=True,
                        method=f"opaque-{opaque.family or 'unknown'}",
                        region=opaque.region,
                        confidence=opaque.confidence,
                    )
                working_image = opaque.image
                opaque_applied = True
                opaque_method = f"opaque-{opaque.family}"

            rgba_bytes = working_image.convert("RGBA").tobytes()
            processed_pixels, metadata = _run_node_processor(rgba_bytes, width, height)
            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
            passes = tuple(metadata.get("passes") or ())
            pass_metadata = passes[0] if passes else {}
            position = pass_metadata.get("position") or {}
            candidate_region = None
            if position:
                candidate_region = (
                    int(position["x"]),
                    int(position["y"]),
                    int(position["x"] + position["width"]),
                    int(position["y"] + position["height"]),
                )

            paired = metadata.get("pairedCandidate") or {}
            paired_region_data = paired.get("region") or {}
            compact = metadata.get("compactCandidate") or {}
            compact_region_data = compact.get("region") or {}
            secondary = metadata.get("secondaryCandidate") or {}
            secondary_region_data = secondary.get("region") or {}
            candidate_validation = pass_metadata.get("validation") or {}
            candidate_evidence = candidate_validation.get("evidence") or {}
            candidate_is_accepted = bool(candidate_validation.get("accepted"))
            exceptional_dark_pair = (
                metadata.get("stopReason") == "sdk-quality-review-required"
                and candidate_region is not None
                and bool(paired_region_data)
                and paired.get("polarity") == "dark"
                and float(candidate_evidence.get("score") or 0) >= 0.75
                and float(candidate_evidence.get("gradientScore") or 0) >= 0.55
                and float(candidate_evidence.get("luminanceScore") or 0) >= 0.70
                and float(paired.get("score") or 0) >= 0.23
                and float(paired.get("gradientScore") or 0) >= 0.20
                and float(paired.get("luminanceScore") or 0) >= 0.22
            )
            candidate_is_corroborated = (
                candidate_region is not None
                and float(candidate_evidence.get("score") or 0) >= 0.40
                and float(candidate_evidence.get("gradientScore") or 0) >= 0.15
                and float(candidate_evidence.get("luminanceScore") or 0) >= 0.55
                and float(paired.get("score") or 0) >= 0.32
                and float(paired.get("gradientScore") or 0) >= 0.20
                and float(paired.get("luminanceScore") or 0) >= 0.40
            )
            exceptional_compact_pair = (
                metadata.get("stopReason") == "sdk-quality-review-required"
                and candidate_region is not None
                and bool(compact_region_data)
                and compact.get("polarity") == "light"
                and float(candidate_evidence.get("score") or 0) >= 0.75
                and float(candidate_evidence.get("gradientScore") or 0) >= 0.55
                and float(candidate_evidence.get("luminanceScore") or 0) >= 0.70
                and float(compact.get("score") or 0) >= 0.50
                and float(compact.get("gradientScore") or 0) >= 0.34
                and float(compact.get("luminanceScore") or 0) >= 0.48
            )
            compact_is_strong = (
                (candidate_is_accepted or candidate_is_corroborated or exceptional_compact_pair)
                and candidate_region is not None
                and bool(compact_region_data)
                and compact.get("polarity") == "light"
                and float(compact.get("score") or 0) >= 0.50
                and float(compact.get("gradientScore") or 0) >= 0.34
                and float(compact.get("luminanceScore") or 0) >= 0.48
            )
            paired_is_strong = (
                (candidate_is_accepted or candidate_is_corroborated or exceptional_dark_pair)
                and not compact_is_strong
                and candidate_region is not None
                and float(paired.get("score") or 0) >= (0.23 if exceptional_dark_pair else 0.32)
                and float(paired.get("luminanceScore") or 0) >= (0.22 if exceptional_dark_pair else 0.35)
                and float(paired.get("gradientScore") or 0) >= 0.20
            )
            secondary_is_strong = (
                candidate_is_accepted
                and candidate_region is not None
                and bool(secondary_region_data)
                and float(secondary.get("score") or 0) >= 0.34
                and float(secondary.get("luminanceScore") or 0) >= 0.45
            )
            flat_is_safe = (
                processed_pixels is None
                and metadata.get("stopReason") == "insufficient-original-pixel-evidence"
                and candidate_region is not None
                and float(candidate_evidence.get("score") or 0) >= 0.28
                and float(candidate_evidence.get("gradientScore") or 0) >= 0.08
                and is_safe_flat_sparkle_candidate(
                    working_image,
                    candidate_region,
                    candidate_evidence,
                )
            )
            # An sdk-quality-review-required rejection means every independent
            # gate passed (corner position, template evidence, confined change,
            # residual improvement) and only the SDK's own cleanup left visible
            # residue — common on lossy WebP, where alpha subtraction cannot
            # perfectly reverse the compressed sparkle. Reconstruction below
            # repaints from the untouched source, so a decisively evidenced
            # single sparkle is safe to repair without a companion.
            primary_is_strong = (
                processed_pixels is None
                and metadata.get("stopReason") == "sdk-quality-review-required"
                and candidate_region is not None
                and float(candidate_evidence.get("score") or 0) >= 0.60
                and float(candidate_evidence.get("gradientScore") or 0) >= 0.40
                and float(candidate_evidence.get("luminanceScore") or 0) >= 0.70
            )
            if (
                paired_is_strong
                or compact_is_strong
                or flat_is_safe
                or secondary_is_strong
                or primary_is_strong
            ):
                regions = [candidate_region]
                shaped_regions: list[tuple[int, int, int, int]] = []
                shaped_region_masks: dict[tuple[int, int, int, int], list[int]] = {}
                primary_alpha_mask = metadata.get("primaryAlphaMask")
                if isinstance(primary_alpha_mask, list):
                    shaped_regions.append(candidate_region)
                    shaped_region_masks[candidate_region] = primary_alpha_mask
                if secondary_is_strong or compact_is_strong:
                    method = "sparkle-cluster"
                elif paired_is_strong:
                    method = "sparkle-pair"
                elif primary_is_strong:
                    method = "sparkle-primary"
                else:
                    method = "sparkle-flat"
                confidence = max(
                    float(paired.get("score") or 0),
                    float(compact.get("score") or 0),
                    float(secondary.get("score") or 0),
                    float(pass_metadata.get("confidence") or 0),
                )
                if paired_is_strong:
                    paired_region = (
                        int(paired_region_data["x"]),
                        int(paired_region_data["y"]),
                        int(paired_region_data["x"] + paired_region_data["width"]),
                        int(paired_region_data["y"] + paired_region_data["height"]),
                    )
                    regions.append(paired_region)
                    if isinstance(primary_alpha_mask, list):
                        shaped_regions.append(paired_region)
                        shaped_region_masks[paired_region] = primary_alpha_mask
                if compact_is_strong:
                    compact_region = (
                        int(compact_region_data["x"]),
                        int(compact_region_data["y"]),
                        int(compact_region_data["x"] + compact_region_data["width"]),
                        int(compact_region_data["y"] + compact_region_data["height"]),
                    )
                    regions.append(compact_region)
                    shaped_regions.append(compact_region)
                    compact_alpha_mask = compact.get("alphaMask")
                    if isinstance(compact_alpha_mask, list):
                        shaped_region_masks[compact_region] = compact_alpha_mask
                if secondary_is_strong:
                    secondary_width = int(secondary_region_data["width"])
                    secondary_x = max(
                        0,
                        int(secondary_region_data["x"]) - max(2, round(secondary_width * 0.08)),
                    )
                    secondary_region = (
                        secondary_x,
                        int(secondary_region_data["y"]),
                        secondary_x + secondary_width,
                        int(secondary_region_data["y"] + secondary_region_data["height"]),
                    )
                    regions.append(secondary_region)
                    shaped_regions.append(secondary_region)
                    alpha_mask = secondary.get("alphaMask")
                    if isinstance(alpha_mask, list):
                        shaped_region_masks[secondary_region] = alpha_mask
                reconstructed = reconstruct_watermark_regions(
                    working_image,
                    regions,
                    family=method,
                    margin=5 if paired_is_strong or compact_is_strong else 8,
                    confidence=confidence,
                    shaped_regions=shaped_regions,
                    shaped_region_masks=shaped_region_masks,
                )
                elapsed_ms = round((time.perf_counter() - started_at) * 1000)
                if not reconstructed.applied or reconstructed.image is None:
                    return WatermarkProcessingResult(
                        image_bytes=image_bytes,
                        applied=False,
                        applied_passes=0,
                        processing_ms=elapsed_ms,
                        stop_reason=f"{method}-reconstruction-unavailable",
                        error=reconstructed.error or "Sparkle reconstruction was not available.",
                        passes=passes,
                        needs_review=True,
                        method=method,
                        region=reconstructed.region,
                        confidence=confidence,
                    )
                encoded = _encode_processed_pixels(
                    reconstructed.image.convert("RGBA").tobytes(),
                    width,
                    height,
                    image_format,
                    source_info,
                    len(image_bytes),
                )
                if method == "sparkle-primary" and _encoded_sparkle_residue(
                    encoded,
                    width,
                    height,
                    candidate_region,
                ):
                    # The shaped repaint left a visible echo; repaint the whole
                    # grown corner box once, then insist the detector is quiet
                    # on the exact bytes that would be uploaded.
                    expanded_region = _expanded_primary_region(candidate_region, width, height)
                    rectangle = reconstruct_watermark_regions(
                        working_image,
                        [expanded_region],
                        family=method,
                        margin=8,
                        confidence=confidence,
                    )
                    rescued_bytes = None
                    if rectangle.applied and rectangle.image is not None:
                        rescued_bytes = _encode_processed_pixels(
                            rectangle.image.convert("RGBA").tobytes(),
                            width,
                            height,
                            image_format,
                            source_info,
                            len(image_bytes),
                        )
                        if _encoded_sparkle_residue(rescued_bytes, width, height, candidate_region):
                            rescued_bytes = None
                    if rescued_bytes is None:
                        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
                        return WatermarkProcessingResult(
                            image_bytes=image_bytes,
                            applied=False,
                            applied_passes=0,
                            processing_ms=elapsed_ms,
                            stop_reason="sparkle-primary-residual",
                            passes=passes,
                            needs_review=True,
                            method=method,
                            region=candidate_region,
                            confidence=confidence,
                        )
                    reconstructed = rectangle
                    encoded = rescued_bytes
                elapsed_ms = round((time.perf_counter() - started_at) * 1000)
                return WatermarkProcessingResult(
                    image_bytes=encoded,
                    applied=True,
                    applied_passes=len(regions) + int(opaque_applied),
                    processing_ms=elapsed_ms,
                    stop_reason=(f"{opaque_method}+" if opaque_applied else "")
                    + f"{method}-reconstructed",
                    passes=passes,
                    method=f"{opaque_method}+{method}" if opaque_applied else method,
                    region=reconstructed.region,
                    confidence=confidence,
                )
            if processed_pixels is None:
                if opaque_applied:
                    encoded = _encode_processed_pixels(
                        working_image.convert("RGBA").tobytes(),
                        width,
                        height,
                        image_format,
                        source_info,
                        len(image_bytes),
                    )
                    return WatermarkProcessingResult(
                        image_bytes=encoded,
                        applied=True,
                        applied_passes=1,
                        processing_ms=elapsed_ms,
                        stop_reason=f"{opaque_method}-reconstructed",
                        passes=passes,
                        method=opaque_method,
                        region=opaque.region,
                        confidence=opaque.confidence,
                    )
                return WatermarkProcessingResult(
                    image_bytes=image_bytes,
                    applied=False,
                    applied_passes=0,
                    processing_ms=elapsed_ms,
                    stop_reason=str(metadata.get("stopReason") or "no-match"),
                    passes=passes,
                    needs_review=bool(metadata.get("needsReview")),
                    method="sparkle" if metadata.get("candidate") else "none",
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
                applied_passes=int(metadata.get("appliedPassCount") or 1) + int(opaque_applied),
                processing_ms=elapsed_ms,
                stop_reason=(f"{opaque_method}+" if opaque_applied else "")
                + str(metadata.get("stopReason") or "completed"),
                passes=passes,
                needs_review=bool(metadata.get("needsReview")),
                method=f"{opaque_method}+sparkle" if opaque_applied else "sparkle",
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
            if result.method.startswith("opaque-") and "+" not in result.method:
                family = result.method.removeprefix("opaque-")
                self.append_job_log(
                    job_id,
                    "info",
                    f"{asset_type.title()} watermark cleanup reconstructed the opaque {family} "
                    f"in {result.processing_ms} ms (output format and dimensions preserved)",
                )
                return
            self.append_job_log(
                job_id,
                "info",
                f"{asset_type.title()} watermark cleanup removed {result.applied_passes} detected layer(s) "
                f"in {result.processing_ms} ms (output format and dimensions preserved)",
            )
            return
        if result.needs_review:
            self.append_job_log(
                job_id,
                "warning",
                f"{asset_type.title()} image {filename} may contain an uncertain watermark; "
                "the original bytes were preserved for review",
            )
            return
        self.append_job_log(
            job_id,
            "info",
            f"No supported watermark detected in {asset_type} image {filename} "
            f"({result.processing_ms} ms); uploading the original bytes",
        )
