# Jobnib browser assistant

This local companion enables CreateStory to import a complete Jobnib chapter
after an operator unlocks all of its reader parts in a normal Chrome window.
It is intended for the quality-first **Browser assisted** mode on Jobnib Batch.

The assistant is deliberately limited to capture and visual assistance:

- It opens backend-assigned Jobnib chapter URLs in the isolated Chrome tab.
- It observes only Jobnib chapter containers and their visible lock state.
- It keeps the current real **Start Reading** or **Continue to Part** button
  in the middle of the Chrome viewport and adds an orange highlight until the
  operator activates it.
- It waits for the operator to use Jobnib's real **Start Reading** and part
  navigation controls.
- It submits text and sanitized markup only after every expected part is
  populated, no reader lock is visible, and the final part is visible.
- It automatically opens the next assigned chapter after a successful save.

It does **not** click, focus, or type, call Jobnib JavaScript reader functions, inspect
or replay verification tokens, change browser fingerprint properties, export
cookies, or attempt to solve a challenge.

## User setup (localhost or public server)

1. In CreateStory, open Jobnib Batch and click **Download companion**. No
   repository checkout or Node.js installation is required.
2. Open `CreateStory-Jobnib-Companion-win-x64.exe`.
3. Choose a discovered batch in CreateStory and click **Create pairing code**.
4. Copy the `csjn1...` code and paste it into the companion window.

The same executable accepts loopback HTTP for local development and requires
HTTPS for a public CreateStory server. Pairing credentials are batch-bound,
short-lived, held only in memory, and never written to disk.

The companion opens or reuses a visible Chrome window with a dedicated profile
under `%LOCALAPPDATA%\CreateStory\JobnibBrowserAssistant`.

## Build and publish

On Windows x64 with Node.js 26 or newer:

```powershell
cd Services
task build:jobnib-companion
```

The build bundles the assistant and WebSocket client with esbuild, then uses
Node's single-executable builder. It creates the executable and integrity
manifest under `tools/jobnib_browser_assistant/dist/`. Build it before building
the NovelCrawler Docker image, or mount it elsewhere and set
`JOBNIB_COMPANION_PATH`. Set `CREATE_STORY_SIGN_CERT_SHA1` during the build to
code-sign and timestamp the executable with `signtool.exe`.

The authenticated gateway exposes the build through the normal download-ticket
flow, so NovelCrawler does not need to be publicly reachable.

### Public server prerequisite

If the API hostname embedded in the frontend is protected by Cloudflare Access
or another whole-site login proxy, create a more-specific Access application
and add a **Bypass / Everyone** policy for this path only:

```text
/api/crawl/jobnib-batch/*/browser-capture/*
```

Do not bypass the whole `/api` tree. Pair creation, companion download, and all
normal application APIs remain behind the user's regular login. The bypassed
companion endpoints independently require a high-entropy, batch-bound bearer
from the one-time pairing code and reject missing, invalid, expired, or closed
pairings. Without this narrow proxy exception, the companion detects the HTML
access-login response and explains the required server-side fix.

## Developer fallback

The source assistant remains runnable for development:

```powershell
npm install
node jobnib_browser_assistant.js --pairing-code "csjn1..."
```

## During capture

For each assigned chapter:

1. Wait for the assistant to open the chapter.
2. Complete any normal browser verification shown by Jobnib.
3. Click the orange-highlighted **Start Reading** button centered in Chrome.
4. Each required **Continue to Part** button is centered and highlighted once;
   click it to reveal the next part.
5. Leave the final part visible briefly. The terminal prints `[SAVED]`, and the
   next assigned chapter opens automatically.

If CreateStory rejects a chapter, it stays checkpointed as incomplete and the
assistant reports the reason. No partial chapter is exported.

## Backend contract

The logged-in UI creates the pairing. The companion then uses the pairing token
as a Bearer token (and an equivalent compatibility header) on these endpoints:

- `GET /api/crawl/jobnib-batch/{batch_id}/browser-capture/{pairing_id}/next`
- `POST .../{pairing_id}/submit`
- `POST .../{pairing_id}/report`
- `POST .../{pairing_id}/close`

`next` returns either HTTP 204 or `{done, assignment}`. An assignment contains
`assignment_id`, `url`, and `expected_segment_ids` plus display/progress fields.
`submit` receives `assignment_id`, `page_url`, `page_title`, sanitized segment
HTML, plain text, visible reader-lock state, and `lock_scan_complete: true`.

## Tests

```powershell
npm install --no-audit --no-fund
npm test
```
