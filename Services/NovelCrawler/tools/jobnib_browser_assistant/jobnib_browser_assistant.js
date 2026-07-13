#!/usr/bin/env node

"use strict";

const http = require("node:http");
const { setTimeout: sleep } = require("node:timers/promises");
const WebSocket = require("ws");

const VERSION = "0.1.0";
const JOBNIB_HOSTS = new Set(["jobnib.com", "www.jobnib.com"]);
const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const DEFAULT_CHROME_PORT = 9224;
const DEFAULT_POLL_MS = 2500;
const DEFAULT_MIN_SEGMENT_CHARS = 100;

function usage() {
  return `
CreateStory - Jobnib browser assistant ${VERSION}

Usage:
  node jobnib_browser_assistant.js \\
    --batch <batch-id> \\
    --pairing <pairing-id> \\
    --token <pairing-token> \\
    [--api-base http://127.0.0.1:8000] \\
    [--chrome-port 9224]

The assistant observes a normal Chrome tab and keeps the current reader control
centered and highlighted. It never clicks that control or interacts with browser
verification. Click each highlighted control yourself; the assistant validates
and submits the populated chapter segments automatically.
`;
}

function parseArgs(argv) {
  const aliases = new Map([
    ["--batch", "batchId"],
    ["--batch-id", "batchId"],
    ["--pairing", "pairingId"],
    ["--pairing-id", "pairingId"],
    ["--token", "token"],
    ["--api-base", "apiBase"],
    ["--chrome-port", "chromePort"],
    ["--poll-ms", "pollMs"],
    ["--min-segment-chars", "minSegmentChars"],
  ]);
  const values = {
    apiBase: process.env.CREATE_STORY_API_BASE || DEFAULT_API_BASE,
    chromePort: process.env.JOBNIB_ASSIST_CHROME_PORT || DEFAULT_CHROME_PORT,
    pollMs: process.env.JOBNIB_ASSIST_POLL_MS || DEFAULT_POLL_MS,
    minSegmentChars: process.env.JOBNIB_ASSIST_MIN_SEGMENT_CHARS || DEFAULT_MIN_SEGMENT_CHARS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      values.help = true;
      continue;
    }
    const key = aliases.get(argument);
    if (!key) throw new Error(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    values[key] = value;
    index += 1;
  }

  values.chromePort = parsePositiveInteger(values.chromePort, "--chrome-port");
  values.pollMs = parsePositiveInteger(values.pollMs, "--poll-ms");
  values.minSegmentChars = parsePositiveInteger(values.minSegmentChars, "--min-segment-chars");
  values.apiBase = normalizeApiBase(values.apiBase);
  if (!values.help) {
    for (const [key, option] of [["batchId", "--batch"], ["pairingId", "--pairing"], ["token", "--token"]]) {
      if (!values[key]) throw new Error(`${option} is required.`);
    }
  }
  return values;
}

function parsePositiveInteger(value, option) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer.`);
  return parsed;
}

function normalizeApiBase(value) {
  const url = new URL(String(value || DEFAULT_API_BASE));
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("--api-base must use HTTPS, except for a localhost development server.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function assertJobnibUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !JOBNIB_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Backend assignment is not an allowed Jobnib HTTPS URL: ${url.origin}`);
  }
  return url.toString();
}

function normalizeAssignment(payload) {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload.assignment || payload.next_assignment || payload.data?.assignment || payload;
  const pageUrl = raw.page_url || raw.chapter_url || raw.url;
  if (!pageUrl) return null;
  const assignmentId = raw.assignment_id || raw.id || raw.chapter_id;
  if (!assignmentId) throw new Error("The backend assignment has no assignment_id.");
  const expectedSegmentIds = Array.isArray(raw.expected_segment_ids) && raw.expected_segment_ids.length
    ? raw.expected_segment_ids.map(normalizeSegmentId)
    : Array.from(
      { length: Math.max(1, Number.parseInt(raw.expected_segments || raw.segment_count || "2", 10) || 2) },
      (_unused, index) => String(index + 1),
    );
  return {
    assignmentId: String(assignmentId),
    pageUrl: assertJobnibUrl(pageUrl),
    expectedSegments: expectedSegmentIds.length,
    expectedSegmentIds,
    storyTitle: String(raw.story_title || ""),
    chapterTitle: String(raw.chapter_title || raw.title || ""),
  };
}

