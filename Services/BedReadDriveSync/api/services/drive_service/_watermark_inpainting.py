"""Conservative detection and reconstruction for opaque Gemini watermark families.

The JavaScript SDK can reverse the known translucent sparkle alpha layer, but it
cannot remove opaque badges or the ``M GEMINI`` wordmark.  This module recognizes
only those two tightly-defined, bottom-right families and reconstructs their
small corner region with the OpenCV LaMa ONNX model.  Any uncertainty is a
no-op: callers must preserve the source bytes and surface a review state.
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image


logger = logging.getLogger(__name__)

_MODEL_FILENAME = "inpainting_lama_2025jan.onnx"
_MODEL_URL = (
    "https://huggingface.co/opencv/inpainting_lama/resolve/main/"
    "inpainting_lama_2025jan.onnx"
)
_MODEL_SHA256 = "7df918ac3921d3daf0aae1d219776cf0dc4e4935f035af81841b40adcf74fdf2"
_MODEL_LOCK = threading.Lock()
_SESSION: Any | None = None
_SESSION_PATH: Path | None = None


@dataclass(frozen=True)
class OpaqueWatermarkDetection:
    family: str
    box: tuple[int, int, int, int]
    confidence: float
    details: dict[str, Any]


@dataclass(frozen=True)
class OpaqueWatermarkResult:
    image: Image.Image | None
    detected: bool
    applied: bool
    processing_ms: int
    family: str | None = None
    region: tuple[int, int, int, int] | None = None
    confidence: float | None = None
    error: str | None = None


def _components(mask: np.ndarray, x_offset: int = 0, y_offset: int = 0) -> list[dict[str, int]]:
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    return [
        {
            "x": int(stats[index, cv2.CC_STAT_LEFT] + x_offset),
            "y": int(stats[index, cv2.CC_STAT_TOP] + y_offset),
            "w": int(stats[index, cv2.CC_STAT_WIDTH]),
            "h": int(stats[index, cv2.CC_STAT_HEIGHT]),
            "area": int(stats[index, cv2.CC_STAT_AREA]),
        }
        for index in range(1, count)
    ]


def detect_opaque_watermark(image: Image.Image) -> OpaqueWatermarkDetection | None:
    """Return a high-confidence opaque watermark family, otherwise ``None``."""

    bgr = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    height, width = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    # Family 1: a neutral-white opaque badge physically attached to both edges.
    x0 = max(0, width - 192)
    y0 = max(0, height - 160)
    badge_mask = ((gray[y0:, x0:] >= 165) & (hsv[y0:, x0:, 1] <= 72)).astype(np.uint8)
    badge_mask = cv2.morphologyEx(badge_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    for component in _components(badge_mask, x0, y0):
        box_area = max(1, component["w"] * component["h"])
        fill = component["area"] / box_area
        crop = hsv[
            component["y"] : component["y"] + component["h"],
            component["x"] : component["x"] + component["w"],
        ]
        mean_saturation = float(crop[:, :, 1].mean()) if crop.size else 255.0
        valid = (
            component["x"] + component["w"] >= width - 2
            and component["y"] + component["h"] >= height - 2
            and 32 <= component["w"] <= 160
            and 32 <= component["h"] <= 140
            and box_area <= 0.025 * width * height
            and fill >= 0.78
            and mean_saturation <= 42
        )
        if valid:
            confidence = min(0.99, 0.75 + 0.18 * fill + 0.06 * (1 - mean_saturation / 42))
            return OpaqueWatermarkDetection(
                family="badge",
                box=(component["x"], component["y"], width, height),
                confidence=round(confidence, 4),
                details={"component": component, "fill": fill, "mean_saturation": mean_saturation},
            )

    # Family 2: edge-anchored monogram plus a small-cap word row on dark pixels.
    roi_width = max(96, round(0.12 * width))
    roi_height = max(88, round(0.21 * height))
    x0 = width - roi_width
    y0 = height - roi_height
    wordmark_mask = ((gray[y0:, x0:] >= 130) & (hsv[y0:, x0:, 1] <= 95)).astype(np.uint8)
    wordmark_mask = cv2.morphologyEx(wordmark_mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    components = [component for component in _components(wordmark_mask, x0, y0) if component["area"] >= 3]
    icons = [
        component
        for component in components
        if 16 <= component["w"] <= 55
        and 18 <= component["h"] <= 55
        and 100 <= component["area"] <= 1200
        and width - (component["x"] + component["w"]) <= 20
        and height - (component["y"] + component["h"]) <= 24
    ]
    for icon in sorted(icons, key=lambda item: item["area"], reverse=True):
        lower = [
            component
            for component in components
            if icon["y"] + icon["h"] - 2 <= component["y"] <= icon["y"] + icon["h"] + 28
            and component["x"] >= icon["x"] - 12
        ]
        patch = gray[
            max(y0, icon["y"] - 6) : min(height, icon["y"] + icon["h"] + 30),
            max(x0, icon["x"] - 10) : width,
        ]
        dark_fraction = float((patch < 105).mean()) if patch.size else 0.0
        if len(lower) >= 4 and dark_fraction >= 0.42:
            confidence = min(0.99, 0.74 + min(0.12, 0.02 * len(lower)) + 0.12 * dark_fraction)
            return OpaqueWatermarkDetection(
                family="wordmark",
                box=(max(x0, icon["x"] - 10), max(y0, icon["y"] - 7), width, height),
                confidence=round(confidence, 4),
                details={"icon": icon, "lower_count": len(lower), "dark_fraction": dark_fraction},
            )
    return None


def _frame_line_evidence(
    gray: np.ndarray,
    axis: str,
    coordinate: int,
    start: int,
    stop: int,
) -> dict[str, float]:
    """Measure a thin bright line against pixels on both sides of it."""

    offset = 5
    if axis == "horizontal":
        line = gray[coordinate, start:stop].astype(np.float32)
        neighbors = (
            gray[coordinate - offset, start:stop].astype(np.float32)
            + gray[coordinate + offset, start:stop].astype(np.float32)
        ) / 2
    else:
        line = gray[start:stop, coordinate].astype(np.float32)
        neighbors = (
            gray[start:stop, coordinate - offset].astype(np.float32)
            + gray[start:stop, coordinate + offset].astype(np.float32)
        ) / 2
    contrast = line - neighbors
    return {
        "coverage": float((contrast >= 12).mean()),
        "mean_contrast": float(contrast.mean()),
        "mean_luminance": float(line.mean()),
    }


def detect_pale_frame(image: Image.Image) -> OpaqueWatermarkDetection | None:
    """Detect a near-edge, symmetric pale frame without matching normal artwork.

    Some Gemini exports contain a compressed one- or two-pixel white rectangle
    in addition to the corner logo.  Requiring four long, bright, symmetric
    sides prevents isolated text boxes, page curls, and scene geometry from
    being treated as that frame.
    """

    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    height, width = gray.shape
    limit = min(64, width // 10, height // 6)
    if limit <= 12:
        return None

    best: tuple[float, int, list[int], list[dict[str, float]]] | None = None
    for margin in range(12, limit + 1):
        side_specs = (
            ("horizontal", margin, margin, width - margin),
            ("horizontal", height - 1 - margin, margin, width - margin),
            ("vertical", margin, margin, height - margin),
            ("vertical", width - 1 - margin, margin, height - margin),
        )
        coordinates: list[int] = []
        evidence: list[dict[str, float]] = []
        for axis, target, start, stop in side_specs:
            candidates = [
                (
                    _frame_line_evidence(gray, axis, coordinate, start, stop),
                    coordinate,
                )
                for coordinate in range(target - 2, target + 3)
            ]
            side_evidence, coordinate = max(
                candidates,
                key=lambda candidate: (
                    candidate[0]["coverage"],
                    candidate[0]["mean_contrast"],
                ),
            )
            coordinates.append(coordinate)
            evidence.append(side_evidence)

        coverages = [side["coverage"] for side in evidence]
        score = sum(coverages) / len(coverages)
        valid = (
            min(coverages) >= 0.62
            and score >= 0.76
            and min(side["mean_contrast"] for side in evidence) >= 18
            and min(side["mean_luminance"] for side in evidence) >= 95
        )
        if valid and (best is None or score > best[0]):
            best = (score, margin, coordinates, evidence)

    if best is None:
        return None
    score, margin, coordinates, evidence = best
    top, bottom, left, right = coordinates
    confidence = min(0.99, 0.65 + 0.34 * score)
    return OpaqueWatermarkDetection(
        family="pale-frame",
        box=(left, top, right + 1, bottom + 1),
        confidence=round(confidence, 4),
        details={
            "margin": margin,
            "coordinates": {
                "top": top,
                "bottom": bottom,
                "left": left,
                "right": right,
            },
            "sides": evidence,
        },
    )


def _interpolate_line_band(pixels: np.ndarray, axis: str, coordinate: int, radius: int = 5) -> None:
    """Replace a narrow line with interpolation from its two neighboring sides."""

    height, width = pixels.shape[:2]
    limit = height if axis == "horizontal" else width
    start = max(1, coordinate - radius)
    stop = min(limit - 1, coordinate + radius + 1)
    if stop <= start:
        return
    before = pixels[start - 1].copy() if axis == "horizontal" else pixels[:, start - 1].copy()
    after = pixels[stop].copy() if axis == "horizontal" else pixels[:, stop].copy()
    span = stop - start + 1
    for index, position in enumerate(range(start, stop), start=1):
        alpha = index / span
        blended = np.clip(before * (1 - alpha) + after * alpha, 0, 255)
        if axis == "horizontal":
            pixels[position] = blended
        else:
            pixels[:, position] = blended


def reconstruct_pale_frame(
    image: Image.Image,
    detection: OpaqueWatermarkDetection | None = None,
    radius: int = 4,
) -> OpaqueWatermarkResult:
    """Remove a validated pale frame using local, perpendicular interpolation."""

    started_at = time.perf_counter()
    detection = detection or detect_pale_frame(image)
    if detection is None:
        return OpaqueWatermarkResult(
            image=None,
            detected=False,
            applied=False,
            processing_ms=round((time.perf_counter() - started_at) * 1000),
        )
    try:
        coordinates = detection.details["coordinates"]
        pixels = np.asarray(image.convert("RGB"))
        height, width = pixels.shape[:2]
        # The frame is a long, one-to-two-pixel overlay with a small JPEG halo.
        # Perpendicular interpolation removes that narrow signal while retaining
        # the scene on both sides. Whole-band Telea inpainting can smear a long
        # horizontal strip, especially along the bottom of wide banners.
        prepared = pixels.astype(np.float32).copy()
        _interpolate_line_band(prepared, "horizontal", int(coordinates["top"]), radius)
        _interpolate_line_band(prepared, "horizontal", int(coordinates["bottom"]), radius)
        _interpolate_line_band(prepared, "vertical", int(coordinates["left"]), radius)
        _interpolate_line_band(prepared, "vertical", int(coordinates["right"]), radius)
        output = prepared.astype(np.uint8)
        return OpaqueWatermarkResult(
            image=Image.fromarray(output),
            detected=True,
            applied=True,
            processing_ms=round((time.perf_counter() - started_at) * 1000),
            family=detection.family,
            region=detection.box,
            confidence=detection.confidence,
        )
    except Exception as exc:
        return OpaqueWatermarkResult(
            image=None,
            detected=True,
            applied=False,
            processing_ms=round((time.perf_counter() - started_at) * 1000),
            family=detection.family,
            region=detection.box,
            confidence=detection.confidence,
            error=str(exc),
        )


def _model_path() -> Path:
    configured = os.getenv("WATERMARK_INPAINT_MODEL_PATH", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[2] / "data" / "models" / _MODEL_FILENAME


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _ensure_model() -> Path:
    path = _model_path()
    if path.is_file() and _sha256(path) == _MODEL_SHA256:
        return path
    if os.getenv("WATERMARK_INPAINT_ALLOW_DOWNLOAD", "1").strip().lower() in {"0", "false", "no"}:
        raise RuntimeError(f"LaMa model is unavailable or invalid at {path}")

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".download")
    try:
        logger.info("Downloading watermark inpainting model to %s", path)
        with urllib.request.urlopen(_MODEL_URL, timeout=120) as response, temporary.open("wb") as target:
            while chunk := response.read(1024 * 1024):
                target.write(chunk)
        if _sha256(temporary) != _MODEL_SHA256:
            raise RuntimeError("Downloaded LaMa model failed its SHA-256 integrity check")
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink(missing_ok=True)
    return path


def _session() -> Any:
    global _SESSION, _SESSION_PATH
    path = _model_path()
    with _MODEL_LOCK:
        if _SESSION is not None and _SESSION_PATH == path:
            return _SESSION
        verified_path = _ensure_model()
        try:
            import onnxruntime as ort
        except ImportError as exc:  # pragma: no cover - dependency error is exercised through caller
            raise RuntimeError("onnxruntime is required for opaque watermark reconstruction") from exc
        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, int(os.getenv("WATERMARK_INPAINT_THREADS", "6")))
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        _SESSION = ort.InferenceSession(
            str(verified_path),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        _SESSION_PATH = verified_path
        return _SESSION


def _masks(shape: tuple[int, ...], box: tuple[int, int, int, int], margin: int) -> tuple[np.ndarray, np.ndarray]:
    height, width = shape[:2]
    x0, y0, x1, y1 = box
    core = np.zeros((height, width), np.uint8)
    expanded = np.zeros((height, width), np.uint8)
    core[y0:y1, x0:x1] = 255
    expanded[max(0, y0 - margin) : y1, max(0, x0 - margin) : x1] = 255
    return core, expanded


def _alpha_ramp(core: np.ndarray, expanded: np.ndarray, margin: int) -> np.ndarray:
    padded = np.pad((expanded > 0).astype(np.uint8), 1, constant_values=0)
    distance = cv2.distanceTransform(padded, cv2.DIST_L2, 5)[1:-1, 1:-1]
    alpha = np.clip(distance / max(1, margin), 0, 1)
    alpha[core > 0] = 1
    return alpha.astype(np.float32)


def _infer(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    resized_image = cv2.resize(bgr, (512, 512), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    resized_mask = (cv2.resize(mask, (512, 512), interpolation=cv2.INTER_NEAREST) > 0).astype(np.float32)
    output = _session().run(
        None,
        {
            "image": np.transpose(resized_image, (2, 0, 1))[None],
            "mask": resized_mask[None, None],
        },
    )[0]
    generated = np.clip(np.transpose(output[0], (1, 2, 0)), 0, 255).astype(np.uint8)
    return cv2.resize(generated, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_CUBIC)


def _infer_window(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Run LaMa on a local window around the mask instead of the whole frame.

    Squeezing a full banner into the model's 512x512 input throws away most of
    the corner's detail and returns a soft, smeary fill. A window a bit larger
    than the mask keeps the repair at (or above) native resolution while the
    surrounding pixels stay byte-identical.
    """
    height, width = bgr.shape[:2]
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        return bgr.copy()
    top, bottom = int(ys.min()), int(ys.max()) + 1
    left, right = int(xs.min()), int(xs.max()) + 1
    side = max(256, round(1.75 * max(bottom - top, right - left)))
    side = min(side, width, height)
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2
    window_left = max(0, min(width - side, center_x - side // 2))
    window_top = max(0, min(height - side, center_y - side // 2))
    window = (slice(window_top, window_top + side), slice(window_left, window_left + side))
    if mask[window].sum() < mask.sum():
        # The mask does not fit in a square window; fall back to full-frame.
        return _infer(bgr, mask)
    generated = bgr.copy()
    generated[window] = _infer(bgr[window], mask[window])
    return generated


def reconstruct_opaque_watermark(
    image: Image.Image,
    detection: OpaqueWatermarkDetection | None = None,
) -> OpaqueWatermarkResult:
    """Detect and reconstruct an opaque mark; never mutate the source on failure."""

    started_at = time.perf_counter()
    detection = detection or detect_opaque_watermark(image)
    if detection is None:
        return OpaqueWatermarkResult(
            image=None,
            detected=False,
            applied=False,
            processing_ms=round((time.perf_counter() - started_at) * 1000),
        )
    try:
        bgr = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
        margin = 14 if detection.family == "badge" else 9
        core, expanded = _masks(bgr.shape, detection.box, margin)
        generated = _infer_window(bgr, expanded)
        alpha = _alpha_ramp(core, expanded, margin)
        output = np.clip(bgr * (1 - alpha[:, :, None]) + generated * alpha[:, :, None], 0, 255).astype(np.uint8)
        rgb = cv2.cvtColor(output, cv2.COLOR_BGR2RGB)
        return OpaqueWatermarkResult(
            image=Image.fromarray(rgb),
            detected=True,
            applied=True,
            processing_ms=round((time.perf_counter() - started_at) * 1000),
            family=detection.family,
            region=detection.box,
            confidence=detection.confidence,
        )
    except Exception as exc:
        return OpaqueWatermarkResult(
            image=None,
            detected=True,
            applied=False,
            processing_ms=round((time.perf_counter() - started_at) * 1000),
            family=detection.family,
            region=detection.box,
            confidence=detection.confidence,
            error=str(exc),
        )


def is_safe_flat_sparkle_candidate(
    image: Image.Image,
    region: tuple[int, int, int, int],
    evidence: dict[str, Any] | None,
) -> bool:
    """Accept a weak sparkle only when it sits on an exceptionally flat patch.

    This gate separates the faint, compressed sparkle fixture from page curls,
    jewelry, sequins, text edges, and other high-detail false positives.
    """

    if not evidence or evidence.get("polarity") != "light":
        return False
    gradient_score = float(evidence.get("gradientScore") or 0)
    luminance_score = float(evidence.get("luminanceScore") or 0)
    if gradient_score >= 0.06 or luminance_score < 0.30:
        return False
    rgb = np.asarray(image.convert("RGB"))
    height, width = rgb.shape[:2]
    x0, y0, x1, y1 = region
    if x0 < int(width * 0.78) or y0 < int(height * 0.72) or x1 > width or y1 > height:
        return False
    gray = cv2.cvtColor(rgb[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY)
    if gray.size == 0:
        return False
    return float(gray.std()) <= 4.0 and float(cv2.Laplacian(gray, cv2.CV_32F).std()) <= 4.0


def reconstruct_watermark_regions(
    image: Image.Image,
    regions: list[tuple[int, int, int, int]],
    family: str,
    margin: int = 5,
    confidence: float | None = None,
    shaped_regions: list[tuple[int, int, int, int]] | None = None,
    shaped_region_masks: dict[tuple[int, int, int, int], list[int]] | None = None,
) -> OpaqueWatermarkResult:
    """Reconstruct independently validated small watermark regions with LaMa."""

    started_at = time.perf_counter()
    if not regions:
        return OpaqueWatermarkResult(None, False, False, 0)
    try:
        bgr = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
        height, width = bgr.shape[:2]
        core = np.zeros((height, width), np.uint8)
        expanded = np.zeros((height, width), np.uint8)
        shaped = np.zeros((height, width), np.uint8)
        shaped_set = set(shaped_regions or ())
        supplied_masks = shaped_region_masks or {}
        for x0, y0, x1, y1 in regions:
            if x0 < 0 or y0 < 0 or x1 <= x0 or y1 <= y0 or x1 > width or y1 > height:
                raise ValueError("Watermark reconstruction region is outside the image")
            region = (x0, y0, x1, y1)
            if region in shaped_set:
                region_width = x1 - x0
                region_height = y1 - y0
                supplied = supplied_masks.get(region)
                if supplied is not None and len(supplied) == region_width * region_height:
                    sparkle = np.asarray(supplied, dtype=np.uint8).reshape(region_height, region_width)
                else:
                    xs = np.linspace(-1.0, 1.0, region_width, dtype=np.float32)
                    ys = np.linspace(-1.0, 1.0, region_height, dtype=np.float32)
                    xx, yy = np.meshgrid(xs, ys)
                    sparkle = (
                        np.power(np.abs(xx), 0.72) + np.power(np.abs(yy), 0.72) <= 1.0
                    ).astype(np.uint8)
                sparkle = cv2.dilate(sparkle, np.ones((7, 7), np.uint8)) * 255
                shaped[y0:y1, x0:x1] = np.maximum(shaped[y0:y1, x0:x1], sparkle)
            else:
                core[y0:y1, x0:x1] = 255
                expanded[
                    max(0, y0 - margin) : min(height, y1 + margin),
                    max(0, x0 - margin) : min(width, x1 + margin),
                ] = 255
        inference_mask = np.maximum(expanded, shaped)
        generated = _infer_window(bgr, inference_mask)
        alpha = _alpha_ramp(core, expanded, margin) if np.any(core) else np.zeros((height, width), np.float32)
        if np.any(shaped):
            shaped_alpha = cv2.GaussianBlur(shaped.astype(np.float32) / 255, (0, 0), 2.0)
            alpha = np.maximum(alpha, np.clip(shaped_alpha * 1.4, 0, 1))
        output = np.clip(bgr * (1 - alpha[:, :, None]) + generated * alpha[:, :, None], 0, 255).astype(np.uint8)
        union = (
            min(region[0] for region in regions),
            min(region[1] for region in regions),
            max(region[2] for region in regions),
            max(region[3] for region in regions),
        )
        return OpaqueWatermarkResult(
            image=Image.fromarray(cv2.cvtColor(output, cv2.COLOR_BGR2RGB)),
            detected=True,
            applied=True,
            processing_ms=round((time.perf_counter() - started_at) * 1000),
            family=family,
            region=union,
            confidence=confidence,
        )
    except Exception as exc:
        return OpaqueWatermarkResult(
            image=None,
            detected=True,
            applied=False,
            processing_ms=round((time.perf_counter() - started_at) * 1000),
            family=family,
            confidence=confidence,
            error=str(exc),
        )
