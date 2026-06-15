import { apiFetch } from '../client';
import type {
  CheckAllResponse,
  CheckUpdatedResponse,
  CoverUpdateUploadResponse,
} from '../types';

export async function checkBannerUpdateAll(): Promise<CheckAllResponse> {
  return apiFetch<CheckAllResponse>('/api/drive-sync/banner-update/check-all', { timeout: 300000 });
}

export async function checkBannerUpdateUpdated(): Promise<CheckUpdatedResponse> {
  return apiFetch<CheckUpdatedResponse>('/api/drive-sync/banner-update/check-updated', { timeout: 30000 });
}

export async function uploadBannerUpdate(folderId: string, storyId: string): Promise<CoverUpdateUploadResponse> {
  return apiFetch<CoverUpdateUploadResponse>(
    `/api/drive-sync/banner-update/upload/${encodeURIComponent(folderId)}/${encodeURIComponent(storyId)}`,
    { method: 'POST', timeout: 120000 }
  );
}
