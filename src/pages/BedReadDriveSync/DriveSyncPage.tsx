import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  checkUploadable,
  checkUpdatable,
  checkUpdatableReaderFinished,
  createJob,
  getJob,
  getStoriesNeedingUpdate,
  type DriveFolderEntry,
  type UpdatableStoryEntry,
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type TrackedJob,
  type StoriesNeedingUpdateEntry,
} from '../../api/BedReadDriveSync';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';
import { StorySyncTabs, type StorySyncTab } from '../../components/BedReadDriveSync/DriveSync/StorySyncTabs';
import { LoadingAppIcon } from '../../components/BedReadDriveSync/DriveSync/SyncTabShared';
import { useDriveSyncConfig } from '../../hooks/useDriveSyncConfig';
import type { ThemeMode } from '../../types/theme';

const pollUpdate = (
  jobId: string,
  storyId: string,
  lockKey: string,
  setResults: (fn: (prev: Map<string, { success: boolean; message: string }>) => Map<string, { success: boolean; message: string }>) => void,
  setJobs: (fn: (prev: Map<string, string>) => Map<string, string>) => void,
  locksRef: RefObject<Set<string>>,
) => {
  const poll = async () => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const { job } = await getJob(jobId);
        if (job.status !== 'queued' && job.status !== 'running') {
          setResults((prev) => {
            const next = new Map(prev).set(storyId, {
              success: job.status === 'success',
              message: job.result_message ?? (job.status === 'success' ? 'Updated' : job.error ?? 'Update failed'),
            });
            return next;
          });
          setJobs((prev) => {
            const next = new Map(prev);
            next.delete(storyId);
            return next;
          });
          locksRef.current?.delete(lockKey);
          return;
        }
      } catch {
        // ignore
      }
    }
  };
  poll();
};

async function pollUploadResults(
  trackedJobs: TrackedJob[],
  setTrackedJobs: (fn: (prev: TrackedJob[]) => TrackedJob[]) => void,
  setUploadResults: (fn: (prev: Map<string, { success: boolean; message: string }>) => Map<string, { success: boolean; message: string }>) => void,
  setUploadingJobs: (fn: (prev: Map<string, string>) => Map<string, string>) => void,
  uploadLocksRef: RefObject<Set<string>>,
) {
  const completedIds: string[] = [];

  for (const tracked of trackedJobs) {
    try {
      const { job } = await getJob(tracked.jobId);

      if (job.status === 'queued' || job.status === 'running') {
        continue;
      }

      completedIds.push(tracked.jobId);

      const uploadResult = {
        success: job.status === 'success',
        message: job.status === 'success' ? (job.result_message ?? 'Done') : (job.error ?? 'Upload failed'),
      };
      setUploadResults((prev) => new Map(prev).set(tracked.folderId, uploadResult));
    } catch {
      // ignore
    }
  }

  if (completedIds.length > 0) {
    setTrackedJobs((prev) => prev.filter((job) => !completedIds.includes(job.jobId)));
    const jobsToRemove = trackedJobs.filter((t) => completedIds.includes(t.jobId));
    setUploadingJobs((prev) => {
      const next = new Map(prev);
      for (const tracked of jobsToRemove) {
        next.delete(tracked.folderId);
        uploadLocksRef.current?.delete(tracked.folderId);
      }
      return next;
    });
  }
}

interface DriveSyncPageProps {
  readonly themeMode: ThemeMode;
}

