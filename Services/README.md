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

## Normal update workflow

Use:

```bat
update_services.bat
```

Useful options:

- `1` builds the frontend with `VITE_API_BASE_URL=https://be.createstory.online`, copies it to `Services\frontend-dist`, then rebuilds/reloads all Docker services.
- `2-6` rebuild individual backend services.
- `7` rebuilds only the frontend and restarts the frontend container.
- `8` restarts only the frontend container.

## Required secret files

Secrets should live outside the workspace:

```text
C:\ProgramData\CreateStory\secrets\postgres_password
C:\ProgramData\CreateStory\secrets\database_url
C:\ProgramData\CreateStory\secrets\jwt_secret_key
C:\ProgramData\CreateStory\secrets\internal_service_token
```

On a fresh machine you do not need to create these by hand. `update_services.bat`
runs `setup_secrets.ps1` on launch and generates any missing secret file, keeping
`postgres_password` and the password embedded in `database_url` in sync. Existing
files are never overwritten. Run `setup_secrets.bat` directly to pre-create them.
Because the secrets live outside the workspace, they are **not** included in
`export_services.bat` archives - each machine provisions its own.

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
- `update_services.bat` - normal local update workflow
- `export_services.bat` - archive/export helper
- `AutoAudio/`, `BedReadDriveSync/`, `BedReadVoices/`, `FastAPIServer/`, `NovelCrawler/` - service repositories