function normalizeSegmentId(value) {
  const text = String(value || "");
  const match = text.match(/(?:^|[-_])(\d+)$/);
  return match ? match[1] : text;
}

class BackendClient {
  constructor({ apiBase, batchId, pairingId, token }) {
    this.apiBase = apiBase;
    this.batchId = encodeURIComponent(batchId);
    this.pairingId = encodeURIComponent(pairingId);
    this.token = token;
    this.closed = false;
  }

  path(action) {
    return `${this.apiBase}/api/crawl/jobnib-batch/${this.batchId}/browser-capture/${this.pairingId}/${action}`;
  }

  async request(action, { method = "GET", body, allowEmpty = false } = {}) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(this.path(action), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (allowEmpty && (response.status === 204 || response.status === 404)) return null;
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { throw new Error(`${method} ${action} returned non-JSON HTTP ${response.status}.`); }
    }
    if (!response.ok) {
      const detail = data?.detail || data?.message || `HTTP ${response.status}`;
      const error = new Error(`${method} ${action} failed: ${detail}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async next() {
    const payload = await this.request("next", { allowEmpty: true });
    return {
      done: Boolean(payload?.done),
      assignment: normalizeAssignment(payload),
    };
  }

  async submit(assignment, capture) {
    return this.request("submit", {
      method: "POST",
      body: {
        assignment_id: assignment.assignmentId,
        page_url: capture.pageUrl,
        page_title: capture.title,
        segments: selectExpectedSegments(capture, assignment).map((segment) => ({
          segment_id: segment.segmentId,
          html: segment.html,
          text: segment.text,
          visible: segment.visible,
        })),
        locks: capture.locks,
        lock_scan_complete: true,
      },
    });
  }

  async report(kind, assignment, message, releaseAssignment = false) {
    try {
      await this.request("report", {
        method: "POST",
        body: {
          assignment_id: assignment?.assignmentId || null,
          kind,
          message: String(message || "").slice(0, 1000),
          release_assignment: releaseAssignment,
        },
      });
    } catch (error) {
      console.warn(`[WARN] Could not report ${kind}: ${error.message}`);
    }
  }

  async close(reason) {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.request("close", {
        method: "POST",
        body: { reason },
      });
    } catch (error) {
      console.warn(`[WARN] Could not close the backend pairing cleanly: ${error.message}`);
    }
  }
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { hostname: "127.0.0.1", port, path: pathname, timeout: 10000 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Chrome debugging endpoint returned HTTP ${response.statusCode}.`));
            return;
          }
          try { resolve(JSON.parse(body)); }
          catch (error) { reject(new Error(`Chrome returned invalid JSON: ${error.message}`)); }
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Chrome debugging connection timed out.")));
  });
}

class ChromeSession {
  constructor(port) {
    this.port = port;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.centeredManualActionKey = null;
  }

