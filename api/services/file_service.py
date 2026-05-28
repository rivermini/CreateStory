"""File service — handles output file reading, preview, and download."""

import re
from pathlib import Path
from typing import Literal, Optional

from api.models.crawl_request import OutputFile


class FileService:
    def __init__(self) -> None:
        self._project_root = Path(__file__).parent.parent.parent.resolve()

    def get_output_dir(self, crawl_id: str, custom_dir: Optional[str] = None) -> Path:
        if custom_dir:
            return Path(custom_dir).resolve()
        return self._project_root / "output" / "crawl" / crawl_id

    def list_output_files(
        self,
        crawl_id: str,
        fmt: Literal["jsonl", "csv", "md", "txt"],
        custom_dir: Optional[str] = None,
    ) -> list[OutputFile]:
        output_dir = self.get_output_dir(crawl_id, custom_dir)
        ext = "json" if fmt == "jsonl" else fmt
        files: list[Path] = []

        if output_dir.exists() and output_dir.is_dir():
            files = sorted(
                output_dir.glob(f"*.{ext}"),
                key=lambda p: self._chapter_number_from_filename(p.name),
            )

        result: list[OutputFile] = []
        for fp in files:
            try:
                size = fp.stat().st_size
            except OSError:
                size = 0
            result.append(OutputFile(
                filename=fp.name,
                size_bytes=size,
                chapter_number=self._chapter_number_from_filename(fp.name),
            ))
        return result

    def read_file_preview(self, filepath: Path, max_lines: int = 30) -> tuple[str, int]:
        try:
            with open(filepath, "r", encoding="utf-8") as fh:
                lines: list[str] = []
                total = 0
                for line in fh:
                    total += 1
                    if total <= max_lines:
                        lines.append(line.rstrip("\n"))
                return "\n".join(lines), total
        except OSError:
            return "", 0

    def get_file_content(self, filepath: Path) -> tuple[bytes, str]:
        try:
            content = filepath.read_bytes()
        except OSError:
            return b"", "application/octet-stream"

        mime_types = {
            ".json": "application/json",
            ".csv": "text/csv",
            ".md": "text/markdown",
            ".txt": "text/plain",
        }
        mime = mime_types.get(filepath.suffix.lower(), "application/octet-stream")
        return content, mime

    @staticmethod
    def _chapter_number_from_filename(name: str) -> int:
        m = re.search(r"_chapter_(\d+)", name)
        return int(m.group(1)) if m else 0


_file_service: Optional[FileService] = None


def get_file_service() -> FileService:
    global _file_service
    if _file_service is None:
        _file_service = FileService()
    return _file_service
