import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkMetadataUpdateAll,
  createJobsBatch,
  listJobs,
  queryJobs,
  updateMetadata,
  type MetadataCheckAllResponse,
  type MetadataUpdateEntry,
} from '../../api/BedReadDriveSync';
import { MetadataUpdateTabs } from '../../components/BedReadDriveSync/MetadataUpdate/MetadataUpdateTabs';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { LoadingAppIcon } from '../../components/BedReadDriveSync/DriveSync/SyncTabShared';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';
import { showToast } from '../../components/Shared/Toast';
import { useDriveSyncConfig } from '../../hooks/useDriveSyncConfig';
import type { ThemeMode } from '../../types/theme';
import type { MetadataFieldDifference } from '../../api/types';

interface MetadataUpdatePageProps {
  readonly themeMode: ThemeMode;
}

const METADATA_BATCH_SESSION_KEY = 'drivesync_active_metadata_batch';

interface StoredMetadataBatch {
  id: string;
  folderIds: string[];
}

function readStoredMetadataBatch(): StoredMetadataBatch | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(METADATA_BATCH_SESSION_KEY) ?? 'null') as Partial<StoredMetadataBatch> | null;
    if (!value || typeof value.id !== 'string' || !Array.isArray(value.folderIds)) return null;
    return { id: value.id, folderIds: value.folderIds.filter((id): id is string => typeof id === 'string') };
  } catch {
    return null;
  }
}

function getOrCreateMetadataBatch(folderIds: string[]): StoredMetadataBatch {
  const normalized = [...folderIds].sort();
  const stored = readStoredMetadataBatch();
  if (stored && stored.folderIds.length === normalized.length && stored.folderIds.every((id, i) => id === normalized[i])) {
    return stored;
  }
  const suffix = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const batch = { id: `drive-metadata-${suffix}`, folderIds: normalized };
  sessionStorage.setItem(METADATA_BATCH_SESSION_KEY, JSON.stringify(batch));
  return batch;
}