  async connect() {
    let tabs;
    try { tabs = await getJson(this.port, "/json/list"); }
    catch { tabs = await getJson(this.port, "/json"); }
    if (!Array.isArray(tabs)) throw new Error("Chrome returned an invalid tab list.");
    const tab = tabs.find((candidate) => candidate.type === "page" && isJobnibPage(candidate.url))
      || tabs.find((candidate) => candidate.type === "page" && !String(candidate.url).startsWith("devtools:"));
    if (!tab?.webSocketDebuggerUrl) {
      throw new Error(`No usable Chrome page was found on debugging port ${this.port}.`);
    }
    this.socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Chrome WebSocket connection timed out.")), 10000);
      this.socket.once("open", () => { clearTimeout(timeout); resolve(); });
      this.socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
    });
    this.socket.on("message", (raw) => this.onMessage(raw));
    this.socket.on("close", () => this.rejectAll(new Error("Chrome debugging connection closed.")));
    this.socket.on("error", (error) => this.rejectAll(error));
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }

  onMessage(raw) {
    let message;
    try { message = JSON.parse(String(raw)); }
    catch { return; }
    if (!message.id || !this.pending.has(message.id)) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else pending.resolve(message.result || {});
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}, timeoutMs = 20000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Chrome debugging connection is not open."));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome timed out while running ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Chrome evaluation failed.");
    }
    return result.result?.value;
  }

  async navigate(pageUrl) {
    assertJobnibUrl(pageUrl);
    this.centeredManualActionKey = null;
    const result = await this.send("Page.navigate", { url: pageUrl });
    if (result.errorText) throw new Error(`Chrome could not navigate: ${result.errorText}`);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const state = await this.evaluate("({readyState: document.readyState, url: location.href})");
      if (state?.readyState === "complete" && isSameAssignmentPage(state.url, pageUrl)) return;
      await sleep(500);
    }
    throw new Error("Chrome did not finish loading the assigned chapter within 45 seconds.");
  }

  async captureState() {
    return this.evaluate(CAPTURE_EXPRESSION);
  }

  async centerManualAction(expectedPageUrl) {
    const candidate = await this.evaluate(MANUAL_ACTION_SCAN_EXPRESSION);
    if (
      !candidate?.id ||
      !candidate?.pageUrl ||
      !isSameAssignmentPage(candidate.pageUrl, expectedPageUrl)
    ) {
      this.centeredManualActionKey = null;
      return { found: false, changed: false };
    }

    const key = `${normalizedPageKey(candidate.pageUrl)}|${candidate.id}`;
    const changed = key !== this.centeredManualActionKey;
    const result = await this.evaluate(buildManualActionCenterExpression(candidate.id));
    if (!result?.centered) {
      return { found: false, changed: false };
    }
    this.centeredManualActionKey = key;
    return { ...candidate, ...result, found: true, changed };
  }

  close() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.close();
    this.socket = null;
  }
}

const CAPTURE_EXPRESSION = String.raw`(() => {
  const visible = (element) => {
    if (!element || element.hidden) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  };
  const cleanText = (value) => String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const safeHtml = (element) => {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('script,style,iframe,object,embed,form,input,textarea,button,select,template').forEach((node) => node.remove());
    clone.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (
          name.startsWith('on') ||
          name === 'style' ||
          name === 'nonce' ||
          name.includes('token') ||
          name.includes('sitekey') ||
          name.startsWith('data-cf')
        ) node.removeAttribute(attribute.name);
      });
    });
    return clone.innerHTML.trim();
  };
  const segmentElements = Array.from(document.querySelectorAll('[id^="jn-content-"]'));
  const segments = segmentElements.map((element, offset) => {
    const match = element.id.match(/^jn-content-(.+)-(\d+)$/);
    return {
      segmentId: match ? match[2] : element.id,
      index: match ? Number(match[2]) : offset + 1,
      text: cleanText(element.textContent),
      html: safeHtml(element),
      visible: visible(element),
    };
  }).sort((left, right) => left.index - right.index);
  // jn-coll-* is Jobnib's harmless "tap to re-read" collapsed-part control.
  // Only jn-lock-* represents an unresolved reader lock.
  const lockElements = Array.from(document.querySelectorAll('[id^="jn-lock-"]'));
  const locks = lockElements.map((element) => ({
    segment_id: (element.id.match(/(?:^|[-_])(\d+)$/) || [])[1] || null,
    selector: element.id ? '#' + element.id : element.tagName.toLowerCase(),
    text: cleanText(element.textContent).slice(0, 500),
    visible: visible(element),
  }));
  const article = document.querySelector('article[id^="post-"]');
  const storyTitle = cleanText(
    document.querySelector('.seriestitlenu, .seriestuheader h1, [itemprop="name"]')?.textContent
  );
  const chapterTitle = cleanText(
    document.querySelector('h1.entry-title, .entry-title, article h1, document-title')?.textContent || document.title
  );
  return {
    pageUrl: location.href,
    title: chapterTitle || document.title,
    storyTitle,
    postId: article ? article.id.replace(/^post-/, '') : '',
    segments,
    locks,
    finalSegmentVisible: Boolean(segments.length && segments[segments.length - 1].visible),
    visibleLockCount: locks.filter((lock) => lock.visible).length,
  };
})()`;

