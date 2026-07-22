import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock('../client', () => ({
  apiFetch: apiFetchMock,
}));

import {
  DRIVE_SYNC_CONFIG_UPDATED_EVENT,
  createJobsBatch,
  initDriveSyncConfig,
  listActiveUploadJobs,
  queryJobs,
} from './driveSync';

describe('DriveSync batch job API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({ jobs: [] });
  });

  it('submits one idempotent batch request for all upload jobs', async () => {
    const request = {
      client_batch_id: 'drive-upload-123',
      jobs: [
        {
          kind: 'upload_single' as const,
          folder_id: 'folder-1',
          folder_name: 'DONE_story',
          display_name: 'Story',
        },
      ],
    };

    await createJobsBatch(request);

    expect(apiFetchMock).toHaveBeenCalledOnce();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/drive-sync/jobs/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      timeout: 30000,
    });
  });

  it('submits update jobs as one idempotent batch with per-story limits', async () => {
    const request = {
      client_batch_id: 'drive-update-123',
      jobs: [
        {
          kind: 'update_single' as const,
          folder_id: 'folder-1',
          folder_name: 'Story',
          display_name: 'Story',
          chapters_count: 4,
        },
      ],
    };

    await createJobsBatch(request);

    expect(apiFetchMock).toHaveBeenCalledOnce();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/drive-sync/jobs/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      timeout: 30000,
    });
  });

  it('queries all tracked job statuses in one request', async () => {
    await queryJobs(['job-1', 'job-2', 'job-3']);

    expect(apiFetchMock).toHaveBeenCalledOnce();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/drive-sync/jobs/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['job-1', 'job-2', 'job-3'] }),
      timeout: 15000,
    });
  });

  it('uses repeated status filters to restore queued and running uploads', async () => {
    await listActiveUploadJobs();

    expect(apiFetchMock).toHaveBeenCalledOnce();
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/drive-sync/jobs?limit=500&offset=0&status=queued&status=running&kind=upload_single',
      { timeout: 15000 },
    );
  });

  it('notifies mounted pages after Drive Sync configuration is saved', async () => {
    apiFetchMock.mockResolvedValueOnce({
      folder_id: 'drive-folder',
      enabled: true,
      main_be_api_base_url: 'https://api-novel.santngo.com',
      main_category_id: 'category-1',
      main_be_user_id: 'user-1',
    });
    const listener = vi.fn();
    window.addEventListener(DRIVE_SYNC_CONFIG_UPDATED_EVENT, listener);

    await initDriveSyncConfig({
      folder_id: 'drive-folder',
      service_account_json_path: 'fixed-json/google-service-account.json',
      main_be_api_base_url: 'https://api-novel.santngo.com',
      main_be_user_id: 'user-1',
    });

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(DRIVE_SYNC_CONFIG_UPDATED_EVENT, listener);
  });
});
