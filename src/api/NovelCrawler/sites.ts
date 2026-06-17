import { apiFetch } from '../client';
import type {
  SiteDetectResponse,
  SiteInfoResponse,
  ChapterListResponse,
  BinarySearchTotalResponse,
} from '../types';

export async function detectSite(url: string, options?: { signal?: AbortSignal }): Promise<SiteDetectResponse> {
  return apiFetch<SiteDetectResponse>(`/api/sites/detect?url=${encodeURIComponent(url)}`, { timeout: 90000, signal: options?.signal });
}

export async function listSites(): Promise<SiteInfoResponse[]> {
  return apiFetch<SiteInfoResponse[]>('/api/sites');
}

export async function getNovelChapters(url: string): Promise<ChapterListResponse> {
  return apiFetch<ChapterListResponse>(
    `/api/sites/chapters?url=${encodeURIComponent(url)}`,
    { timeout: 90000 }
  );
}

export async function getBinarySearchTotal(url: string): Promise<BinarySearchTotalResponse> {
  return apiFetch<BinarySearchTotalResponse>(
    `/api/sites/chapters/total?url=${encodeURIComponent(url)}`,
    { timeout: 15000 }
  );
}
