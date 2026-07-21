from __future__ import annotations

import io

from PIL import Image

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
