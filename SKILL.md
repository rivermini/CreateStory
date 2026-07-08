---
name: novel-crawler-new-site
description: Use when adding, debugging, or extending NovelCrawler support for a new novel/story website, including spider implementation, YAML site config, metadata detection, crawl API behavior, output formatting, and DriveSync source suffix/platform integration.
---

# Adding a new site to NovelCrawler

NovelCrawler (`Services/NovelCrawler`, FastAPI on :8002) crawls free novel chapters with Scrapy and
saves per-chapter Markdown + a combined file. Downstream, **BedReadDriveSync** parses Drive folder
names like `DONE_my-story_wp` and must learn the new site's suffix, or uploads/metadata for it break.
A complete new-site change touches **both services**.

> ⚠️ The repo `README.md` ("Adding a New Site") is **stale and wrong**. It says a new site is
> "auto-detected from the URL — no further changes needed" and references files that do not exist
> (`sites_service.py`, `results_service.py`, `txt_writer.py`, `site_handlers.py`, `default.yaml`).
> Only **domain→config** matching is automatic. Story-vs-chapter detection, metadata, and the TOC
> endpoint are per-site `if/elif config_name == ...` branches you must add. Trust the code, not the README.

## Read these first (ground truth)

1. `spiders/base_spider.py` + `models/chapter.py` — the item you yield and the base class.
2. `spiders/novellunar.py` (simplest: plain `requests`) and `spiders/jobnib.py` (browser+AJAX) — copy targets.
3. `api/services/crawler_service.py` — **subprocess command, progress regexes (lines 128-134), `_run_combine`**. The single most error-prone integration point.
4. `pipelines/md_writer.py` + `core/pipeline_base.py` — output filename + header format.
5. `api/services/config_discovery.py` + `api/services/site_registry.py` + `configs/base_config.py` + an existing `configs/*.yaml`.
6. `api/services/site_service.py` + `api/routes/sites.py` + `api/models/site_info.py` — detection / metadata / TOC.
7. `api/routes/crawl.py` + `api/models/crawl_request.py` — API surface.
8. `settings/default_settings.py` — `SPIDER_MODULES`, `ITEM_PIPELINES`, `DOWNLOAD_HANDLERS`.
9. `Services/BedReadDriveSync/api/services/drive_service/_paths.py` + `_parsers.py` **and** `api/routes/drive_sync/utils.py` — the suffix/platform integration (**THREE** edit sites; see [`bedread-drive-sync`](../bedread-drive-sync/SKILL.md) for the full trap).

## The wiring map — everything a new site `foo` touches

| # | File | Change |
|---|------|--------|
| 1 | `configs/foo.yaml` | New config. `config_name`/`name`/`site_name` all derive from here. |
| 2 | `spiders/foo.py` | New spider: `name="foo"`, `config_name="foo"`. Auto-discovered (`SPIDER_MODULES=["spiders"]`). |
| 3 | `api/routes/sites.py` → `is_chapter_url()` | Add `if "foo" in parsed.netloc: return is_foo_chapter_url(url)` + the helper. |
| 4 | `api/routes/sites.py` → `get_chapters()` | Add `elif site_info.config_name == "foo":` → `_fetch_foo_chapters()`. |
| 5 | `api/services/site_service.py` → `detect_site()` | Add `elif site_info.config_name == "foo":` for metadata/title (keep it CHEAP — no full crawl). |
| 6 | (optional) `api/services/foo_api.py`, cookie service/repo, alembic migration | Only if the site needs an API client or DB-backed cookies. |
| 7 | `tests/` | Add a chapter-numbering regression + (if applicable) a detection test. |
| 8 | **DriveSync** `_paths.py` `_RE_SOURCE_SUFFIX` | Add the suffix token to the alternation. |
| 9 | **DriveSync** `_paths.py` `_PLATFORM_TO_ENUM` | Add BOTH the short token and full lowercase site key → enum. |
| 10 | **DriveSync** `routes/drive_sync/utils.py` `_is_valid_upload_format` | Add the token to its **narrower hardcoded accept-list** → `return (True, token, "EnumName")`. Miss it and `GET /check-uploadable` rejects the folder as `UNRECOGNIZED SOURCE` even though the platform parsed fine. |
| 11 | **DriveSync** `tests/` | Add a parser test (none exists yet) asserting the suffix strips + maps. |

Pipelines, the registry, and Scrapy spider discovery are **generic** — you do **not** add a pipeline
or touch `crawler_service.py` for a normal new site.

