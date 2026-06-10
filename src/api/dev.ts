import { apiFetch, clearAuth } from './client';
import type { ClearBackendDataResponse } from './types';

export async function clearBackendData(): Promise<ClearBackendDataResponse> {
  const result = await apiFetch<ClearBackendDataResponse>('/api/dev/clear-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'CLEAR_BACKEND_DATA' }),
    timeout: 120000,
  });
  clearAuth();
  return result;
}
