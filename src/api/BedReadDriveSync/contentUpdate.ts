import { apiFetch } from '../client';
import type {
  ContentUpdateSearchResponse,
  ContentUpdateScanResponse,
  ContentUpdateChapterResponse,
} from '../types';

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

export async function updateContentChapter(
  storyId: string,
  folderId: string,
  chapterNumber: number
): Promise<ContentUpdateChapterResponse> {
  return apiFetch<ContentUpdateChapterResponse>('/api/drive-sync/content-update/update-chapter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_id: storyId, folder_id: folderId, chapter_number: chapterNumber }),
    timeout: 60000,
  });
}
