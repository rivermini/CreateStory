// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeJobnibBrowserCapture,
  getJobnibBrowserCaptureStatus,
  pairJobnibBrowserCapture,
} from './crawl';

const jsonHeaders = { 'Content-Type': 'application/json' };

describe('Jobnib browser capture API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    } satisfies Storage);
  });

  it('creates a pairing with the normal app API', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      batch_id: 'batch-1',
      pairing_id: 'pair-1',
      pairing_token: 'pair-secret',
      row_index: null,
      status: 'active',
      created_at: '2026-07-13T10:00:00Z',
      expires_at: '2026-07-13T10:15:00Z',
      idle_ttl_seconds: 900,
    }), { status: 200, headers: jsonHeaders }));
    vi.stubGlobal('fetch', fetchMock);

    await pairJobnibBrowserCapture('batch/1', { ttl_seconds: 600, row_index: 8 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:8000/api/crawl/jobnib-batch/batch%2F1/browser-capture/pair');
    expect(JSON.parse(String(init?.body))).toEqual({ ttl_seconds: 600, row_index: 8 });
  });

  it('polls and closes with the temporary pairing bearer without app-auth refresh', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/close')) {
        return new Response(JSON.stringify({
          batch_id: 'batch-1', pairing_id: 'pair-1', status: 'closed',
          closed_at: '2026-07-13T10:01:00Z', submitted_chapters: 4,
        }), { status: 200, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({
        batch_id: 'batch-1', pairing_id: 'pair-1', status: 'active',
        created_at: '2026-07-13T10:00:00Z', last_activity_at: '2026-07-13T10:00:05Z',
        expires_at: '2026-07-13T10:15:00Z', submitted_chapters: 4, reported_events: 1,
        active_assignment: null,
        batch: { phase: 'ready', total_stories: 10, completed_count: 0, needs_session_count: 3, total_chapters: 932, crawled_chapters: 4 },
      }), { status: 200, headers: jsonHeaders });
    });
    vi.stubGlobal('fetch', fetchMock);

    await getJobnibBrowserCaptureStatus('batch-1', 'pair-1', 'pair-secret');
    await closeJobnibBrowserCapture('batch-1', 'pair-1', 'pair-secret', 'Finished testing');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const statusHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    const closeHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(statusHeaders.get('Authorization')).toBe('Bearer pair-secret');
    expect(closeHeaders.get('Authorization')).toBe('Bearer pair-secret');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ reason: 'Finished testing' });
  });
});