const MANUAL_ACTION_SCAN_EXPRESSION = String.raw`(() => {
  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const isActionable = (element) => {
    if (!element || !element.isConnected || element.disabled) return false;
    if (element.getAttribute('aria-disabled') === 'true') return false;
    if (element.closest('[inert], [aria-hidden="true"]')) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden) return false;
      const style = getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        Number(style.opacity || 1) <= 0 ||
        style.pointerEvents === 'none'
      ) return false;
    }
    const rect = element.getBoundingClientRect();
    return element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0;
  };

  const article = document.querySelector('article[id^="post-"]');
  const match = article?.id.match(/^post-(\d+)$/);
  if (!article || !match) return { pageUrl: location.href, found: false };
  const postId = match[1];
  const candidates = [];

  const start = document.getElementById('jn-btn-' + postId + '-1');
  if (
    article.contains(start) &&
    /^(?:▶\s*)?Start Reading$/i.test(normalizeText(start.textContent)) &&
    isActionable(start)
  ) {
    candidates.push({
      id: start.id,
      label: normalizeText(start.textContent),
      kind: 'start',
      part: 1,
    });
  }

  article.querySelectorAll('[id^="jn-next-"]').forEach((element) => {
    const idMatch = element.id.match(new RegExp('^jn-next-' + postId + '-([1-9]\\d*)$'));
    const labelMatch = normalizeText(element.textContent).match(/^Continue to Part\s+(\d+)\s*(?:→)?$/i);
    if (!idMatch || !labelMatch || Number(labelMatch[1]) !== Number(idMatch[1]) + 1) return;
    if (!isActionable(element)) return;
    candidates.push({
      id: element.id,
      label: normalizeText(element.textContent),
      kind: 'continue',
      part: Number(labelMatch[1]),
    });
  });

  if (candidates.length !== 1) {
    return { pageUrl: location.href, found: false, ambiguous: candidates.length > 1 };
  }
  return { pageUrl: location.href, found: true, ...candidates[0] };
})()`;

function buildManualActionCenterExpression(elementId) {
  const encodedId = JSON.stringify(String(elementId || ""));
  return String.raw`(() => {
    const element = document.getElementById(${encodedId});
    const article = document.querySelector('article[id^="post-"]');
    if (!element || !article || !article.contains(element) || element.disabled) {
      return { centered: false };
    }
    if (element.getAttribute('aria-disabled') === 'true') return { centered: false };
    const rectBefore = element.getBoundingClientRect();
    if (!element.isConnected || element.getClientRects().length === 0 || rectBefore.width <= 0 || rectBefore.height <= 0) {
      return { centered: false };
    }

    let style = document.getElementById('create-story-manual-action-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'create-story-manual-action-style';
      style.textContent = '[data-create-story-manual-action="true"] {' +
        'outline: 4px solid #ff6500 !important;' +
        'outline-offset: 6px !important;' +
        'box-shadow: 0 0 0 8px rgba(255, 101, 0, 0.28) !important;' +
      '}';
      (document.head || document.documentElement).appendChild(style);
    }
    document.querySelectorAll('[data-create-story-manual-action="true"]').forEach((previous) => {
      previous.removeAttribute('data-create-story-manual-action');
    });
    element.setAttribute('data-create-story-manual-action', 'true');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });

    const viewport = window.visualViewport;
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportHeight = viewport ? viewport.height : window.innerHeight;
    const rect = element.getBoundingClientRect();
    const delta = rect.top + (rect.height / 2) - (viewportTop + (viewportHeight / 2));
    if (Math.abs(delta) > 2) {
      window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
    }
    const finalRect = element.getBoundingClientRect();
    return {
      centered: true,
      viewportCenter: Math.round(viewportTop + (viewportHeight / 2)),
      buttonCenter: Math.round(finalRect.top + (finalRect.height / 2)),
    };
  })()`;
}

