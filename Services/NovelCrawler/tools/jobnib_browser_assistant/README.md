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

## First-time setup

1. Install Node.js 20 or newer.
2. In CreateStory, open Jobnib Batch, choose a batch, and create a browser
   capture pairing.
3. Copy the generated command. It has this shape:

   ```bat
   .\Services\NovelCrawler\tools\jobnib_browser_assistant\run_jobnib_browser_assistant.bat --batch BATCH_ID --pairing PAIRING_ID --token PAIRING_TOKEN --api-base http://127.0.0.1:8000 --chrome-port 9224
   ```

   Run that command from the CreateStory repository root.

The BAT file installs the single local `ws` dependency on its first run. It
reuses Chrome if the requested debugging port is already open; otherwise it
opens a normal visible Chrome window with a dedicated profile under
`%LOCALAPPDATA%\CreateStory\JobnibBrowserAssistant`. The pairing token remains
in process memory and is never written to disk. Close the terminal or press
`Ctrl+C` to close the pairing; Chrome remains open.

Use HTTPS for a production API URL. Plain HTTP is accepted only for localhost.

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
