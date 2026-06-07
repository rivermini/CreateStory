// Centralized API client for the Novel Crawler API.
// All fetch() calls go through here — no fetch() in components.

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export const FIXED_JSON_PREFIX = 'db://external_credentials/';

type FetchOptions = RequestInit & { timeout?: number };

const ACCESS_TOKEN_KEY = 'create_story_access_token';
const REFRESH_TOKEN_KEY = 'create_story_refresh_token';
const AUTH_USER_KEY = 'create_story_auth_user';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

export interface AuthTokensResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUserCreateRequest {
  email: string;
  password: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

export interface AdminUserUpdateRequest {
  email?: string;
  password?: string;
  role?: 'admin' | 'user';
  is_active?: boolean;
}

export function getStoredAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredAuthUser(): AuthUser | null {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function storeAuth(tokens: AuthTokensResponse) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(tokens.user));
}

export function clearAuth() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function authHeaders(existing?: HeadersInit): Headers {
  const headers = new Headers(existing);
  const token = getStoredAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      clearAuth();
      return false;
    }
    const tokens = await res.json() as AuthTokensResponse;
    storeAuth(tokens);
    return true;
  } catch {
    clearAuth();
    return false;
  }
}

async function requestWithAuth(path: string, fetchOptions: RequestInit, signal: AbortSignal): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...fetchOptions,
    headers: authHeaders(fetchOptions.headers),
    signal,
  });
}

async function apiFetch<T>(path: string, options: FetchOptions = {}, allowRetry = true): Promise<T> {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    let res = await requestWithAuth(path, fetchOptions, controller.signal);

    if (res.status === 401 && allowRetry && await refreshAccessToken()) {
      res = await requestWithAuth(path, fetchOptions, controller.signal);
    }

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.detail ?? message;
      } catch { /* ignore */ }
      throw new Error(message);
    }

    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out. The site may be slow or blocking automated requests.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function login(email: string, password: string): Promise<AuthTokensResponse> {
  const tokens = await apiFetch<AuthTokensResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, false);
  storeAuth(tokens);
  return tokens;
}

export async function register(email: string, password: string): Promise<AuthTokensResponse> {
  const tokens = await apiFetch<AuthTokensResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, false);
  storeAuth(tokens);
  return tokens;
}

export async function logout(): Promise<void> {
  const refreshToken = getStoredRefreshToken();
  if (refreshToken) {
    try {
      await apiFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }, false);
    } catch {
      // Best effort only; local auth state is cleared either way.
    }
  }
  clearAuth();
}

export async function getCurrentUser(): Promise<AuthUser> {
  const user = await apiFetch<AuthUser>('/api/auth/me');
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  return user;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>('/api/admin/users');
}

