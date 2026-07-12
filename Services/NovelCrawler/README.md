# NovelCrawler

**NovelCrawler** is a web scraping microservice that extracts novel and chapter content from supported sites. It uses Scrapy for structured crawling and Selenium with headless Chrome to bypass anti-bot protections (Cloudflare, etc.). All crawled content is saved locally and queryable through a FastAPI REST and SSE API running on port 8002.

Built with Scrapy + Selenium + FastAPI on Python 3.10+.

---

## Features

| Category | Details |
|---|---|
| **Multi-site support** | wattpad.com, novelworm.com (extensible via YAML configs) |
| **Cloudflare bypass** | Selenium with undetected-chromedriver on wattpad.com |
| **Live crawl progress** | SSE streaming of crawl events and log lines |
| **Multiple output formats** | JSON, CSV, Markdown, plain-text per chapter |
| **Chapter range targeting** | Crawl specific chapter ranges (`1-10`) |
| **Chapter combination** | Merge chapters into a single combined file |
| **Batch crawling** | Launch multiple crawls from a list of URLs |
| **Cookie persistence** | Keeps Selenium session cookies between crawls |
| **Paywall detection** | Detects premium/paywalled chapters on Wattpad |

---

## Architecture

```
FastAPIServer (port 8000) ──► NovelCrawler (port 8002, this service)
                                  │
                                  ├── Scrapy (in-process or subprocess)
                                  │     ├── Selenium ──► wattpad.com (Cloudflare bypass)
                                  │     └── httpx ──► novelworm.com
                                  │
                                  └── FastAPI ──► REST + SSE API
                                      └── Filesystem ──► output/crawl/
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web framework | FastAPI 0.110+ |
| ASGI server | Uvicorn |
| Web scraping | Scrapy 2.11+ |
| Browser automation | Selenium 4.15+, undetected-chromedriver |
| HTML parsing | BeautifulSoup 4, Parsel |
| HTTP client | httpx |
| Data validation | Pydantic 2.0+ |
| Environment | python-dotenv |

---

## Prerequisites

- **Python 3.10+**
- **Google Chrome** installed
- **ChromeDriver** matching your Chrome version (or use undetected-chromedriver for auto-download)

---

## Quick Start

```powershell
cd D:\Developer\Nova\CreateStoryMicroService\NovelCrawler
pip install -r requirements.txt
python main.py
```

The server starts on **http://localhost:8002**. API docs are at **http://localhost:8002/docs** (Swagger UI).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CHROME_BIN` | auto-detected | Path to Chrome executable |
| `SCRAPY_ENV` | `dev` | Scrapy settings profile: `dev` or `prod` |
| `SERVICE_URLS_FastAPIServer` | `http://localhost:8000` | FastAPIServer base URL (for config reads) |
| `CRAWLER_PROXY_URL` | unset | Optional HTTP/SOCKS proxy for all crawler egress traffic |
| `WATTPAD_PROXY_URL` | unset | Optional Wattpad-only proxy override; kept for compatibility |
| `FLARESOLVERR_URL` | `http://flaresolverr:8191/v1` (in Docker) | FlareSolverr endpoint used to auto-solve ScribbleHub's Cloudflare challenge. Unset it to disable auto-solving (see Supported Sites → ScribbleHub) |
| `SCRIBBLEHUB_PROXY_URL` | unset | Optional ScribbleHub-only proxy — alternative to FlareSolverr for Docker runs (`http://host.docker.internal:8899` + `scripts/scribblehub_host_proxy.py` on the host) |
| `SCRIBBLEHUB_DOWNLOAD_DELAY` | `0.35` | Seconds between ScribbleHub chapter requests (raise to reduce 429s) |
| `SCRIBBLEHUB_RETRY_COOLDOWN` | `45` | Seconds before each retry round for rate-limited chapters |
| `SCRIBBLEHUB_RETRY_ROUNDS` | `40` | Max retry rounds to recover rate-limited chapters (completeness) |
| `INKITT_BATCH_MAX_DISCOVER_WORKERS` | `2` in Docker | Upper bound for concurrent Inkitt genre discovery workers |
| `INKITT_BATCH_MAX_CRAWL_WORKERS` | `4` in Docker | Upper bound for concurrent Inkitt story workers; requests still use one serialized egress lane |
| `INKITT_DISCOVER_RETRY_TIMES` | `6` | Retry attempts for transient Inkitt discovery HTTP errors |
| `INKITT_DISCOVER_RETRY_BASE_SECONDS` | `15` | Base cooldown for Inkitt discovery retries |
| `INKITT_DISCOVER_RETRY_MAX_SECONDS` | `120` | Maximum cooldown for Inkitt discovery retries |
| `INKITT_GLOBAL_MIN_REQUEST_INTERVAL_SECONDS` | `1.0` | Minimum delay after one Inkitt response before the next serialized request |
| `INKITT_RATE_LIMIT_BASE_COOLDOWN_SECONDS` | `60` | First global cooldown after HTTP 429; subsequent cooldowns increase exponentially |
| `INKITT_RATE_LIMIT_MAX_COOLDOWN_SECONDS` | `900` | Maximum automatic global HTTP 429 cooldown |
| `INKITT_RATE_LIMIT_MAX_EVENTS` | `8` | Repeated 429 events before safely pausing the run with unfinished stories queued |
| `INKITT_RATE_LIMIT_RECOVERY_SUCCESSES` | `250` | Successful responses required before returning adaptive pacing toward the configured minimum |
| `INKITT_ARCHIVE_PREPARE_DELAY_SECONDS` | `120` | Delay after a crawl run finishes before preparing reusable full/run ZIP caches in the background |
| `INKITT_ARCHIVE_COMPRESSION_LEVEL` | `1` | Fast DEFLATE level for large cached Inkitt archives |
| `INKITT_RENDERED_FALLBACK` | `1` | Enables FlareSolverr/Selenium fallback when static Inkitt chapter HTML is incomplete |
| `INKITT_RENDERED_FALLBACK_SUSPICIOUS_WORDS` | `800` | Only use browser fallback for suspicious static content at or below this word count |

