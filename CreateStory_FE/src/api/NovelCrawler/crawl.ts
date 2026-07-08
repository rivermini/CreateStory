import { apiFetch } from '../client';
import type {
  CrawlRequest,
  CrawlStartResponse,
  CrawlCancelResponse,
  InkittCookieUpdateResponse,
  InkittCookieStatusResponse,
  ScribbleHubCookieUpdateResponse,
  ScribbleHubCookieStatusResponse,
  GoodNovelCookieUpdateResponse,
  GoodNovelCookieStatusResponse,
  WebNovelCookieUpdateResponse,
  WebNovelCookieStatusResponse,
  GoodNovelBatchCrawlRequest,
  GoodNovelBatchRowsResponse,
  GoodNovelBatchScanRequest,
  GoodNovelBatchSummary,
  InkittBatchCrawlRequest,
  InkittBatchRowsResponse,
  InkittBatchStartRequest,
  InkittBatchSummary,
  CrawlStatusWithLogs,
  ProgressUpdate,
  ActiveCrawl,
} from '../types';

export async function startCrawl(request: CrawlRequest): Promise<CrawlStartResponse> {
  return apiFetch<CrawlStartResponse>('/api/crawl/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export async function startBatchCrawl(requests: CrawlRequest[]): Promise<CrawlStartResponse[]> {
  return apiFetch<CrawlStartResponse[]>('/api/crawl/start-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
  });
}

export async function updateInkittCookies(cookies: string, userAgent?: string): Promise<InkittCookieUpdateResponse> {
  return apiFetch<InkittCookieUpdateResponse>('/api/crawl/inkitt-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies, user_agent: userAgent }),
  });
}

export async function checkInkittCookies(storyUrl?: string): Promise<InkittCookieStatusResponse> {
  return apiFetch<InkittCookieStatusResponse>('/api/crawl/inkitt-cookies/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_url: storyUrl }),
    timeout: 45000,
  });
}

export async function updateScribblehubCookies(
  cookies: string,
  userAgent?: string,
): Promise<ScribbleHubCookieUpdateResponse> {
  return apiFetch<ScribbleHubCookieUpdateResponse>('/api/crawl/scribblehub-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies, user_agent: userAgent }),
  });
}

export async function checkScribblehubCookies(storyUrl?: string): Promise<ScribbleHubCookieStatusResponse> {
  return apiFetch<ScribbleHubCookieStatusResponse>('/api/crawl/scribblehub-cookies/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_url: storyUrl }),
    timeout: 45000,
  });
}

export async function updateGoodnovelCookies(
  cookies: string,
  userAgent?: string,
): Promise<GoodNovelCookieUpdateResponse> {
  return apiFetch<GoodNovelCookieUpdateResponse>('/api/crawl/goodnovel-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies, user_agent: userAgent }),
  });
}

export async function checkGoodnovelCookies(storyUrl?: string): Promise<GoodNovelCookieStatusResponse> {
  return apiFetch<GoodNovelCookieStatusResponse>('/api/crawl/goodnovel-cookies/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_url: storyUrl }),
    timeout: 60000,
  });
}

export async function updateWebnovelCookies(
  cookies: string,
  userAgent?: string,
): Promise<WebNovelCookieUpdateResponse> {
  return apiFetch<WebNovelCookieUpdateResponse>('/api/crawl/webnovel-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies, user_agent: userAgent }),
  });
}

export async function checkWebnovelCookies(storyUrl?: string): Promise<WebNovelCookieStatusResponse> {
  return apiFetch<WebNovelCookieStatusResponse>('/api/crawl/webnovel-cookies/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_url: storyUrl }),
    timeout: 60000,
  });
}

export async function startGoodnovelBatchScan(
  request: GoodNovelBatchScanRequest,
): Promise<GoodNovelBatchSummary> {
  return apiFetch<GoodNovelBatchSummary>('/api/crawl/goodnovel-batch/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    timeout: 60000,
  });
}

export async function listGoodnovelBatches(): Promise<GoodNovelBatchSummary[]> {
  return apiFetch<GoodNovelBatchSummary[]>('/api/crawl/goodnovel-batch');
}

