# CreateStory Frontend

CreateStory_FE is the web interface for the local CreateStory stack. It lets the team crawl novels, preview and download results, generate TTS audio, run BedRead batch generation, and monitor Drive sync.

The intended deployment model is simple: run the stack on one local PC, then expose the local frontend and gateway to the small team through the existing Cloudflare Tunnel routes:

- `https://createstory.online` -> local frontend
- `https://be.createstory.online` -> local gateway

## Architecture

```text
Team browser
  |
  | HTTPS via Cloudflare Tunnel
  v
Local PC
  |
  +-- Frontend Nginx / Vite preview on 127.0.0.1:5173
  |
  +-- FastAPI gateway on 127.0.0.1:8000
        |
        +-- NovelCrawler worker
        +-- BedReadVoices worker
        +-- BedReadDriveSync worker
        +-- AutoAudio worker
        +-- PostgreSQL
```

The frontend communicates through the centralized API client in `src/api/client.ts`. In development, Vite can proxy `/api` calls to `localhost:8000`. For team access, build with `VITE_API_BASE_URL=https://be.createstory.online`.

## Tech stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Language | TypeScript |
| Build tool | Vite 8 |
| Routing | React Router v6 |
| Styling | Tailwind CSS v3 |
| HTTP client | Native `fetch`, centralized in `src/api/client.ts` |
| Runtime | Local PC + Cloudflare Tunnel |

## Quick start

```bash
cd CreateStory_FE
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). By default the app talks to `http://localhost:8000`.

## Environment

Copy `.env.example` to `.env` only when you need to override the defaults:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

For the team-facing Cloudflare build, set:

```bash
VITE_API_BASE_URL=https://be.createstory.online
```

Do not commit `.env`, `.env.production`, cookies, tokens, or private keys.

## Build for local hosting

```bash
npm run build
```

The output goes to `dist/`. To serve it with the local Services stack, copy the contents of `dist/` into `Services/frontend-dist/`, then run the Services Docker Compose stack. The frontend container serves that directory through Nginx.

## Required checks

```bash
npm run lint
npm run typecheck
npm test
npm audit --audit-level=high
npm run build
```

The GitHub Actions workflow runs those checks plus Gitleaks and a committed-credential artifact guard. It does not deploy anywhere.

## Troubleshooting

**Frontend cannot reach the backend.** Make sure the gateway is running on the local PC. For local dev, `VITE_API_BASE_URL` should usually be `http://localhost:8000`. For team access, it should be `https://be.createstory.online`.

**CORS errors through Cloudflare.** Make sure the gateway `ALLOWED_ORIGINS` includes `https://createstory.online`.

**Downloads fail in the browser.** Downloads now use short-lived tickets. Make sure browser navigation to the gateway tunnel URL is allowed and that frontend and gateway clocks are reasonably in sync.