export function DriveSyncPage({ themeMode }: DriveSyncPageProps) {
  const isDark = themeMode === 'dark';

  const {
    config,
    configLoading,
    configError,
    configInvalid,
    tokenInvalid,
  } = useDriveSyncConfig({
    validateToken: true,
    enableEditing: false,
  });

  const [trackedJobs, setTrackedJobs] = useState<TrackedJob[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<StorySyncTab>('uploadable');
  const [uploadableData, setUploadableData] = useState<CheckUploadableResponse | null>(null);
  const [uploadableLoading, setUploadableLoading] = useState(false);
  const [uploadableError, setUploadableError] = useState('');
  const [uploadResults, setUploadResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [uploadingJobs, setUploadingJobs] = useState<Map<string, string>>(new Map());
  const uploadLocksRef = useRef<Set<string>>(new Set());

  const [updatableData, setUpdatableData] = useState<CheckUpdatableResponse | null>(null);
  const [updatableLoading, setUpdatableLoading] = useState(false);
  const [updatableError, setUpdatableError] = useState('');
  const [updateResults, setUpdateResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [updatingJobs, setUpdatingJobs] = useState<Map<string, string>>(new Map());
  const updateLocksRef = useRef<Set<string>>(new Set());
  const [storiesNeedingUpdate, setStoriesNeedingUpdate] = useState<StoriesNeedingUpdateEntry[]>([]);

  const pageBackground = 'var(--cs-page)';
  const panelBackground = 'var(--cs-surface-elevated)';
  const panelBorder = 'var(--cs-border)';
  const pageText = 'var(--cs-text)';
  const secondaryText = 'var(--cs-text-soft)';
  const tertiaryText = 'var(--cs-text-faint)';
  const mutedSurface = 'var(--cs-surface-muted)';

  useEffect(() => {
    const interval = setInterval(
      () => pollUploadResults(trackedJobs, setTrackedJobs, setUploadResults, setUploadingJobs, uploadLocksRef),
      4000,
    );
    return () => clearInterval(interval);
  }, [trackedJobs]);

  useEffect(() => {
    return () => {
      sessionStorage.removeItem('drivesync_uploadableData');
      sessionStorage.removeItem('drivesync_uploadableError');
      sessionStorage.removeItem('drivesync_uploadResults');
      sessionStorage.removeItem('drivesync_updatableData');
      sessionStorage.removeItem('drivesync_updatableError');
      sessionStorage.removeItem('drivesync_updateResults');
    };
  }, []);

  const handleCheckUploadable = async () => {
    setUploadableData(null);
    setUploadableLoading(true);
    setUploadableError('');
    setUploadResults(new Map());
    try {
      const data = await checkUploadable();
      setUploadableData(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to check uploadable stories.';
      setUploadableError(message);
      setUploadableData(null);
    } finally {
      setUploadableLoading(false);
    }
  };

  const handleUploadSingle = useCallback(
    async (folder: DriveFolderEntry): Promise<string> => {
      if (uploadLocksRef.current.has(folder.id)) {
        return folder.id;
      }

      uploadLocksRef.current.add(folder.id);
      setUploadingJobs((prev) => new Map(prev).set(folder.id, 'pending'));

      try {
        const response = await createJob({
          kind: 'upload_single',
          folder_id: folder.id,
          folder_name: folder.name,
          display_name: folder.display_name,
          main_be_api_base_url: config?.main_be_api_base_url,
        });

        setTrackedJobs((prev) =>
          prev.some((job) => job.jobId === response.id)
            ? prev
            : [...prev, { jobId: response.id, folderId: folder.id, displayName: folder.display_name }],
        );
        setUploadingJobs((prev) => new Map(prev).set(folder.id, response.id));
        return response.id;
      } catch (e) {
        uploadLocksRef.current.delete(folder.id);
        setUploadingJobs((prev) => {
          const next = new Map(prev);
          next.delete(folder.id);
          return next;
        });
        setUploadResults((prev) => {
          const next = new Map(prev).set(folder.id, {
            success: false,
            message: e instanceof Error ? e.message : 'Failed to enqueue job',
          });
          return next;
        });
        return folder.id;
      }
    },
    [config],
  );

  const handleUploadAll = useCallback(async () => {
    if (!uploadableData) return;

    const folders = uploadableData.uploadable;
    if (folders.length === 0) return;

    const newJobs: TrackedJob[] = [];
    for (const folder of folders) {
      if (uploadLocksRef.current.has(folder.id)) {
        continue;
      }
      uploadLocksRef.current.add(folder.id);
      setUploadingJobs((prev) => new Map(prev).set(folder.id, 'pending'));
      try {
        const response = await createJob({
          kind: 'upload_single',
          folder_id: folder.id,
          folder_name: folder.name,
          display_name: folder.display_name,
          main_be_api_base_url: config?.main_be_api_base_url,
        });
        if (!newJobs.some((job) => job.jobId === response.id)) {
          newJobs.push({ jobId: response.id, folderId: folder.id, displayName: folder.display_name });
        }
        setUploadingJobs((prev) => new Map(prev).set(folder.id, response.id));
      } catch (e) {
        uploadLocksRef.current.delete(folder.id);
        setUploadingJobs((prev) => {
          const next = new Map(prev);
          next.delete(folder.id);
          return next;
        });
        setUploadResults((prev) => {
          const next = new Map(prev).set(folder.id, {
            success: false,
            message: e instanceof Error ? e.message : 'Failed to enqueue job',
          });
          return next;
        });
      }
    }

    if (newJobs.length > 0) {
      setTrackedJobs((prev) => [...prev, ...newJobs]);
    }
  }, [uploadableData, config]);

  const handleCheckUpdatable = async () => {
    setUpdatableData(null);
    setUpdatableLoading(true);
    setUpdatableError('');
    setUpdateResults(new Map());
    try {
      const data = await checkUpdatable();
      setUpdatableData(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to check updatable stories.';
      setUpdatableError(message);
      setUpdatableData(null);
    } finally {
      setUpdatableLoading(false);
    }
  };

  const handleCheckReaderFinished = async () => {
    setUpdatableData(null);
    setUpdatableLoading(true);
    setUpdatableError('');
    setUpdateResults(new Map());
    try {
      const [data, storiesResp] = await Promise.all([checkUpdatableReaderFinished(), getStoriesNeedingUpdate()]);
      setUpdatableData(data);
      setStoriesNeedingUpdate(storiesResp.success && storiesResp.data ? storiesResp.data.data : []);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to check reader finished stories.';
      setUpdatableError(message);
      setUpdatableData(null);
      setStoriesNeedingUpdate([]);
    } finally {
      setUpdatableLoading(false);
    }
  };

  const handleUpdateSingle = useCallback(
    async (entry: UpdatableStoryEntry, chaptersCount?: number): Promise<string> => {
      const { server_story, folder } = entry;
      const lockKey = server_story.id || folder.id;

      if (updateLocksRef.current.has(lockKey)) {
        return server_story.id;
      }

      updateLocksRef.current.add(lockKey);
      setUpdatingJobs((prev) => new Map(prev).set(server_story.id, 'pending'));

      let jobId: string;
      try {
        const job = await createJob({
          kind: 'update_single',
          folder_id: folder.id,
          folder_name: folder.display_name,
          display_name: folder.display_name,
          main_be_api_base_url: config?.main_be_api_base_url,
          chapters_count: chaptersCount,
        });
        jobId = job.id;
        setUpdatingJobs((prev) => new Map(prev).set(server_story.id, jobId));
      } catch (e) {
        updateLocksRef.current.delete(lockKey);
        setUpdatingJobs((prev) => {
          const next = new Map(prev);
          next.delete(server_story.id);
          return next;
        });
        setUpdateResults((prev) => {
          const next = new Map(prev).set(server_story.id, {
            success: false,
            message: e instanceof Error ? e.message : 'Failed to create update job',
          });
          return next;
        });
        return server_story.id;
      }

      pollUpdate(jobId, server_story.id, lockKey, setUpdateResults, setUpdatingJobs, updateLocksRef);

      return server_story.id;
    },
    [config],
  );

  const handleUpdateAll = useCallback(
    async (entries: UpdatableStoryEntry[], chapterInputs: Map<string, number>) => {
      if (entries.length === 0) return;
      for (const entry of entries) {
        const count = chapterInputs.get(entry.server_story.id) ?? 1;
        handleUpdateSingle(entry, count);
      }
    },
    [handleUpdateSingle],
  );

  const hasActiveJobs = trackedJobs.length > 0 || updatingJobs.size > 0;
  const totalUploadable = uploadableData?.uploadable.length ?? 0;
  const totalUpdatable = updatableData?.updatable.length ?? 0;
  const successfulUploads = Array.from(uploadResults.values()).filter((result) => result.success).length;

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <main className="space-y-4">
          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                  Sync
                </div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                  Drive Sync
                </h1>
                <p className="text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                  Sync your crawled novels with Google Drive.
                </p>
              </div>
            </div>
          </section>

          {config && !configLoading && (
            <div
              className="flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-3"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: hasActiveJobs ? '#f59e0b' : '#10b981' }}
                />
                <span className="text-sm font-medium" style={{ color: pageText }}>
                  {hasActiveJobs ? 'Syncing...' : 'Ready'}
                </span>
              </div>

              <div className="hidden h-5 sm:block" style={{ width: '1px', background: panelBorder }} />

              <div className="flex min-w-0 items-center gap-2">
                <Icon icon={appIcons.folder} className="h-4 w-4 shrink-0" style={{ color: tertiaryText }} />
                <span className="truncate text-xs" style={{ color: tertiaryText }}>
                  {config.folder_id}
                </span>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div
                  className="hidden items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium sm:flex"
                  style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}
                >
                  <Icon icon={appIcons.uploadFile} className="h-3.5 w-3.5" />
                  {totalUploadable} ready to upload
                </div>
                <div
                  className="hidden items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium md:flex"
                  style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}
                >
                  <Icon icon={appIcons.trends} className="h-3.5 w-3.5" />
                  {totalUpdatable} can update
                </div>
                {successfulUploads > 0 && (
                  <div
                    className="hidden items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium lg:flex"
                    style={{
                      background: isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.06)',
                      borderColor: isDark ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.16)',
                      color: isDark ? '#6ee7b7' : '#047857',
                    }}
                  >
                    <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
                    {successfulUploads} uploaded
                  </div>
                )}
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
              className="rounded-xl border px-4 py-3 text-sm"
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
            <StorySyncTabs
              activeTab={activeSubTab}
              onTabChange={setActiveSubTab}
              themeMode={themeMode}
              uploadableData={uploadableData}
              uploadableLoading={uploadableLoading}
              uploadableError={uploadableError}
              uploadResults={uploadResults}
              uploadingIds={new Set(uploadingJobs.keys())}
              onCheckUploadable={handleCheckUploadable}
              onUploadSingle={handleUploadSingle}
              onUploadAll={handleUploadAll}
              updatableData={updatableData}
              updatableLoading={updatableLoading}
              updatableError={updatableError}
              updateResults={updateResults}
              updatingIds={new Set(updatingJobs.keys())}
              onCheckUpdatable={handleCheckUpdatable}
              onCheckReaderFinished={handleCheckReaderFinished}
              onUpdateSingle={handleUpdateSingle}
              onUpdateAll={handleUpdateAll}
              updatableInvalid={updatableData?.invalid ?? []}
              updatableNoServerMatch={updatableData?.no_server_match ?? []}
              updatableEmptyExtended={updatableData?.empty_extended ?? []}
              storiesNeedingUpdate={storiesNeedingUpdate}
              noDriveFolder={updatableData?.no_drive_folder ?? []}
            />
          )}
        </main>
      </div>
    </div>
  );
}
