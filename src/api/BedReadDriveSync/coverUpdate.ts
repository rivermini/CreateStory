import { apiFetch } from '../client';
import type {
  CheckAllResponse,
  CheckUpdatedResponse,
  CoverUpdateUploadResponse,
} from '../types';

export async function checkCoverUpdateAll(): Promise<CheckAllResponse> {
  return apiFetch<CheckAllResponse>('/api/drive-sync/cover-update/check-all', { timeout: 120000 });
}

export async function checkCoverUpdateUpdated(): Promise<CheckUpdatedResponse> {
  return apiFetch<CheckUpdatedResponse>('/api/drive-sync/cover-update/check-updated', { timeout: 30000 });
}

export async function uploadCoverUpdate(folderId: string, storyId: string): Promise<CoverUpdateUploadResponse> {
  return apiFetch<CoverUpdateUploadResponse>(
    `/api/drive-sync/cover-update/upload/${encodeURIComponent(folderId)}/${encodeURIComponent(storyId)}`,
    { method: 'POST', timeout: 120000 }
  );
}
