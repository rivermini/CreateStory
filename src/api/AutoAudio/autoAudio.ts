import { apiFetch } from '../client';
import type {
  AutoAudioSession,
  AutoAudioHistoryEntry,
  AutoAudioPauseResponse,
  AutoScanState,
} from '../types';

export async function startAutoAudio(cfg: { phase: string; test_mode: boolean; voice?: string; limit?: number }): Promise<{ session_id: string }> {
  return apiFetch<{ session_id: string }>('/api/auto-audio/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
}

export async function getAutoAudioStatus(options: { compact?: boolean; logLimit?: number; resultLimit?: number } = {}): Promise<AutoAudioSession | null> {
  const params = new URLSearchParams();
  if (options.compact) params.set('compact', 'true');
  if (options.logLimit !== undefined) params.set('log_limit', String(options.logLimit));
  if (options.resultLimit !== undefined) params.set('result_limit', String(options.resultLimit));
  const qs = params.toString();
  return apiFetch<AutoAudioSession | null>(`/api/auto-audio/status${qs ? '?' + qs : ''}`);
}

export async function stopAutoAudio(): Promise<void> {
  await apiFetch('/api/auto-audio/stop', { method: 'POST' });
}

export async function getAutoScanState(): Promise<AutoScanState> {
  return apiFetch<AutoScanState>('/api/auto-audio/auto-scan');
}

export async function updateAutoScan(body: {
  enabled?: boolean;
  interval_hours?: number;
  chapter_threshold?: number;
}): Promise<AutoScanState> {
  return apiFetch<AutoScanState>('/api/auto-audio/auto-scan', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function runAutoScanNow(): Promise<{ session_id: string }> {
  return apiFetch<{ session_id: string }>('/api/auto-audio/auto-scan/run-now', { method: 'POST' });
}

export async function pauseAutoAudio(): Promise<AutoAudioPauseResponse> {
  return apiFetch<AutoAudioPauseResponse>('/api/auto-audio/pause', { method: 'POST' });
}

export async function resumeAutoAudio(): Promise<AutoAudioPauseResponse> {
  return apiFetch<AutoAudioPauseResponse>('/api/auto-audio/resume', { method: 'POST' });
}

export async function getAutoAudioHistory(): Promise<AutoAudioHistoryEntry[]> {
  return apiFetch<AutoAudioHistoryEntry[]>('/api/auto-audio/history');
}

export async function getAutoAudioSession(sessionId: string): Promise<AutoAudioSession> {
  return apiFetch<AutoAudioSession>(`/api/auto-audio/history/${encodeURIComponent(sessionId)}`);
}

export async function removeAutoAudioSession(sessionId: string): Promise<{ deleted: boolean; session_id: string }> {
  return apiFetch<{ deleted: boolean; session_id: string }>(
    `/api/auto-audio/history/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  );
}

export async function removeAutoAudioSessions(sessionIds: string[]): Promise<{ deleted: number; requested: number }> {
  return apiFetch<{ deleted: number; requested: number }>(
    '/api/auto-audio/history/batch-delete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_ids: sessionIds }),
    }
  );
}
