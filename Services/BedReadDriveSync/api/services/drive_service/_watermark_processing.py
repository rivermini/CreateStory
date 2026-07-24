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
_ESCALATED_REGION_GROWTH = 0.60
# A standalone dark silhouette this strong is a legacy over-subtraction hole,
# not scene content; thresholds validated against real damaged outputs.
_DARK_RESIDUAL_MIN_SCORE = 0.45
_DARK_RESIDUAL_MIN_GRADIENT = 0.25
_DARK_RESIDUAL_MIN_LUMINANCE = 0.40


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
    growth_factor: float = _PRIMARY_REGION_GROWTH,
) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = region
    growth = max(4, round((x1 - x0) * growth_factor))
    return (
        max(0, x0 - growth),
        max(0, y0 - growth),
        min(width, x1 + growth),
        min(height, y1 + growth),
    )


def _region_tuple(data: Any) -> tuple[int, int, int, int] | None:
    if not isinstance(data, dict):
        return None
    try:
        return (
            int(data["x"]),
            int(data["y"]),
            int(data["x"] + data["width"]),
            int(data["y"] + data["height"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _dark_candidate_is_strong(candidate: dict[str, Any]) -> bool:
    return (
        candidate.get("polarity") == "dark"
        and float(candidate.get("score") or 0) >= _DARK_RESIDUAL_MIN_SCORE
        and float(candidate.get("gradientScore") or 0) >= _DARK_RESIDUAL_MIN_GRADIENT
        and float(candidate.get("luminanceScore") or 0) >= _DARK_RESIDUAL_MIN_LUMINANCE
    )


def _expected_sparkle_corner(width: int, height: int) -> tuple[int, int, int, int]:
    """Where Gemini stamps the sparkle, derived from observed exports.

    The mark measures ~5.7-6.8% of the min dimension and sits inset from the
    bottom-right corner by roughly 0.7x its own size. The returned box pads
    both ends of that range so a repaint fully covers any residue there.
    """
    unit = 0.067 * min(width, height)
    return (
        max(0, round(width - 2.2 * unit)),
        max(0, round(height - 2.2 * unit)),
        min(width, round(width - 0.3 * unit)),
        min(height, round(height - 0.3 * unit)),
    )


def _encoded_sparkle_residue(
    encoded_bytes: bytes,
    width: int,
    height: int,
    region: tuple[int, int, int, int],
) -> bool:
    """Re-detect on the exact upload bytes; True when a ghost survives the repair.

    Both polarities count: a pale echo of the sparkle (undersized template or
    the size-matched lossy re-encode sharpening it back) and a dark
    over-subtraction hole. When the detector itself cannot run, the repair is
    unverifiable and must not ship — the caller escalates or preserves the
    original for review.
    """
    try:
        with Image.open(io.BytesIO(encoded_bytes)) as decoded:
            pixels = decoded.convert("RGBA").tobytes()
        _, metadata = _run_node_processor(pixels, width, height)
    except Exception:
        return True
    passes = tuple(metadata.get("passes") or ())
    position = (passes[0].get("position") if passes else None) or {}
    found = _region_tuple(position)
    if found is not None and _regions_intersect(found, region):
        if bool(metadata.get("applied")):
            return True
        evidence = ((passes[0].get("validation") or {}).get("evidence")) or {}
        if (
            evidence.get("polarity") == "light"
            and float(evidence.get("score") or 0) >= _PRIMARY_RESIDUE_MIN_SCORE
            and float(evidence.get("gradientScore") or 0) >= _PRIMARY_RESIDUE_MIN_GRADIENT
            and float(evidence.get("luminanceScore") or 0) >= _PRIMARY_RESIDUE_MIN_LUMINANCE
        ):
            return True
    dark = metadata.get("darkCandidate") or {}
    dark_region = _region_tuple(dark.get("region"))
    return (
        dark_region is not None
        and _regions_intersect(dark_region, region)
        and _dark_candidate_is_strong(dark)
    )


class WatermarkProcessingMixin:
    """Adds best-effort watermark cleanup before image bytes leave DriveSync."""

    def _repaint_expected_sparkle_corner(
        self,
        image_bytes: bytes,
        filename: str,
    ) -> WatermarkProcessingResult:
        """Force-repaint the standard sparkle corner of a legacy repair output.

        Outputs written by the retired multi-pass subtraction can carry dark
        holes shaped too irregularly for template detection to find. Their
        provenance is certain (job history), and the stamp position is
        deterministic, so the corner is repainted outright and the result held
        to the normal verification bar.
        """
        started_at = time.perf_counter()
        try:
            with Image.open(io.BytesIO(image_bytes)) as source:
                image_format = (source.format or "").upper()
                width, height = source.size
                source_info = dict(source.info)
                rgb_image = source.convert("RGB")
            corner = _expected_sparkle_corner(width, height)
            # Legacy damage can outsize the sparkle stamp (badge-era repairs),
            # so allow one escalation to a grown box before giving up.
            targets = (
                corner,
                _expanded_primary_region(corner, width, height, _ESCALATED_REGION_GROWTH),
            )
            for target in targets:
                repaint = reconstruct_watermark_regions(
                    rgb_image,
                    [target],
                    family="legacy-corner-repaint",
                    margin=8,
                )
                if not repaint.applied or repaint.image is None:
                    break
                encoded = _encode_processed_pixels(
                    repaint.image.convert("RGBA").tobytes(),
                    width,
                    height,
                    image_format,
                    source_info,
                    len(image_bytes),
                )
                if not _encoded_sparkle_residue(encoded, width, height, corner):
                    return WatermarkProcessingResult(
                        image_bytes=encoded,
                        applied=True,
                        applied_passes=1,
                        processing_ms=round((time.perf_counter() - started_at) * 1000),
                        stop_reason="legacy-corner-repaint-reconstructed",
                        method="legacy-corner-repaint",
                        region=target,
                    )
            return WatermarkProcessingResult(
                image_bytes=image_bytes,
                applied=False,
                applied_passes=0,
                processing_ms=round((time.perf_counter() - started_at) * 1000),
                stop_reason="legacy-corner-repaint-unverified",
                needs_review=True,
                method="legacy-corner-repaint",
                region=corner,
            )
        except Exception as exc:
            return WatermarkProcessingResult(
                image_bytes=image_bytes,
                applied=False,
                applied_passes=0,
                processing_ms=round((time.perf_counter() - started_at) * 1000),
                stop_reason="processor-error",
                error=str(exc),
            )

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
                if method == "sparkle-primary":
                    # A lone sparkle's template box regularly undersizes its
                    # halo, and a shape-tight repaint leaves a pale echo.
                    # Repaint the whole grown corner box from the start.
                    regions = [_expanded_primary_region(candidate_region, width, height)]
                    shaped_regions = []
                    shaped_region_masks = {}
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
                    # A ghost survived (or verification could not run); repaint
                    # a larger corner box once, then insist the detector is
                    # quiet on the exact bytes that would be uploaded.
                    expanded_region = _expanded_primary_region(
                        candidate_region,
                        width,
                        height,
                        _ESCALATED_REGION_GROWTH,
                    )
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
                    with Image.open(io.BytesIO(encoded)) as decoded:
                        opaque_leftover = detect_opaque_watermark(decoded.convert("RGB"))
                    elapsed_ms = round((time.perf_counter() - started_at) * 1000)
                    if opaque_leftover is not None:
                        return WatermarkProcessingResult(
                            image_bytes=image_bytes,
                            applied=False,
                            applied_passes=0,
                            processing_ms=elapsed_ms,
                            stop_reason=f"{opaque_method}-residual",
                            passes=passes,
                            needs_review=True,
                            method=opaque_method,
                            region=opaque.region,
                            confidence=opaque.confidence,
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
                dark = metadata.get("darkCandidate") or {}
                dark_region = _region_tuple(dark.get("region"))
                if dark_region is not None and _dark_candidate_is_strong(dark):
                    # A standalone dark sparkle hole: damage left on the server
                    # by the retired multi-pass subtraction. Repaint it like
                    # any confirmed sparkle and hold it to the same verify bar.
                    dark_confidence = float(dark.get("score") or 0)
                    repaint = reconstruct_watermark_regions(
                        working_image,
                        [_expanded_primary_region(dark_region, width, height)],
                        family="sparkle-dark-residual",
                        margin=8,
                        confidence=dark_confidence,
                    )
                    if repaint.applied and repaint.image is not None:
                        encoded = _encode_processed_pixels(
                            repaint.image.convert("RGBA").tobytes(),
                            width,
                            height,
                            image_format,
                            source_info,
                            len(image_bytes),
                        )
                        if not _encoded_sparkle_residue(encoded, width, height, dark_region):
                            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
                            return WatermarkProcessingResult(
                                image_bytes=encoded,
                                applied=True,
                                applied_passes=1,
                                processing_ms=elapsed_ms,
                                stop_reason="sparkle-dark-residual-reconstructed",
                                passes=passes,
                                method="sparkle-dark-residual",
                                region=repaint.region,
                                confidence=dark_confidence,
                            )
                    elapsed_ms = round((time.perf_counter() - started_at) * 1000)
                    return WatermarkProcessingResult(
                        image_bytes=image_bytes,
                        applied=False,
                        applied_passes=0,
                        processing_ms=elapsed_ms,
                        stop_reason="sparkle-dark-residual-unrepaired",
                        passes=passes,
                        needs_review=True,
                        method="sparkle-dark-residual",
                        region=dark_region,
                        confidence=dark_confidence,
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
            sdk_method = f"{opaque_method}+sparkle" if opaque_applied else "sparkle"
            sdk_confidence = float(pass_metadata.get("confidence") or 0) or None
            if candidate_region is not None and _encoded_sparkle_residue(
                encoded,
                width,
                height,
                candidate_region,
            ):
                # The SDK's own subtraction shipped with a visible echo or a
                # dark hole. Fall back to repainting the corner from the
                # untouched source, and hold that to the same verify bar.
                repaint = reconstruct_watermark_regions(
                    working_image,
                    [_expanded_primary_region(candidate_region, width, height)],
                    family="sparkle-repaint",
                    margin=8,
                    confidence=sdk_confidence,
                )
                rescued_bytes = None
                if repaint.applied and repaint.image is not None:
                    rescued_bytes = _encode_processed_pixels(
                        repaint.image.convert("RGBA").tobytes(),
                        width,
                        height,
                        image_format,
                        source_info,
                        len(image_bytes),
                    )
                    if _encoded_sparkle_residue(rescued_bytes, width, height, candidate_region):
                        rescued_bytes = None
                elapsed_ms = round((time.perf_counter() - started_at) * 1000)
                if rescued_bytes is None:
                    return WatermarkProcessingResult(
                        image_bytes=image_bytes,
                        applied=False,
                        applied_passes=0,
                        processing_ms=elapsed_ms,
                        stop_reason="sparkle-subtraction-residual",
                        passes=passes,
                        needs_review=True,
                        method=sdk_method,
                        region=candidate_region,
                        confidence=sdk_confidence,
                    )
                return WatermarkProcessingResult(
                    image_bytes=rescued_bytes,
                    applied=True,
                    applied_passes=1 + int(opaque_applied),
                    processing_ms=elapsed_ms,
                    stop_reason=(f"{opaque_method}+" if opaque_applied else "")
                    + "sparkle-repaint-reconstructed",
                    passes=passes,
                    method=f"{opaque_method}+sparkle-repaint" if opaque_applied else "sparkle-repaint",
                    region=repaint.region,
                    confidence=sdk_confidence,
                )
            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
            return WatermarkProcessingResult(
                image_bytes=encoded,
                applied=True,
                applied_passes=int(metadata.get("appliedPassCount") or 1) + int(opaque_applied),
                processing_ms=elapsed_ms,
                stop_reason=(f"{opaque_method}+" if opaque_applied else "")
                + str(metadata.get("stopReason") or "completed"),
                passes=passes,
                needs_review=bool(metadata.get("needsReview")),
                method=sdk_method,
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
