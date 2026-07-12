// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACCESS_TOKEN_KEY,
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_USER_KEY,
  REFRESH_TOKEN_KEY,
  apiFetch,
  downloadWithAuth,
} from './client';

function seedAuth() {
  localStorage.setItem(ACCESS_TOKEN_KEY, 'old-access');
  localStorage.setItem(REFRESH_TOKEN_KEY, 'old-refresh');
  localStorage.setItem(
    AUTH_USER_KEY,
    JSON.stringify({ id: 'user-1', email: 'user@example.com', role: 'operator', is_active: true }),
  );
}

describe('authentication refresh coordination', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    } satisfies Storage);
    localStorage.clear();
    seedAuth();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: async (_name: string, callback: () => Promise<boolean>) => callback() },
    });
  });

  it('shares one refresh across 20 simultaneous 401 responses', async () => {
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          token_type: 'bearer',
          user: { id: 'user-1', email: 'user@example.com', role: 'operator', is_active: true },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const authorization = new Headers(init?.headers).get('Authorization');
      return authorization === 'Bearer new-access'
        ? new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ detail: 'expired' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }));

    const results = await Promise.all(
      Array.from({ length: 20 }, () => apiFetch<{ ok: boolean }>('/api/test')),
    );

    expect(refreshCalls).toBe(1);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('emits one session-expired event when the shared refresh fails', async () => {
    let expiredEvents = 0;
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, () => {
      expiredEvents += 1;
    }, { once: false });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/api/auth/refresh')
        ? new Response('{}', { status: 401 })
        : new Response('{}', { status: 401 })
    )));

    await Promise.allSettled(
      Array.from({ length: 20 }, () => apiFetch('/api/test')),
    );

    expect(expiredEvents).toBe(1);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });

  it('uses a native IDM-visible link and waits for ticket readiness', async () => {
    let statusCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/download-ticket')) {
        return new Response(JSON.stringify({
          ticket: 'download-token',
          download_url: '/api/download/download-token',
          status_url: '/api/download-ticket/download-token/status',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/download-ticket/download-token/status')) {
        statusCalls += 1;
        return new Response(JSON.stringify({ status: 'ready' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }));
    let clickedHref = '';
    let clickedDownloadAttribute: string | null = null;
    let clickedTarget = '';
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedHref = this.href;
      clickedDownloadAttribute = this.getAttribute('download');
      clickedTarget = this.target;
    });

    await downloadWithAuth('/api/results/inkitt-batch/abc123ef/download', 'inkitt_batch_abc123ef.zip');

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(clickedHref).toBe('http://localhost:8000/api/download/download-token');
    expect(clickedDownloadAttribute).toBeNull();
    expect(clickedTarget).toBe('_self');
    expect(statusCalls).toBe(1);
  });
});
