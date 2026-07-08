from api.routes.crawl import _sanitize_log_line_for_ui
from api.models.crawl_request import LogEntry


def test_sanitize_log_line_string():
    # Test traceback line
    assert _sanitize_log_line_for_ui("Traceback (most recent call last):") is None
    assert _sanitize_log_line_for_ui("  File \"main.py\", line 10, in <module>") is None
    assert _sanitize_log_line_for_ui("ValueError: invalid literal") is None
    
    # Test internal path sanitization
    assert _sanitize_log_line_for_ui("Error at /app/api/routes/crawl.py line 12") == "Error at [internal-path] line 12"
    
    # Test normal line
    assert _sanitize_log_line_for_ui("Normal log message") == "Normal log message"


def test_sanitize_log_line_log_entry():
    # Test traceback entry
    entry_tb = LogEntry(timestamp="2026-07-08 12:00:00", message="Traceback (most recent call last):", level="error")
    assert _sanitize_log_line_for_ui(entry_tb) is None
    
    # Test internal path sanitization entry
    entry_path = LogEntry(timestamp="2026-07-08 12:00:00", message="Error at /app/api/routes/crawl.py line 12", level="error")
    sanitized = _sanitize_log_line_for_ui(entry_path)
    assert sanitized is not None
    assert sanitized.message == "Error at [internal-path] line 12"
    assert sanitized.timestamp == "2026-07-08 12:00:00"
    assert sanitized.level == "error"
    
    # Test normal entry
    entry_normal = LogEntry(timestamp="2026-07-08 12:00:00", message="Normal log message", level="info")
    sanitized_normal = _sanitize_log_line_for_ui(entry_normal)
    assert sanitized_normal is not None
    assert sanitized_normal.message == "Normal log message"