## Crawl lifecycle (payload → subprocess → files)

1. `POST /api/crawl/start` with `CrawlRequest` → `CrawlService.start_crawl()` (`api/routes/crawl.py:99`).
2. `crawl_id = str(uuid4())[:8]` (8 hex chars — enforced by `FileService`; output dir `output/crawl/{crawl_id}`).
3. Builds and `Popen`s, in a daemon thread, merged stdout+stderr (`crawler_service.py:320`):
   ```
   python -u -m scrapy crawl <spider_name>
     -a novel=<novel> -a limit=<N>
     -s OUTPUT_DIR=output/crawl/<id> -s OUTPUT_FORMAT=md -s LOG_LEVEL=INFO -s SITE_NAME=<Site>
     [-a chapter_range=3-5] [-s NOVEL_NAME=<display>] [-s NOVEL_COMPLETED=true|false]
   ```
   So the spider receives `novel`, `limit`, `chapter_range` as **`-a` args** (spider `__init__` kwargs),
   and `OUTPUT_DIR / OUTPUT_FORMAT / SITE_NAME / NOVEL_NAME / NOVEL_COMPLETED` as **`-s` settings**.
4. `_parse_line()` regex-scrapes each stdout line for progress (see below).
5. On exit-code 0 with ≥1 chapter → status `completed`, then `_run_combine()` runs in a thread.
   Exit 0 with **0 chapters and any error lines** → status `failed`.
6. Live progress via SSE `GET /api/crawl/stream?crawl_id=...`; poll fallback `GET /api/crawl/status`.

`CrawlRequest` fields (`api/models/crawl_request.py`): `spider_name` (=Scrapy `name`), `site_name`
(human label, becomes filename prefix), `novel` (slug or full URL), `limit` (1–1000, default 10),
`chapter_range` (`"3-5"`, **overrides limit**), `output_format` (`Literal["md"]` — md only via API),
`novel_name`, `completed` (→ `Completed`/`Ongoing` suffix), `combine_chapters`, `source_url`.

## Site discovery (YAML + SiteRegistry)

- `discover_sites()` globs `configs/*.yaml` (**`.yml` is ignored**) and reads only 4 top-level fields:
  `site_name`, `base_url`, `domains`, `rate_limit`. `config_name` is the **filename stem** (not read from
  inside the file). All other keys (`selectors`, `promo_patterns`, `spider_settings`, …) are read later
  by the spider via `load_site_config(config_name)`, **not** by discovery.
- `SiteRegistry.match_url()` matches by host: exact domain, then parent-domain walk; `www.x` auto-aliases
  to `x`. The registry is a **process-global singleton** — adding/editing a YAML needs a **restart**.
- Minimum viable `configs/foo.yaml`:
  ```yaml
  site_name: Foo                 # human label; also the default filename prefix
  base_url: https://foo.com
  domains: [foo.com, www.foo.com]
  rate_limit: 1.0
  selectors:                     # consumed by the spider, not by discovery
    novel_title: "h1.title"
    chapter_list: "a.chapter-link"
    chapter_body: ".chapter-content p"
  ```
  `validate_config()` warns (never errors) if `site_name`/`base_url`/`selectors` or the
  `novel_title`/`chapter_list`/`chapter_body` selectors are missing.

## URL detection & metadata (`SiteService` + `routes/sites.py`)

- `detect_site(url)` validates scheme → `registry.match_url()` → `slug_from_url()` → then a
  **per-`config_name` branch** enriches title/metadata. Add your `elif`. **Keep detection cheap**: a
  single GET or an API call for title/cover — never a full chapter crawl (this runs synchronously on
  `GET /api/sites/detect`).
- `is_chapter_url(url)` (`routes/sites.py`) is a per-domain switch using a site regex
  (`is_foo_chapter_url`). `GET /api/sites/chapters` (`get_chapters`) rejects chapter URLs and dispatches
  to `_fetch_foo_chapters()` which returns up to **50** `ChapterEntry` items + a `total_chapter_count`.
- Endpoints: `GET /api/sites`, `GET /api/sites/detect?url=`, `GET /api/sites/chapters?url=`.

## Designing the spider

There are **two architectures**; pick A unless you truly need a real browser:

- **A — self-fetch (preferred).** Override `async def start()`, fetch with `requests`/`httpx`/`curl_cffi`
  or a site API in worker threads, and **`yield Chapter(...)` directly**. `parse_chapter` is left as
  `raise NotImplementedError`. Used by novellunar, jobnib, novelworm(API), goodnovel, inkitt, scribblehub.
