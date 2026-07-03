import { apiFetch, BASE_URL } from '../client';
import type { BatchJob } from '../types';

// Audio-generation job endpoints (back the "Audio Jobs" monitor, which lists
// batch jobs including auto-mode batches produced by Auto Audio). The manual
// story browse/search/generate calls were removed with the manual BedRead page.

export async function getBatchJob(batchId: string): Promise<BatchJob> {
  return apiFetch<BatchJob>(`/api/bedread/jobs/${encodeURIComponent(batchId)}`);
}

export async function cancelBatchJob(batchId: string): Promise<{ batch_id: string; status: string }> {
  return apiFetch<{ batch_id: string; status: string }>(
    `/api/bedread/jobs/${encodeURIComponent(batchId)}`,
    { method: 'DELETE' }
  );
}

export async function listAllBatchJobs(): Promise<BatchJob[]> {
  return apiFetch<BatchJob[]>('/api/bedread/jobs');
}

export async function removeBatchJob(batchId: string): Promise<{ batch_id: string; status: string }> {
  return apiFetch<{ batch_id: string; status: string }>(
    `/api/bedread/jobs/${encodeURIComponent(batchId)}/remove`,
    { method: 'POST' }
  );
}

export function getChapterAudioUrl(batchId: string, chapterNum: number): string {
  return `${BASE_URL}/api/bedread/jobs/${encodeURIComponent(batchId)}/download?chapter=${chapterNum}`;
}

export function getBatchZipUrl(batchId: string): string {
  return `${BASE_URL}/api/bedread/jobs/${encodeURIComponent(batchId)}/zip`;
}
