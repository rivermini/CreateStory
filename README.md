# BedReadDriveSync

**BedReadDriveSync** is a Google Drive synchronization microservice that bridges a Google Drive folder structure to a remote story backend. It scans Drive for organized story folders, parses chapter files and metadata, and uploads or updates stories on the remote backend via REST API calls. It runs on port 8003 and is called by FastAPIServer.

Built with FastAPI + Google Drive API on Python 3.10+.

---

## Features

| Category | Details |
|---|---|
| **Drive folder scanning** | Recursively scans Drive folders by naming convention (`DONE_`, `EXTENDED_`, `ING_`, `INCOMPLETE_`) |
| **Story upload (DONE_)** | Creates new stories on the remote backend with metadata, tags, cover, and chapters |
| **Chapter update (EXTENDED_)** | Adds new chapters to existing stories without re-uploading |
| **Metadata extraction** | Reads `synopsis.md`, `tags.md`, `free.md`, `Category.md` from Drive folders |
| **Uploadability checks** | Identifies which Drive folders are ready to upload, already uploaded, or invalid |
| **Updatability checks** | Identifies stories with new chapters waiting to be pushed |
| **Story dashboard** | Proxies "stories needing update" data from the remote backend |
| **Job queue** | Tracks individual sync operations as persisted jobs |
| **Action history** | Logs all sync actions with timestamps and errors (capped at 200 entries) |
| **Batch Drive API** | Minimizes API calls via batched queries and exponential backoff retry |

---

## Architecture

```
FastAPIServer (port 8000)
    │
    └── HTTP ──► BedReadDriveSync (port 8003, this service)
                      │
                      ├── Google Drive API ──► Google Drive
                      │     └── Service account credentials
                      │
                      ├── External BedRead API ──► Story library
                      │     └── Bearer token auth
                      │
                      └── FastAPI ──► REST API
                          └── Filesystem ──► api/data/
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web framework | FastAPI 0.111+ |
| ASGI server | Uvicorn |
| Google APIs | google-api-python-client, google-auth |
| HTTP client | httpx |
| Data validation | Pydantic 2.5+ |
| Environment | python-dotenv |

---

## Prerequisites

- **Python 3.10+**
- **Google service account** with a JSON key file (shared with FastAPIServer)
- **Remote backend API** URL and bearer token
- Google Drive folder with stories organized by naming convention

---

## Quick Start

```powershell
cd D:\Developer\Nova\CreateStoryMicroService\BedReadDriveSync
pip install -r requirements.txt
python main.py
```

The server starts on **http://localhost:8003**. API docs are at **http://localhost:8003/docs** (Swagger UI) and **http://localhost:8003/redoc**.

---

## Environment Variables

| Variable | Description |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Path to the Google service account JSON key file (e.g. `credentials/google-service-account.json`) |
| `MAIN_BE_API_BASE_URL` | Base URL of the remote story backend API |
| `MAIN_BE_API_TOKEN` | Bearer token for authenticating with the remote backend |
| `DRIVE_FOLDER_ID` | *(optional)* Root Google Drive folder ID to sync from (can also be set via API) |

---

## Project Structure

```
BedReadDriveSync/
├── main.py                           # Uvicorn entry point (port 8003)
├── .env                              # Service account path, remote API credentials
├── api/
│   ├── main.py                       # FastAPI app, CORS, router inclusion
│   ├── models/
│   │   └── drive_sync.py             # All Pydantic models
│   ├── routes/
│   │   └── drive_sync/
│   │       ├── __init__.py           # Router composition
│   │       ├── config.py            # GET/POST/PUT /config, /status, /token, /url
│   │       ├── folders.py            # /folders, /folders/all, /trigger, /preview, /file, /chapter-breakdown
│   │       ├── uploadability.py      # /check-uploadable, /check-updatable, /update-chapters
│   │       ├── history.py            # Action history CRUD
│   │       ├── jobs.py              # Sync job management
│   │       ├── dashboard.py          # Stories needing update proxy
│   │       └── utils.py             # Shared route models
│   └── data/
│       ├── drive_sync_config.json    # Persisted sync configuration
│       ├── sync_jobs.json           # Persisted job queue
│       ├── sync_jobs.lock           # File lock for job queue
│       └── drive_sync_history.json   # Action history log
└── services/
    └── drive_service/
        ├── drive_service.py          # Main class composition + singleton
        ├── _paths.py                 # Path constants, regex patterns, author IDs
        ├── _config_store.py          # ConfigStoreMixin: config/status persistence
        ├── _drive_api.py             # DriveAPIMixin: Drive API calls + retry
        ├── _parsers.py               # ParsersMixin: folder/content parsing
        ├── _main_be_client.py        # MainBEClientMixin: remote backend API calls
        └── _history_jobs.py          # HistoryJobsMixin: history + sync jobs
