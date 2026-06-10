import { apiFetch, clearAuth, storeAuth, getStoredRefreshToken, AUTH_USER_KEY } from './client';
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
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  return user;
}
