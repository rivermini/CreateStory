import { apiFetch } from './client';
import type { SettingsResponse } from './types';

export async function getSettings(): Promise<SettingsResponse> {
  return apiFetch<SettingsResponse>('/api/settings');
}

export async function updateSettings(patch: Partial<Omit<SettingsResponse, never>>): Promise<SettingsResponse> {
  return apiFetch<SettingsResponse>('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}
