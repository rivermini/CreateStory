"""One-time diagnostic: inspects a NovelWorm chapter page to find the correct selectors."""

import time
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from handlers import selenium_handler as sh_module

SeleniumBrowser = sh_module._SeleniumBrowser
print(f"Using class: {SeleniumBrowser}")

CHAPTER_URL = "https://www.novelworm.com/When-Her-Death-Couldnt-Break-Him572881/000001"

handler = SeleniumBrowser()
try:
    final_url, status, body, headers, scroll_result = handler.fetch(
        CHAPTER_URL, timeout=60, skip_scroll=True
    )
finally:
    handler.close()

html = body.decode("utf-8")
print(f"\n=== Page: {final_url} ===")
print(f"Status: {status}, Body size: {len(html)} bytes\n")

from bs4 import BeautifulSoup
soup = BeautifulSoup(html, "html.parser")

print("=== Elements with 'read'/'chapter'/'content'/'body' in class ===")
for tag in soup.find_all(class_=True):
    for cls in tag.get("class", []):
        if any(kw in cls.lower() for kw in ["read", "chapter", "content", "body", "text", "story", "panel"]):
            text = tag.get_text(strip=True)
            print(f"  <{tag.name}> class={tag.get('class')} | text={text[:80]!r}")
            break

print("\n=== All <p> tags (first 20) ===")
for i, p in enumerate(soup.find_all("p")[:20]):
    print(f"  [{i}] {p.get_text(strip=True)[:100]!r}")

print("\n=== Selenium scroll result ===")
if scroll_result:
    print(f"  Scroll returned {len(scroll_result)} paragraphs")
    for j, para in enumerate(scroll_result[:5]):
        print(f"  [{j}] {para[:80]!r}")
else:
    print("  Scroll returned None/empty")

dump_path = os.path.join(os.path.dirname(__file__), "output", "diagnostic_dump.html")
os.makedirs(os.path.dirname(dump_path), exist_ok=True)
with open(dump_path, "w", encoding="utf-8") as f:
    f.write(html)
print(f"\nFull HTML dumped to: {dump_path}")
