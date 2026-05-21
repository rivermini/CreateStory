// Centralized API client for the Novel Crawler API.
// All fetch() calls go through here — no fetch() in components.

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

// ── Shared constants ──────────────────────────────────────────────────────────
// These are the same values used in ConfigModal.tsx and DriveSyncPage.tsx.
// Update VITE_MAIN_BE_URL in .env to change the API base URL everywhere.
export const MAIN_BE_URL = import.meta.env.VITE_MAIN_BE_URL;
export const FIXED_JSON_PREFIX = 'credentials/';

type FetchOptions = RequestInit & { timeout?: number };

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
    });

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.detail ?? message;
      } catch { /* ignore */ }
      throw new Error(message);
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Site detection
// ---------------------------------------------------------------------------

export interface SiteInfoResponse {
  config_name: string;
  site_name: string;
  base_url: string;
  rate_limit: number;
}

export interface SiteDetectResponse {
  site: SiteInfoResponse | null;
  slug: string | null;
  valid: boolean;
  message: string;
  story_title?: string | null;
  resolved_url?: string | null;
  chapter_count?: number | null;
  chapters?: ChapterEntry[] | null;
  /** Rich metadata for Wattpad stories (null for other sites) */
  novel_metadata?: NovelMetadata | null;
}

export async function detectSite(url: string): Promise<SiteDetectResponse> {
  return apiFetch<SiteDetectResponse>(`/api/sites/detect?url=${encodeURIComponent(url)}`);
}

export async function listSites(): Promise<SiteInfoResponse[]> {
  return apiFetch<SiteInfoResponse[]>('/api/sites');
}

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------

export interface CrawlRequest {
  spider_name: string;
  site_name: string;
  novel: string;
  limit: number;
  output_format: 'jsonl' | 'txt';
  chapter_range?: string;
  novel_name?: string;
  completed?: boolean;
  combine_chapters?: boolean;
}

export interface ActiveCrawl {
  crawl_id: string;
  status: string;
  chapters_crawled: number;
  chapters_total: number;
  current_title: string;
  error_message: string;
  started_at: string | null;
  finished_at: string | null;
  novel_name?: string | null;
}

export interface CrawlStartResponse {
  crawl_id: string;
  status: string;
}

export interface CrawlCancelResponse {
  crawl_id: string;
  cancelled: boolean;
}

export interface ProgressUpdate {
  chapters_crawled: number;
  chapters_total: number;
  current_title: string;
  status: string;
  error_message?: string;
}

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

export async function cancelCrawl(crawlId: string): Promise<CrawlCancelResponse> {
  return apiFetch<CrawlCancelResponse>(`/api/crawl/cancel?crawl_id=${encodeURIComponent(crawlId)}`, {
    method: 'DELETE',
  });
}

export interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'error' | 'warning' | 'debug';
}

