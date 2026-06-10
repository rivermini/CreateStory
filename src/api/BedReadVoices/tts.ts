import { apiFetch, withAccessToken, BASE_URL } from '../client';
import type {
  TTSVoice,
  TTSLanguage,
  TTSJob,
  SpeakRequest,
  SpeakResponse,
} from '../types';

export async function getVoices(): Promise<TTSVoice[]> {
  return apiFetch<TTSVoice[]>('/api/tts/voices');
}

export async function getLanguages(): Promise<TTSLanguage[]> {
  return apiFetch<TTSLanguage[]>('/api/tts/languages');
}

export async function startSpeak(request: SpeakRequest): Promise<SpeakResponse> {
  return apiFetch<SpeakResponse>('/api/tts/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    timeout: 15000,
  });
}

export async function getTTSJob(jobId: string): Promise<TTSJob> {
  return apiFetch<TTSJob>(`/api/tts/jobs/${encodeURIComponent(jobId)}`);
}

export async function cancelTTSJob(jobId: string): Promise<{ job_id: string; status: string }> {
  return apiFetch<{ job_id: string; status: string }>(
    `/api/tts/jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' }
  );
}

export function getTTSAudioUrl(jobId: string): string {
  return withAccessToken(`${BASE_URL}/api/tts/jobs/${encodeURIComponent(jobId)}/audio`);
}

export async function getTTSQueue(): Promise<{
  concurrency: number;
  active_workers: number;
  queue_size: number;
  currently_processing: TTSJob[];
  queued: TTSJob[];
}> {
  return apiFetch('/api/tts/queue');
}

export async function listTTSJobs(): Promise<TTSJob[]> {
  return apiFetch<TTSJob[]>('/api/tts/jobs');
}
