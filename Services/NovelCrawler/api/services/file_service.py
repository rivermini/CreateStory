"""File service — handles output file reading, preview, and download."""

import re
from pathlib import Path
from typing import Literal, Optional

from api.models.crawl_request import OutputFile
from api.repositories.crawl_repository import CrawlOutputRepository


CRAWL_ID_PATTERN = re.compile(r"^[0-9a-f]{8}$")


class CrawlPathError(ValueError):
    """Raised when a crawl identifier or output path escapes the crawl root."""


class FileService:
    def __init__(self) -> None:
        self._project_root = Path(__file__).parent.parent.parent.resolve()
        self._crawl_root = (self._project_root / "output" / "crawl").resolve()
        self._output_repo = CrawlOutputRepository()

    @staticmethod
    def validate_crawl_id(crawl_id: str) -> str:
        if not CRAWL_ID_PATTERN.fullmatch(crawl_id):
            raise CrawlPathError("Invalid crawl identifier.")
        return crawl_id

    def get_output_dir(self, crawl_id: str) -> Path:
        self.validate_crawl_id(crawl_id)
        candidate = self._crawl_root / crawl_id
        if candidate.is_symlink():
            raise CrawlPathError("Symbolic-link crawl directories are not allowed.")
        resolved = candidate.resolve()
        if not resolved.is_relative_to(self._crawl_root):
            raise CrawlPathError("Crawl path escapes the output root.")
        return resolved

    def get_output_file(self, crawl_id: str, filename: str) -> Path:
        output_dir = self.get_output_dir(crawl_id)
        if not filename or Path(filename).is_absolute() or Path(filename).name != filename or "\\" in filename or "/" in filename:
            raise CrawlPathError("Invalid output filename.")
        candidate = output_dir / filename
        if candidate.is_symlink():
            raise CrawlPathError("Symbolic-link output files are not allowed.")
        resolved = candidate.resolve()
        if not resolved.is_relative_to(output_dir):
            raise CrawlPathError("Output file escapes the crawl directory.")
        return resolved

    def list_output_files(
        self,
        crawl_id: str,
        fmt: Literal["md"],
    ) -> list[OutputFile]:
        output_dir = self.get_output_dir(crawl_id)
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
        try:
            self._output_repo.scan_output_dir(crawl_id, output_dir, ext=ext)
        except Exception:
            pass
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
