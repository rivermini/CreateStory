# Nova Crawler — Frontend

**CreateStory_FE** is the web interface for the Nova Crawler suite. Enter any novel URL, crawl chapters in real time, preview and download results in multiple formats, generate audio with GPU-accelerated text-to-speech, or explore the BedRead story library for batch audio synthesis. It connects to the [CreateStory_BE](https://github.com/hatrumtruong27/createstory-be) FastAPI backend.

Built with React 19, TypeScript, and Tailwind CSS — deployed on Vercel

---

## Features

| Feature | Description |
|---|---|
| **URL auto-detection** | Paste any novel URL — the app identifies the site and fetches metadata automatically |
| **Live crawl progress** | Real-time progress streaming with a live log panel as chapters are scraped |
| **Multi-format output** | Download individual chapters, merged files, or full ZIP archives |
| **Text-to-speech** | Pick a voice, adjust speed, generate WAV/MP3 audio from any crawled text |
| **Batch crawl** | Launch multiple crawls simultaneously from a list of URLs |
| **BedRead library** | Browse the story library, configure TTS settings, batch-generate audio for entire novels |
| **Google Drive sync** | Configure and monitor Drive-to-backend story synchronization |
| **Dark / light mode** | System-aware theme switching with a manual toggle |

---

## Architecture

```
Browser (this app)
    │
    ├── HTTP/SSE ──► FastAPI backend (port 8000)
    │                   │
    │                   ├── Scrapy + Selenium/Chrome ──► wattpad.com
    │                   ├── Kokoro ONNX ──► WAV/MP3 audio
    │                   ├── Google Drive API ──► Story sync
    │                   └── External BedRead API ──► Story library
    │
    └── In dev: Vite proxy /api/* ──► localhost:8000
        In prod: Direct HTTP to Cloudflare Tunnel URL or VPS endpoint
```

The frontend communicates exclusively through the API client (`src/api/client.ts`). No `fetch()` calls exist outside that module.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Language | TypeScript |
| Build tool | Vite 8 |
| Routing | React Router v6 |
| Styling | Tailwind CSS v3 |
| Fonts | Inter (via @fontsource/inter) |
| HTTP client | Native `fetch` (centralized wrapper) |
| Deployment | Vercel |

---

## Prerequisites

- **Node.js 18+**
- **npm 9+**

---

## Quick Start

```bash
cd CreateStory_FE

npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The app will connect to the backend at `http://localhost:8000` (configured via `VITE_API_BASE_URL`).

---

## Environment Variables

Create a `.env` file in the project root:

```bash
# Development: points to local backend
VITE_API_BASE_URL=http://localhost:8000
```

For production (Vercel), set `VITE_API_BASE_URL` under **Settings > Environment Variables** in the Vercel dashboard. Point it to your backend's Cloudflare Tunnel URL or public VPS IP.

---

## Pages

| Page | Route | Description |
|---|---|---|
| **Home** | `/` | Paste a URL, auto-detect the site, configure crawl settings, start crawling |
| **Results** | `/results` | Browse all past crawl sessions, preview and download files |
| **Active Crawls** | `/active` | Monitor all running and recently finished crawl sessions |
| **Batch** | `/batch` | Start multiple crawls at once from a list of URLs |
| **BedRead** | `/bedread` | Browse the story library, configure TTS, batch-generate audio |
| **Drive Sync** | `/drive-sync` | Configure Drive sync settings and monitor sync status |

---

## Project Structure

```
src/
├── api/
│   └── client.ts              # All HTTP calls — the single source of truth for API communication
├── hooks/
│   ├── useSiteDetection.ts    # URL detection with 300 ms debounce
│   ├── useCrawlStream.ts      # Crawl progress polling (2 s interval)
│   └── useResults.ts          # Results fetching and caching
├── pages/
│   ├── Home.tsx               # Main crawl page
│   ├── Results.tsx            # Results browser
│   ├── ActiveCrawls.tsx       # Active session monitor
│   ├── Batch.tsx              # Multi-crawl launcher
│   ├── BedRead.tsx            # Story library + batch TTS
│   └── DriveSync.tsx          # Drive sync configuration & monitoring
├── components/
│   ├── UrlInput.tsx           # URL input with auto-detection
│   ├── ProgressBar.tsx        # Crawl progress bar
│   ├── CrawlLog.tsx           # Live log output
│   ├── FilePreview.tsx        # In-browser file preview
│   ├── TTSPlayer.tsx          # Audio player for TTS output
│   ├── VoiceSelector.tsx      # Voice picker with language grouping
│   └── ThemeToggle.tsx        # Dark/light mode toggle
└── main.tsx                   # App entry point, router setup
```

---

## State Management

No global state library is used. Each page owns its local state via `useState`. Shared server state is fetched on demand through custom hooks. The API client (`src/api/client.ts`) is the single source of truth for all HTTP communication.

---

## Build and Deploy

### Build for production

```bash
npm run build
```

Output goes to the `dist/` directory.

### Preview the production build locally

```bash
npm run preview
```

### Deploy to Vercel

```bash
npm run build
vercel deploy
```

Or connect the repository to Vercel for automatic deployments on push. Set `VITE_API_BASE_URL` in Vercel's environment variables to your backend URL.

---

## API Client

All HTTP calls go through `src/api/client.ts`. Key functions:

```typescript
// Start a crawl
const { crawl_id } = await startCrawl({
  spider_name: "wattpad",
  novel: "https://www.wattpad.com/1284690197-slug",
  limit: 10,
  output_format: "txt",
  chapter_range: "1-10",
  novel_name: "Story Title",
});

// Poll for progress (useCrawlStream hook does this automatically)
const { progress, logLines } = await getCrawlStatusWithLogs(crawl_id);

// Get results
const result = await getCrawlResult(crawl_id);

// Download as ZIP
const zipUrl = getDownloadAllUrl(crawlId);

// Start batch crawl
await startBatchCrawl(requests);

// TTS
const { job_id } = await speak({ text, voice, lang, speed, format: "wav" });
const job = await getJobStatus(jobId);
const audioBlob = await getJobAudio(jobId);
```

See `src/api/client.ts` for the complete API surface.

---

## Troubleshooting

**Frontend can't reach the backend.** Make sure the backend is running (`python main.py` in the CreateStory_BE directory). Check that `VITE_API_BASE_URL` in `.env` matches `http://localhost:8000`.

**CORS errors in dev.** The Vite proxy (`vite.config.ts`) forwards `/api` to `localhost:8000`. This only works in `npm run dev`. For production, `VITE_API_BASE_URL` must point to your deployed backend.

**SSE not updating.** The frontend uses HTTP polling (every 2 seconds), not Server-Sent Events. This is intentional — polling works reliably through Cloudflare Tunnel, while SSE gets buffered by intermediaries.

---

## Related Projects

- [CreateStory_BE](https://github.com/hatrumtruong27/createstory-be) — FastAPI backend API
