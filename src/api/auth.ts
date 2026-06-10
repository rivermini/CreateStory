import { apiFetch, clearAuth, storeAuth } from './client';
import type { AuthTokensResponse } from './types';

export async function login(email: string, password: string): Promise<AuthTokensResponse> {
  const tokens = await apiFetch<AuthTokensResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, false);
  storeAuth(tokens);
  return tokens;
}

export async function register(email: string, password: string): Promise<AuthTokensResponse> {
  const tokens = await apiFetch<AuthTokensResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, false);
  storeAuth(tokens);
  return tokens;
}

export async function logout(): Promise<void> {
  const { getStoredRefreshToken } = await import('./client');
  const refreshToken = getStoredRefreshToken();
  if (refreshToken) {
    try {
      await apiFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }, false);
    } catch {
      // Best effort only; local auth state is cleared either way.
    }
  }
  clearAuth();
}

export async function getCurrentUser(): Promise<import('./types').AuthUser> {
  const user = await apiFetch<import('./types').AuthUser>('/api/auth/me');
  const { AUTH_USER_KEY } = await import('./client');
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  return user;
}
