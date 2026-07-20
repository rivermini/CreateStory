"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BackendClient,
  ChromeSession,
  MANUAL_ACTION_SCAN_EXPRESSION,
  assertJobnibUrl,
  buildManualActionCenterExpression,
  decodePairingCode,
  isSameAssignmentPage,
  isDeterministicCaptureRejection,
  normalizeAssignment,
  normalizeApiBase,
  parseArgs,
  validateCapture,
} = require("../jobnib_browser_assistant");

function pairingCode(payload) {
  return `csjn1.${Buffer.from(JSON.stringify({ v: 1, ...payload })).toString('base64url')}`;
}

test("parseArgs accepts the documented companion command", () => {
  const result = parseArgs([
    "--batch", "batch-1",
    "--pairing", "pair-1",
    "--token", "secret",
    "--api-base", "http://localhost:8000/",
    "--chrome-port", "9224",
  ]);
  assert.equal(result.batchId, "batch-1");
  assert.equal(result.pairingId, "pair-1");
  assert.equal(result.token, "secret");
  assert.equal(result.apiBase, "http://localhost:8000");
  assert.equal(result.chromePort, 9224);
});

test("remote API bases require HTTPS", () => {
  assert.throws(() => normalizeApiBase("http://example.test"), /must use HTTPS/);
  assert.equal(normalizeApiBase("https://createstory.online/"), "https://createstory.online");
});

test("pairing codes configure localhost and public server sessions", () => {
  const localCode = pairingCode({
    api_base: "http://127.0.0.1:8000",
    batch_id: "deadbeef",
    pairing_id: "a".repeat(32),
    pairing_token: "b".repeat(43),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  });
  const decoded = decodePairingCode(localCode);
  assert.equal(decoded.apiBase, "http://127.0.0.1:8000");
  assert.equal(decoded.batchId, "deadbeef");
  assert.equal(parseArgs(["--pairing-code", localCode]).pairingId, "a".repeat(32));

  const publicCode = pairingCode({
    api_base: "https://stories.example.com",
    batch_id: "feed1234",
    pairing_id: "c".repeat(32),
    pairing_token: "d".repeat(43),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  });
  assert.equal(parseArgs(["--pairing-code", publicCode]).apiBase, "https://stories.example.com");
});

test("expired or non-HTTPS remote pairing codes are rejected", () => {
  const expired = pairingCode({
    api_base: "https://stories.example.com",
    batch_id: "feed1234",
    pairing_id: "c".repeat(32),
    pairing_token: "d".repeat(43),
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  assert.throws(() => decodePairingCode(expired), /expired/);

  const insecure = pairingCode({
    api_base: "http://stories.example.com",
    batch_id: "feed1234",
    pairing_id: "c".repeat(32),
    pairing_token: "d".repeat(43),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  });
  assert.throws(() => parseArgs(["--pairing-code", insecure]), /must use HTTPS/);
});

test("pairing codes require complete fields and a valid expiry", () => {
  assert.throws(() => decodePairingCode(pairingCode({ expires_at: "not-a-date" })), /incomplete/);
  assert.throws(() => decodePairingCode(pairingCode({
    api_base: "https://stories.example.com",
    batch_id: "feed1234",
    pairing_id: "c".repeat(32),
    pairing_token: "d".repeat(43),
    expires_at: "not-a-date",
  })), /invalid expiry/);
});

test("the companion explains a public access-proxy block", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(
    "<html><title>Cloudflare Access</title></html>",
    { status: 200, headers: { "Content-Type": "text/html" } },
  ));
  const client = new BackendClient({
    apiBase: "https://stories.example.com",
    batchId: "feed1234",
    pairingId: "c".repeat(32),
    token: "d".repeat(43),
  });

  await assert.rejects(() => client.request("next"), /access proxy blocked.*bypass only/s);
});

test("assignments are restricted to Jobnib HTTPS pages", () => {
  assert.equal(assertJobnibUrl("https://jobnib.com/book/a-chapter-1"), "https://jobnib.com/book/a-chapter-1");
  assert.throws(() => assertJobnibUrl("https://example.com/book/a"), /not an allowed Jobnib/);
  assert.throws(() => assertJobnibUrl("http://jobnib.com/book/a"), /not an allowed Jobnib/);
});

test("normalizeAssignment accepts the backend wrapper", () => {
  const result = normalizeAssignment({
    assignment: {
      assignment_id: "chapter-7",
      page_url: "https://www.jobnib.com/book/story-chapter-7",
      expected_segment_ids: ["1", "2"],
      chapter_title: "Chapter 7",
    },
  });
  assert.equal(result.assignmentId, "chapter-7");
  assert.equal(result.expectedSegments, 2);
  assert.deepEqual(result.expectedSegmentIds, ["1", "2"]);
  assert.equal(result.chapterTitle, "Chapter 7");
});

