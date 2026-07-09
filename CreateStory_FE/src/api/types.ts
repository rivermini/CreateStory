// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  is_active: boolean;
}

export interface AuthTokensResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUserCreateRequest {
  email: string;
  password: string;
  role: 'admin' | 'operator' | 'viewer';
  is_active: boolean;
}

export interface AdminUserUpdateRequest {
  email?: string;
  password?: string;
  role?: 'admin' | 'operator' | 'viewer';
  is_active?: boolean;
}

// ---------------------------------------------------------------------------
// Dev
// ---------------------------------------------------------------------------

export interface ClearBackendDataResponse {
  cleared_tables: string[];
  deleted_paths: string[];
  cleared_logs: string[];
  reset_files: string[];
  reset_services: string[];
  skipped_paths: string[];
}

// ---------------------------------------------------------------------------
// Sites
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
  novel_metadata?: NovelMetadata | null;
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

export interface ScribbleHubCookieUpdateResponse {
  updated: boolean;
  cookie_count: number;
  has_cf_clearance: boolean;
}

export interface ScribbleHubCookieStatusResponse {
  valid: boolean | null;
  reason: string;
  message: string;
  cookie_count: number;
  tested_url?: string | null;
}

export interface GoodNovelCookieUpdateResponse {
  updated: boolean;
  cookie_count: number;
  has_token: boolean;
}

export interface GoodNovelCookieStatusResponse {
  valid: boolean | null;
  reason: string;
  message: string;
  cookie_count: number;
  tested_url?: string | null;
  readable?: number | null;
  readable_without_login?: number | null;
  total?: number | null;
  extra_unlocked?: number | null;
}

export interface WebNovelCookieUpdateResponse {
  updated: boolean;
  cookie_count: number;
  has_cf_clearance: boolean;
  has_user_agent: boolean;
}

export interface WebNovelCookieStatusResponse {
  valid: boolean | null;
  reason: string;
  message: string;
  cookie_count: number;
  tested_url?: string | null;
}

export type GoodNovelBatchPhase = 'scanning' | 'scan_completed' | 'crawling' | 'completed' | 'failed';
export type GoodNovelBatchRowStatus = 'pending' | 'found' | 'not_found' | 'ambiguous' | 'error';
export type GoodNovelBatchCrawlStatus = 'pending' | 'queued' | 'crawling' | 'completed' | 'failed' | 'skipped';
export type GoodNovelBatchSplitMode = 'stories_per_folder' | 'folder_count';

export interface GoodNovelBatchSummary {
  batch_id: string;
  batch_name: string;
  phase: GoodNovelBatchPhase;
  total_titles: number;
  scanned_count: number;
  found_count: number;
  not_found_count: number;
  ambiguous_count: number;
  scan_error_count: number;
  crawl_total: number;
  crawled_count: number;
  crawl_failed_count: number;
  crawl_skipped_count: number;
  download_ready: boolean;
  error_message: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  scan_concurrency: number;
  crawl_concurrency: number;
  split_mode: GoodNovelBatchSplitMode;
  stories_per_folder: number;
  folder_count: number | null;
  log_lines: string[];
}

export interface GoodNovelBatchCandidate {
  title: string;
  author: string;
  url: string;
  book_id: string;
  score: number;
}

export interface GoodNovelBatchRow {
  index: number;
  input_title: string;
  status: GoodNovelBatchRowStatus;
  matched_title: string;
  author: string;
  url: string;
  book_id: string;
  score: number;
  total_chapters: number | null;
  free_chapters: number | null;
  paid_chapters: number | null;
  crawled_chapters: number;
  crawl_status: GoodNovelBatchCrawlStatus;
  output_file: string;
  folder_path: string;
  error: string;
  candidates: GoodNovelBatchCandidate[];
}

