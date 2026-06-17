import { apiFetch, BASE_URL } from '../client';
import type {
  CrawlResult,
  FilePreview,
  CrawlSessionSummary,
  CombineResponse,
} from '../types';

export async function getCrawlResult(crawlId: string, timeout?: number): Promise<CrawlResult> {
  return apiFetch<CrawlResult>(`/api/results/${encodeURIComponent(crawlId)}`, timeout ? { timeout } : {});
}

export async function previewFile(crawlId: string, filename: string): Promise<FilePreview> {
  return apiFetch<FilePreview>(
    `/api/results/${encodeURIComponent(crawlId)}/preview?filename=${encodeURIComponent(filename)}`
  );
}

export async function getFileContent(crawlId: string, filename: string): Promise<{ content: string }> {
  return apiFetch<{ content: string }>(
    `/api/results/${encodeURIComponent(crawlId)}/content?filename=${encodeURIComponent(filename)}`
  );
}

export function getDownloadUrl(crawlId: string, filename: string): string {
  return `${BASE_URL}/api/results/${encodeURIComponent(crawlId)}/download?filename=${encodeURIComponent(filename)}`;
}

export function getDownloadAllUrl(crawlId: string): string {
  return `${BASE_URL}/api/results/${encodeURIComponent(crawlId)}/download-all`;
}

export function getDownloadAllSessionsUrl(): string {
  return `${BASE_URL}/api/results/download-all`;
}

export function getDownloadCombinedUrl(crawlId: string, filename: string): string {
  return `${BASE_URL}/api/results/${encodeURIComponent(crawlId)}/download?filename=${encodeURIComponent(filename)}`;
}

export function getDownloadAllCombinedUrl(): string {
  return `${BASE_URL}/api/results/download-combined-all`;
}

export async function listAllResults(): Promise<CrawlSessionSummary[]> {
  return apiFetch<CrawlSessionSummary[]>('/api/results');
}

export async function combineChapters(crawlId: string): Promise<CombineResponse> {
  return apiFetch<CombineResponse>(
    `/api/results/${encodeURIComponent(crawlId)}/combine`,
    { method: 'POST' }
  );
}

export async function getCombinedResult(crawlId: string, timeout?: number): Promise<CrawlResult> {
  return apiFetch<CrawlResult>(
    `/api/results/${encodeURIComponent(crawlId)}/combined`,
    timeout ? { timeout } : {}
  );
}

export async function deleteCrawlSessions(crawlIds: string[]): Promise<{ deleted_count: number }> {
  return apiFetch<{ deleted_count: number }>(
    '/api/results/delete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crawl_ids: crawlIds }),
    }
  );
}