---

## Project Structure

```
NovelCrawler/
├── main.py                           # Uvicorn entry point (port 8002)
├── .env                              # Chrome path, Scrapy env
├── api/
│   ├── main.py                       # FastAPI app, CORS, router inclusion
│   ├── routes/
│   │   ├── crawl.py                  # Start/stop/stream crawls
│   │   ├── results.py                # File listing, preview, download, combine
│   │   └── sites.py                  # Site configs, metadata, chapter list
│   └── services/
│       ├── crawler_service.py         # Scrapy subprocess + in-process runner
│       ├── results_service.py         # File I/O, ZIP, combination logic
│       └── sites_service.py           # Site config loader + metadata extractor
├── spiders/
│   ├── base_spider.py                # Abstract base spider
│   ├── wattpad.py                    # wattpad.com spider (Selenium + Cloudflare bypass)
│   └── novelworm.py                  # novelworm.com spider
├── handlers/
│   ├── selenium_handler.py            # Chrome singleton, cookie persistence, undetected-chromedriver
│   └── site_handlers.py              # Per-site content extraction helpers
├── pipelines/
│   ├── json_writer.py                # Writes {slug}_chapter_{N}.json
│   ├── csv_writer.py                 # Writes {slug}_chapter_{N}.csv
│   ├── md_writer.py                  # Writes {slug}_chapter_{N}.txt
│   └── txt_writer.py                 # Writes {slug}_chapter_{N}.md (plain text)
├── configs/
│   ├── default.yaml                  # Base settings (concurrency, retry, etc.)
│   ├── dev.yaml                      # Dev overrides (logging, UA, etc.)
│   ├── prod.yaml                     # Prod overrides
│   ├── wattpad.yaml                  # Wattpad CSS selectors and rate limits
│   └── novelworm.yaml                # NovelWorm CSS selectors and rate limits
├── settings/
│   ├── default_settings.py           # Dev Scrapy settings
│   └── prod_settings.py              # Production Scrapy settings
├── data/                             # Session state persistence
│   ├── sessions.json                 # Crawl session metadata
│   └── cookies.json                 # Selenium session cookies (shared across crawls)
├── output/                           # Crawl output files
│   └── crawl/
│       └── {crawl_id}/
│           ├── metadata.json
│           └── {slug}_chapter_{N}.{json,csv,md,txt}
└── logs/                             # Scrapy and app logs
```

---

## Supported Sites