export async function getGoodnovelBatchStatus(batchId: string): Promise<GoodNovelBatchSummary> {
  return apiFetch<GoodNovelBatchSummary>(`/api/crawl/goodnovel-batch/${encodeURIComponent(batchId)}`);
}

export async function getGoodnovelBatchRows(
  batchId: string,
  options: { offset?: number; limit?: number; status?: string } = {},
): Promise<GoodNovelBatchRowsResponse> {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 100),
    status: options.status ?? 'all',
  });
  return apiFetch<GoodNovelBatchRowsResponse>(
    `/api/crawl/goodnovel-batch/${encodeURIComponent(batchId)}/rows?${params.toString()}`
  );
}

export async function removeGoodnovelBatch(batchId: string): Promise<{ deleted: boolean; batch_id: string }> {
  return apiFetch<{ deleted: boolean; batch_id: string }>(
    `/api/crawl/goodnovel-batch/${encodeURIComponent(batchId)}`,
    { method: 'DELETE' },
  );
}

export async function startGoodnovelBatchCrawl(
  batchId: string,
  request: GoodNovelBatchCrawlRequest,
): Promise<GoodNovelBatchSummary> {
  return apiFetch<GoodNovelBatchSummary>(`/api/crawl/goodnovel-batch/${encodeURIComponent(batchId)}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    timeout: 60000,
  });
}

export async function startInkittBatch(request: InkittBatchStartRequest): Promise<InkittBatchSummary> {
  return apiFetch<InkittBatchSummary>('/api/crawl/inkitt-batch/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    timeout: 60000,
  });
}

export async function crawlInkittBatch(batchId: string, request: InkittBatchCrawlRequest): Promise<InkittBatchSummary> {
  return apiFetch<InkittBatchSummary>(`/api/crawl/inkitt-batch/${encodeURIComponent(batchId)}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    timeout: 60000,
  });
}

export async function pauseInkittBatch(batchId: string): Promise<InkittBatchSummary> {
  return apiFetch<InkittBatchSummary>(`/api/crawl/inkitt-batch/${encodeURIComponent(batchId)}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    timeout: 60000,
  });
}

export async function listInkittBatches(): Promise<InkittBatchSummary[]> {
  return apiFetch<InkittBatchSummary[]>('/api/crawl/inkitt-batch');
}

export async function getInkittBatchStatus(batchId: string): Promise<InkittBatchSummary> {
  return apiFetch<InkittBatchSummary>(`/api/crawl/inkitt-batch/${encodeURIComponent(batchId)}`);
}

export async function getInkittBatchRows(
  batchId: string,
  options: { offset?: number; limit?: number; status?: string } = {},
): Promise<InkittBatchRowsResponse> {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 100),
    status: options.status ?? 'all',
  });
  return apiFetch<InkittBatchRowsResponse>(
    `/api/crawl/inkitt-batch/${encodeURIComponent(batchId)}/rows?${params.toString()}`
  );
}

export async function removeInkittBatch(batchId: string): Promise<{ deleted: boolean; batch_id: string }> {
  return apiFetch<{ deleted: boolean; batch_id: string }>(
    `/api/crawl/inkitt-batch/${encodeURIComponent(batchId)}`,
    { method: 'DELETE' },
  );
}

export async function cancelCrawl(crawlId: string): Promise<CrawlCancelResponse> {
  return apiFetch<CrawlCancelResponse>(`/api/crawl/cancel?crawl_id=${encodeURIComponent(crawlId)}`, {
    method: 'DELETE',
  });
}

export async function getCrawlStatusWithLogs(crawlId: string): Promise<CrawlStatusWithLogs> {
  return apiFetch<CrawlStatusWithLogs>(`/api/crawl/status/${encodeURIComponent(crawlId)}`);
}

export async function getCrawlStatus(crawlId: string): Promise<ProgressUpdate> {
  return apiFetch<ProgressUpdate>(`/api/crawl/status?crawl_id=${encodeURIComponent(crawlId)}`);
}

export async function getActiveCrawls(): Promise<ActiveCrawl[]> {
  return apiFetch<ActiveCrawl[]>('/api/crawl/active');
}
