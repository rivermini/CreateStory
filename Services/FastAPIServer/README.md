# CreateStory Gateway

**FastAPIServer** is the API gateway for the CreateStory suite. It proxies requests from the [CreateStory_FE](https://github.com/hatrumtruong27/createstory-fe) frontend to three downstream microservices (NovelCrawler, BedReadVoices, BedReadDriveSync) and runs its own auto-audio orchestration pipeline that discovers stories with missing audio and generates, compresses, and uploads TTS chapters end-to-end.

Built with FastAPI on Python 3.10+.

---

## Features

| Category | Details |
|---|---|
| **Gateway proxying** | Forwards requests to NovelCrawler (scraping), BedReadVoices (TTS), and BedReadDriveSync (Drive sync) |
| **Auto-audio orchestrator** | Phase 1–3 story discovery, batch TTS generation, FFmpeg audio compression, and presigned-URL upload to external API |
| **Settings management** | Persisted user preferences (theme, crawl defaults, auto-audio config) |
| **Drive sync config proxy** | Serves external API credentials from `drive_sync_config.json` to downstream services |
| **CORS open** | Serves any origin; designed for local development and Cloudflare Tunnel |

---

## Architecture

```
Browser (CreateStory_FE, port 5173 / Vercel)
    │
    ├── HTTP/SSE ──► FastAPIServer (port 8000, this service)
    │                   │
    │                   ├── HTTP proxy ──► NovelCrawler (port 8002)
    │                   ├── HTTP proxy ──► BedReadVoices (port 8001)
    │                   ├── HTTP proxy ──► BedReadDriveSync (port 8003)
    │                   └── Auto-audio pipeline (self-contained)
    │                       ├── External API ──► story discovery
    │                       ├── BedReadVoices ──► batch TTS
    │                       ├── FFmpeg ──► audio compression
    │                       └── External API ──► upload
    │
    └── Cloudflare Tunnel (production) ──► exposes local backend
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web framework | FastAPI 0.110+ |
| ASGI server | Uvicorn |
| HTTP client | httpx |
| Data validation | Pydantic 2.0+ |
| Environment | python-dotenv |

---

## Prerequisites

- **Python 3.10+**
- All downstream services running on their configured ports
- FFmpeg available in system PATH, `BedReadVoices/vendor/`, or bundled vendor dir (for auto-audio compression)
- `api/data/drive_sync_config.json` with external API credentials (written by frontend's Drive Sync Configuration modal)

---

## Quick Start

```powershell
cd D:\Developer\Nova\CreateStoryMicroService\FastAPIServer
pip install -r requirements.txt
python main.py
```

The server starts on **http://localhost:8000**. API docs are at **http://localhost:8000/docs** (Swagger UI) and **http://localhost:8000/redoc**.

> **Important:** Start FastAPIServer **first** so the frontend can reach it. Downstream services (BedReadVoices, NovelCrawler, BedReadDriveSync) must also be running on their respective ports.

---

## Environment Variables

### `.env`

```powershell
SERVICE_URLS={"FastAPIServer":"http://localhost:8000","NovelCrawler":"http://localhost:8002","BedReadVoices":"http://localhost:8001","BedReadDriveSync":"http://localhost:8003"}
```

Individual service URL overrides are also read directly:

| Variable | Default | Description |
|---|---|---|
| `SERVICE_URLS_NovelCrawler` | `http://localhost:8002` | NovelCrawler base URL |
| `SERVICE_URLS_BedReadVoices` | `http://localhost:8001` | BedReadVoices base URL |
| `SERVICE_URLS_BedReadDriveSync` | `http://localhost:8003` | BedReadDriveSync base URL |
| `DOWNLOAD_TICKET_TTL_SECONDS` | `3600` | Lifetime of native browser/IDM download tickets; tickets remain reusable for Range requests |
| `DOWNLOAD_PREPARE_TIMEOUT_SECONDS` | `1800` | Maximum time the gateway waits for a worker to finish first-time archive preparation |
| `BEDREADVOICES_ROOT` | *(auto-detected)* | Path to BedReadVoices directory (for FFmpeg lookup) |
| `MAIN_BE_API_BASE_URL` | *(set in drive_sync_config.json)* | External story API base URL |
| `MAIN_BE_API_TOKEN` | *(set in drive_sync_config.json)* | Bearer token for external API |

Download endpoints exchange the logged-in API session for a short-lived native download ticket. The
ticket status endpoint keeps frontend preparation indicators active until worker archive headers are
ready, while reusable tickets and forwarded byte ranges support IDM resume/multi-connection downloads.

---

## Project Structure

```
FastAPIServer/
├── main.py                           # Uvicorn entry point (port 8000)
├── .env                              # Service URLs and external API credentials
├── .env.example                      # Template
├── api/
│   ├── main.py                       # FastAPI app, CORS, router inclusion
│   ├── config.py                     # drive_sync_config.json loader
│   ├── routes/
│   │   ├── auto_audio.py             # Auto-audio session control (start/stop/status/history)
│   │   ├── crawl.py                  # Proxy → NovelCrawler: start, stream, cancel, status
│   │   ├── results.py                # Proxy → NovelCrawler: list, download, combine, preview
│   │   ├── sites.py                  # Proxy → NovelCrawler: detect, chapter list
│   │   ├── settings.py               # User settings CRUD
│   │   ├── tts.py                    # Proxy → BedReadVoices: voices, jobs, audio
│   │   ├── bedread.py                # Proxy → BedReadVoices: stories, chapters, batch TTS
│   │   └── drive_sync/               # Proxy → BedReadDriveSync (all sub-routes)
│   │       ├── config.py            # Config, status, token, URL endpoints
│   │       ├── folders.py            # Folder listing, preview, sync trigger
│   │       ├── history.py            # Sync history
│   │       ├── jobs.py              # Job management
│   │       ├── dashboard.py         # Stories needing update
│   │       ├── uploadability.py      # Uploadability/updatability checks
│   │       └── utils.py             # Shared Pydantic models
│   ├── models/
│   │   ├── auto_audio.py             # Auto-audio session schemas
│   │   └── settings.py               # User settings schemas
│   └── data/
│       ├── user_settings.json        # Persisted user settings
│       └── drive_sync_config.json    # Shared external API credentials
├── services/
│   └── orchestrator/
│       └── auto_audio_service.py     # Auto-audio pipeline (~1300 lines)
└── output/
    └── auto_audio_logs/             # Session history and detail logs
        ├── sessions.json
        └── session_*.json
```

---

## Auto-Audio Orchestrator

The auto-audio pipeline (`services/orchestrator/auto_audio_service.py`) runs in a background daemon thread and processes stories across three phases:

| Phase | Target | Source |
|---|---|---|
| Phase 1 | Stories needing update only | `/api/v1/dashboard/stories-needing-update` |
| Phase 2 | All published stories | `/api/v1/story/discover` (paginated) |
| Phase 3 | N most recently updated | `/api/v1/story/discover?sort=recently_updated` |

**Per-story pipeline:**

1. Fetch chapters from external API — flag chapters missing `audioUrl`
2. Batch TTS generation via BedReadVoices — poll until all chapters complete
3. Compress WAV → Opus via FFmpeg (48kbps, max 20MB)
4. Get presigned upload URL from external API
5. PUT compressed audio, then call `/complete`
6. Pause (configurable, default 30s) before next story

---

## API Reference

### Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings` | Get user settings |
| `PUT` | `/api/settings` | Partially update settings |

### Auto-Audio

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auto-audio/start` | Start an auto-audio session |
| `GET` | `/api/auto-audio/status` | Current session state |
| `POST` | `/api/auto-audio/stop` | Gracefully stop the session |
| `GET` | `/api/auto-audio/history` | List all past sessions |
| `GET` | `/api/auto-audio/history/{session_id}` | Full session detail |

### Crawl (→ NovelCrawler)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/crawl/start` | Start a crawl |
| `POST` | `/api/crawl/start-batch` | Start multiple crawls |
| `GET` | `/api/crawl/stream` | SSE stream for live crawl progress |
| `GET` | `/api/crawl/status` | Crawl status |
| `DELETE` | `/api/crawl/cancel` | Cancel a crawl |

### Results (→ NovelCrawler)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/results` | List all crawl sessions |
| `GET` | `/api/results/{crawl_id}` | Full result |
| `POST` | `/api/results/{crawl_id}/combine` | Merge chapters |
| `GET` | `/api/results/{crawl_id}/download-all` | Download as ZIP |

### Sites (→ NovelCrawler)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sites/detect` | Detect site from URL |
| `GET` | `/api/sites` | List supported sites |
| `GET` | `/api/sites/chapters` | Fetch chapter list |

### TTS (→ BedReadVoices)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tts/voices` | List available voices |
| `GET` | `/api/tts/languages` | List languages |
| `POST` | `/api/tts/speak` | Start a TTS job |
| `GET` | `/api/tts/jobs` | List all TTS jobs |
| `GET` | `/api/tts/jobs/{job_id}` | Get job status |
| `GET` | `/api/tts/jobs/{job_id}/audio` | Stream audio |

### BedRead (→ BedReadVoices)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/bedread/stories` | List stories |
| `GET` | `/api/bedread/stories/search` | Search stories |
| `GET` | `/api/bedread/stories/{id}/chapters` | Get chapters |
| `POST` | `/api/bedread/generate` | Batch TTS generation |
| `GET` | `/api/bedread/jobs` | List batch jobs |
| `GET` | `/api/bedread/jobs/{batch_id}/zip` | Download batch as ZIP |

### Drive Sync (→ BedReadDriveSync)

All sub-routes under `/api/drive-sync/` are proxied directly to BedReadDriveSync. See [BedReadDriveSync README](./BedReadDriveSync/README.md).

---

## Related Projects

- [CreateStory_FE](https://github.com/hatrumtruong27/createstory-fe) — React frontend
- [CreateStory_BE](https://github.com/hatrumtruong27/createstory-be) — Original monolithic backend (superseded by this microservice architecture)