### Wattpad (wattpad.com)

- Uses **undetected-chromedriver** with a persistent headless Chrome session
- Cloudflare challenge bypass via Selenium
- Cookie jar persistence between crawls
- Paywall detection: logs chapters with premium content separately
- Extracts: title, author, description, cover image URL, chapter list, chapter content

### NovelWorm (novelworm.com)

- Uses **httpx** with standard HTTP requests
- Faster than Wattpad (no browser needed)
- Extracts: title, author, description, chapter list, chapter content

### ScribbleHub (scribblehub.com)

ScribbleHub is behind a **Cloudflare managed challenge**. The spider runs **cookies-only** (no
crawler-side headless browser): it reads pages with fast HTTP requests using a `cf_clearance`
cookie. The cookie is obtained automatically — no manual steps.

**How it works (self-contained, Docker-native).** A **FlareSolverr** service (added to
`docker-compose.yml`) runs headless Chrome *inside the Docker network* and solves the Cloudflare
challenge on demand. Because FlareSolverr shares the crawler's egress IP and Linux network
fingerprint, the `cf_clearance` it mints can be replayed with plain `requests` from the crawler — so
the first page is solved by FlareSolverr (~10–15 s) and the rest of the crawl is fast. Harvested
cookies are saved to the `scribblehub_cookies` table and auto-refreshed whenever the challenge
reappears (cf_clearance expires every ~30–60 min). Nothing to run on the host, nothing to paste.

- Config: `FLARESOLVERR_URL=http://flaresolverr:8191/v1` (already set on `novel_crawler` in compose).
- After pulling these changes: `docker compose up -d` (starts `flaresolverr` and recreates
  `novel_crawler`). **Settings → ScribbleHub Cookies → Test Cookies** triggers a solve and confirms.

**Why not just paste a browser cookie?** `cf_clearance` is bound to the *network fingerprint* of the
machine that solved the challenge. A cookie grabbed from Chrome on a Windows host is rejected when
replayed from inside the Linux container (different TCP/TLS fingerprint), even with the same IP and
User-Agent. FlareSolverr sidesteps this by solving from inside the container itself.

**Manual paste / host fallbacks (optional).** You can still paste a `cf_clearance` + User-Agent in
the Settings panel (used as-is if valid). If you run NovelCrawler **directly on the host** (not
Docker) you need neither FlareSolverr nor a proxy. If you prefer not to run FlareSolverr but the
crawler is in Docker, the alternative is the host proxy: run `scripts/scribblehub_host_proxy.py` on
the host and set `SCRIBBLEHUB_PROXY_URL=http://host.docker.internal:8899` (see `extra_hosts` already
set on `novel_crawler`).

**Rate limiting & guaranteed completeness.** ScribbleHub throttles per IP with **HTTP 429** (a
"slow down" signal — *not* a Cloudflare challenge, so it never burns a FlareSolverr solve). The
crawler handles it so a full novel always finishes with every chapter:

1. On a 429 it retries the same page with short exponential backoff (lets the bucket refill).
2. A chapter that's *still* rate-limited is deferred — not skipped, not fatal.
3. After the main pass, the crawler runs **retry rounds**: it waits a cooldown (so the bucket
   refills) and re-fetches the deferred chapters, repeating until none remain. So a 711-chapter
   novel completes even if ScribbleHub throttles partway through — it just takes longer.

| Setting | Default | Notes |
|---|---|---|
| `SCRIBBLEHUB_DOWNLOAD_DELAY` | `0.35` | Seconds between chapter requests on the main pass. Raise it if you see lots of 429s. |
| `SCRIBBLEHUB_RETRY_COOLDOWN` | `45` | Seconds to wait before each retry round (escalates ×1.5 on a no-progress round). |
| `SCRIBBLEHUB_RETRY_ROUNDS` | `40` | Max retry rounds before giving up (set high for "finish no matter what"). |

Tip: heavy back-to-back crawls deplete ScribbleHub's rate-limit bucket; if a run spends a long time
in retry rounds, wait a few minutes (or raise `SCRIBBLEHUB_DOWNLOAD_DELAY`) before the next crawl.

### Inkitt batch crawling