test("same assignment page ignores www and trailing slash", () => {
  assert.equal(
    isSameAssignmentPage("https://www.jobnib.com/book/Test-Chapter-1/", "https://jobnib.com/book/test-chapter-1"),
    true,
  );
});

test("capture requires every segment, no visible locks, and the final part visible", () => {
  const assignment = normalizeAssignment({
    assignment_id: "one",
    page_url: "https://jobnib.com/book/story-chapter-1",
    expected_segment_ids: ["1", "2"],
  });
  const complete = {
    pageUrl: assignment.pageUrl,
    segments: [
      { segmentId: "1", text: "a".repeat(200), visible: false },
      { segmentId: "2", text: "b".repeat(200), visible: true },
    ],
    locks: [],
    visibleLockCount: 0,
    finalSegmentVisible: true,
  };
  assert.deepEqual(validateCapture(complete, assignment, 100), { ready: true, reasons: [] });

  const locked = { ...complete, visibleLockCount: 1 };
  assert.equal(validateCapture(locked, assignment, 100).ready, false);

  const partial = { ...complete, segments: [complete.segments[0]], finalSegmentVisible: false };
  assert.equal(validateCapture(partial, assignment, 100).ready, false);
});

test("deterministic server capture rejections stop instead of recycling the assignment", () => {
  assert.equal(isDeterministicCaptureRejection({ status: 409 }, "capture"), true);
  assert.equal(isDeterministicCaptureRejection({ status: 422 }, "capture"), true);
  assert.equal(isDeterministicCaptureRejection({ status: 500 }, "capture"), false);
  assert.equal(isDeterministicCaptureRejection({ status: 409 }, "navigation"), false);
});

test("manual action scan is narrowly scoped and supports any continue part", () => {
  assert.match(MANUAL_ACTION_SCAN_EXPRESSION, /article\[id\^="post-"\]/);
  assert.match(MANUAL_ACTION_SCAN_EXPRESSION, /jn-btn-/);
  assert.match(MANUAL_ACTION_SCAN_EXPRESSION, /jn-next-/);
  assert.match(MANUAL_ACTION_SCAN_EXPRESSION, /Continue to Part/);
  assert.match(MANUAL_ACTION_SCAN_EXPRESSION, /candidates\.length !== 1/);
  assert.doesNotMatch(MANUAL_ACTION_SCAN_EXPRESSION, /\.click\s*\(/);
  assert.doesNotMatch(MANUAL_ACTION_SCAN_EXPRESSION, /dispatchEvent|jnStart|jnNext/);
});

test("centering expression scrolls and highlights without activating or focusing the control", () => {
  const expression = buildManualActionCenterExpression('jn-next-123-2');
  assert.match(expression, /scrollIntoView/);
  assert.match(expression, /block: 'center'/);
  assert.match(expression, /data-create-story-manual-action/);
  assert.match(expression, /visualViewport/);
  assert.doesNotMatch(expression, /\.click\s*\(|\.focus\s*\(|dispatchEvent|dispatchMouse|dispatchKey/);
});

test("Chrome session keeps the same action centered but announces each id once", async () => {
  const chrome = new ChromeSession(9224);
  const scans = [
    { pageUrl: 'https://jobnib.com/book/story-chapter-1', id: 'jn-btn-10-1', label: 'Start Reading' },
    { pageUrl: 'https://jobnib.com/book/story-chapter-1', id: 'jn-btn-10-1', label: 'Start Reading' },
    { pageUrl: 'https://jobnib.com/book/story-chapter-1', id: 'jn-next-10-1', label: 'Continue to Part 2' },
  ];
  let centered = 0;
  chrome.evaluate = async (expression) => {
    if (expression === MANUAL_ACTION_SCAN_EXPRESSION) return scans.shift();
    centered += 1;
    return { centered: true, viewportCenter: 400, buttonCenter: 400 };
  };

  const first = await chrome.centerManualAction('https://jobnib.com/book/story-chapter-1');
  const repeated = await chrome.centerManualAction('https://jobnib.com/book/story-chapter-1');
  const nextPart = await chrome.centerManualAction('https://jobnib.com/book/story-chapter-1');

  assert.equal(first.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(nextPart.changed, true);
  assert.equal(centered, 3);
});

test("Chrome session refuses a candidate reported from another page", async () => {
  const chrome = new ChromeSession(9224);
  let calls = 0;
  chrome.evaluate = async () => {
    calls += 1;
    return {
      pageUrl: 'https://jobnib.com/book/other-chapter-9',
      id: 'jn-btn-10-1',
      label: 'Start Reading',
    };
  };
  const result = await chrome.centerManualAction('https://jobnib.com/book/story-chapter-1');
  assert.deepEqual(result, { found: false, changed: false });
  assert.equal(calls, 1);
});