- **B — Scrapy + Selenium.** `yield scrapy.Request(..., meta={"selenium": True})`. Only `meta["selenium"]`
  requests route through the `SeleniumHandler` download handler (registered as `DOWNLOAD_HANDLERS` in
  `default_settings.py`). Heavy; actively being retired. Used by wattpad chapter pages.

Required spider contract:

- `name = "foo"` and `config_name = "foo"` (both = YAML stem).
- `__init__(self, *args, novel="", limit=1, chapter_range="", **kwargs)`. Accept **story URL and chapter
  URL** for `novel`. Parse `limit = max(1, int(limit))`; parse range as
  `start = max(1, int(a)); end = max(start, int(b))` and ignore-with-warning if malformed.
- **Story URL** → fetch the TOC, select chapters. **Chapter URL** → start from that chapter and walk
  forward `limit` chapters (derive the number from the URL).
- **Range filters, limit head-slices** — never renumber. After selecting you may set
  `self.limit = len(selected)` so the `[N/M]` log denominator is right.
- **Dedup** by normalized URL in a `set` (`self._seen_urls`, guarded by a lock if threaded).
- Yield `models.chapter.Chapter` (a `@dataclass`, **not a dict**):
  ```python
  Chapter(novel_slug, novel_title, chapter_number, title, content, source_url, novel_metadata=None)
  ```
  Put site-level metadata (cover/description/author/tags) on the **first** chapter's `novel_metadata`.

### Chapter numbers MUST be absolute

`chapter_number` is the **absolute source chapter index** and must be stable no matter what range/limit
is crawled. Derive it from the site's own numbering (URL slug `-chapter-(\d+)`, an API field, or the TOC
position) — like jobnib (`int(chapter_ref["chapter_number"])`) and novelworm-API (`ref.chapter_number`).
**Do NOT** use a 1-based loop/enqueue counter. ⚠️ `base_spider.py`'s `self._chapter_counter += 1 →
meta["chapter_index"]` is a *relative* counter and is a footgun — copying it makes chapter 5 save as
chapter 1 under a range. Keep the progress counter (`_chapters_crawled`, for the `[N/M]` log and the
`>= self.limit` stop) **separate** from `chapter_number`.

### The progress log line is load-bearing

`crawler_service.py` derives all progress purely by regex-scraping stdout. Emit **exactly** this, once
per saved chapter:

```python
self.logger.info("[%d/%d] Crawled chapter %d: %s",
                 self._chapters_crawled, self.limit, chapter.chapter_number, title or "(untitled)")
```

Parser (`crawler_service.py:128-134`):
```python
_LOG_LINE_RE = re.compile(r"\[(?P<slug>[^\]]+)/(?P<limit>\d+)\]\s+Crawled chapter (?P<idx>\d+):\s+(?P<title>.*)")
_ERROR_RE    = re.compile(r"(?i)\b(error|exception|failed|traceback|critical)\b", re.IGNORECASE)
_WARNING_RE  = re.compile(r"(?i)\b(warning|retry|retrying)\b", re.IGNORECASE)
```
Each match increments `chapters_crawled` and sets `chapters_total = <limit group>`. **Order matters:**
`_ERROR_RE` and `_WARNING_RE` are checked **before** `_LOG_LINE_RE`, so the "Crawled chapter" line must
**not** contain `error|exception|failed|traceback|critical|warning|retry|retrying` (a title with those
words gets misrouted and won't count). Accumulated error lines with **zero** chapters → the crawl is
marked `failed`. The part before `/` can be any text without `]` (existing spiders put the running
counter there).

### Minimal Pattern-A spider skeleton

```python
class FooSpider(BaseSpider):
    name = "foo"
    config_name = "foo"
    custom_settings = {"DOWNLOAD_DELAY": 0.0, "CONCURRENT_REQUESTS_PER_DOMAIN": 4}

    def __init__(self, *args, novel="", limit=1, chapter_range="", **kwargs):
        super().__init__(*args, **kwargs)
        if not novel.strip():
            raise ValueError("Spider argument 'novel' is required (a full Foo story or chapter URL).")
        self.start_urls = [novel.strip()]
        self.limit = max(1, int(limit))
        self._range_start = self._range_end = None
        if chapter_range and "-" in chapter_range:
            a, b = chapter_range.split("-", 1)
            try:
                self._range_start = max(1, int(a)); self._range_end = max(self._range_start, int(b))
            except ValueError:
                self.logger.warning("Invalid chapter_range '%s' — ignoring.", chapter_range)
        cfg = load_site_config(self.config_name)
        self.selector_config = self.build_selector_config(cfg)
        self.novel_slug = self._slug_from_url(self.start_urls[0])
        self._chapters_crawled = 0
        self._seen = set()

    async def start(self):
        chapters = self._select(self._resolve_toc(self.start_urls[0]))  # filter by range / slice by limit
        self.limit = len(chapters)
        for ref in chapters:
            if ref["url"] in self._seen:
                continue
            self._seen.add(ref["url"])
            content = clean_chapter_content(self._fetch_text(ref["url"]))  # utils.cleaner
            self._chapters_crawled += 1
            self.logger.info("[%d/%d] Crawled chapter %d: %s",
                             self._chapters_crawled, self.limit, ref["number"], ref["title"] or "(untitled)")
            yield Chapter(
                novel_slug=self.novel_slug, novel_title=self._story_title,
                chapter_number=ref["number"],          # ABSOLUTE, from the source
                title=ref["title"], content=content, source_url=ref["url"],
                novel_metadata=self._metadata if self._chapters_crawled == 1 else None,
            )

    def parse_chapter(self, response, chapter_index):
        raise NotImplementedError("FooSpider uses a direct fetch flow.")
