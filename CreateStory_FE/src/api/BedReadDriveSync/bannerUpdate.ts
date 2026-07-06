import { apiFetch } from '../client';
import type {
  CheckAllResponse,
  CheckUpdatedResponse,
  CoverUpdateUploadResponse,
} from '../types';

export async function checkBannerUpdateAll(bannerFilename: string = 'banner1.jpg'): Promise<CheckAllResponse> {
  return apiFetch<CheckAllResponse>(
    `/api/drive-sync/banner-update/check-all?banner_filename=${encodeURIComponent(bannerFilename)}`,
    { timeout: 300000 }
  );
}

export async function checkBannerUpdateUpdated(): Promise<CheckUpdatedResponse> {
  return apiFetch<CheckUpdatedResponse>('/api/drive-sync/banner-update/check-updated', { timeout: 30000 });
}

export async function uploadBannerUpdate(folderId: string, storyId: string, bannerFilename: string = 'banner1.jpg'): Promise<CoverUpdateUploadResponse> {
  return apiFetch<CoverUpdateUploadResponse>(
    `/api/drive-sync/banner-update/upload/${encodeURIComponent(folderId)}/${encodeURIComponent(storyId)}?banner_filename=${encodeURIComponent(bannerFilename)}`,
    { method: 'POST', timeout: 120000 }
  );
}