function isJobnibPage(value) {
  try {
    const url = new URL(value);
    return JOBNIB_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizedPageKey(value) {
  const url = new URL(value);
  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "").toLowerCase()}`;
}

function isSameAssignmentPage(current, expected) {
  try { return normalizedPageKey(current) === normalizedPageKey(expected); }
  catch { return false; }
}

function validateCapture(state, assignment, minSegmentChars) {
  const reasons = [];
  if (!state || typeof state !== "object") return { ready: false, reasons: ["Chapter DOM is not available yet."] };
  if (!isSameAssignmentPage(state.pageUrl, assignment.pageUrl)) {
    reasons.push("Chrome is not on the assigned chapter.");
  }
  const expected = selectExpectedSegments(state, assignment);
  if (expected.length < assignment.expectedSegments) {
    reasons.push(`Found ${expected.length}/${assignment.expectedSegments} expected chapter parts.`);
  }
  const incomplete = expected.filter((segment) => String(segment.text || "").trim().length < minSegmentChars);
  if (incomplete.length) reasons.push(`${incomplete.length} chapter part(s) are still empty or preview-only.`);
  if (Number(state.visibleLockCount || 0) > 0) reasons.push(`${state.visibleLockCount} reader lock(s) are still visible.`);
  const finalExpected = expected.find(
    (segment) => normalizeSegmentId(segment.segmentId) === assignment.expectedSegmentIds.at(-1),
  );
  if (expected.length && !finalExpected?.visible) reasons.push("Continue to the final chapter part so it is visible.");
  return { ready: reasons.length === 0, reasons };
}

function selectExpectedSegments(state, assignment) {
  if (!Array.isArray(state?.segments)) return [];
  const byId = new Map(state.segments.map((segment) => [normalizeSegmentId(segment.segmentId), segment]));
  return assignment.expectedSegmentIds.map((segmentId) => byId.get(segmentId)).filter(Boolean);
}

function captureSummary(state, assignment) {
  const lengths = selectExpectedSegments(state, assignment).map((segment) => segment.text.length);
  return `parts ${lengths.length}/${assignment.expectedSegments} [${lengths.join(", ") || "empty"}] chars; visible locks ${state?.visibleLockCount || 0}`;
}

async function waitForManualUnlock(chrome, backend, assignment, options, signal) {
  console.log("");
  console.log(`[CHAPTER] ${assignment.chapterTitle || assignment.pageUrl}`);
  console.log("[ACTION] The assistant will keep each reader button centered and highlighted. You still click it yourself.");
  console.log("[WAIT] It will submit automatically when the full chapter is ready.");
  let lastSummary = "";
  let lastReportAt = 0;
  while (!signal.aborted) {
    const state = await chrome.captureState();
    const validation = validateCapture(state, assignment, options.minSegmentChars);
    const summary = captureSummary(state, assignment);
    if (summary !== lastSummary) {
      console.log(`[WAIT] ${summary}${validation.ready ? " - ready" : ""}`);
      lastSummary = summary;
    }
    if (validation.ready) return state;
    const manualAction = await chrome.centerManualAction(assignment.pageUrl);
    if (manualAction.changed) {
      process.stdout.write("\x07");
      console.log(
        `[ACTION] Centered and highlighted "${manualAction.label}" in Chrome. Click the orange-highlighted button.`,
      );
    }
    if (Date.now() - lastReportAt > 30000) {
      await backend.report("unlock_required", assignment, validation.reasons.join(" "));
      lastReportAt = Date.now();
    }
    await sleep(options.pollMs, undefined, { signal });
  }
  throw new Error("Browser assistant stopped.");
}

async function run(options) {
  const backend = new BackendClient(options);
  const chrome = new ChromeSession(options.chromePort);
  const controller = new AbortController();
  let stopReason = "completed";
  const requestStop = () => {
    stopReason = "operator_stopped";
    controller.abort();
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  try {
    console.log(`CreateStory Jobnib browser assistant ${VERSION}`);
    console.log(`[INFO] Connecting to Chrome debugging port ${options.chromePort}...`);
    await chrome.connect();
    console.log("[OK] Connected to the isolated Chrome window.");
    console.log("[INFO] Pairing token is held in memory and is never written to disk.");
    await backend.report("info", null, `Assistant connected to Chrome debugging port ${options.chromePort}.`);

    let queuedAssignment = null;
    while (!controller.signal.aborted) {
      let assignment = queuedAssignment;
      queuedAssignment = null;
      if (!assignment) {
        const next = await backend.next();
        if (next.done) {
          console.log("\n[DONE] The backend reports that this browser-capture run is complete.");
          break;
        }
        assignment = next.assignment;
      }
      if (!assignment) {
        process.stdout.write(".");
        await sleep(Math.max(options.pollMs, 3000), undefined, { signal: controller.signal });
        continue;
      }

      console.log("");
      console.log(`[INFO] Opening assignment ${assignment.assignmentId}.`);
      let assignmentStage = "navigation";
      try {
        await chrome.navigate(assignment.pageUrl);
        assignmentStage = "capture";
        await backend.report("info", assignment, "Assignment opened; waiting for manual reader unlock.");
        const capture = await waitForManualUnlock(chrome, backend, assignment, options, controller.signal);
        // Re-read immediately before submission to avoid accepting stale state after navigation.
        const finalCapture = await chrome.captureState();
        const finalValidation = validateCapture(finalCapture, assignment, options.minSegmentChars);
        if (!finalValidation.ready) {
          console.warn(`[WARN] Chapter changed before submission: ${finalValidation.reasons.join(" ")}`);
          continue;
        }
        const response = await backend.submit(assignment, finalCapture);
        if (response?.accepted === false) {
          throw new Error(response.message || response.detail || "Backend rejected the captured chapter.");
        }
        console.log(`[SAVED] ${assignment.chapterTitle || assignment.assignmentId} (${captureSummary(finalCapture, assignment)}).`);
      } catch (error) {
        if (controller.signal.aborted) break;
        console.error(`[ERROR] Assignment ${assignment.assignmentId}: ${error.message}`);
        await backend.report(
          assignmentStage === "navigation" ? "navigation_error" : "capture_error",
          assignment,
          error.message,
          true,
        );
        await sleep(Math.max(options.pollMs, 3000), undefined, { signal: controller.signal });
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      stopReason = "assistant_error";
      console.error(`[ERROR] ${error.message}`);
      process.exitCode = 1;
    }
  } finally {
    chrome.close();
    await backend.close(stopReason);
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    console.log("\n[STOPPED] Browser assistant closed. Chrome was left open.");
  }
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      run(options);
    }
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    console.log(usage());
    process.exitCode = 1;
  }
}

module.exports = {
  BackendClient,
  CAPTURE_EXPRESSION,
  ChromeSession,
  MANUAL_ACTION_SCAN_EXPRESSION,
  assertJobnibUrl,
  buildManualActionCenterExpression,
  isSameAssignmentPage,
  normalizeAssignment,
  normalizeSegmentId,
  normalizeApiBase,
  parseArgs,
  validateCapture,
};