```

## Choosing a fetch technique

Pick the **cheapest rung that returns full content** (decision order):

`plain requests / SSR` → `site JSON API` → `cookie injection` → `FlareSolverr` → `Selenium handler (last resort)`.

| Defense seen | Technique | Example |
|---|---|---|
| None / server-rendered HTML | `requests.Session` + BeautifulSoup | **novellunar** (Next.js SSR) |
| Open JSON API behind Akamai/TLS fingerprinting | `curl_cffi` with `impersonate="chrome"` | **goodnovel** (`/hwyc/...`, free = `charge==false`) |
| Encrypted JSON API | plain requests + decrypt | **novelworm** (SM4-ECB, `utils/sm4`) |
| Hybrid API + HTML + paywall | v3 API for meta, storytext API, Selenium fallback | **wattpad** (skips paywalled "Originals") |
| HTTP **429** (per-IP rate limit) | exponential backoff + retry rounds — **never** burn a FlareSolverr solve | **scribblehub** |
| Cloudflare JS challenge (`Just a moment`, `/cdn-cgi/challenge-platform/`) | FlareSolverr mints `cf_clearance`, replay with `requests` | **scribblehub** |
| Login gate | `requests` + saved cookies, lazy-load on 403 | **inkitt** |
| Turnstile / per-segment AJAX unlock | `requests` AJAX flow, undetected-chromedriver fallback | **jobnib** |

- **429 vs Cloudflare:** 429 means "slow down" (backoff, not a challenge); a FlareSolverr solve shares
  the crawler's egress IP and would be throttled too — don't waste it. 403/503 + challenge markers = solve it.
- **FlareSolverr** (`flaresolverr_client.py`): `POST {cmd:"request.get", url, maxTimeout}` →
  `solution.response/cookies/userAgent`. Minted `cf_clearance` is replayable because FlareSolverr's Chrome
  shares the container's IP+fingerprint. Gated on `FLARESOLVERR_URL`.
- **Cookie pattern (3 layers):** a `*_cookie_service` parses pasted input (JSON / `name=value` header /
  bare token) and normalizes; a SQLAlchemy `*_cookie_repository` does full-replace `save`/`get_valid`
  (drops expired); the spider loads cookies **plus the matching User-Agent** into its session. **Always
  replay the captured UA with the cookie** — TLS/UA must match the client that solved the challenge.
  Adding cookie storage means an Alembic migration (see `alembic/versions/`).

## Output files

`MdWriterPipeline` (active when `OUTPUT_FORMAT in ("md","both")`) writes one file per chapter:

- **Filename:** `f"{sanitize_filename(prefix)}_chapter_{chapter_number}.md"` — `N` is **not** zero-padded.
- **prefix:** `{SITE_NAME}_{display}` where `display = NOVEL_NAME or spider.novel_slug`, with
  `_Completed`/`_Ongoing` appended when `NOVEL_COMPLETED` is set (`core/pipeline_base.py`).
  e.g. `Jobnib_mated-to-my-fiances-alpha-king-brother_chapter_2.md`.
- **File body — line 1 is a header the combiner re-parses, do not change its shape:**
  ```
  {prefix}_chapter_{N}.md: {chapter_title}
  <blank line>
  {content...}
  ```
- **Combine (`CrawlService._run_combine`):** sorts files by `chapter_number`, then writes
  `{sanitize(base_name)}.md` = the raw per-chapter files joined by `"\n\n---\n\n"`, plus
  `{base_name}_combined_{crawl_id}.json` (`{crawl_id, chapter_count, chapters:[...]}`).
  `base_name = {SITE_NAME}_{novel_name}_{Completed|Ongoing}`. Stable absolute `chapter_number`s keep this
  ordering correct — another reason numbering must be absolute.
- `sanitize_filename()` strips `<>:"/\|?*` + control chars + decorative Unicode, collapses spaces to `_`,
  and guards Windows reserved names. `FileService` enforces path containment (crawl_id must be 8 hex; no
  `..`, absolute paths, or symlink escapes — see `tests/test_path_containment.py`). Never build output
  paths by hand outside these helpers.

