// Core API client infrastructure. All fetch() calls go through here.

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export const FIXED_JSON_PREFIX = 'db://external_credentials/';

export const ACCESS_TOKEN_KEY = 'create_story_access_token';
export const REFRESH_TOKEN_KEY = 'create_story_refresh_token';
export const AUTH_USER_KEY = 'create_story_auth_user';
export const AUTH_SESSION_EXPIRED_EVENT = 'create-story:auth-session-expired';

type FetchOptions = RequestInit & { timeout?: number };

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
}

export { storeAuth };

export function clearAuth() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

export function expireAuthSession() {
  clearAuth();
  window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
}

function authHeaders(existing?: HeadersInit): Headers {
  const headers = new Headers(existing);
  const token = getStoredAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;
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

async function requestWithAuth(path: string, fetchOptions: RequestInit, signal: AbortSignal): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...fetchOptions,
    headers: authHeaders(fetchOptions.headers),
    signal,
  });
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}, allowRetry = true): Promise<T> {
  const { timeout = 10000, signal, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const hadAuthSession = Boolean(getStoredAccessToken() || getStoredRefreshToken());

  try {
    let res = await requestWithAuth(path, fetchOptions, signal ?? controller.signal);

    if (res.status === 401 && allowRetry && await refreshAccessToken()) {
      res = await requestWithAuth(path, fetchOptions, signal ?? controller.signal);
    }

    if (res.status === 401 && hadAuthSession) {
      expireAuthSession();
    }

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.detail ?? message;
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
 * Uses fetch + Blob to avoid exposing the token in the URL.
 */
export async function downloadWithAuth(url: string, filename: string): Promise<void> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const hadAuthSession = Boolean(getStoredAccessToken() || getStoredRefreshToken());
  if (!hadAuthSession) throw new Error('Not authenticated');

  const request = () => fetch(url, {
    ...options,
    headers: authHeaders(options.headers),
  });

  let res = await request();
  if (res.status === 401 && await refreshAccessToken()) {
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
