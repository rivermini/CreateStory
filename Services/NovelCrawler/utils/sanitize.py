"""Filename sanitization utilities for cross-platform filesystem compatibility."""

from __future__ import annotations

import re

_INVALID_FILENAME_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_LEADING_TRAILING_SPACE_DOT_RE = re.compile(r"^[\s.]+|[\s.]+$")
_UNICODE_SYMBOLS_RE = re.compile(
    r"[\u2000-\u206f\u2100-\u214f\u2190-\u21ff\u2200-\u22ff"
    r"\u2300-\u23ff\u2500-\u257f\u25a0-\u25ff\u2600-\u26ff"
    r"\u2700-\u27bf\u27c0-\u27ef\u2980-\u29ff\u2a00-\u2aff"
    r"\u263e]"
)
_DECORATIVE_SYMBOLS_RE = re.compile(r"[*]")
_WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}


def sanitize_filename(name: str) -> str:
    sanitized = _INVALID_FILENAME_CHARS_RE.sub("", name)
    sanitized = _DECORATIVE_SYMBOLS_RE.sub("_", sanitized)
    sanitized = _UNICODE_SYMBOLS_RE.sub("_", sanitized)
    sanitized = _LEADING_TRAILING_SPACE_DOT_RE.sub("", sanitized)
    sanitized = re.sub(r"\s+", "_", sanitized)
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if sanitized.upper() in _WINDOWS_RESERVED_NAMES:
        sanitized = f"_{sanitized}"
    if not sanitized:
        return "untitled"
    return sanitized