export interface GoodNovelBatchRowsResponse {
  batch: GoodNovelBatchSummary;
  items: GoodNovelBatchRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface GoodNovelBatchScanRequest {
  titles_text: string;
  delimiter?: string;
  scan_concurrency?: number;
  batch_name?: string;
}

export interface GoodNovelBatchCrawlRequest {
  split_mode: GoodNovelBatchSplitMode;
  stories_per_folder: number;
  folder_count?: number | null;
  crawl_concurrency: number;
  request_delay_seconds: number;
}

export type InkittBatchPhase = 'discovering' | 'ready' | 'crawling' | 'completed' | 'failed';
export type InkittBatchRowStatus = 'discovered' | 'queued' | 'crawling' | 'completed' | 'skipped' | 'failed';

export interface InkittBatchSummary {
  batch_id: string;
  batch_name: string;
  phase: InkittBatchPhase;
  total_stories: number;
  discovered_count: number;
  completed_count: number;
  skipped_count: number;
  failed_count: number;
  processed_count: number;
  total_chapters: number;
  crawled_chapters: number;
  download_ready: boolean;
  error_message: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  max_pages_per_genre: number;
  discover_concurrency: number;
  crawl_concurrency: number;
  request_delay_seconds: number;
  selected_genres: string[];
  crawl_runs: InkittBatchCrawlRun[];
  cancel_requested: boolean;
  log_lines: string[];
}

export interface InkittBatchCrawlRun {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  target_stories: number;
  completed_count: number;
  failed_count: number;
  skipped_count: number;
  crawled_chapters?: number;
  total_chapters?: number;
  status: string;
}

export interface InkittBatchRow {
  index: number;
  genre: string;
  genre_slug: string;
  title: string;
  url: string;
  story_id: string;
  author: string;
  status: InkittBatchRowStatus;
  completion_status: string;
  total_chapters: number | null;
  crawled_chapters: number;
  rating: number | null;
  review_count: number | null;
  read_count: number | null;
  output_file: string;
  metadata_file: string;
  error: string;
}

export interface InkittBatchRowsResponse {
  batch: InkittBatchSummary;
  items: InkittBatchRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface InkittBatchLogsResponse {
  batch: InkittBatchSummary;
  log_lines: string[];
  total: number;
}

export interface InkittCatalogBackup {
  kind: 'inkitt_discovered_catalog' | 'inkitt_batch_discovered_catalog';
  version: number;
  exported_at: string;
  batch_id?: string;
  batch_name?: string;
  story_count: number;
  selected_genres?: string[];
  genres: Array<{ slug: string; label: string }>;
  stories: Array<Record<string, unknown>>;
}

export interface InkittCatalogImportResponse {
  imported_count: number;
  new_count: number;
  total_count: number;
  queued_count: number;
  batch: InkittBatchSummary;
}

export interface InkittBatchStartRequest {
  batch_name?: string | null;
  genres?: string[] | null;
  max_pages_per_genre: number;
  discover_concurrency: number;
  crawl_concurrency: number;
  request_delay_seconds: number;
  crawl_after_discovery?: boolean;
}

export interface InkittBatchCrawlRequest {
  crawl_concurrency: number;
  request_delay_seconds: number;
  max_stories?: number | null;
}

export interface ProgressUpdate {
  chapters_crawled: number;
  chapters_total: number;
  current_title: string;
  status: string;
  error_message?: string;
  source_url?: string | null;
  started_at?: string | null;
}

export type LogLevel = 'info' | 'error' | 'warning' | 'debug';

export interface LogEntry {
  timestamp: string;
  message: string;
  level: LogLevel;
}

export interface CrawlStatusWithLogs {
  progress: ProgressUpdate;
  log_lines: LogEntry[];
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
  author?: string;
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
  chapter_count?: number;
  chapters?: unknown[];
  combined_txt_file?: string | null;
  txt_content?: string;
  source_url?: string | null;
}

export interface FilePreview {
  filename: string;
  preview: string;
  total_lines: number;
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

export interface CombineResponse {
  crawl_id: string;
  combined_file: string;
  combined_txt_file?: string | null;
  size_bytes: number;
  chapter_count: number;
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

// ---------------------------------------------------------------------------
// Novel chapter list
// ---------------------------------------------------------------------------

export interface ChapterEntry {
  chapter_number: number;
  title: string;
  url: string;
  /** True if the chapter is paywalled/not free; null when the site has no free/paid distinction. */
  locked?: boolean | null;
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
  /** Chapters readable for free across the whole book (sites with a per-chapter paywall). */
  free_chapter_count?: number | null;
  /** Paywalled/locked chapters across the whole book. */
  paid_chapter_count?: number | null;
  /** Whether saved login cookies were applied when computing the free/paid split. */
  authenticated?: boolean | null;
}

export interface BinarySearchTotalResponse {
  url: string;
  total?: number | null;
  done: boolean;
  fetching: boolean;
}

// ---------------------------------------------------------------------------
// Drive Sync — Config & Credentials
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

export interface DriveSyncUrlResponse {
  url: string | null;
}

export interface TokenValidationResponse {
  valid: boolean;
  status_code: number | null;
  message: string | null;
}

export interface UploadCredentialsResponse {
  success: boolean;
  filename: string;
  path: string;
}

export interface DriveSyncUpdateRequest {
  folder_id?: string;
  service_account_json_path?: string;
  main_be_api_base_url?: string;
  main_be_user_id?: string;
  main_category_id?: string;
  main_be_bearer_token?: string;
}

export interface InitDriveSyncRequest {
  folder_id: string;
  service_account_json_path: string;
  main_be_api_base_url: string;
  main_be_user_id: string;
  main_category_id?: string;
  main_be_bearer_token?: string;
}

// ---------------------------------------------------------------------------
// Drive Sync — Folders
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Drive Sync — Status & Sync
// ---------------------------------------------------------------------------

export interface DriveSyncStatus {
  last_sync_at: string | null;
  stories_found: number;
  stories_created: number;
  chapters_added: number;
  errors: string[];
  enabled: boolean;
}

export interface DriveSyncLogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'warning';
  message: string;
  story_name: string | null;
}

export interface DriveSyncProgressResponse {
  status: DriveSyncStatus;
  current_sync_id: string | null;
  log: DriveSyncLogEntry[];
}

export interface DriveSyncTriggerResponse {
  message: string;
  sync_id: string;
  stories_found: number;
}

// ---------------------------------------------------------------------------
// Drive Sync — File content
// ---------------------------------------------------------------------------

export interface DriveFileContentResponse {
  success: boolean;
  content: string;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Drive Sync — Uploadability check
// ---------------------------------------------------------------------------

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
  not_ready?: DriveFolderEntry[];
}

// ---------------------------------------------------------------------------
// Drive Sync — Updatability check
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Drive Sync — Chapter count & chapters update
// ---------------------------------------------------------------------------

export interface UpdateChapterCountResponse {
  success: boolean;
  message: string;
}

export interface UpdateChaptersResponse {
  id: string;
  status: string;
  message: string;
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

// ---------------------------------------------------------------------------
// Drive Sync — Content Update
// ---------------------------------------------------------------------------

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

export interface BatchChapterUpdateResult {
  chapter_number: number;
  success: boolean;
  message: string;
}

export interface BatchFolderResult {
  folder_name: string;
  found: boolean;
  story: ContentUpdateStoryRef | null;
  folder: ContentUpdateFolderRef | null;
  chapters: ContentUpdateChapterStatus[];
  summary: ContentUpdateSummary;
  message: string;
  update_results: BatchChapterUpdateResult[];
  stopped_at: number | null;
  stop_reason: string | null;
}

export interface BatchContentUpdateResponse {
  results: BatchFolderResult[];
}

// ---------------------------------------------------------------------------
// Drive Sync — Job system
// ---------------------------------------------------------------------------

export interface TrackedJob {
  jobId: string;
  folderId: string;
  displayName: string;
}

export interface SyncJob {
  id: string;
  kind: 'upload_single' | 'update_single' | 'chapter_content_update' | 'metadata_update' | 'cover_update' | 'banner_update' | 'intro_update' | 'title_update';
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
  chapters_count?: number;
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
  chapters_count?: number;
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

// ---------------------------------------------------------------------------
// Drive Sync — Cover Update
// ---------------------------------------------------------------------------

export interface CoverUpdateEntry {
  story_id: string | null;
  story_title: string;
  folder_id: string;
  folder_name: string;
  cover_file_name: string | null;
  status: string;
  last_updated: string | null;
}

export interface CheckAllResponse {
  can_update: CoverUpdateEntry[];
  updated: CoverUpdateEntry[];
  no_cover1_file: CoverUpdateEntry[];
  no_banner1_file?: CoverUpdateEntry[];
  no_server_match: CoverUpdateEntry[];
}

export interface CheckUpdatedResponse {
  entries: CoverUpdateEntry[];
}

export interface CoverUpdateUploadResponse {
  success: boolean;
  message: string;
  cover_url?: string | null;
}

// ---------------------------------------------------------------------------
// Drive Sync — Intro Update
// ---------------------------------------------------------------------------

export interface IntroUpdateEntry {
  story_id: string | null;
  story_title: string;
  folder_id: string;
  folder_name: string;
  intro_file_name: string | null;
  status: string;
  last_updated: string | null;
}

export interface CheckAllIntroResponse {
  can_update: IntroUpdateEntry[];
  updated: IntroUpdateEntry[];
  no_intro1_file: IntroUpdateEntry[];
  no_server_match: IntroUpdateEntry[];
}

export interface CheckUpdatedIntroResponse {
  entries: IntroUpdateEntry[];
}

export interface IntroUpdateUploadResponse {
  success: boolean;
  message: string;
  intro_url?: string | null;
}

// ---------------------------------------------------------------------------
// Drive Sync — Metadata Update
// ---------------------------------------------------------------------------

export interface MetadataFieldDifference {
  field: 'category' | 'free_chapters_count' | 'push' | 'synopsis' | 'tags';
  file_name?: string | null;
  folder_value: unknown;
  server_value: unknown;
}

export interface MetadataFieldDetail {
  field: MetadataFieldDifference['field'];
  file_name?: string | null;
  folder_value: unknown;
  server_value: unknown;
  is_different: boolean;
}

export interface MetadataStoryValues {
  main_category: string | null;
  sub_categories: string[];
  free_chapters_count: number;
  push_title: string | null;
  push_content: string | null;
  synopsis: string | null;
  tags: string[];
}

export interface MetadataFolderValues {
  main_category: string | null;
  sub_category: string | null;
  free_chapters_count: number | null;
  push_title: string | null;
  push_content: string | null;
  synopsis: string | null;
  tags: string[];
}

export interface MetadataUpdateEntry {
  story_id: string | null;
  story_title: string;
  folder_id: string;
  folder_name: string;
  server: MetadataStoryValues;
  folder_values: MetadataFolderValues;
  differences: MetadataFieldDifference[];
  status: 'can_update' | 'all_match' | 'no_server_match';
}

export interface MetadataCheckAllResponse {
  can_update: MetadataUpdateEntry[];
  all_match: MetadataUpdateEntry[];
  no_server_match: MetadataUpdateEntry[];
}

export interface MetadataUpdateResponse {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Drive Sync — Title Update
// ---------------------------------------------------------------------------

export type TitleChapterStatus = 'matched' | 'can_update_title' | 'missing_drive' | 'drive_only' | 'error';
export type TitleFolderStatus = 'can_update' | 'all_match' | 'no_server_match' | 'empty_chapters';

export interface TitleChapterEntry {
  chapter_number: number;
  file_name: string | null;
  drive_title: string;
  server_title: string | null;
  status: TitleChapterStatus;
  message: string | null;
}

export interface TitleFolderEntry {
  story_id: string | null;
  story_title: string;
  folder_id: string;
  folder_name: string;
  folder_status: TitleFolderStatus;
  matched_count: number;
  can_update_count: number;
  missing_drive_count: number;
  drive_only_count: number;
  error_count: number;
  chapters: TitleChapterEntry[];
}

export interface CheckAllTitleResponse {
  can_update: TitleFolderEntry[];
  all_match: TitleFolderEntry[];
  no_server_match: TitleFolderEntry[];
  empty_chapters: TitleFolderEntry[];
}

export interface TitleUpdateChapterResponse {
  success: boolean;
  message: string;
  chapter?: TitleChapterEntry | null;
}

export interface TitleUpdateChapterResult {
  chapter_number: number;
  success: boolean;
  message: string;
}

export interface TitleFolderUpdateResult {
  folder_id: string;
  folder_name: string;
  story_id: string | null;
  story_title: string;
  update_results: TitleUpdateChapterResult[];
  stopped_at: number | null;
  stop_reason: string | null;
  success_count: number;
  failed_count: number;
}

export interface BatchTitleUpdateResponse {
  results: TitleFolderUpdateResult[];
}

// ---------------------------------------------------------------------------
// TTS — Kokoro
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

// ---------------------------------------------------------------------------
// BedRead audio jobs — "Audio Jobs" monitor (incl. Auto Audio batches)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Auto Audio
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

export interface AutoAudioPauseResponse {
  is_paused: boolean;
  status: string;
}

export interface AutoScanState {
  enabled: boolean;
  interval_hours: number;
  chapter_threshold: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_session_id: string | null;
  is_running: boolean;
}
