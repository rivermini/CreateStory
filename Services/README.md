# CreateStory Services

Docker Compose orchestration for the local CreateStory PC.

Your current team access model is Cloudflare-managed routes on the existing `create story` tunnel:

- `https://createstory.online` -> local frontend container on `127.0.0.1:5173`
- `https://be.createstory.online` -> local gateway on `127.0.0.1:8000`

## What runs locally

- Frontend Nginx on `127.0.0.1:5173`
- FastAPI gateway on `127.0.0.1:8000`
- Worker services on internal Docker networks only
- PostgreSQL on an internal Docker network only

The gateway is the only public backend entry point. Workers and PostgreSQL are not published to the host.

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
C:\ProgramData\CreateStory\secrets\jwt_secret_key
C:\ProgramData\CreateStory\secrets\internal_service_token
```

On a fresh machine you do not need to create these by hand. Running `task secrets:ensure`
runs `setup_secrets.ps1` and generates any missing secret file, keeping
`postgres_password` and the password embedded in `database_url` in sync. Existing
files are never overwritten. Because the secrets live outside the workspace,
they are **not** included in exported zip packages - each machine provisions its own.

Do not commit `.env`, cookies, service-account JSON, browser profiles, private keys, or token files.

## Non-secret settings

The gateway default CORS allowlist includes:

```text
http://localhost:5173,http://localhost:3000,https://createstory.online
```

Copy `.env.example` to `.env` only if you need to override non-secret Compose settings.

## Layout

- `docker-compose.yml` - local stack definition
- `docker-compose.ci.yml` - CI-only secret-file override
- `nginx-frontend.conf` - Nginx config for the built React frontend
- `Taskfile.yml` - developer task runner configuration
- `AutoAudio/`, `BedReadDriveSync/`, `BedReadVoices/`, `FastAPIServer/`, `NovelCrawler/` - service repositories
