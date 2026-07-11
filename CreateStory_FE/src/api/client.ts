// Core API client infrastructure. All fetch() calls go through here.

// API base URL. In deployed environments the API is SAME-ORIGIN: the frontend
// nginx reverse-proxies /api to the gateway, so ONE build works everywhere and a
// single Cloudflare Access login covers both the UI and the API (no CORS, no
// service token, gateway never exposed on its own public hostname).
//   deployed (any host)   -> "" (relative: /api/... is proxied by nginx)
//   localhost / 127.0.0.1 -> http://localhost:8000 (Vite dev talks to the gateway)
// A build-time VITE_API_BASE_URL still overrides, if you ever need to pin it.
function resolveApiBaseUrl(): string {
  const override = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (override) return override.replace(/\/+$/, '');
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  if (host === 'localhost' || host === '127.0.0.1' || host === '') {
    return 'http://localhost:8000';
  }
  return '';
}

const BASE_URL = resolveApiBaseUrl();

export const FIXED_JSON_PREFIX = 'db://external_credentials/';

export const ACCESS_TOKEN_KEY = 'create_story_access_token';
export const REFRESH_TOKEN_KEY = 'create_story_refresh_token';
export const AUTH_USER_KEY = 'create_story_auth_user';
export const AUTH_SESSION_EXPIRED_EVENT = 'create-story:auth-session-expired';
const AUTH_CHANNEL_NAME = 'create-story-auth';
const AUTH_REFRESH_LOCK = 'create-story-auth-refresh';

type FetchOptions = RequestInit & { timeout?: number };
type AuthBroadcastMessage = { type: 'tokens-replaced' } | { type: 'logout' };
type ApiErrorBody = {
  detail?: unknown;
  message?: unknown;
};
type ValidationErrorDetail = {
  loc?: unknown[];
  msg?: unknown;
};

let refreshPromise: Promise<boolean> | null = null;
let sessionExpiredEmitted = false;
const authChannel = typeof BroadcastChannel === 'undefined'
  ? null
  : new BroadcastChannel(AUTH_CHANNEL_NAME);

export { BASE_URL };

export function getStoredAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredAuthUser(): import('./types').AuthUser | null {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as import('./types').AuthUser;
  } catch {
    return null;
  }
}

function storeAuth(tokens: import('./types').AuthTokensResponse) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(tokens.user));
  sessionExpiredEmitted = false;
  authChannel?.postMessage({ type: 'tokens-replaced' } satisfies AuthBroadcastMessage);
}

export { storeAuth };

export function clearAuth(broadcast = true) {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  if (broadcast) {
    authChannel?.postMessage({ type: 'logout' } satisfies AuthBroadcastMessage);
  }
}

export function expireAuthSession() {
  if (sessionExpiredEmitted) return;
  sessionExpiredEmitted = true;
  clearAuth();
  window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
}

authChannel?.addEventListener('message', (event: MessageEvent<AuthBroadcastMessage>) => {
  if (event.data?.type === 'tokens-replaced') {
    sessionExpiredEmitted = false;
    return;
  }
  if (event.data?.type === 'logout') {
    clearAuth(false);
    if (!sessionExpiredEmitted) {
      sessionExpiredEmitted = true;
      window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    }
  }
});

function authHeaders(existing?: HeadersInit): Headers {
  const headers = new Headers(existing);
  const token = getStoredAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

function formatValidationDetail(detail: ValidationErrorDetail): string {
  const loc = Array.isArray(detail.loc)
    ? detail.loc.filter((part) => part !== 'body').join('.')
    : '';
  const message = typeof detail.msg === 'string' ? detail.msg : JSON.stringify(detail);
  return loc ? `${loc}: ${message}` : message;
}

function formatApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;

  const { detail, message } = body as ApiErrorBody;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object') {
          return formatValidationDetail(item as ValidationErrorDetail);
        }
        return String(item);
      })
      .join('; ');
  }
  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail);
  }
  if (typeof message === 'string') return message;

  return fallback;
}

async function executeRefresh(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      return false;
    }
    const tokens = await res.json() as import('./types').AuthTokensResponse;
    storeAuth(tokens);
    return true;
  } catch {
    return false;
  }
}