```

---

## Drive Folder Conventions

Folders in Google Drive are expected to follow a naming convention for automatic detection:

### Status Prefixes

| Prefix | Meaning |
|---|---|
| `DONE_` | Story is complete — all chapters ready to upload |
| `EXTENDED_` | New chapters added to an existing story — update on remote |
| `ING_` | Work in progress — skipped by default |
| `INCOMPLETE_` | Incomplete — skipped by default |

### Folder Structure

```
{DONE,EXTENDED}_{Story Title}_{Status}
/  synopsis.md        # Story synopsis text
  cover.jpg          # Cover image
  free.md            # Number of free chapters (integer)
  tags.md            # Tag list (one per line)
  Category.md        # Main and sub category
  chapters/          # Chapter files
  │   ├── Chapter 1 - Title.md
  │   ├── Chapter 2 - Title.md
  │   └── ...
  └── chapters-extended/   # (EXTENDED_ folders only) New chapters to add
      ├── Chapter N+1 - Title.md
      └── ...
```

System folders (`.tmp`, `.workdir`, `.cowork-trash`) are skipped.

### Reference Platforms

| Value in Category.md | Platform |
|---|---|
| `wp` | Wattpad |
| `gd` | Goodnovel |

---

## API Reference

### Config

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/drive-sync/config` | Get current sync configuration |
| `POST` | `/api/drive-sync/config` | Initialize sync configuration |
| `PUT` | `/api/drive-sync/config` | Update sync configuration |
| `GET` | `/api/drive-sync/config/token` | Get current bearer token |
| `GET` | `/api/drive-sync/config/url` | Get remote API base URL |
| `GET` | `/api/drive-sync/status` | Current sync status |

### Folders

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/drive-sync/folders` | List story folders in Drive |
| `GET` | `/api/drive-sync/folders/all` | Flat list of all files in Drive |
| `GET` | `/api/drive-sync/folders/{folder_id}/preview` | Preview folder contents without syncing |
| `GET` | `/api/drive-sync/folders/{folder_id}/file` | Read a metadata file's content |
| `GET` | `/api/drive-sync/folders/{folder_id}/chapter-breakdown` | Detailed chapter analysis |
| `POST` | `/api/drive-sync/folders/{folder_id}/sync` | Sync a single Drive folder |
| `POST` | `/api/drive-sync/trigger` | Trigger a full Drive scan and sync |

### Uploadability / Updatability

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/drive-sync/check-uploadable` | Which `DONE_` folders are ready to upload |
| `GET` | `/api/drive-sync/check-updatable` | Which `EXTENDED_` folders have new chapters |
| `GET` | `/api/drive-sync/check-updatable/reader-finished` | Filtered to stories in "needs update" dashboard |
| `POST` | `/api/drive-sync/update-chapters/{folder_id}` | Push new chapters from a folder to the backend |
| `POST` | `/api/drive-sync/update-chapter-count` | Update a story's `maxChapter` count |

### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/drive-sync/dashboard/stories-needing-update` | Proxied from remote backend |

### History

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/drive-sync/history` | List action history |
| `POST` | `/api/drive-sync/history` | Add a manual history entry |
| `PATCH` | `/api/drive-sync/history/{entry_id}` | Update a history entry |
| `POST` | `/api/drive-sync/history/clear` | Clear all history |

### Jobs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/drive-sync/jobs` | List all sync jobs |
| `POST` | `/api/drive-sync/jobs` | Create a sync job |
| `GET` | `/api/drive-sync/jobs/{job_id}` | Get job status |
| `DELETE` | `/api/drive-sync/jobs/{job_id}` | Delete a job |
| `POST` | `/api/drive-sync/jobs/delete` | Bulk delete jobs |

---

## Validation Rules

Before uploading, folders are validated:

- Chapter filenames must match `Chapter X - Title.ext` format
- Chapter numbering must start at 1
- No duplicate chapter numbers
- No "rewritten" chapter files in `chapters-extended`
- Story must exist on the remote backend before `EXTENDED_` updates

---

## Related Projects

- [CreateStory_FE](https://github.com/hatrumtruong27/createstory-fe) — React frontend
- [FastAPIServer](https://github.com/hatrumtruong27/createstory-be) — API gateway that proxies to this service