## DriveSync suffix + platform (REQUIRED for every new source)

Drive story folders are named `<STATUS>_<title>_<suffix>` (status ∈ `DONE_|ING_|INCOMPLETE_|EXTENDED_`),
e.g. `DONE_my-story_wp`. `_parsers.py` strips the suffix to get the title and maps it to a platform enum.
The source suffix is parsed in **THREE** places that must stay in sync — two in
`Services/BedReadDriveSync/api/services/drive_service/_paths.py` and a **third, narrower** validator in
`api/routes/drive_sync/utils.py`. Miss any one and the source half-breaks silently. (For a new source
`XxSite`, suffix token `xx`, full key `xxsite`):

**1. `_RE_SOURCE_SUFFIX`** — add the token(s) to the alternation (case-insensitive). Add both a short and
a long form if folder names use both:
```python
# BEFORE
_RE_SOURCE_SUFFIX = re.compile(
    r"_(?:wp|gd|Goodnovel|nw|ink|jn|jobnib|sh|scribblehub|nl|novellunar)(?![a-zA-Z0-9_])|_-_?novel(?=\s|_|\s-\s|$)", re.IGNORECASE
)
# AFTER
_RE_SOURCE_SUFFIX = re.compile(
    r"_(?:wp|gd|Goodnovel|nw|ink|jn|jobnib|sh|scribblehub|nl|novellunar|xx|xxsite)(?![a-zA-Z0-9_])|_-_?novel(?=\s|_|\s-\s|$)", re.IGNORECASE
)
```

**2. `_PLATFORM_TO_ENUM`** — add the token AND the full lowercase site key, both → the enum string:
```python
    "xx": "XxSite",
    "xxsite": "XxSite",
```