export interface CrawlStatusWithLogs {
  progress: ProgressUpdate;
  log_lines: LogEntry[];
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

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface OutputFile {
  filename: string;
  size_bytes: number;
  chapter_number: number;
}

export interface NovelMetadata {
  source_url?: string;
  title?: string;
  /** Single author username (from detect endpoint) */
  author?: string;
  /** Multiple authors (from crawl result) */
  authors?: string[];
  author_fullname?: string;
  author_avatar?: string;
  cover_url?: string;
  description?: string;
  chapter_count?: number;
  views?: number;
  stars?: number;
  comment_count?: number;
  num_parts?: number;
  tags?: string[];
  language?: { id: number; name: string };
  completed?: boolean;
  mature?: boolean;
  is_paywalled?: boolean;
  paid_model?: string;
  season_current?: number;
  season_total?: number;
}

export interface CrawlResult {
  crawl_id: string;
  status: string;
  spider_name: string;
  novel_slug: string;
  novel_name?: string;
  chapters_crawled: number;
  chapters_total: number;
  started_at: string | null;
  finished_at: string | null;
  error_message: string;
  output_files: OutputFile[];
  novel_metadata?: NovelMetadata | null;
  /** Only present in combined result responses */
  chapter_count?: number;
  /** Only present in combined result responses */
  chapters?: unknown[];
  /** Only present in combined result responses (TXT format) */
  combined_txt_file?: string | null;
  /** Only present in combined result responses (TXT format) */
  txt_content?: string;
}

export async function getCrawlResult(crawlId: string, timeout?: number): Promise<CrawlResult> {
  return apiFetch<CrawlResult>(`/api/results/${encodeURIComponent(crawlId)}`, timeout ? { timeout } : {});
}

export interface FilePreview {
  filename: string;
  preview: string;
  total_lines: number;
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

export interface CrawlSessionSummary {
  crawl_id: string;
  status: string;
  spider_name: string;
  novel_name: string;
  chapters_crawled: number;
  chapters_total: number;
  started_at: string | null;
  finished_at: string | null;
  error_message: string;
  output_files: OutputFile[];
  novel_metadata?: NovelMetadata | null;
  combined_file: string | null;
  combined_txt_file?: string | null;
  output_format?: string;
}

export async function listAllResults(): Promise<CrawlSessionSummary[]> {
  return apiFetch<CrawlSessionSummary[]>('/api/results');
}

export interface CombineResponse {
  crawl_id: string;
  combined_file: string;
  combined_txt_file?: string | null;
  size_bytes: number;
  chapter_count: number;
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
    `/api/results/delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crawl_ids: crawlIds }),
    }
  );
}

// ---------------------------------------------------------------------------
// Novel chapter list
// ---------------------------------------------------------------------------

export interface ChapterEntry {
  chapter_number: number;
  title: string;
  url: string;
}

/** Format a raw number for display: 21369584 -> "21.4M", 511542 -> "511.5K", 59 -> "59" */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export interface ChapterListResponse {
  valid: boolean;
  reason?: string | null;
  message: string;
  story_title?: string | null;
  chapter_count: number;
  total_chapter_count?: number | null;
  chapters: ChapterEntry[];
  warning?: string | null;
}

export async function getNovelChapters(url: string): Promise<ChapterListResponse> {
  return apiFetch<ChapterListResponse>(
    `/api/sites/chapters?url=${encodeURIComponent(url)}`,
    { timeout: 90000 }
  );
}


// ---------------------------------------------------------------------------
// Drive Sync — Google Drive folder browsing + test sync
// ---------------------------------------------------------------------------

export interface DriveSyncConfig {
  folder_id: string;
  enabled: boolean;
  main_be_api_base_url: string;
  main_category_id: string;
}

export interface DriveFolderEntry {
  id: string;
  name: string;
  prefix: string;
  display_name: string;
  is_completed: boolean;
  is_valid_format: boolean;
  has_chapter_duplicates: boolean;
  validation_errors: string[];
  chapter_count: number | null;
  extended_chapter_count: number | null;
  modified_time: string | null;
}

export interface DriveFolderListResponse {
  folders: DriveFolderEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface DriveChapterPreview {
  file_name: string;
  index: number;
  title: string;
  content_preview: string;
  content_length: number;
  download_error: boolean;
}

export interface DriveStoryPreview {
  folder_id: string;
  folder_name: string;
  prefix: string;
  display_name: string;
  is_completed: boolean;
  chapter_count: number;
  modified_time: string | null;
  chapters: DriveChapterPreview[];
}

export interface DriveSyncStatus {
  last_sync_at: string | null;
  stories_found: number;
  stories_created: number;
  chapters_added: number;
  errors: string[];
  enabled: boolean;
}

export interface DriveSyncProgressResponse {
  status: DriveSyncStatus;
  current_sync_id: string | null;
  log: DriveSyncLogEntry[];
}

export interface DriveSyncLogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'warning';
  message: string;
  story_name: string | null;
}

export interface DriveSyncTriggerResponse {
  message: string;
  sync_id: string;
  stories_found: number;
}

export interface InitDriveSyncRequest {
  folder_id: string;
  service_account_json_path: string;
  main_be_api_base_url: string;
  main_be_user_id: string;
  main_category_id?: string;
  main_be_bearer_token?: string;
}

export interface DriveSyncUpdateRequest {
  enabled?: boolean;
  main_category_id?: string;
}

export async function getDriveSyncConfig(): Promise<DriveSyncConfig | null> {
  return apiFetch<DriveSyncConfig | null>('/api/drive-sync/config');
}

export async function initDriveSyncConfig(req: InitDriveSyncRequest): Promise<DriveSyncConfig> {
  return apiFetch<DriveSyncConfig>('/api/drive-sync/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function updateDriveSyncConfig(req: DriveSyncUpdateRequest): Promise<DriveSyncConfig> {
  return apiFetch<DriveSyncConfig>('/api/drive-sync/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function listDriveFolders(options: { limit?: number; offset?: number; counts?: boolean } = {}): Promise<DriveFolderListResponse> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.counts) params.set('counts', 'true');
  const qs = params.toString();
  return apiFetch<DriveFolderListResponse>(
    `/api/drive-sync/folders${qs ? `?${qs}` : ''}`,
    { timeout: 60000 }
  );
}

export async function previewDriveStory(folderId: string): Promise<DriveStoryPreview> {
  return apiFetch<DriveStoryPreview>(
    `/api/drive-sync/folders/${encodeURIComponent(folderId)}/preview`,
    { timeout: 60000 }
  );
}

export async function getDriveSyncStatus(): Promise<DriveSyncProgressResponse> {
  return apiFetch<DriveSyncProgressResponse>('/api/drive-sync/status');
}

export async function triggerDriveSync(): Promise<DriveSyncTriggerResponse> {
  return apiFetch<DriveSyncTriggerResponse>('/api/drive-sync/trigger', {
    method: 'POST',
    timeout: 15000,
  });
}

export async function syncSingleDriveFolder(folderId: string): Promise<{ success: boolean; message: string }> {
  return apiFetch<{ success: boolean; message: string }>(
    `/api/drive-sync/folders/${encodeURIComponent(folderId)}/sync`,
    { method: 'POST', timeout: 60000 }
  );
}

export interface ServerStoryRef {
  id: string;
  title: string;
  maxChapter: number;
}

export interface CheckUploadableResponse {
  drive_folders: DriveFolderEntry[];
  server_stories: ServerStoryRef[];
  uploadable: DriveFolderEntry[];
  already_on_server: DriveFolderEntry[];
  invalid: DriveFolderEntry[];
}

export interface UpdatableStoryEntry {
  folder: DriveFolderEntry;
  server_story: ServerStoryRef;
}

export interface CheckUpdatableResponse {
  all_extended_folders: DriveFolderEntry[];
  server_stories: ServerStoryRef[];
  updatable: UpdatableStoryEntry[];
  no_update_needed: UpdatableStoryEntry[];
  invalid: UpdatableStoryEntry[];
}

export interface UpdateChapterCountResponse {
  success: boolean;
  message: string;
}

export async function checkUploadable(): Promise<CheckUploadableResponse> {
  return apiFetch<CheckUploadableResponse>('/api/drive-sync/check-uploadable', { timeout: 120000 });
}

export async function checkUpdatable(): Promise<CheckUpdatableResponse> {
  return apiFetch<CheckUpdatableResponse>('/api/drive-sync/check-updatable', { timeout: 120000 });
}

export interface UpdateChapterCountResponse {
  success: boolean;
  message: string;
}

export async function updateChapterCount(storyId: string, maxChapter: number): Promise<UpdateChapterCountResponse> {
  return apiFetch<UpdateChapterCountResponse>('/api/drive-sync/update-chapter-count', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_id: storyId, max_chapter: maxChapter }),
    timeout: 30000,
  });
}

export interface UpdateChaptersResponse {
  id: string;
  status: string;
  message: string;
}

export async function updateChapters(folderId: string): Promise<UpdateChaptersResponse> {
  return apiFetch<UpdateChaptersResponse>(`/api/drive-sync/update-chapters/${folderId}`, {
    method: 'POST',
    timeout: 300000,
  });
}

// ---------------------------------------------------------------------------
// Drive Sync — Job system
// ---------------------------------------------------------------------------

/** Client-side tracking of an enqueued job */
export interface TrackedJob {
  jobId: string;
  folderId: string;
  displayName: string;
}

export interface SyncJob {
  id: string;
  kind: 'upload_single' | 'update_single';
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled';
  folder_id: string;
  folder_name: string;
  display_name: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result_message: string | null;
  chapters_added: number;
  chapters_skipped: number;
  error: string | null;
  logs: JobLogEntry[];
}

export interface JobLogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
}

export interface JobCreateRequest {
  kind: 'upload_single' | 'update_single';
  folder_id: string;
  folder_name: string;
  display_name: string;
}

export interface JobCreateResponse {
  id: string;
  status: string;
  message: string;
}

export interface JobListResponse {
  jobs: SyncJob[];
  total: number;
}

export interface JobResponse {
  job: SyncJob;
}

export async function createJob(req: JobCreateRequest): Promise<JobCreateResponse> {
  return apiFetch<JobCreateResponse>('/api/drive-sync/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function listJobs(limit = 100, offset = 0): Promise<JobListResponse> {
  return apiFetch<JobListResponse>(
    `/api/drive-sync/jobs?limit=${limit}&offset=${offset}`,
    { timeout: 15000 }
  );
}

export async function getJob(jobId: string): Promise<JobResponse> {
  return apiFetch<JobResponse>(
    `/api/drive-sync/jobs/${encodeURIComponent(jobId)}`,
    { timeout: 15000 }
  );
}

export async function deleteJob(jobId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(
    `/api/drive-sync/jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' }
  );
}

// ---------------------------------------------------------------------------
// Main BE direct calls (for upload check / chapter update features)
// ---------------------------------------------------------------------------

export interface MainBeStory {
  id: string;
  title: string;
  maxChapter: number;
}

const MAIN_BE_TOKEN = import.meta.env.VITE_MAIN_BE_TOKEN ?? '';

export async function getServerStories(): Promise<MainBeStory[]> {
  const stories: MainBeStory[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${MAIN_BE_URL}/api/v1/story?page=${page}&limit=100`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${MAIN_BE_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch server stories: HTTP ${res.status}`);
    }
    const data = await res.json() as { data: { page: number; totalPages: number; items: { id: string; title: string; maxChapter: number }[] } };
    stories.push(...data.data.items);
    totalPages = data.data.totalPages;
    page++;
  }

  return stories;
}

export async function updateServerStoryMaxChapter(storyId: string, maxChapter: number): Promise<void> {
  const url = `${MAIN_BE_URL}/api/v1/story/${storyId}`;
  const userId = '3b2fae40-e482-4ea1-af7a-96e35ecfbf5f';
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${MAIN_BE_TOKEN}`,
      'x-user-id': userId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ maxChapter }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to update story maxChapter: HTTP ${res.status} — ${body}`);
  }
}
