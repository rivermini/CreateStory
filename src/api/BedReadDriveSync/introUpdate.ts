import { apiFetch } from '../client';
import type {
  IntroUpdateUploadResponse,
  CheckAllIntroResponse,
  CheckUpdatedIntroResponse,
} from '../types';

export type { IntroUpdateUploadResponse } from '../types';

export async function checkIntroUpdateAll(introFilename: string = 'intro1.jpg'): Promise<CheckAllIntroResponse> {
  return apiFetch<CheckAllIntroResponse>(
    `/api/drive-sync/intro-update/check-all?intro_filename=${encodeURIComponent(introFilename)}`,
    { timeout: 300000 }
  );
}

export async function checkIntroUpdateUpdated(): Promise<CheckUpdatedIntroResponse> {
  return apiFetch<CheckUpdatedIntroResponse>('/api/drive-sync/intro-update/check-updated', { timeout: 30000 });
}

export async function uploadIntroUpdate(folderId: string, storyId: string, introFilename: string = 'intro1.jpg'): Promise<IntroUpdateUploadResponse> {
  return apiFetch<IntroUpdateUploadResponse>(
    `/api/drive-sync/intro-update/upload/${encodeURIComponent(folderId)}/${encodeURIComponent(storyId)}?intro_filename=${encodeURIComponent(introFilename)}`,
    { method: 'POST', timeout: 120000 }
  );
}