export function MetadataUpdatePage({ themeMode }: MetadataUpdatePageProps) {
  const isDark = themeMode === 'dark';

  const {
    config,
    configLoading,
    configError,
    configInvalid,
    tokenInvalid,
  } = useDriveSyncConfig({
    validateToken: false,
    enableEditing: false,
  });

  const [checkAllData, setCheckAllData] = useState<MetadataCheckAllResponse | null>(null);
  const [checkAllLoading, setCheckAllLoading] = useState(false);
  const [checkAllError, setCheckAllError] = useState('');

  const [updateResults, setUpdateResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [metadataJobs, setMetadataJobs] = useState<Map<string, string>>(new Map());
  const updateLocksRef = useRef<Set<string>>(new Set());
  const updateResultVersionRef = useRef(0);

  const applyFinishedJobs = useCallback((jobs: Awaited<ReturnType<typeof queryJobs>>['jobs']) => {
    const finished = jobs.filter((job) => job.status !== 'queued' && job.status !== 'running');
    if (finished.length === 0) return;
    setUpdateResults((prev) => {
      const next = new Map(prev);
      for (const job of finished) {
        next.set(job.folder_id, {
          success: job.status === 'success',
          message: job.result_message ?? job.error ?? (job.status === 'success' ? 'Metadata updated.' : 'Metadata update failed.'),
        });
      }
      return next;
    });
    setMetadataJobs((prev) => {
      const next = new Map(prev);
      for (const job of finished) next.delete(job.folder_id);
      return next;
    });
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      for (const job of finished) next.delete(job.folder_id);
      return next;
    });
    for (const job of finished) updateLocksRef.current.delete(job.folder_id);
  }, []);

  useEffect(() => {
    const stored = readStoredMetadataBatch();
    if (!stored) return;
    let cancelled = false;
    void listJobs(500, 0, { kind: 'metadata_update' }).then(({ jobs }) => {
      if (cancelled) return;
      const batchJobs = jobs.filter((job) => job.client_batch_id === stored.id);
      applyFinishedJobs(batchJobs);
      const active = batchJobs.filter((job) => job.status === 'queued' || job.status === 'running');
      if (active.length === 0 && batchJobs.length > 0) sessionStorage.removeItem(METADATA_BATCH_SESSION_KEY);
      setMetadataJobs(new Map(active.map((job) => [job.folder_id, job.id])));
      setUpdatingIds(new Set(active.map((job) => job.folder_id)));
      for (const job of active) updateLocksRef.current.add(job.folder_id);
    });
    return () => { cancelled = true; };
  }, [applyFinishedJobs]);

  useEffect(() => {
    if (metadataJobs.size === 0) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await queryJobs(Array.from(metadataJobs.values()));
        if (!cancelled) applyFinishedJobs(response.jobs);
      } catch {
        // Keep polling; persisted jobs continue safely on the backend.
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [applyFinishedJobs, metadataJobs]);

  const pageBackground = 'var(--cs-page)';
  const panelBackground = 'var(--cs-surface-elevated)';
  const panelBorder = 'var(--cs-border)';
  const pageText = 'var(--cs-text)';
  const secondaryText = 'var(--cs-text-soft)';
  const tertiaryText = 'var(--cs-text-faint)';

  const resetUpdateUiState = () => {
    updateResultVersionRef.current += 1;
    setUpdateResults(new Map());
    setUpdatingIds(new Set());
  };

  const handleCheckAll = async () => {
    setCheckAllData(null);
    setCheckAllLoading(true);
    setCheckAllError('');
    resetUpdateUiState();
    try {
      const data = await checkMetadataUpdateAll();
      setCheckAllData(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to check metadata updates.';
      setCheckAllError(message);
    } finally {
      setCheckAllLoading(false);
    }
  };

  const handleUpdateMetadata = async (folderId: string, storyId: string, differences: MetadataFieldDifference[]) => {
    if (updateLocksRef.current.has(folderId)) return;
    const resultVersion = updateResultVersionRef.current;
    updateLocksRef.current.add(folderId);
    setUpdatingIds((prev) => new Set(prev).add(folderId));

    try {
      const result = await updateMetadata(folderId, storyId, differences);
      if (resultVersion === updateResultVersionRef.current) {
        setUpdateResults((prev) => new Map(prev).set(folderId, { success: result.success, message: result.message }));
      }
      if (result.success) {
        showToast(result.message || 'Metadata update queued.', 'success', 2000, 'top-center');
      } else {
        showToast(`Metadata update failed: ${result.message}`, 'error', 4000, 'top-center');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Update failed';
      if (resultVersion === updateResultVersionRef.current) {
        setUpdateResults((prev) => new Map(prev).set(folderId, { success: false, message: message }));
      }
      showToast(`Metadata update failed: ${message}`, 'error', 4000, 'top-center');
    } finally {
      updateLocksRef.current.delete(folderId);
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  };

  const handleUpdateAllMetadata = async (entries: MetadataUpdateEntry[]) => {
    const available = entries.filter((entry) => entry.story_id && !updateLocksRef.current.has(entry.folder_id));
    if (available.length === 0) return;
    const batch = getOrCreateMetadataBatch(available.map((entry) => entry.folder_id));
    for (const entry of available) updateLocksRef.current.add(entry.folder_id);
    setUpdatingIds((prev) => new Set([...prev, ...available.map((entry) => entry.folder_id)]));
    try {
      const response = await createJobsBatch({
        client_batch_id: batch.id,
        jobs: available.map((entry) => ({
          kind: 'metadata_update',
          folder_id: entry.folder_id,
          folder_name: entry.folder_name,
          display_name: `${entry.story_title} - Metadata update`,
          main_be_api_base_url: config?.main_be_api_base_url,
          payload: { story_id: entry.story_id, differences: entry.differences },
        })),
      });
      setMetadataJobs(new Map(response.jobs.map((job, index) => [available[index].folder_id, job.id])));
    } catch (error) {
      for (const entry of available) updateLocksRef.current.delete(entry.folder_id);
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        for (const entry of available) next.delete(entry.folder_id);
        return next;
      });
      showToast(error instanceof Error ? error.message : 'Failed to enqueue metadata batch.', 'error', 4000, 'top-center');
    }
  };

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <main className="space-y-4">
          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Sync
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                Metadata update
              </h1>
              <p className="text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                Compare and update story metadata from Drive `DONE_` and `EXTENDED_` folders.
              </p>
            </div>
          </section>

          {config && !configLoading && (
            <div
              className="flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-3"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ background: '#10b981' }} />
                <span className="text-sm font-medium" style={{ color: pageText }}>
                  Ready
                </span>
              </div>
              <div className="hidden h-5 sm:block" style={{ width: '1px', background: panelBorder }} />
              <div className="flex min-w-0 items-center gap-2">
                <Icon icon={appIcons.folder} className="h-4 w-4 shrink-0" style={{ color: tertiaryText }} />
                <span className="truncate text-xs sm:text-sm" style={{ color: tertiaryText }}>
                  {config.folder_id}
                </span>
              </div>
            </div>
          )}

          {configLoading && (
            <div
              className="flex items-center justify-center gap-3 rounded-2xl border p-8"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <LoadingAppIcon isDark={isDark} color={secondaryText} />
              <span className="text-sm" style={{ color: secondaryText }}>
                Loading Drive Sync...
              </span>
            </div>
          )}

          {configError && (
            <div
              className="rounded-xl border p-4 text-sm"
              style={{
                background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
                borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
                color: isDark ? '#f87171' : '#dc2626',
              }}
            >
              {configError}
            </div>
          )}

          <ServerModeBanner
            serverUrl={config?.main_be_api_base_url ?? null}
            isDark={isDark}
            isConfigLoading={configLoading}
            isConfigValid={
              tokenInvalid
                ? undefined
                : configInvalid
                  ? false
                  : configLoading
                    ? undefined
                    : Boolean(config?.main_be_api_base_url && config?.main_be_user_id)
            }
            tokenInvalid={tokenInvalid}
          />

          {config && !configLoading && (
            <MetadataUpdateTabs
              checkAllData={checkAllData}
              checkAllLoading={checkAllLoading}
              checkAllError={checkAllError}
              updateResults={updateResults}
              updatingIds={updatingIds}
              onCheckAll={handleCheckAll}
              onUpdateMetadata={handleUpdateMetadata}
              onUpdateAllMetadata={handleUpdateAllMetadata}
              themeMode={themeMode}
            />
          )}
        </main>
      </div>
    </div>
  );
}
