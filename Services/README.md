# CreateStory Services

Docker Compose orchestration for the local CreateStory PC.

Your current team access model is Cloudflare-managed routes on the existing `create story` tunnel:

- `https://createstory.online` -> local frontend container on `127.0.0.1:5173`
- `https://be.createstory.online` -> local gateway on `127.0.0.1:8000`

## What runs locally

- Frontend Nginx on `127.0.0.1:5173`
- FastAPI gateway on `127.0.0.1:8000`
- Worker services on internal Docker networks only
- One PostgreSQL server containing five private logical databases

The gateway is the only public backend entry point. Worker APIs stay internal;
PostgreSQL is bound to `127.0.0.1` for local administration and is not exposed
to the LAN. Restarting the Gateway interrupts new browser requests only; queued
and running worker jobs continue in their owning service.

## Database ownership

| Service | Database / role | Owned state |
|---|---|---|
| FastAPIServer | `create_story_gateway` | users, refresh tokens, UI/crawl preferences, migration archive |
| NovelCrawler | `create_story_crawler` | crawl sessions/output and crawler cookies |
| BedReadVoices | `create_story_voices` | TTS jobs/files and TTS settings |
| BedReadDriveSync | `create_story_drive_sync` | queue/history, Drive config, credentials and metadata caches |
| AutoAudio | `create_story_auto_audio` | sessions, scheduler state and AutoAudio settings |

The roles are denied `CONNECT` to the other four databases. Services exchange
data through protected HTTP APIs, never by querying another service's tables.

## Installing Task

We use **go-task** (Task) as a lightweight, cross-platform dev tool runner. You can find detailed instructions in the [official Task installation guide](https://taskfile.dev/docs/installation), or use these quick commands:

### Windows:
```powershell
winget install Task.Task
```
*(Remember to restart your terminal after installing to reload the PATH).*

### macOS:
```bash
brew install go-task
```

### Linux:
```bash
sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d
```

---

## Normal developer workflow

Use the **Taskfile** to run developer workflow tasks:

```bash
# List all available tasks
task --list

# Start the stack for the first time (Clean -> Reset Secrets -> Verify Models -> Start Stack -> Set Admin)
task start:fresh

# Rebuild and reload all services normally in the foreground
task start

# Rebuild and reload all services in the background
task start:bg

# Rebuild and reload all services (including rebuilding frontend)
task update:all

# Rebuild and reload all services, skipping frontend compilation
task update:all-noFE

# Rebuild and reload all backend services (no frontend build)
task update:backend

# Update a single service (no-deps build, e.g. gateway or voices)
task update:gateway
task update:voices
```

## Required secret files

Secrets should live outside the workspace:

```text
C:\ProgramData\CreateStory\secrets\postgres_password
C:\ProgramData\CreateStory\secrets\database_url
C:\ProgramData\CreateStory\secrets\gateway_database_password
C:\ProgramData\CreateStory\secrets\gateway_database_url
C:\ProgramData\CreateStory\secrets\crawler_database_password
C:\ProgramData\CreateStory\secrets\crawler_database_url
C:\ProgramData\CreateStory\secrets\voices_database_password
C:\ProgramData\CreateStory\secrets\voices_database_url
C:\ProgramData\CreateStory\secrets\drive_sync_database_password
C:\ProgramData\CreateStory\secrets\drive_sync_database_url
C:\ProgramData\CreateStory\secrets\auto_audio_database_password
C:\ProgramData\CreateStory\secrets\auto_audio_database_url
C:\ProgramData\CreateStory\secrets\jwt_secret_key
C:\ProgramData\CreateStory\secrets\internal_service_token
C:\ProgramData\CreateStory\secrets\cookie_encryption_key
```

On a fresh machine you do not need to create these by hand. Running `task secrets:ensure`
runs `setup_secrets.ps1` and generates any missing secret file, keeping
the matching role passwords and URLs in sync. `database_url` remains the
untouched legacy shared-database connection for migration/rollback. Existing
files are never overwritten. Because the secrets live outside the workspace,
they are **not** included in exported zip packages - each machine provisions its own.

CI can generate the same ignored file set under `Services/.ci-secrets` with
`task secrets:ci`, then use both Compose files:

```powershell
docker compose -f docker-compose.yml -f docker-compose.ci.yml config
```

Do not commit `.env`, cookies, service-account JSON, browser profiles, private keys, or token files.

## Non-secret settings

The gateway default CORS allowlist includes:

```text
http://localhost:5173,http://localhost:3000,https://createstory.online
```

Copy `.env.example` to `.env` only if you need to override non-secret Compose settings.

## Shared-database migration runbook

The migration is deliberately a maintenance-window operation. Do not start new
jobs after reviewing the plan.

For an existing shared-database installation, run this workflow before any
normal rebuild with the new Compose file. The database provisioner detects a
populated legacy database without a validated cutover marker and refuses to
start empty service databases, preventing an accidental empty-data deployment.

```powershell
task migration:plan       # read-only source inventory and routing
task migration:apply      # provision, backup, copy, validate, cut over
task migration:validate   # repeat hashes/schema/role-isolation checks
```

`migration:apply` refuses active jobs and non-empty target tables. It stops
writers, writes a custom-format `pg_dump` plus SHA-256 file under
`C:\ProgramData\CreateStory\backups`, runs each service's Alembic chain, copies
data, splits settings by owner, validates deterministic row fingerprints, then
starts workers before the Gateway and frontend. It never writes to or deletes
the legacy `create_story` database. Before building, it also tags the exact
currently-running application images for the pre-reopening rollback path.

If validation fails before traffic reopens:

```powershell
task migration:rollback
```

Rollback runs those captured pre-migration images and reconnects every service
through `docker-compose.legacy-db.yml`, so the untouched legacy schema is not
upgraded by the new code. While rollback is active, include that override in
later Compose commands. It is not a post-cutover data merge: writes accepted by
the new databases are not copied back to the legacy database.

### Recurring database backups

The post-migration databases have a separate backup workflow. Backups are stored
under `C:\ProgramData\CreateStory\backups\service-databases` as timestamped,
checksummed sets containing Gateway, Crawler, Voices, DriveSync, and AutoAudio.
The backup utility is disposable and does not leave a container behind.

```powershell
task backup:database          # create and verify a backup now
task backup:list              # list complete backup sets
task backup:schedule-install  # daily at 03:00, retain 14 days
task backup:restore-latest    # guarded full restore + service restart
task backup:restore -- 20260712T012618Z  # restore a selected backup
```

To change the schedule, reinstall it with options, for example:
`task backup:schedule-install -- -ScheduleTime 02:00 -RetentionDays 30`.

Restore verifies checksums before changing anything and creates a fresh safety
backup first. It then stops application writers, recreates all five databases,
restores the latest complete set, and starts workers before the Gateway and
frontend. If restore fails, application services remain stopped and the safety
backup name is printed. Scheduled backups require Docker Desktop to be running
and the installing Windows user to be signed in. Remove the schedule with
`task backup:schedule-remove`.

## Layout

- `docker-compose.yml` - local stack definition
- `docker-compose.ci.yml` - CI-only secret-file override
- `docker-compose.legacy-db.yml` - pre-reopening emergency rollback override
- `nginx-frontend.conf` - Nginx config for the built React frontend
- `Taskfile.yml` - developer task runner configuration
- `AutoAudio/`, `BedReadDriveSync/`, `BedReadVoices/`, `FastAPIServer/`, `NovelCrawler/` - service repositories