async function refreshAccessToken(failedAccessToken: string | null): Promise<boolean> {
  if (failedAccessToken && getStoredAccessToken() !== failedAccessToken) {
    return true;
  }
  if (refreshPromise) return refreshPromise;

  const refreshTokenBeforeLock = getStoredRefreshToken();
  if (!refreshTokenBeforeLock) return false;

  refreshPromise = (async () => {
    const runLocked = async (): Promise<boolean> => {
      const currentRefreshToken = getStoredRefreshToken();
      if (!currentRefreshToken) return false;
      if (
        currentRefreshToken !== refreshTokenBeforeLock
        || (failedAccessToken && getStoredAccessToken() !== failedAccessToken)
      ) {
        return true;
      }
      return executeRefresh(currentRefreshToken);
    };

    if (navigator.locks) {
      return navigator.locks.request(AUTH_REFRESH_LOCK, runLocked);
    }
    return runLocked();
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function requestWithAuth(path: string, fetchOptions: RequestInit, signal: AbortSignal): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...fetchOptions,
    headers: authHeaders(fetchOptions.headers),
    signal,
  });
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}, allowRetry = true): Promise<T> {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const hadAuthSession = Boolean(getStoredAccessToken() || getStoredRefreshToken());

  try {
    const accessTokenUsed = getStoredAccessToken();
    let res = await requestWithAuth(path, fetchOptions, controller.signal);

    if (res.status === 401 && allowRetry && await refreshAccessToken(accessTokenUsed)) {
      res = await requestWithAuth(path, fetchOptions, controller.signal);
    }

    if (res.status === 401 && hadAuthSession) {
      expireAuthSession();
    }

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = formatApiError(body, message);
      } catch { /* ignore */ }
      throw new Error(message);
    }

    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out. The site may be slow or blocking automated requests.', { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads a file from a URL that requires Authorization: Bearer header.
 * Exchanges the path for a short-lived download ticket and triggers a native
 * browser download, then resolves only once the download has actually started:
 * the gateway sets a `cs_download_<ticket>` cookie when the file response
 * begins (large batch exports spend minutes zipping first), so callers can
 * keep their loading state up until the browser download is triggered.
 */
export async function downloadWithAuth(url: string, filename: string): Promise<void> {
  const parsed = new URL(url, window.location.origin);
  const ticket = await apiFetch<{ ticket: string; download_url: string }>('/api/download-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: `${parsed.pathname}${parsed.search}` }),
  });
  const a = document.createElement('a');
  a.href = `${BASE_URL}${ticket.download_url}`;
  a.download = filename;
  a.referrerPolicy = 'no-referrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  await waitForDownloadStart(ticket.ticket);
}

const DOWNLOAD_START_POLL_MS = 500;
const DOWNLOAD_START_TIMEOUT_MS = 30 * 60_000;

function readDownloadMarker(ticket: string): string | null {
  const name = `cs_download_${ticket}=`;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(name));
  return entry ? entry.slice(name.length) : null;
}

function clearDownloadMarker(ticket: string): void {
  document.cookie = `cs_download_${ticket}=; path=/; max-age=0`;
}

/**
 * Resolves when the gateway marks the ticket's download response as started
 * ("1" = file streaming, "error" = server rejected it). Times out silently
 * after 30 minutes so a lost response can never pin the UI forever.
 */
async function waitForDownloadStart(ticket: string): Promise<void> {
  const deadline = Date.now() + DOWNLOAD_START_TIMEOUT_MS;
  for (;;) {
    const marker = readDownloadMarker(ticket);
    if (marker !== null) {
      clearDownloadMarker(ticket);
      if (marker === 'error') {
        throw new Error('The server could not prepare the download.');
      }
      return;
    }
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_START_POLL_MS));
  }
}

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const hadAuthSession = Boolean(getStoredAccessToken() || getStoredRefreshToken());
  if (!hadAuthSession) throw new Error('Not authenticated');

  const request = () => fetch(url, {
    ...options,
    headers: authHeaders(options.headers),
  });

  const accessTokenUsed = getStoredAccessToken();
  let res = await request();
  if (res.status === 401 && await refreshAccessToken(accessTokenUsed)) {
    res = await request();
  }

  if (res.status === 401) {
    expireAuthSession();
  }

  return res;
}

/** Format a raw number for display: 21369584 -> "21.4M", 511542 -> "511.5K", 59 -> "59" */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
