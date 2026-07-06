import { apiFetch } from '../client';
import type {
  CheckAllResponse,
  CheckUpdatedResponse,
  CoverUpdateUploadResponse,
} from '../types';

export async function checkCoverUpdateAll(coverFilename: string = 'cover1.jpg'): Promise<CheckAllResponse> {
  return apiFetch<CheckAllResponse>(
    `/api/drive-sync/cover-update/check-all?cover_filename=${encodeURIComponent(coverFilename)}`,
    { timeout: 300000 }
  );
}

export async function checkCoverUpdateUpdated(): Promise<CheckUpdatedResponse> {
  return apiFetch<CheckUpdatedResponse>('/api/drive-sync/cover-update/check-updated', { timeout: 30000 });
}

export async function uploadCoverUpdate(
  folderId: string,
  storyId: string,
  coverFilename: string = 'cover1.jpg'
): Promise<CoverUpdateUploadResponse> {
  return apiFetch<CoverUpdateUploadResponse>(
    `/api/drive-sync/cover-update/upload/${encodeURIComponent(folderId)}/${encodeURIComponent(storyId)}?cover_filename=${encodeURIComponent(coverFilename)}`,
    { method: 'POST', timeout: 120000 }
  );
}