The Inkitt batch tool is built for long, resumable runs over free completed stories. Discovery writes a
persistent catalog (`output/inkitt_batch/discovered_story_index.json`) and per-genre checkpoints
(`discovery_progress.json`), so a full catalog can be built over multiple sessions. Crawling writes each
completed story into the final export set as soon as it finishes, and already exported story IDs are
remembered in `exported_story_index.json`.

Cloudflare Tunnel protects inbound access to CreateStory, but it does not make outbound Inkitt requests
leave through Cloudflare. Requests from the `novel_crawler` container use the server/container's normal
egress route unless your infrastructure explicitly routes them elsewhere.

Recommended production posture:

- Keep Inkitt crawl workers at `4` with a `1` second delay. Workers prepare separate stories, while all
  Inkitt requests use one serialized lane; this is the production target for roughly 1,000 chapters/hour.
- On HTTP `429`, the crawler globally pauses for `60`, `120`, `240` seconds and progressively slows the
  request lane. It retries the current chapter instead of consuming and failing new story rows.
- Partial stories are checkpointed after every chapter, so a pause, retry, or service restart resumes
  without downloading their completed chapters again.
- Full-batch and run-specific ZIP files are prepared in the background two minutes after a run ends,
  cached beside the batch output, and rebuilt only when exported files change. Cached archives support
  byte-range requests for browser download managers such as IDM.
- Crawl in small runs, for example `50` to `200` stories, then download or resume later.
- Keep `INKITT_RENDERED_FALLBACK=1`; rendered requests use the same request lane and are skipped for long
  static chapters by default, but remain heavier than plain HTML fetches.

---

## Adding a New Site

1. Create `configs/your_site.yaml` with CSS selectors and rate limits (see existing configs for format).
2. Create `spiders/your_site.py` extending `BaseSpider`. Set `name = "your_site"` and `config_name = "your_site"`.
3. Optionally add a handler in `handlers/site_handlers.py` if special extraction logic is needed.
4. The site is auto-detected from the URL — no further changes needed.

---

## API Reference

### Crawl

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/crawl/start` | Start a crawl. Returns `{ crawl_id }` immediately. |
| `POST` | `/api/crawl/start-batch` | Start multiple crawls at once from a URL list. |
| `GET` | `/api/crawl/stream` | SSE stream of live crawl logs (works locally). |
| `GET` | `/api/crawl/status` | Full status + recent logs for all sessions. |
| `GET` | `/api/crawl/status/{crawl_id}` | Status for a specific session. |
| `GET` | `/api/crawl/active` | List all crawl sessions. |
| `DELETE` | `/api/crawl/cancel` | Cancel a running crawl. |

### Site

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sites` | List all supported site configs. |
| `GET` | `/api/sites/detect` | Detect site from a URL. Returns slug, config, and metadata. |
| `GET` | `/api/sites/chapters` | Fetch chapter list (TOC) for a story URL. |
| `GET` | `/api/sites/metadata` | Extract title, author, description, cover for a story URL. |

### Results

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/results` | List all crawl sessions with file info. |
| `GET` | `/api/results/{crawl_id}` | Full result with file list and metadata. |
| `POST` | `/api/results/{crawl_id}/combine` | Merge chapters into a combined file. |
| `GET` | `/api/results/{crawl_id}/download` | Download all files as ZIP. |
| `GET` | `/api/results/{crawl_id}/download?filename=...` | Download a single file. |
| `GET` | `/api/results/{crawl_id}/content?filename=...` | Raw file content. |
| `GET` | `/api/results/{crawl_id}/preview?filename=...` | Preview first 30 lines. |
| `POST` | `/api/results/delete` | Delete crawl sessions and output files. |

---

## Command-Line Crawling

Run crawls directly without the API:

```bash
# Wattpad (story URL)
scrapy crawl wattpad -a novel="https://www.wattpad.com/story/347718219-slug" -a limit=5

# Wattpad (chapter URL — auto-detects parent story)
scrapy crawl wattpad -a novel="https://www.wattpad.com/1284690197-slug/chapter-1" -a limit=3

# NovelWorm
scrapy crawl novelworm -a novel="https://novelworm.com/story/slug" -a limit=5
```

---

## Related Projects

- [CreateStory_FE](https://github.com/hatrumtruong27/createstory-fe) — React frontend
- [FastAPIServer](https://github.com/hatrumtruong27/createstory-be) — API gateway that proxies to this service
