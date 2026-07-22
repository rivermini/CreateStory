from __future__ import annotations

import io

from PIL import Image, ImageDraw

from api.services.drive_service import _watermark_inpainting as inpainting
from api.services.drive_service import _watermark_processing as module
from api.services.drive_service._watermark_processing import WatermarkProcessingMixin


class _Processor(WatermarkProcessingMixin):
    def __init__(self) -> None:
        self.logs: list[tuple[str, str, str]] = []

    def append_job_log(self, job_id: str, level: str, message: str) -> None:
        self.logs.append((job_id, level, message))


def _image_bytes(image_format: str = "PNG") -> bytes:
    output = io.BytesIO()
    image = Image.new("RGB", (24, 18), (42, 91, 137))
    image.save(output, format=image_format, quality=88)
    return output.getvalue()


def test_no_match_preserves_original_bytes(monkeypatch) -> None:
    source = _image_bytes("PNG")
    monkeypatch.setattr(
        module,
        "_run_node_processor",
        lambda *_args: (None, {"applied": False, "passes": [], "stopReason": "no-match"}),
    )

    result = _Processor()._process_watermarks_for_upload(source, "banner.png", "banner")

    assert result.applied is False
    assert result.image_bytes is source
    assert result.error is None
    assert result.stop_reason == "no-match"


def test_applied_cleanup_preserves_format_and_dimensions(monkeypatch) -> None:
    source = _image_bytes("JPEG")

    def fake_processor(raw_pixels: bytes, width: int, height: int):
        changed = bytearray(raw_pixels)
        changed[0:4] = bytes((1, 2, 3, 255))
        return bytes(changed), {
            "applied": True,
            "appliedPassCount": 2,
            "passes": [{"applied": True}, {"applied": True}],
            "stopReason": "no-match",
        }

    monkeypatch.setattr(module, "_run_node_processor", fake_processor)
    result = _Processor()._process_watermarks_for_upload(source, "cover.jpg", "cover")

    assert result.applied is True
    assert result.applied_passes == 2
    assert result.error is None
    with Image.open(io.BytesIO(result.image_bytes)) as output:
        assert output.format == "JPEG"
        assert output.size == (24, 18)


def test_processor_failure_falls_back_to_original_and_logs_warning(monkeypatch) -> None:
    source = _image_bytes("PNG")

    def fail(*_args):
        raise RuntimeError("runtime unavailable")

    monkeypatch.setattr(module, "_run_node_processor", fail)
    processor = _Processor()
    result = processor._process_watermarks_for_upload(source, "intro.png", "intro")
    processor._log_watermark_processing_result(result, "intro", "intro.png", "job-1")

    assert result.image_bytes is source
    assert result.stop_reason == "processor-error"
    assert result.error == "runtime unavailable"
    assert processor.logs[0][0:2] == ("job-1", "warning")
    assert "uploading the original image" in processor.logs[0][2]


def test_success_log_reports_internal_one_click_pass_count(monkeypatch) -> None:
    source = _image_bytes("PNG")
    monkeypatch.setattr(
        module,
        "_run_node_processor",
        lambda raw, *_args: (
            raw,
            {
                "applied": True,
                "appliedPassCount": 3,
                "passes": [{"applied": True}] * 3,
                "stopReason": "max-passes",
            },
        ),
    )
    processor = _Processor()
    result = processor._process_watermarks_for_upload(source, "banner.png", "banner")
    processor._log_watermark_processing_result(result, "banner", "banner.png", "job-2")

    assert result.applied_passes == 3
    assert processor.logs[0][0:2] == ("job-2", "info")
    assert "removed 3 detected layer(s)" in processor.logs[0][2]


def test_decorative_frame_is_a_byte_identical_no_match(monkeypatch) -> None:
    image = Image.new("RGB", (360, 180), (65, 95, 125))
    ImageDraw.Draw(image).rectangle((18, 18, 341, 161), outline=(245, 245, 240), width=2)
    source = io.BytesIO()
    image.save(source, format="JPEG", quality=92)
    monkeypatch.setattr(
        module,
        "_run_node_processor",
        lambda *_args: (None, {"applied": False, "passes": [], "stopReason": "no-match"}),
    )

    source_bytes = source.getvalue()
    result = _Processor()._process_watermarks_for_upload(
        source_bytes,
        "banner.jpg",
        "banner",
    )

    assert result.applied is False
    assert result.applied_passes == 0
    assert result.image_bytes is source_bytes
    assert result.method == "none"
    assert result.stop_reason == "no-match"


