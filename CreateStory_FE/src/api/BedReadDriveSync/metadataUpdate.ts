import { apiFetch } from '../client';
import type {
  MetadataCheckAllResponse,
  MetadataFieldDetail,
  MetadataFieldDifference,
  MetadataUpdateResponse,
} from '../types';

export async function checkMetadataUpdateAll(): Promise<MetadataCheckAllResponse> {
  return apiFetch<MetadataCheckAllResponse>('/api/drive-sync/metadata-update/check-all', { timeout: 600000 });
}

export async function updateMetadata(
  folderId: string,
  storyId: string,
  differences: MetadataFieldDifference[],
): Promise<MetadataUpdateResponse> {
  return apiFetch<MetadataUpdateResponse>(
    `/api/drive-sync/metadata-update/update-metadata/${encodeURIComponent(folderId)}/${encodeURIComponent(storyId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ differences }),
      timeout: 120000,
    },
  );
}

export async function getMetadataDifferenceDetail(
  folderId: string,
  storyId: string,
  field: MetadataFieldDifference['field'],
): Promise<MetadataFieldDetail> {
  return apiFetch<MetadataFieldDetail>(
    `/api/drive-sync/metadata-update/difference/${encodeURIComponent(folderId)}/${encodeURIComponent(storyId)}/${encodeURIComponent(field)}`,
    { timeout: 120000 },
  );
}