**3. `_is_valid_upload_format()`** (`Services/BedReadDriveSync/api/routes/drive_sync/utils.py`) — a
**SEPARATE, NARROWER, hardcoded** accept-list used by `GET /api/drive-sync/check-uploadable`. It does
**not** read `_paths.py`. As of this writing it recognizes only `gd`, `nw`, `wp`/`wattpad`,
`ink`/`inkitt`, `goodnovel`, `novelworm` — so `_paths.py`-only sources like `jn`/`sh`/`nl` already
parse a correct `referencePlatform` yet are rejected here. Add a branch returning `(True, token,
"EnumName")` (verify the current accept-list by reading the file first — don't trust this list blind):
```python
    # inside the `if raw_token:` block, alongside the existing gd/nw/wp/ink branches
    if token_lower in ("xx", "xxsite"):
        return True, "xx", "XxSite"
```
Without it, a `DONE_my-story_xx - My Story` folder parses `referencePlatform="XxSite"` fine but
`check-uploadable` buckets it as **`UNRECOGNIZED SOURCE`** and it can **never** be uploaded.
`check-updatable` (EXTENDED_) matches by title only and does **not** call this validator, so this gap
blocks new-story uploads specifically. See [`bedread-drive-sync`](../bedread-drive-sync/SKILL.md)
("Adding a new source/crawler platform — DO ALL THREE") for the full trap.

**Ordering trap:** alternation is leftmost-first, so put **longer** tokens before shorter ones that share
a prefix (e.g. a long form before a colliding short form). The `(?![a-zA-Z0-9_])` boundary guards most
collisions, but never pick a token that is a real word/substring of titles. The enum lookup does
`match.group(0).lstrip("_").lower()`, so the enum **key must be lowercase** even though the regex token
may be capitalized (`Goodnovel`).

**Verify behavior:**
- `_parsers._extract_story_name("DONE_my-story_xx")` → strips `DONE_`, finds `_xx`, truncates before it → `"my story"`.
- `_parsers._extract_reference_platform("DONE_my-story_xx")` → matches `_xx` → `"xx"` → `_PLATFORM_TO_ENUM["xx"]` → `"XxSite"`.
- `utils._is_valid_upload_format("DONE_my-story_xx - My Story")` → `(True, "xx", "XxSite")` (was `(False, "xx", None)` before edit 3 → `UNRECOGNIZED SOURCE`).
- Before the edits all three return the wrong thing (title keeps `xx`, platform `None`, upload rejected); after, all three agree.

**Tests:** DriveSync currently ships only `tests/test_service_auth.py` (no parser test). **Add** a small
unit test asserting `_extract_story_name`, `_extract_reference_platform`, **and** `_is_valid_upload_format`
for a `_xx` folder.

## Validation checklist

Restart both services first (the registry singleton + suffix regex are loaded once).

- [ ] `GET /api/sites` lists `foo` (config + domains discovered).
- [ ] `GET /api/sites/detect?url=<story>` → `valid:true`, correct `slug`, cheap `story_title`/metadata.
- [ ] `GET /api/sites/chapters?url=<story>` → ≤50 `ChapterEntry`, correct `total_chapter_count`; a chapter URL is rejected.
- [ ] `is_chapter_url(<chapter url>)` returns true (new branch + helper).
- [ ] `POST /api/crawl/start` returns a `crawl_id`; SSE/status shows `chapters_crawled` advancing (log line matches the regex).
- [ ] Output: `output/crawl/<id>/{SITE}_{slug}_chapter_{N}.md` with the `…: title` header; combined `.md` (HR-joined) and `_combined_<id>.json` exist.
- [ ] **Range test**: `chapter_range=5-10` → files/items are `chapter_number` 5..10, not 1..6.
- [ ] CLI sanity: `scrapy crawl foo -a novel="<url>" -a limit=3`.
- [ ] DriveSync: `_extract_story_name`/`_extract_reference_platform` correct for `DONE_<title>_<suffix>`; `_is_valid_upload_format` accepts it (so `GET /check-uploadable` lists the folder under `uploadable`, not `invalid`/`UNRECOGNIZED SOURCE`); parser test added; `tests/` green in both services.

## Common traps

- **Stale README** — it claims auto-detection and lists nonexistent files. Verify against code.
- **Forgetting the DriveSync suffix** — uploads/metadata silently mis-name or fail to map the platform.
  Remember it's **THREE** edits: `_RE_SOURCE_SUFFIX` + `_PLATFORM_TO_ENUM` (`_paths.py`) **and**
  `_is_valid_upload_format` (`routes/drive_sync/utils.py`). The third has a separate, narrower accept-list;
  skip it and the platform parses but `check-uploadable` rejects the folder as `UNRECOGNIZED SOURCE`.
- **Log format drift** — anything but `[x/total] Crawled chapter N: title` (and free of error/warning
  trigger words) breaks progress; a title containing "failed"/"retry" silently won't count.
- **Yielding dicts instead of `Chapter`** — pipelines call `.asdict()`/`.model_dump()`; a bare dict path is fragile. Yield the dataclass.
- **Shifting chapter numbers** — using a 1-based crawl counter (the `base_spider` footgun) instead of the
  absolute source number; breaks ranges, combine ordering, and DriveSync chapter indices.
- **Expensive detection** — doing a full crawl (or per-chapter probing) inside `detect_site`/`/sites/detect`. Keep it to one cheap fetch/API call.
- **Selenium by default** — Pattern-A spiders must self-fetch; a plain `scrapy.Request` without
  `meta["selenium"]` still goes through the Selenium download handler. Prefer requests/API; reach for Selenium last.
- **Cloudflare/cookie/IP fingerprint** — a `cf_clearance` is bound to the IP+TLS fingerprint that minted
  it; a host-browser cookie won't replay from the Linux container. Use FlareSolverr (same egress) and
  always pair the cookie with its captured User-Agent. Don't burn a solve on a 429.
- **Unsafe paths** — always go through `sanitize_filename` + `FileService`; never concatenate user slugs into paths.
- **`.yml` configs / no restart** — discovery only globs `*.yaml`, and the registry/suffix regex load once. A new/edited config or suffix needs a process restart.
```
