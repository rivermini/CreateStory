# fe_novel_crawler

The web interface for the Novel Crawler project. Enter a novel URL, crawl chapters, preview and download results, generate audio with text-to-speech, or browse the built-in story library for batch TTS.

## Features

- **URL auto-detection** -- paste any novel URL and the app identifies the site and fetches metadata automatically
- **Live crawl progress** -- real-time log streaming as chapters are scraped
- **Multi-format output** -- download individual chapters, combined files, or full ZIP archives
- **Text-to-speech** -- pick a voice, adjust speed, generate audio from any text
- **BedRead story library** -- browse stories, configure TTS settings, and batch-generate audio for entire novels
- **Dark mode** -- system-aware theme switching

## Architecture

```
Browser (this app)
    │
    ├── HTTP/SSE ──► FastAPI backend (port 8000)
    │                   │
    │                   ├── Scrapy subprocess ──► wattpad.com
    │                   ├── Kokoro ONNX ──► WAV/MP3 audio
    │                   └── External API ──► BedRead story library
    │
    └── In dev: Vite proxy /api/* ──► localhost:8000
        In prod: Direct HTTP to Cloudflare Tunnel URL
```

The frontend connects to the [novel_crawler](https://github.com/hatrumtruong27/novel_crawler) backend API.

## Prerequisites

- **Node.js 18+**
- **npm 9+**

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Environment Variables

Create a `.env` file in the project root:

```bash
# Development: points to local backend
VITE_API_BASE_URL=http://localhost:8000
```

In production (Vercel), set `VITE_API_BASE_URL` via the Vercel dashboard under **Settings > Environment Variables**. It should point to your backend's Cloudflare Tunnel URL or public IP.

## Pages

| Page | Route | What it does |
|------|-------|--------------|
| **Home** | `/` | Paste a URL, auto-detect the site, configure crawl settings, start crawling |
| **Results** | `/results` | Browse all past crawl sessions, preview and download files |
| **Active Crawls** | `/active` | Monitor all running and recently finished crawl sessions |
| **Batch** | `/batch` | Start multiple crawls at once from a list of URLs |
| **BedRead** | `/bedread` | Browse the story library, configure TTS, batch-generate audio |

## Project Structure

```
src/
├── api/
│   └── client.ts          # All API calls -- no fetch() anywhere else
├── hooks/
│   ├── useSiteDetection.ts  # URL detection with 300ms debounce
│   ├── useCrawlStream.ts    # Crawl progress polling (2s interval)
│   └── useResults.ts        # Results fetching and caching
├── pages/
│   ├── Home.tsx           # Main crawl page
│   ├── Results.tsx        # Results browser
│   ├── ActiveCrawls.tsx   # Active session monitor
│   ├── Batch.tsx          # Multi-crawl launcher
│   └── BedRead.tsx        # Story library + batch TTS
└── components/
    ├── UrlInput.tsx        # URL input with auto-detection
    ├── ProgressBar.tsx      # Crawl progress bar
    ├── CrawlLog.tsx        # Live log output
    ├── FilePreview.tsx      # In-browser file preview
    ├── TTSPlayer.tsx       # Audio player for TTS output
    └── VoiceSelector.tsx   # Voice picker with language grouping
```

## State Management

No global state library. Each page owns its local state via `useState`. Shared server state is fetched on demand through custom hooks.

The API client (`src/api/client.ts`) is the single source of truth for all HTTP communication.

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

Or connect the repository to Vercel for automatic deployments on push.

Set `VITE_API_BASE_URL` in Vercel's environment variables to your backend URL (Cloudflare Tunnel URL or public IP).

## API Client

All HTTP calls go through `src/api/client.ts`. Key functions:

```typescript
// Start a crawl
const { crawl_id } = await startCrawl({
  spider_name: "wattpad",
  novel: "https://www.wattpad.com/1284690197-slug",
  limit: 10,
  output_format: "jsonl",
  chapter_range: "1-10",
  novel_name: "Story Title",
  completed: true,
  combine_chapters: true,
});

// Poll for progress (useCrawlStream hook does this automatically)
const { progress, logLines } = await getCrawlStatusWithLogs(crawl_id);

// Get results
const result = await getCrawlResult(crawl_id);

// Download
const zipUrl = getDownloadAllUrl(crawlId);
```

See `src/api/client.ts` for the complete API surface.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 |
| Language | TypeScript |
| Build tool | Vite 8 |
| Routing | React Router v6 |
| Styling | Tailwind CSS v3 |
| HTTP client | Native `fetch` (via centralized wrapper) |
| Deployment | Vercel |

## Troubleshooting

**Frontend can't reach the backend:** Make sure the backend is running (`python main.py` in the `novel_crawler` directory). Check that `VITE_API_BASE_URL` in `.env` matches `http://localhost:8000`.

**CORS errors in dev:** The Vite proxy (`vite.config.ts`) forwards `/api` to `localhost:8000`. This only works in `npm run dev`. For production, `VITE_API_BASE_URL` must point to your deployed backend.

**SSE not updating:** The frontend uses HTTP polling (every 2 seconds), not Server-Sent Events. This is intentional -- polling works through Cloudflare Tunnel, while SSE gets buffered.

## Further Reading

For a deep-dive into how every component works, see [DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md) in the project root.
