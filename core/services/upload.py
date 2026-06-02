"""Upload logic for the AutoAudio service — compresses audio and uploads to the main BE."""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import httpx

from core.models import AutoAudioSession, _CompressedAudio
from core.services.external_api import ExternalAPIClient

logger = logging.getLogger(__name__)

MAX_AUDIO_SIZE_BYTES = 20 * 1024 * 1024
TARGET_BITRATE_KBPS = 48
OPUS_EXTENSION = "opus"


class UploadManager:
    """Handles audio compression and upload to the main BE."""

    def __init__(self, api_client: ExternalAPIClient) -> None:
        self._api = api_client

    def upload_audio(
        self,
        session: AutoAudioSession,
        story_id: str,
        chapter_id: str,
        local_file_path: Path,
        voice: Optional[str],
    ) -> bool:
        session.set_step(6, f"Uploading audio for chapter {chapter_id}", story=session.current_story)

        try:
            compressed = self._compress_audio_to_opus(session, local_file_path)
            mime_type = "audio/ogg"
            file_name = compressed.name
            file_size = compressed.size

            session.add_log(
                6,
                f"Compressed chapter {chapter_id}: {compressed.original} -> {compressed.compressed} bytes",
            )

            presigned_resp = self._api.get_presigned_url(
                story_id, chapter_id, file_name, mime_type, file_size, voice
            )

            presigned_url = presigned_resp.get("uploadUrl")
            if not presigned_url:
                session.add_log(6, f"No presigned URL returned for chapter {chapter_id}", level="error")
                return False

            required_headers = presigned_resp.get("requiredHeaders", {})
            self._put_with_retry(presigned_url, compressed.data, mime_type, required_headers)

            self._api.complete_audio_upload(
                story_id, chapter_id,
                presigned_resp.get("key", ""),
                voice,
            )

            session.add_log(6, f"Uploaded chapter {chapter_id} audio")
            return True

        except httpx.HTTPStatusError as exc:
            session.add_log(
                6,
                f"HTTP error uploading chapter {chapter_id}: "
                f"{exc.response.status_code} {exc.response.text} (retries exhausted)",
                level="error",
            )
            return False
        except Exception as exc:
            session.add_log(6, f"Error uploading chapter {chapter_id}: {exc}", level="error")
            return False

    def _put_with_retry(
        self,
        url: str,
        data: bytes,
        content_type: str = "audio/ogg",
        extra_headers: Optional[dict] = None,
        max_retries: int = 3,
    ) -> httpx.Response:
        headers = {"Content-Type": content_type}
        if extra_headers:
            headers.update(extra_headers)
        last_exc: Exception | None = None
        for attempt in range(max_retries):
            try:
                with httpx.Client(timeout=120.0) as client:
                    resp = client.put(url, content=data, headers=headers)
                    resp.raise_for_status()
                    return resp
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 503 and attempt < max_retries - 1:
                    last_exc = exc
                    import time
                    time.sleep(2 ** attempt)
                    continue
                raise
        raise last_exc or RuntimeError("Unexpected retry failure")

    def delete_local_audio_files(self, session: AutoAudioSession, generated_file: Path) -> None:
        deleted = []
        try:
            if generated_file.exists():
                generated_file.unlink()
                deleted.append(str(generated_file))
        except Exception as exc:
            session.add_log(9, f"Failed to delete generated file {generated_file}: {exc}", level="warning")
            return

        if deleted:
            session.add_log(9, f"Deleted {len(deleted)} local audio file(s): {deleted}")

    def delete_batch_output_dir(self, session: AutoAudioSession, batch_id: str, output_dir: Path) -> None:
        try:
            if output_dir.exists():
                shutil.rmtree(output_dir)
                session.add_log(9, f"Removed batch temp directory: {output_dir}")
        except Exception as exc:
            session.add_log(9, f"Failed to remove temp directory {output_dir}: {exc}", level="warning")

    def _find_ffmpeg(self) -> Optional[Path]:
        import shutil as _sh
        project_root = Path(__file__).parent.parent.parent
        vendor_ffmpeg = project_root / "vendor" / "ffmpeg" / "bin" / "ffmpeg.exe"
        if vendor_ffmpeg.exists():
            return vendor_ffmpeg
        path = _sh.which("ffmpeg")
        if path:
            return Path(path)
        try:
            import imageio_ffmpeg as _imf
            exe = _imf.get_ffmpeg_exe()
            if exe and Path(exe).exists():
                return Path(exe)
        except Exception:
            pass
        return None

    def _compress_audio_to_opus(
        self,
        session: AutoAudioSession,
        audio_path: Path,
    ) -> _CompressedAudio:
        audio_bytes = audio_path.read_bytes()
        original_size = len(audio_bytes)

        ffmpeg_path = self._find_ffmpeg()
        if not ffmpeg_path:
            session.add_log(
                6,
                "FFmpeg not found, uploading original audio as-is "
                "(pip install imageio-ffmpeg to enable Opus compression)",
                level="warning",
            )
            return _CompressedAudio(
                data=audio_bytes,
                name=audio_path.name,
                original=original_size,
                compressed=original_size,
                size=original_size,
            )

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            output_path = tmp_path / f"{audio_path.stem}.{OPUS_EXTENSION}"

            cmd = [
                str(ffmpeg_path),
                "-y",
                "-i", str(audio_path),
                "-vn",
                "-map_metadata", "-1",
                "-c:a", "libopus",
                "-b:a", f"{TARGET_BITRATE_KBPS}k",
                "-vbr", "on",
                "-compression_level", "10",
                "-ac", "1",
                str(output_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                session.add_log(6, f"FFmpeg error: {result.stderr[:200]}", level="warning")
                return _CompressedAudio(
                    data=audio_bytes,
                    name=audio_path.name,
                    original=original_size,
                    compressed=original_size,
                    size=original_size,
                )

            if not output_path.exists():
                session.add_log(6, "FFmpeg did not produce output file", level="warning")
                return _CompressedAudio(
                    data=audio_bytes,
                    name=audio_path.name,
                    original=original_size,
                    compressed=original_size,
                    size=original_size,
                )

            compressed_size = output_path.stat().st_size

            if compressed_size > MAX_AUDIO_SIZE_BYTES:
                session.add_log(
                    6,
                    f"Compressed audio still exceeds {MAX_AUDIO_SIZE_BYTES} bytes "
                    f"({compressed_size} bytes, original {original_size})",
                    level="error",
                )
                return _CompressedAudio(
                    data=audio_bytes,
                    name=audio_path.name,
                    original=original_size,
                    compressed=original_size,
                    size=original_size,
                )

            safe_name = audio_path.stem + f".{OPUS_EXTENSION}"
            opus_data = output_path.read_bytes()
            reduction_pct = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
            session.add_log(
                6,
                f"Compressed: {original_size} -> {compressed_size} bytes "
                f"({reduction_pct:.1f}% reduction, {TARGET_BITRATE_KBPS}kbps opus)",
            )
            return _CompressedAudio(
                data=opus_data,
                name=safe_name,
                original=original_size,
                compressed=compressed_size,
                size=compressed_size,
            )
