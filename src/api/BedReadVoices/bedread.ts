import { apiFetch, BASE_URL } from '../client';
import type {
  BedReadStory,
  BedReadStorySearchParams,
  BedReadStorySearchResponse,
  BedReadChapter,
  BatchJob,
  BatchGenerateRequest,
  BatchGenerateResponse,
} from '../types';

export async function getBedReadStories(): Promise<BedReadStory[]> {
  return apiFetch<BedReadStory[]>('/api/bedread/stories');
}

export async function searchBedReadStories(params: BedReadStorySearchParams): Promise<BedReadStorySearchResponse> {
  const searchParams = new URLSearchParams();

  if (params.keyword) searchParams.set('keyword', params.keyword);
  if (params.status && params.status !== 'all') searchParams.set('status', params.status);
  if (params.sort) searchParams.set('sort', params.sort);
  if (params.minChapters !== undefined) searchParams.set('minchapters', String(params.minChapters));
  if (params.publishedWithin !== undefined) searchParams.set('publishedWithin', String(params.publishedWithin));
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.categories && params.categories.length > 0) {
    params.categories.forEach(cat => searchParams.append('categories', cat));
  }

  return apiFetch<BedReadStorySearchResponse>(`/api/bedread/stories/search?${searchParams.toString()}`, { timeout: 30000 });
}

export async function getBedReadChapters(storyId: string, userId?: string): Promise<BedReadChapter[]> {
  return apiFetch<BedReadChapter[]>(
    `/api/bedread/stories/${encodeURIComponent(storyId)}/chapters`,
    userId ? { headers: { 'x-user-id': userId } } : {}
  );
}

export async function startBatchGenerate(request: BatchGenerateRequest, userId?: string): Promise<BatchGenerateResponse> {
  return apiFetch<BatchGenerateResponse>('/api/bedread/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {}),
    },
    body: JSON.stringify(request),
    timeout: 30000,
  });
}

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
