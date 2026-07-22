from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from api.services.drive_service import _watermark_inpainting as module


def test_detects_edge_attached_opaque_badge() -> None:
    image = Image.new("RGB", (1024, 459), (70, 85, 100))
    ImageDraw.Draw(image).rectangle((955, 379, 1023, 458), fill=(242, 242, 240))

    detection = module.detect_opaque_watermark(image)

    assert detection is not None
    assert detection.family == "badge"
    assert detection.box == (955, 379, 1024, 459)


def test_detects_monogram_and_word_row_on_dark_background() -> None:
    image = Image.new("RGB", (1024, 459), (18, 25, 31))
    draw = ImageDraw.Draw(image)
    draw.rectangle((984, 406, 1008, 439), fill=(240, 240, 236))
    for x in (976, 984, 992, 1000, 1008):
        draw.rectangle((x, 442, x + 4, 449), fill=(235, 235, 232))

    detection = module.detect_opaque_watermark(image)

    assert detection is not None
    assert detection.family == "wordmark"
    assert detection.box[2:] == (1024, 459)


def test_rejects_a_bright_page_curl() -> None:
    image = Image.new("RGB", (1024, 459), (245, 196, 162))
    draw = ImageDraw.Draw(image)
    draw.polygon(((950, 458), (1023, 380), (1023, 458)), fill=(248, 248, 248))

    assert module.detect_opaque_watermark(image) is None


def test_detects_and_removes_a_symmetric_pale_frame() -> None:
    width, height = 360, 180
    x_gradient = np.linspace(40, 170, width, dtype=np.uint8)
    pixels = np.repeat(x_gradient[None, :, None], height, axis=0)
    pixels = np.repeat(pixels, 3, axis=2)
    image = Image.fromarray(pixels)
    draw = ImageDraw.Draw(image)
    draw.rectangle((18, 18, width - 19, height - 19), outline=(245, 245, 240), width=2)

    detection = module.detect_pale_frame(image)
    result = module.reconstruct_pale_frame(image)

    assert detection is not None
    assert detection.family == "pale-frame"
    assert result.applied is True
    output = np.asarray(result.image)
    assert output[18, width // 2, 0] < 190
    assert output[height // 2, 18, 0] < 190
    assert output[18, 18, 0] < 190
    assert output[height - 19, width - 19, 0] < 190


def test_pale_frame_detector_rejects_an_incomplete_decorative_line() -> None:
    image = Image.new("RGB", (360, 180), (80, 100, 120))
    ImageDraw.Draw(image).line((18, 18, 341, 18), fill=(245, 245, 240), width=2)

    assert module.detect_pale_frame(image) is None


def test_flat_sparkle_gate_rejects_detail_and_accepts_flat_patch() -> None:
    flat = Image.new("RGB", (1071, 483), (145, 84, 62))
    detailed = flat.copy()
    draw = ImageDraw.Draw(detailed)
    for offset in range(31):
        draw.line((984 + offset, 418, 984, 418 + offset), fill=(40 + offset * 5, 220, 90))
    evidence = {"polarity": "light", "gradientScore": 0.04, "luminanceScore": 0.35}
    region = (984, 418, 1015, 449)

    assert module.is_safe_flat_sparkle_candidate(flat, region, evidence) is True
    assert module.is_safe_flat_sparkle_candidate(detailed, region, evidence) is False


def test_region_reconstruction_changes_only_the_feathered_corner(monkeypatch) -> None:
    image = Image.new("RGB", (160, 120), (40, 80, 120))
    source = np.asarray(image).copy()

    def fake_infer(bgr, _mask):
        generated = bgr.copy()
        generated[:, :] = (180, 160, 140)
        return generated

    monkeypatch.setattr(module, "_infer", fake_infer)
    result = module.reconstruct_watermark_regions(
        image,
        [(125, 85, 150, 110)],
        family="sparkle-flat",
        margin=5,
    )

    assert result.applied is True
    output = np.asarray(result.image)
    assert np.array_equal(output[:75, :], source[:75, :])
    assert np.array_equal(output[:, :115], source[:, :115])
    assert not np.array_equal(output[90:105, 130:145], source[90:105, 130:145])


def test_shaped_region_uses_supplied_sparkle_mask_instead_of_a_full_box(monkeypatch) -> None:
    image = Image.new("RGB", (96, 72), (30, 60, 90))
    source = np.asarray(image).copy()
    box = (40, 24, 64, 48)
    mask = np.zeros((24, 24), dtype=np.uint8)
    mask[8:16, 4:20] = 1
    mask[4:20, 8:16] = 1

    def fake_infer(bgr, _mask):
        generated = bgr.copy()
        generated[:, :] = (180, 160, 140)
        return generated

    monkeypatch.setattr(module, "_infer", fake_infer)
    result = module.reconstruct_watermark_regions(
        image,
        [box],
        family="sparkle-cluster",
        shaped_regions=[box],
        shaped_region_masks={box: mask.reshape(-1).tolist()},
    )

    assert result.applied is True
    output = np.asarray(result.image)
    assert np.max(np.abs(output[24, 40].astype(int) - source[24, 40].astype(int))) <= 2
    assert not np.array_equal(output[36, 52], source[36, 52])


def test_opaque_reconstruction_can_use_detection_from_untouched_original(monkeypatch) -> None:
    original = Image.new("RGB", (1024, 459), (18, 25, 31))
    draw = ImageDraw.Draw(original)
    draw.rectangle((984, 406, 1008, 439), fill=(240, 240, 236))
    for x in (976, 984, 992, 1000, 1008):
        draw.rectangle((x, 442, x + 4, 449), fill=(235, 235, 232))
    detection = module.detect_opaque_watermark(original)
    assert detection is not None

    altered = original.copy()
    ImageDraw.Draw(altered).rectangle((995, 0, 1005, 458), fill=(18, 25, 31))
    assert module.detect_opaque_watermark(altered) is None
    monkeypatch.setattr(module, "_infer", lambda bgr, _mask: bgr)

    result = module.reconstruct_opaque_watermark(altered, detection)

    assert result.applied is True
    assert result.family == "wordmark"
