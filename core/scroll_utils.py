"""
Shared scroll-utility helpers for triggering lazy-loaded content.

Scroll strategy:
1. Scroll one window.innerHeight at a time.
2. Wait SCROLL_WAIT_MS after each scroll for the lazy-loader.
3. Stop when position-based (reached bottom) OR count-based (stable count).
4. Cap at MAX_SCROLL_STEPS.
"""

MAX_SCROLL_STEPS = 50
SCROLL_WAIT_MS = 800
MIN_SCROLL_STEPS = 3

PARAGRAPH_SELECTORS = [
    "p[data-p-id]",
    ".panel.panel-reading pre p[data-p-id]",
    ".story-content p[data-p-id]",
    "main p[data-p-id]",
    ".page p",
]


def build_scroll_script() -> str:
    return """
        window.scrollBy(0, window.innerHeight);
        return {
            scrollY: window.scrollY,
            innerHeight: window.innerHeight,
            scrollHeight: document.body.scrollHeight,
            atBottom: (window.scrollY + window.innerHeight) >= document.body.scrollHeight - 10
        };
    """


def build_scroll_to_top_script() -> str:
    return "window.scrollTo(0, 0);"


def build_paragraph_count_script(selector: str) -> str:
    escaped = selector.replace("'", "\\'")
    return f"document.querySelectorAll('{escaped}').length"


def build_extract_script(selector: str) -> str:
    escaped = selector.replace("'", "\\'")
    return f"""
        (function () {{
            var paras = document.querySelectorAll('{escaped}');
            var seen = new Set();
            var unique = [];
            for (var i = 0; i < paras.length; i++) {{
                var text = paras[i].innerText.trim();
                if (text.length > 0 && !seen.has(text)) {{
                    seen.add(text);
                    unique.push(text);
                }}
            }}
            return unique;
        }})();
    """
