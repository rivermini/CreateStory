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


# Patterns for text that is NOT chapter prose — used to filter garbage
GARBAGE_TEXT_PATTERNS = [
    r"^(?:next\s+chapter|previous|prev|chapter\s*list|table\s*of\s*contents|see\s+all\s*reviews?|leave\s+a\s*reply|there\s+are\s+no\s+comments|load\s+more|report\s+story|share\s+this\s*story|add\s+to\s+library|vote|sign\s+in|log\s+in|sign\s+up|next\s+page|previous\s+page)$",
    r"^\d{3,4}\s+chapters?$",
    r"^chapter\s+\d+$",
    r"^cecilia\s+and\s+nathaniel\s+rainsworth\s+chapter\s+\d+$",
    r"^reviews?\s*\(\d+\)$",
    r"^chapter\s+\d+\s+[a-z]",
]


def is_garbage_text(text: str) -> bool:
    import re as _re
    t = text.strip()
    if not t:
        return True
    tl = t.lower()
    # Single "chapter N" without any other words = garbage
    if _re.match(r"^chapter\s+\d+\s*$", tl):
        return True
    # Pure number chapters like "100" to "2262"
    if _re.match(r"^\d{3,4}\s*$", tl):
        return True
    # Short nav/review labels
    if len(t) < 30:
        for p in GARBAGE_TEXT_PATTERNS:
            if _re.match(p, tl):
                return True
    return False


def build_wait_for_container_script(container_selector: str) -> str:
    escaped = container_selector.replace("'", "\\'")
    return f"""
        (function () {{
            var el = document.querySelector('{escaped}');
            if (!el) return {{ found: false, count: 0, text: '' }};
            var paras = el.querySelectorAll('p, span, div');
            var realCount = 0;
            for (var i = 0; i < paras.length; i++) {{
                var t = paras[i].innerText.trim();
                if (t.length > 50) realCount++;
            }}
            return {{
                found: true,
                count: realCount,
                text: el.innerText.trim().substring(0, 200),
                rect: {{ top: el.getBoundingClientRect().top, height: el.offsetHeight }}
            }};
        }})();
    """


def build_scroll_to_element_script(selector: str) -> str:
    escaped = selector.replace("'", "\\'")
    return f"""
        var el = document.querySelector('{escaped}');
        if (el) {{
            el.scrollIntoView({{ behavior: 'instant', block: 'start' }});
            return el.getBoundingClientRect().top;
        }}
        return -1;
    """