def test_wordmark_is_removed_without_touching_decorative_frame(monkeypatch) -> None:
    image = Image.new("RGB", (1024, 459), (18, 25, 31))
    draw = ImageDraw.Draw(image)
    draw.rectangle((984, 406, 1008, 439), fill=(240, 240, 236))
    for x in (976, 984, 992, 1000, 1008):
        draw.rectangle((x, 442, x + 4, 449), fill=(235, 235, 232))
    draw.rectangle((26, 26, 997, 432), outline=(246, 242, 232), width=2)
    source = io.BytesIO()
    image.save(source, format="JPEG", quality=92)
    monkeypatch.setattr(module, "detect_opaque_watermark", lambda _image: object())
    monkeypatch.setattr(
        module,
        "reconstruct_opaque_watermark",
        lambda working, _detection: inpainting.OpaqueWatermarkResult(
            image=working,
            detected=True,
            applied=True,
            processing_ms=1,
            family="wordmark",
            region=(976, 406, 1013, 450),
            confidence=0.9,
        ),
    )
    monkeypatch.setattr(
        module,
        "_run_node_processor",
        lambda *_args: (None, {"applied": False, "passes": [], "stopReason": "no-match"}),
    )

    result = _Processor()._process_watermarks_for_upload(
        source.getvalue(),
        "banner.jpg",
        "banner",
    )

    assert result.applied is True
    assert result.applied_passes == 1
    assert result.method == "opaque-wordmark"
    assert result.stop_reason == "opaque-wordmark-reconstructed"


def test_independently_corroborated_pair_uses_shaped_reconstruction(monkeypatch) -> None:
    image = Image.new("RGB", (360, 180), (65, 95, 125))
    ImageDraw.Draw(image).rectangle((18, 18, 341, 161), outline=(245, 245, 240), width=2)
    source = io.BytesIO()
    image.save(source, format="JPEG", quality=92)
    monkeypatch.setattr(
        module,
        "_run_node_processor",
        lambda *_args: (
            None,
            {
                "applied": False,
                "passes": [{
                    "confidence": 0.8,
                    "position": {"x": 300, "y": 120, "width": 20, "height": 20},
                    "validation": {
                        "accepted": False,
                        "evidence": {
                            "score": 0.42,
                            "gradientScore": 0.16,
                            "luminanceScore": 0.60,
                        },
                    },
                }],
                "pairedCandidate": {
                    "score": 0.34,
                    "luminanceScore": 0.42,
                    "gradientScore": 0.22,
                    "region": {"x": 320, "y": 135, "width": 18, "height": 18},
                },
                "primaryAlphaMask": [1] * (20 * 20),
                "stopReason": "sdk-quality-review-required",
            },
        ),
    )
    monkeypatch.setattr(
        module,
        "reconstruct_watermark_regions",
        lambda working, regions, **_kwargs: inpainting.OpaqueWatermarkResult(
            image=working,
            detected=True,
            applied=True,
            processing_ms=1,
            family="sparkle-pair",
            region=(300, 120, 338, 153),
            confidence=0.8,
        ),
    )

    result = _Processor()._process_watermarks_for_upload(
        source.getvalue(),
        "banner.jpg",
        "banner",
    )

    assert result.applied is True
    assert result.applied_passes == 2
    assert result.method == "sparkle-pair"


