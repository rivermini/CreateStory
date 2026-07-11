import { apiFetch } from '../client';
import type {
  DriveSyncConfig,
  DriveSyncUpdateRequest,
  InitDriveSyncRequest,
  DriveFolderListResponse,
  DriveStoryPreview,
  DriveSyncProgressResponse,
  DriveSyncTriggerResponse,
  DriveFileContentResponse,
  CheckUploadableResponse,
  CheckUpdatableResponse,
  UpdateChapterCountResponse,
  UpdateChaptersResponse,
  StoriesNeedingUpdateResponse,
  TokenValidationResponse,
  UploadCredentialsResponse,
  JobCreateRequest,
  JobBatchCreateRequest,
  JobBatchCreateResponse,
  JobQueryResponse,
  JobListFilters,
  JobListResponse,
  JobResponse,
} from '../types';

export async function validateMainBeToken(): Promise<TokenValidationResponse> {
  return apiFetch<TokenValidationResponse>('/api/drive-sync/config/validate-token', { timeout: 30000 });
}

export async function getDriveSyncConfig(): Promise<DriveSyncConfig | null> {
  return apiFetch<DriveSyncConfig | null>('/api/drive-sync/config');
}

export async function initDriveSyncConfig(req: InitDriveSyncRequest): Promise<DriveSyncConfig> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (req.main_be_bearer_token) {
    headers['X-Auth-Token'] = req.main_be_bearer_token;
  }
  const { main_be_bearer_token: _omit, ...body } = req;
  return apiFetch<DriveSyncConfig>('/api/drive-sync/config', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export async function uploadDriveCredentials(file: File): Promise<UploadCredentialsResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<UploadCredentialsResponse>('/api/drive-sync/credentials/upload', {
    method: 'POST',
    body: formData,
  });
}

export async function checkCredentialsExists(filename: string): Promise<boolean> {
  const body = await apiFetch<{ exists: boolean }>(
    `/api/drive-sync/credentials/exists?filename=${encodeURIComponent(filename)}`
  );
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
  const url = '/api/drive-sync/folders' + (qs ? `?${qs}` : '');
  return apiFetch<DriveFolderListResponse>(
    url,
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

export async function getDriveFileContent(folderId: string, filename: string): Promise<DriveFileContentResponse> {
  return apiFetch<DriveFileContentResponse>(
    `/api/drive-sync/folders/${encodeURIComponent(folderId)}/file/${encodeURIComponent(filename)}`
  );
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

export async function getStoriesNeedingUpdate(): Promise<StoriesNeedingUpdateResponse> {
  return apiFetch<StoriesNeedingUpdateResponse>('/api/drive-sync/dashboard/stories-needing-update', { timeout: 600000 });
}

export async function updateChapterCount(storyId: string, maxChapter: number): Promise<UpdateChapterCountResponse> {
  return apiFetch<UpdateChapterCountResponse>('/api/drive-sync/update-chapter-count', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_id: storyId, max_chapter: maxChapter }),
    timeout: 30000,
  });
}

export async function updateChapters(folderId: string): Promise<UpdateChaptersResponse> {
  return apiFetch<UpdateChaptersResponse>(`/api/drive-sync/update-chapters/${folderId}`, {
    method: 'POST',
    timeout: 300000,
  });
}

export async function createJob(req: JobCreateRequest): Promise<import('../types').JobCreateResponse> {
  return apiFetch<import('../types').JobCreateResponse>('/api/drive-sync/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function createJobsBatch(req: JobBatchCreateRequest): Promise<JobBatchCreateResponse> {
  return apiFetch<JobBatchCreateResponse>('/api/drive-sync/jobs/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    timeout: 30000,
  });
}

export async function queryJobs(ids: string[]): Promise<JobQueryResponse> {
  return apiFetch<JobQueryResponse>('/api/drive-sync/jobs/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
    timeout: 15000,
  });
}

function appendFilter(
  params: URLSearchParams,
  name: 'status' | 'kind',
  value: JobListFilters[typeof name],
) {
  if (!value) return;
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) params.append(name, item);
}

export async function listJobs(
  limit = 100,
  offset = 0,
  filters: JobListFilters = {},
): Promise<JobListResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  appendFilter(params, 'status', filters.status);
  appendFilter(params, 'kind', filters.kind);
  return apiFetch<JobListResponse>(
    `/api/drive-sync/jobs?${params.toString()}`,
    { timeout: 15000 }
  );
}

export async function listActiveUploadJobs(limit = 500): Promise<JobListResponse> {
  return listJobs(limit, 0, {
    status: ['queued', 'running'],
    kind: 'upload_single',
  });
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