export async function createAdminUser(request: AdminUserCreateRequest): Promise<AdminUser> {
  return apiFetch<AdminUser>('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export async function updateAdminUser(userId: string, request: AdminUserUpdateRequest): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export async function deleteAdminUser(userId: string): Promise<{ deleted: boolean; id: string }> {
  return apiFetch<{ deleted: boolean; id: string }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export interface ClearBackendDataResponse {
  cleared_tables: string[];
  deleted_paths: string[];
  cleared_logs: string[];
  reset_files: string[];
  reset_services: string[];
  skipped_paths: string[];
}

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

function withAccessToken(url: string): string {
  const token = getStoredAccessToken();
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
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
  return apiFetch<SiteDetectResponse>(`/api/sites/detect?url=${encodeURIComponent(url)}`, { timeout: 90000 });
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
  output_format: 'jsonl' | 'md';
  chapter_range?: string;
  novel_name?: string;
  completed?: boolean;
  combine_chapters?: boolean;
  source_url?: string;
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

export interface InkittCookieUpdateResponse {
  updated: boolean;
  cookie_count: number;
}

export interface InkittCookieStatusResponse {
  valid: boolean | null;
  reason: string;
  message: string;
  cookie_count: number;
  tested_url?: string | null;
}

export interface ProgressUpdate {
  chapters_crawled: number;
  chapters_total: number;
  current_title: string;
  status: string;
  error_message?: string;
  source_url?: string | null;
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

export async function updateInkittCookies(cookies: string): Promise<InkittCookieUpdateResponse> {
  return apiFetch<InkittCookieUpdateResponse>('/api/crawl/inkitt-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies }),
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
  /** The original URL submitted for the crawl */
  source_url?: string | null;
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
  return withAccessToken(`${BASE_URL}/api/results/${encodeURIComponent(crawlId)}/download?filename=${encodeURIComponent(filename)}`);
}

export function getDownloadAllUrl(crawlId: string): string {
  return withAccessToken(`${BASE_URL}/api/results/${encodeURIComponent(crawlId)}/download-all`);
}

export function getDownloadAllSessionsUrl(): string {
  return withAccessToken(`${BASE_URL}/api/results/download-all`);
}

export function getDownloadCombinedUrl(crawlId: string, filename: string): string {
  return withAccessToken(`${BASE_URL}/api/results/${encodeURIComponent(crawlId)}/download?filename=${encodeURIComponent(filename)}`);
}

export function getDownloadAllCombinedUrl(): string {
  return withAccessToken(`${BASE_URL}/api/results/download-combined-all`);
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
  source_url?: string | null;
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
// Settings
// ---------------------------------------------------------------------------

export interface SettingsResponse {
  theme: string;
  crawl_mode: string;
  crawl_default_count: number;
  crawl_default_range_from: number;
  crawl_default_range_to: number;
  crawl_auto_max_chapters: boolean;
  auto_audio_rest_seconds: number;
  auto_audio_upload_workers: number;
  auto_audio_batch_window: number;
  auto_audio_external_api_base: string;
  auto_audio_test_story_ids: string[];
  tts_concurrency: number;
}

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

export interface BinarySearchTotalResponse {
  url: string;
  total?: number | null;
  done: boolean;
  fetching: boolean;
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


// ---------------------------------------------------------------------------
// Drive Sync — Google Drive folder browsing + test sync
// ---------------------------------------------------------------------------

export interface DriveSyncConfig {
  folder_id: string;
  enabled: boolean;
  main_be_api_base_url: string;
  main_category_id: string;
  main_be_user_id?: string;
  service_account_json_name?: string;
  main_be_bearer_token?: string;
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
  folder_id?: string;
  service_account_json_path?: string;
  main_be_api_base_url?: string;
  main_be_user_id?: string;
  main_category_id?: string;
  main_be_bearer_token?: string;
}

export interface DriveSyncUrlResponse {
  url: string | null;
}

export interface TokenValidationResponse {
  valid: boolean;
  status_code: number | null;
  message: string | null;
}

export async function validateMainBeToken(): Promise<TokenValidationResponse> {
  return apiFetch<TokenValidationResponse>('/api/drive-sync/config/validate-token', { timeout: 30000 });
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

export interface UploadCredentialsResponse {
  success: boolean;
  filename: string;
  path: string;
}

export async function uploadDriveCredentials(file: File): Promise<UploadCredentialsResponse> {
  const formData = new FormData();
  formData.append('file', file);
  let res = await fetch(`${BASE_URL}/api/drive-sync/credentials/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (res.status === 401 && await refreshAccessToken()) {
    res = await fetch(`${BASE_URL}/api/drive-sync/credentials/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<UploadCredentialsResponse>;
}

export async function checkCredentialsExists(filename: string): Promise<boolean> {
  let res = await fetch(`${BASE_URL}/api/drive-sync/credentials/exists?filename=${encodeURIComponent(filename)}`, {
    headers: authHeaders(),
  });
  if (res.status === 401 && await refreshAccessToken()) {
    res = await fetch(`${BASE_URL}/api/drive-sync/credentials/exists?filename=${encodeURIComponent(filename)}`, {
      headers: authHeaders(),
    });
  }
  if (!res.ok) return false;
  const body = await res.json() as { exists: boolean };
  return body.exists;
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

export interface DriveFileContentResponse {
  success: boolean;
  content: string;
  error?: string | null;
}

export async function getDriveFileContent(folderId: string, filename: string): Promise<DriveFileContentResponse> {
  return apiFetch<DriveFileContentResponse>(
    `/api/drive-sync/folders/${encodeURIComponent(folderId)}/file/${encodeURIComponent(filename)}`
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
  new_chapters_count?: number;
  free_chapters_count?: number;
  tags?: string[];
  has_free_md?: boolean;
  has_tags_md?: boolean;
  last_updated?: string;
}

export interface CheckUpdatableResponse {
  all_extended_folders: DriveFolderEntry[];
  server_stories: ServerStoryRef[];
  updatable: UpdatableStoryEntry[];
  no_update_needed: UpdatableStoryEntry[];
  no_server_match: DriveFolderEntry[];
  empty_extended: DriveFolderEntry[];
  invalid: UpdatableStoryEntry[];
  no_drive_folder: ServerOnlyStoryEntry[];
}

export interface ServerOnlyStoryEntry {
  server_story: ServerStoryRef;
  last_updated?: string;
}

export interface UpdateChapterCountResponse {
  success: boolean;
  message: string;
}

export async function checkUploadable(): Promise<CheckUploadableResponse> {
  return apiFetch<CheckUploadableResponse>('/api/drive-sync/check-uploadable', { timeout: 600000 });
}

export async function checkUpdatable(): Promise<CheckUpdatableResponse> {
  return apiFetch<CheckUpdatableResponse>('/api/drive-sync/check-updatable', { timeout: 600000 });
}

export async function checkUpdatableReaderFinished(): Promise<CheckUpdatableResponse> {
  return apiFetch<CheckUpdatableResponse>('/api/drive-sync/check-updatable/reader-finished', { timeout: 600000 });
}

export interface StoriesNeedingUpdateEntry {
  storyId: string;
  title: string;
  referencePlatform: string;
  totalChapters: number;
  uniqueReaders: number;
  completedUsers: number;
  completionRate: number;
  tags: string[];
  categories: { id: string; name: string }[];
  mainCategory: { id: string; name: string } | null;
  completedUsersByCountry: { users: number; ipCountryCode: string }[];
  latestCompletionDate: string;
  latestCompletionUsers: number;
}

export interface StoriesNeedingUpdateResponse {
  success: boolean;
  message: string;
  data?: {
    startDate: string;
    endDate: string;
    data: StoriesNeedingUpdateEntry[];
  };
}

export async function getStoriesNeedingUpdate(): Promise<StoriesNeedingUpdateResponse> {
  return apiFetch<StoriesNeedingUpdateResponse>('/api/drive-sync/dashboard/stories-needing-update', { timeout: 600000 });
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

export interface ContentUpdateStoryRef {
  id: string;
  title: string;
  maxChapter: number;
}

export interface ContentUpdateSearchResponse {
  found: boolean;
  exact_match: ContentUpdateStoryRef | null;
  stories: ContentUpdateStoryRef[];
  message: string;
}

export interface ContentUpdateFolderRef {
  id: string;
  name: string;
  prefix: string;
  display_name: string;
  is_completed: boolean;
  chapter_count?: number | null;
  extended_chapter_count?: number | null;
  modified_time?: string | null;
}

export type ContentUpdateChapterStatusValue = 'same' | 'different' | 'missing_drive' | 'drive_only' | 'error';

export interface ContentUpdateChapterStatus {
  chapterNumber: number;
  title: string;
  status: ContentUpdateChapterStatusValue | 'ready' | 'updated';
  fileName?: string | null;
  serverLength: number;
  driveLength: number;
  message?: string | null;
}

export interface ContentUpdateSummary {
  total: number;
  same: number;
  different: number;
  missingDrive: number;
  driveOnly: number;
  errors: number;
}

export interface ContentUpdateScanResponse {
  found: boolean;
  story: ContentUpdateStoryRef | null;
  folder: ContentUpdateFolderRef | null;
  chapters: ContentUpdateChapterStatus[];
  summary: ContentUpdateSummary;
  message: string;
}

export interface ContentUpdateChapterResponse {
  success: boolean;
  message: string;
  chapter?: ContentUpdateChapterStatus | null;
}

export async function searchContentUpdateStory(keyword: string): Promise<ContentUpdateSearchResponse> {
  return apiFetch<ContentUpdateSearchResponse>(
    `/api/drive-sync/content-update/search?keyword=${encodeURIComponent(keyword)}`,
    { timeout: 30000 }
  );
}

export async function inspectContentUpdateFolder(folderName: string): Promise<ContentUpdateScanResponse> {
  return apiFetch<ContentUpdateScanResponse>(
    `/api/drive-sync/content-update/folder?folder_name=${encodeURIComponent(folderName)}`,
    { timeout: 120000 }
  );
}

export async function scanContentUpdateStory(storyId: string): Promise<ContentUpdateScanResponse> {
  return apiFetch<ContentUpdateScanResponse>(
    `/api/drive-sync/content-update/scan/${encodeURIComponent(storyId)}`,
    { timeout: 600000 }
  );
}

export async function updateContentChapter(storyId: string, folderId: string, chapterNumber: number): Promise<ContentUpdateChapterResponse> {
  return apiFetch<ContentUpdateChapterResponse>('/api/drive-sync/content-update/update-chapter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_id: storyId, folder_id: folderId, chapter_number: chapterNumber }),
    timeout: 60000,
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
  main_be_api_base_url?: string;
  chapters_count?: number;  // limits how many chapters to update; only used for update_single
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
  main_be_api_base_url?: string;
  chapters_count?: number;  // limits how many chapters to update; only used for update_single
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

export async function deleteJobs(jobIds: string[]): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(
    '/api/drive-sync/jobs/delete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: jobIds }),
    }
  );
}

// ---------------------------------------------------------------------------
// TTS — Kokoro text-to-speech
// ---------------------------------------------------------------------------

export interface TTSVoice {
  id: string;
  label: string;
  lang: string;
}

export interface TTSLanguage {
  code: string;
  label: string;
}

export interface TTSJob {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  voice: string;
  lang: string;
  speed: number;
  format: string;
  chunks_total: number;
  chunks_done: number;
  progress_pct: number;
  error: string;
  output_filename: string;
  started_at: string | null;
  finished_at: string | null;
  queue_position: number;
}

export interface SpeakRequest {
  text: string;
  voice: string;
  lang: string;
  speed: number;
  format: 'wav' | 'mp3';
}

export interface SpeakResponse {
  job_id: string;
  status: string;
}

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

// ---------------------------------------------------------------------------
// BedRead — Novel TTS Reader
// ---------------------------------------------------------------------------

export interface BedReadStory {
  storyId: string;
  title: string;
  author: string;
  chapterCount: number;
  coverUrl?: string | null;
  description?: string | null;
  tags: string[];
}

export interface BedReadStorySearchParams {
  keyword?: string;
  categories?: string[];
  status?: 'all' | 'ongoing' | 'completed';
  sort?: 'release_date' | 'popular' | 'recently_updated' | 'recently_added';
  minChapters?: number;
  publishedWithin?: number;
  page?: number;
  limit?: number;
}

export interface BedReadStorySearchResponse {
  stories: BedReadStory[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BedReadChapter {
  chapterNumber: number;
  title: string;
  plainContent?: string | null;
}

export interface BatchJobChapter {
  chapter_number: number;
  title: string;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed';
  progress_pct: number;
  output_filename: string;
  error: string;
  retry_count?: number;
}

export interface BatchJob {
  batch_id: string;
  story_id: string;
  story_title: string;
  voice: string;
  lang: string;
  speed: number;
  format: string;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress_pct: number;
  started_at: string | null;
  processing_started_at?: string | null;
  finished_at: string | null;
  error: string;
  chapters: BatchJobChapter[];
  queue_position?: number;
  from_auto_mode?: boolean;
}

export interface BatchGenerateRequest {
  story_id: string;
  story_title: string;
  chapter_start?: number;
  chapter_end?: number | null;
  voice?: string;
  lang?: string;
  speed?: number;
  format?: string;
}

export interface BatchGenerateResponse {
  batch_id: string;
  status: string;
  total_chapters: number;
}

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
  return withAccessToken(`${BASE_URL}/api/bedread/jobs/${encodeURIComponent(batchId)}/download?chapter=${chapterNum}`);
}

export function getBatchZipUrl(batchId: string): string {
  return withAccessToken(`${BASE_URL}/api/bedread/jobs/${encodeURIComponent(batchId)}/zip`);
}

// ---------------------------------------------------------------------------
// Auto Audio — Session orchestration for auto-generating TTS across all stories
// ---------------------------------------------------------------------------

export interface AutoAudioLogEntry {
  timestamp: string;
  step: number;
  message: string;
  level: 'info' | 'error' | 'warning' | 'debug';
}

export interface AutoAudioStoryPreview {
  storyId: string;
  title: string;
  missingCount: number;
}

export interface AutoAudioStoryResult {
  story_id: string;
  story_title: string;
  chapters_expected?: number;
  chapters_generated: number;
  chapters_uploaded: number;
  upload_errors: string[];
  error: string;
}

export interface AutoAudioSession {
  session_id: string;
  phase: string;
  test_mode: boolean;
  voice: string;
  status: 'idle' | 'running' | 'paused' | 'stopping' | 'completed' | 'error' | 'stopped';
  current_step: number;
  current_step_desc: string;
  current_story: string;
  progress: { done: number; total: number };
  chapter_progress: { done: number; total: number };
  stories_missing_audio: AutoAudioStoryPreview[];
  logs: AutoAudioLogEntry[];
  started_at: string | null;
  finished_at: string | null;
  error: string;
  story_results: AutoAudioStoryResult[];
  is_paused?: boolean;
}

export interface AutoAudioHistoryEntry {
  session_id: string;
  phase: string;
  test_mode: boolean;
  voice: string;
  status: string;
  current_step: number;
  current_step_desc: string;
  started_at: string | null;
  finished_at: string | null;
  error: string;
  total_stories: number;
  total_chapters: number;
}

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
  return apiFetch<AutoAudioSession | null>(`/api/auto-audio/status${qs ? `?${qs}` : ''}`);
}

export async function stopAutoAudio(): Promise<void> {
  await apiFetch('/api/auto-audio/stop', { method: 'POST' });
}

export interface AutoAudioPauseResponse {
  is_paused: boolean;
  status: string;
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