def test_exceptional_dark_companion_salvages_sdk_quality_review(monkeypatch) -> None:
    image = Image.new("RGB", (1024, 459), (18, 42, 55))
    source = io.BytesIO()
    image.save(source, format="WEBP", quality=90)
    alpha_mask = [1] * (33 * 33)
    monkeypatch.setattr(
        module,
        "_run_node_processor",
        lambda *_args: (
            None,
            {
                "applied": False,
                "passes": [{
                    "confidence": 0.842,
                    "position": {"x": 970, "y": 405, "width": 33, "height": 33},
                    "validation": {
                        "accepted": False,
                        "reason": "sdk-quality-review-required",
                        "evidence": {
                            "score": 0.842,
                            "gradientScore": 0.835,
                            "luminanceScore": 0.847,
                        },
                    },
                }],
                "pairedCandidate": {
                    "score": 0.255,
                    "luminanceScore": 0.266,
                    "gradientScore": 0.240,
                    "polarity": "dark",
                    "region": {"x": 964, "y": 426, "width": 33, "height": 33},
                },
                "primaryAlphaMask": alpha_mask,
                "stopReason": "sdk-quality-review-required",
            },
        ),
    )
    captured: dict[str, object] = {}

    def fake_reconstruct(working, regions, **kwargs):
        captured["regions"] = regions
        captured.update(kwargs)
        return inpainting.OpaqueWatermarkResult(
            image=working,
            detected=True,
            applied=True,
            processing_ms=1,
            family="sparkle-pair",
            region=(959, 400, 1008, 459),
            confidence=0.842,
        )

    monkeypatch.setattr(module, "reconstruct_watermark_regions", fake_reconstruct)

    result = _Processor()._process_watermarks_for_upload(
        source.getvalue(),
        "banner.webp",
        "banner",
    )

    primary = (970, 405, 1003, 438)
    companion = (964, 426, 997, 459)
    assert result.applied is True
    assert result.applied_passes == 2
    assert result.method == "sparkle-pair"
    assert captured["regions"] == [primary, companion]
    assert captured["shaped_regions"] == [primary, companion]
    assert captured["shaped_region_masks"] == {
        primary: alpha_mask,
        companion: alpha_mask,
    }


def test_compact_light_companion_supersedes_false_dark_overlap(monkeypatch) -> None:
    image = Image.new("RGB", (1024, 459), (18, 42, 55))
    source = io.BytesIO()
    image.save(source, format="WEBP", quality=90)
    primary_mask = [1] * (33 * 33)
    compact_mask = [1] * (22 * 22)
    monkeypatch.setattr(
        module,
        "_run_node_processor",
        lambda *_args: (
            None,
            {
                "applied": False,
                "passes": [{
                    "confidence": 0.842,
                    "position": {"x": 970, "y": 405, "width": 33, "height": 33},
                    "validation": {
                        "accepted": False,
                        "reason": "sdk-quality-review-required",
                        "evidence": {
                            "score": 0.842,
                            "gradientScore": 0.835,
                            "luminanceScore": 0.847,
                        },
                    },
                }],
                "pairedCandidate": {
                    "score": 0.255,
                    "luminanceScore": 0.266,
                    "gradientScore": 0.240,
                    "polarity": "dark",
                    "region": {"x": 964, "y": 426, "width": 33, "height": 33},
                },
                "compactCandidate": {
                    "score": 0.690,
                    "luminanceScore": 0.658,
                    "gradientScore": 0.735,
                    "polarity": "light",
                    "region": {"x": 985, "y": 425, "width": 22, "height": 22},
                    "alphaMask": compact_mask,
                },
                "primaryAlphaMask": primary_mask,
                "stopReason": "sdk-quality-review-required",
            },
        ),
    )
    captured: dict[str, object] = {}

    def fake_reconstruct(working, regions, **kwargs):
        captured["regions"] = regions
        captured.update(kwargs)
        return inpainting.OpaqueWatermarkResult(
            image=working,
            detected=True,
            applied=True,
            processing_ms=1,
            family="sparkle-cluster",
            region=(970, 405, 1007, 447),
            confidence=0.842,
        )

    monkeypatch.setattr(module, "reconstruct_watermark_regions", fake_reconstruct)

    result = _Processor()._process_watermarks_for_upload(
        source.getvalue(),
        "banner.webp",
        "banner",
    )

    primary = (970, 405, 1003, 438)
    compact = (985, 425, 1007, 447)
    assert result.applied is True
    assert result.applied_passes == 2
    assert result.method == "sparkle-cluster"
    assert captured["regions"] == [primary, compact]
    assert captured["shaped_regions"] == [primary, compact]
    assert captured["shaped_region_masks"] == {
        primary: primary_mask,
        compact: compact_mask,
    }


