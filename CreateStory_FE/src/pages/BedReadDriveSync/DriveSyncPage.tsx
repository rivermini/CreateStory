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
import { PageShell, PageHeader, Surface } from '../../components/Shared/Primitives';


function hasTrackedJobs(jobs: TrackedJob[]): boolean {
  return jobs.length > 0;
}

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
  const trackedJobsRef = useRef<TrackedJob[]>([]);

  useEffect(() => {
    trackedJobsRef.current = trackedJobs;
  }, [trackedJobs]);

  const hasActiveTrackedJobs = hasTrackedJobs(trackedJobs);

  useEffect(() => {
    if (!hasActiveTrackedJobs) return;
    const interval = setInterval(
      () => pollUploadResults(trackedJobsRef.current, setTrackedJobs, setUploadResults, setUploadingJobs, uploadLocksRef),
      4000,
    );
    return () => clearInterval(interval);
  }, [hasActiveTrackedJobs]);

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

  return (
    <PageShell themeMode={themeMode}>
      <div className="flex w-full flex-col px-4 py-6 sm:px-6 lg:px-8">
        <main className="space-y-4">
          <PageHeader
            themeMode={themeMode}
            eyebrow="Sync"
            title="Drive Sync"
            description={
              config && !configLoading ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Sync your crawled novels with Google Drive.</span>
                  <span className="text-[var(--cs-text-faint)]">•</span>
                  <span className="flex items-center gap-1 font-mono text-xs text-[var(--cs-text-soft)] bg-[var(--cs-surface-muted)] px-1.5 py-0.5 rounded border border-[var(--cs-border)]">
                    <Icon icon={appIcons.folder} className="h-3 w-3 shrink-0" />
                    <span>Drive ID: {config.folder_id}</span>
                  </span>
                </span>
              ) : (
                "Sync your crawled novels with Google Drive."
              )
            }
            actions={
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
            }
          />

          {configLoading && (
            <Surface className="flex items-center justify-center gap-3 p-8">
              <LoadingAppIcon isDark={isDark} color="var(--cs-text-soft)" />
              <span className="text-sm" style={{ color: 'var(--cs-text-soft)' }}>
                Loading Drive Sync...
              </span>
            </Surface>
          )}

          {configError && (
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{
                background: 'rgba(220, 38, 38, 0.08)',
                borderColor: 'rgba(220, 38, 38, 0.16)',
                color: 'var(--cs-danger)',
              }}
            >
              {configError}
            </div>
          )}

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
    </PageShell>
  );
}
