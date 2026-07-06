from bs4 import BeautifulSoup

html = open("output/diagnostic_dump.html", encoding="utf-8").read()
soup = BeautifulSoup(html, "html.parser")

content_div = soup.select_one(".content")
if content_div:
    fonts = content_div.select(".content-font")
    print(f".content has {len(fonts)} .content-font children:")
    for i, e in enumerate(fonts[:10]):
        text = e.get_text(strip=True)
        print(f"  [{i}] cls={e.get('class')} text={text[:80]!r}")
else:
    print("No .content found")

print("\n\nAll .content-font on page:")
all_fonts = soup.select(".content-font")
for i, e in enumerate(all_fonts[:15]):
    text = e.get_text(strip=True)
    print(f"  [{i}] cls={e.get('class')} text={text[:80]!r}")