def test_low_evidence_flat_corner_candidate_preserves_decorative_border(monkeypatch) -> None:
    source = _image_bytes("JPEG")
    monkeypatch.setattr(module, "is_safe_flat_sparkle_candidate", lambda *_args: True)
    monkeypatch.setattr(
        module,
        "_run_node_processor",
        lambda *_args: (
            None,
            {
                "applied": False,
                "passes": [{
                    "position": {"x": 1, "y": 1, "width": 20, "height": 20},
                    "validation": {
                        "accepted": False,
                        "evidence": {
                            "score": 0.22,
                            "gradientScore": 0.04,
                            "luminanceScore": 0.35,
                        },
                    },
                }],
                "pairedCandidate": {
                    "score": 0.35,
                    "luminanceScore": 0.44,
                    "gradientScore": 0.24,
                    "region": {"x": 2, "y": 2, "width": 20, "height": 20},
                },
                "stopReason": "insufficient-original-pixel-evidence",
            },
        ),
    )

    result = _Processor()._process_watermarks_for_upload(source, "banner.jpg", "banner")

    assert result.applied is False
    assert result.image_bytes is source


def test_distant_companion_is_forwarded_as_a_shaped_cluster_in_one_action(monkeypatch) -> None:
    image = Image.new("RGB", (1024, 459), (65, 95, 125))
    source = io.BytesIO()
    image.save(source, format="JPEG", quality=92)
    alpha_mask = [1] * (48 * 48)
    monkeypatch.setattr(
        module,
        "_run_node_processor",
        lambda *_args: (
            None,
            {
                "applied": True,
                "passes": [{
                    "confidence": 0.8,
                    "position": {"x": 981, "y": 396, "width": 25, "height": 25},
                    "validation": {"accepted": True, "evidence": {}},
                }],
                "pairedCandidate": {
                    "score": 0.8,
                    "luminanceScore": 0.7,
                    "gradientScore": 0.6,
                    "region": {"x": 995, "y": 427, "width": 25, "height": 25},
                },
                "secondaryCandidate": {
                    "score": 0.7,
                    "luminanceScore": 0.6,
                    "gradientScore": 0.1,
                    "alphaMask": alpha_mask,
                    "region": {"x": 932, "y": 358, "width": 48, "height": 48},
                },
                "stopReason": "validated-original-pixel-match",
            },
        ),
    )
    captured: dict[str, object] = {}

    def fake_reconstruct(working, regions, **kwargs):
        captured["regions"] = regions
        captured.update(kwargs)
        return inpainting.OpaqueWatermarkResult(
            image=working,
            detected=True,
            applied=True,
            processing_ms=1,
            family="sparkle-cluster",
            region=(928, 358, 1020, 452),
            confidence=0.8,
        )

    monkeypatch.setattr(module, "reconstruct_watermark_regions", fake_reconstruct)
    result = _Processor()._process_watermarks_for_upload(
        source.getvalue(),
        "banner.jpg",
        "banner",
    )

    shifted_secondary = (928, 358, 976, 406)
    assert result.applied is True
    assert result.applied_passes == 3
    assert result.method == "sparkle-cluster"
    assert shifted_secondary in captured["regions"]
    assert captured["shaped_regions"] == [shifted_secondary]
    assert captured["shaped_region_masks"] == {shifted_secondary: alpha_mask}


def test_opaque_logo_cleanup_continues_into_sparkle_cleanup(monkeypatch) -> None:
    source = _image_bytes("JPEG")
    cleaned_opaque = Image.new("RGB", (24, 18), (40, 80, 120))
    monkeypatch.setattr(module, "detect_opaque_watermark", lambda _image: object())
    monkeypatch.setattr(
        module,
        "reconstruct_opaque_watermark",
        lambda _image, _detection: inpainting.OpaqueWatermarkResult(
            image=cleaned_opaque,
            detected=True,
            applied=True,
            processing_ms=1,
            family="wordmark",
            region=(10, 8, 24, 18),
            confidence=0.9,
        ),
    )

    def fake_processor(raw_pixels: bytes, _width: int, _height: int):
        changed = bytearray(raw_pixels)
        changed[0:4] = bytes((1, 2, 3, 255))
        return bytes(changed), {
            "applied": True,
            "appliedPassCount": 1,
            "passes": [{"applied": True, "validation": {"accepted": True}}],
            "stopReason": "validated-original-pixel-match",
        }

    monkeypatch.setattr(module, "_run_node_processor", fake_processor)
    result = _Processor()._process_watermarks_for_upload(source, "banner.jpg", "banner")

    assert result.applied is True
    assert result.applied_passes == 2
    assert result.method == "opaque-wordmark+sparkle"
    assert result.stop_reason == "opaque-wordmark+validated-original-pixel-match"
