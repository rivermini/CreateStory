import { apiFetch } from '../client';
import type {
  CheckAllTitleResponse,
  TitleFolderEntry,
  TitleUpdateChapterResponse,
  TitleFolderUpdateResult,
  BatchTitleUpdateResponse,
} from '../types';

export async function checkAllTitles(): Promise<CheckAllTitleResponse> {
  return apiFetch<CheckAllTitleResponse>(
    '/api/drive-sync/title-update/check-all',
    { timeout: 120000 }
  );
}

export async function getTitleFolderDetail(folderId: string): Promise<TitleFolderEntry> {
  return apiFetch<TitleFolderEntry>(
    `/api/drive-sync/title-update/folder/${encodeURIComponent(folderId)}/detail`,
    { timeout: 120000 }
  );
}

export async function updateChapterTitle(
  storyId: string,
  folderId: string,
  chapterNumber: number
): Promise<TitleUpdateChapterResponse> {
  return apiFetch<TitleUpdateChapterResponse>(
    `/api/drive-sync/title-update/update-chapter/${encodeURIComponent(storyId)}/${encodeURIComponent(folderId)}/${chapterNumber}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      timeout: 60000,
    }
  );
}

export async function updateFolderTitles(
  storyId: string,
  folderId: string
): Promise<TitleFolderUpdateResult> {
  return apiFetch<TitleFolderUpdateResult>(
    `/api/drive-sync/title-update/update-folder/${encodeURIComponent(storyId)}/${encodeURIComponent(folderId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      timeout: 300000,
    }
  );
}

export async function batchUpdateTitles(
  folderIds: string[],
  concurrency?: number
): Promise<BatchTitleUpdateResponse> {
  return apiFetch<BatchTitleUpdateResponse>(
    '/api/drive-sync/title-update/batch-update',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_ids: folderIds, concurrency: concurrency ?? 2 }),
      timeout: 900000,
    }
  );
}
