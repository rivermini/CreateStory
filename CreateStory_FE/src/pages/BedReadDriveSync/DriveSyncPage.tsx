import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  checkUploadable,
  checkUpdatable,
  checkUpdatableReaderFinished,
  createJob,
  createJobsBatch,
  getJob,
  getStoriesNeedingUpdate,
  listActiveUploadJobs,
  listJobs,
  queryJobs,
  type DriveFolderEntry,
  type UpdatableStoryEntry,
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type DriveSyncUploadProgress,
  type SyncJob,
  type SyncJobStatus,
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


const UPLOAD_POLL_INTERVAL_MS = 4000;
const UPLOAD_POLL_MAX_BACKOFF_MS = 30000;
const UPLOAD_BATCH_SESSION_KEY = 'drivesync_active_upload_batch';
const UPDATE_BATCH_SESSION_KEY = 'drivesync_active_update_batch';

interface StoredUploadBatch {
  id: string;
  folderIds: string[];
  processWatermark: boolean;
}

interface StoredUpdateBatch {
  id: string;
  storyIds: string[];
}

function readStoredUploadBatch(): StoredUploadBatch | null {
  try {
    const raw = sessionStorage.getItem(UPLOAD_BATCH_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredUploadBatch>;
    if (typeof value.id !== 'string' || !Array.isArray(value.folderIds)) return null;
    return {
      id: value.id,
      folderIds: value.folderIds.filter((item): item is string => typeof item === 'string'),
      processWatermark: typeof value.processWatermark === 'boolean' ? value.processWatermark : true,
    };
  } catch {
    return null;
  }
}

function storeUploadBatch(batch: StoredUploadBatch) {
  sessionStorage.setItem(UPLOAD_BATCH_SESSION_KEY, JSON.stringify(batch));
}

function clearStoredUploadBatch(expectedId?: string) {
  const stored = readStoredUploadBatch();
  if (!expectedId || stored?.id === expectedId) {
    sessionStorage.removeItem(UPLOAD_BATCH_SESSION_KEY);
  }
}

function makeBatchId(kind: 'upload' | 'update' = 'upload'): string {
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `drive-${kind}-${suffix}`;
}

function getOrCreateBatch(folderIds: string[], processWatermark: boolean): StoredUploadBatch {
  const normalizedIds = [...folderIds].sort();
  const stored = readStoredUploadBatch();
  if (
    stored
    && stored.processWatermark === processWatermark
    && stored.folderIds.length === normalizedIds.length
    && stored.folderIds.every((id, index) => id === normalizedIds[index])
  ) {
    return stored;
  }

  const batch = { id: makeBatchId(), folderIds: normalizedIds, processWatermark };
  storeUploadBatch(batch);
  return batch;
}

function readStoredUpdateBatch(): StoredUpdateBatch | null {
  try {
    const raw = sessionStorage.getItem(UPDATE_BATCH_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredUpdateBatch>;
    if (typeof value.id !== 'string' || !Array.isArray(value.storyIds)) return null;
    return {
      id: value.id,
      storyIds: value.storyIds.filter((item): item is string => typeof item === 'string'),
    };
  } catch {
    return null;
  }
}

function getOrCreateUpdateBatch(storyIds: string[]): StoredUpdateBatch {
  const normalizedIds = [...storyIds].sort();
  const stored = readStoredUpdateBatch();
  if (
    stored
    && stored.storyIds.length === normalizedIds.length
    && stored.storyIds.every((id, index) => id === normalizedIds[index])
  ) {
    return stored;
  }

  const batch = { id: makeBatchId('update'), storyIds: normalizedIds };
  sessionStorage.setItem(UPDATE_BATCH_SESSION_KEY, JSON.stringify(batch));
  return batch;
}

function clearStoredUpdateBatch(expectedId: string) {
  const stored = readStoredUpdateBatch();
  if (stored?.id === expectedId) sessionStorage.removeItem(UPDATE_BATCH_SESSION_KEY);
}

function isActiveJobStatus(status: SyncJobStatus): status is 'queued' | 'running' {
  return status === 'queued' || status === 'running';
}

function toTrackedJob(job: SyncJob): TrackedJob {
  return {
    jobId: job.id,
    folderId: job.folder_id,
    displayName: job.display_name,
    status: job.status,
    clientBatchId: job.client_batch_id,
  };
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
  const [processUploadWatermark, setProcessUploadWatermark] = useState(true);
  const [uploadableData, setUploadableData] = useState<CheckUploadableResponse | null>(null);
  const [uploadableLoading, setUploadableLoading] = useState(false);
  const [uploadableError, setUploadableError] = useState('');
  const [uploadResults, setUploadResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [uploadingJobs, setUploadingJobs] = useState<Map<string, string>>(new Map());
  const [uploadBatchTotal, setUploadBatchTotal] = useState(
    () => readStoredUploadBatch()?.folderIds.length ?? 0,
  );
  const [uploadPollingError, setUploadPollingError] = useState('');
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

  const hasActiveTrackedJobs = trackedJobs.length > 0;

  useEffect(() => {
    let cancelled = false;

    const rehydrate = async () => {
      try {
        const storedBatch = readStoredUploadBatch();
        const { jobs } = storedBatch
          ? await listJobs(500, 0, { kind: 'upload_single' })
          : await listActiveUploadJobs();
        if (cancelled) return;

        const storedBatchJobs = storedBatch
          ? jobs.filter((job) => job.client_batch_id === storedBatch.id)
          : [];
        const terminalBatchJobs = storedBatchJobs.filter((job) => !isActiveJobStatus(job.status));
        if (terminalBatchJobs.length > 0) {
          setUploadResults((prev) => {
            const next = new Map(prev);
            for (const job of terminalBatchJobs) {
              next.set(job.folder_id, {
                success: job.status === 'success',
                message: job.status === 'success'
                  ? (job.result_message ?? 'Done')
                  : (job.error ?? (job.status === 'cancelled' ? 'Upload cancelled' : 'Upload failed')),
              });
            }
            return next;
          });
        }

        const activeJobs = jobs.filter((job) => isActiveJobStatus(job.status));
        if (activeJobs.length === 0) {
          if (trackedJobsRef.current.length === 0) {
            clearStoredUploadBatch();
            setUploadBatchTotal(storedBatchJobs.length);
          }
          return;
        }

        const restored = activeJobs.map(toTrackedJob);
        for (const job of restored) uploadLocksRef.current.add(job.folderId);

        setTrackedJobs((prev) => {
          const byId = new Map(prev.map((job) => [job.jobId, job]));
          for (const job of restored) byId.set(job.jobId, job);
          const next = Array.from(byId.values());
          trackedJobsRef.current = next;
          return next;
        });
        setUploadingJobs((prev) => {
          const next = new Map(prev);
          for (const job of restored) next.set(job.folderId, job.jobId);
          return next;
        });
        setUploadBatchTotal((prev) => Math.max(
          prev,
          storedBatch?.folderIds.length ?? 0,
          storedBatchJobs.length,
          restored.length,
        ));
      } catch (error) {
        if (!cancelled) {
          setUploadPollingError(
            error instanceof Error
              ? `Could not restore active uploads: ${error.message}`
              : 'Could not restore active uploads.',
          );
        }
      }
    };

    void rehydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasActiveTrackedJobs) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;

    const schedule = (delay: number) => {
      if (!cancelled && trackedJobsRef.current.length > 0) {
        timeoutId = setTimeout(() => void poll(), delay);
      }
    };

    const poll = async () => {
      const snapshot = trackedJobsRef.current;
      if (cancelled || snapshot.length === 0) return;

      try {
        const { jobs } = await queryJobs(snapshot.map((job) => job.jobId));
        if (cancelled) return;

        consecutiveFailures = 0;
        setUploadPollingError('');
        const returnedById = new Map(jobs.map((job) => [job.id, job]));
        const terminalJobs: Array<{ tracked: TrackedJob; job: SyncJob }> = [];
        const nextTracked = snapshot.flatMap((tracked) => {
          const job = returnedById.get(tracked.jobId);
          if (!job) return [tracked];
          if (isActiveJobStatus(job.status)) {
            return [{ ...tracked, status: job.status, clientBatchId: job.client_batch_id }];
          }
          terminalJobs.push({ tracked, job });
          return [];
        });

        trackedJobsRef.current = nextTracked;
        setTrackedJobs(nextTracked);

        if (terminalJobs.length > 0) {
          setUploadResults((prev) => {
            const next = new Map(prev);
            for (const { tracked, job } of terminalJobs) {
              next.set(tracked.folderId, {
                success: job.status === 'success',
                message: job.status === 'success'
                  ? (job.result_message ?? 'Done')
                  : (job.error ?? (job.status === 'cancelled' ? 'Upload cancelled' : 'Upload failed')),
              });
            }
            return next;
          });
          setUploadingJobs((prev) => {
            const next = new Map(prev);
            for (const { tracked } of terminalJobs) {
              next.delete(tracked.folderId);
              uploadLocksRef.current.delete(tracked.folderId);
            }
            return next;
          });
        }

        if (nextTracked.length === 0) {
          const batchId = snapshot.find((job) => job.clientBatchId)?.clientBatchId;
          clearStoredUploadBatch(batchId ?? undefined);
          return;
        }

        schedule(UPLOAD_POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        consecutiveFailures += 1;
        const delay = Math.min(
          UPLOAD_POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailures, 3),
          UPLOAD_POLL_MAX_BACKOFF_MS,
        );
        const message = error instanceof Error ? error.message : 'Status request failed';
        setUploadPollingError(
          `Upload status refresh failed (${message}). Retrying in ${Math.ceil(delay / 1000)}s.`,
        );
        schedule(delay);
      }
    };

    schedule(0);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
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
      setUploadResults((prev) => {
        const next = new Map(prev);
        next.delete(folder.id);
        return next;
      });
      setUploadingJobs((prev) => new Map(prev).set(folder.id, 'pending'));
      setUploadPollingError('');
      setUploadBatchTotal((prev) => Math.max(prev, trackedJobsRef.current.length + 1));

      try {
        const response = await createJob({
          kind: 'upload_single',
          folder_id: folder.id,
          folder_name: folder.name,
          display_name: folder.display_name,
          main_be_api_base_url: config?.main_be_api_base_url,
          payload: { process_watermark: processUploadWatermark },
        });

        setTrackedJobs((prev) =>
          prev.some((job) => job.jobId === response.id)
            ? prev
            : [...prev, {
                jobId: response.id,
                folderId: folder.id,
                displayName: folder.display_name,
                status: response.status,
              }],
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

    const folders = uploadableData.uploadable.filter(
      (folder) => !uploadLocksRef.current.has(folder.id),
    );
    if (folders.length === 0) return;

    for (const folder of folders) uploadLocksRef.current.add(folder.id);
    setUploadResults((prev) => {
      const next = new Map(prev);
      for (const folder of folders) next.delete(folder.id);
      return next;
    });
    setUploadingJobs((prev) => {
      const next = new Map(prev);
      for (const folder of folders) next.set(folder.id, 'pending');
      return next;
    });
    setUploadPollingError('');
    setUploadBatchTotal(folders.length);

    const batch = getOrCreateBatch(
      folders.map((folder) => folder.id),
      processUploadWatermark,
    );

    try {
      const response = await createJobsBatch({
        client_batch_id: batch.id,
        jobs: folders.map((folder) => ({
          kind: 'upload_single',
          folder_id: folder.id,
          folder_name: folder.name,
          display_name: folder.display_name,
          main_be_api_base_url: config?.main_be_api_base_url,
          payload: { process_watermark: processUploadWatermark },
        })),
      });

      const returnedJobs = response.jobs.slice(0, folders.length);
      const newJobs = returnedJobs.map((job, index): TrackedJob => ({
        jobId: job.id,
        folderId: folders[index].id,
        displayName: folders[index].display_name,
        status: job.status,
        clientBatchId: response.client_batch_id,
      }));

      setTrackedJobs((prev) => {
        const byId = new Map(prev.map((job) => [job.jobId, job]));
        for (const job of newJobs) byId.set(job.jobId, job);
        const next = Array.from(byId.values());
        trackedJobsRef.current = next;
        return next;
      });
      setUploadingJobs((prev) => {
        const next = new Map(prev);
        for (const [index, folder] of folders.entries()) {
          const job = returnedJobs[index];
          if (job) next.set(folder.id, job.id);
          else next.delete(folder.id);
        }
        return next;
      });

      if (returnedJobs.length < folders.length) {
        const missing = folders.slice(returnedJobs.length);
        for (const folder of missing) uploadLocksRef.current.delete(folder.id);
        setUploadResults((prev) => {
          const next = new Map(prev);
          for (const folder of missing) {
            next.set(folder.id, {
              success: false,
              message: 'The server did not return a job for this story.',
            });
          }
          return next;
        });
      }
    } catch (e) {
      for (const folder of folders) uploadLocksRef.current.delete(folder.id);
      setUploadingJobs((prev) => {
        const next = new Map(prev);
        for (const folder of folders) next.delete(folder.id);
        return next;
      });
      setUploadResults((prev) => {
        const next = new Map(prev);
        for (const folder of folders) {
          next.set(folder.id, {
            success: false,
            message: e instanceof Error ? e.message : 'Failed to enqueue upload batch',
          });
        }
        return next;
      });
      setUploadPollingError(
        'The batch request may have reached the server. Retrying Upload All will reuse the same batch ID and will not duplicate jobs.',
      );
    }
  }, [uploadableData, config, processUploadWatermark]);

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

      const available = entries.filter((entry) => {
        const lockKey = entry.server_story.id || entry.folder.id;
        return !updateLocksRef.current.has(lockKey);
      });
      if (available.length === 0) return;

      for (const entry of available) {
        updateLocksRef.current.add(entry.server_story.id || entry.folder.id);
      }
      setUpdateResults((prev) => {
        const next = new Map(prev);
        for (const entry of available) next.delete(entry.server_story.id);
        return next;
      });
      setUpdatingJobs((prev) => {
        const next = new Map(prev);
        for (const entry of available) next.set(entry.server_story.id, 'pending');
        return next;
      });

      const batch = getOrCreateUpdateBatch(available.map((entry) => entry.server_story.id));

      try {
        const response = await createJobsBatch({
          client_batch_id: batch.id,
          jobs: available.map((entry) => ({
            kind: 'update_single',
            folder_id: entry.folder.id,
            folder_name: entry.folder.display_name,
            display_name: entry.folder.display_name,
            main_be_api_base_url: config?.main_be_api_base_url,
            chapters_count: chapterInputs.get(entry.server_story.id) ?? 1,
          })),
        });

        const returnedJobs = response.jobs.slice(0, available.length);
        setUpdatingJobs((prev) => {
          const next = new Map(prev);
          for (const [index, entry] of available.entries()) {
            const job = returnedJobs[index];
            if (job) next.set(entry.server_story.id, job.id);
            else next.delete(entry.server_story.id);
          }
          return next;
        });

        for (const [index, job] of returnedJobs.entries()) {
          const entry = available[index];
          const lockKey = entry.server_story.id || entry.folder.id;
          pollUpdate(job.id, entry.server_story.id, lockKey, setUpdateResults, setUpdatingJobs, updateLocksRef);
        }

        if (returnedJobs.length < available.length) {
          setUpdateResults((prev) => {
            const next = new Map(prev);
            for (const entry of available.slice(returnedJobs.length)) {
              updateLocksRef.current.delete(entry.server_story.id || entry.folder.id);
              next.set(entry.server_story.id, {
                success: false,
                message: 'The server did not return a job for this story.',
              });
            }
            return next;
          });
        }

        clearStoredUpdateBatch(response.client_batch_id);
      } catch (error) {
        for (const entry of available) {
          updateLocksRef.current.delete(entry.server_story.id || entry.folder.id);
        }
        setUpdatingJobs((prev) => {
          const next = new Map(prev);
          for (const entry of available) next.delete(entry.server_story.id);
          return next;
        });
        setUpdateResults((prev) => {
          const next = new Map(prev);
          for (const entry of available) {
            next.set(entry.server_story.id, {
              success: false,
              message: error instanceof Error ? error.message : 'Failed to enqueue update batch',
            });
          }
          return next;
        });
      }
    },
    [config, processUploadWatermark],
  );

  const pendingUploadCount = Array.from(uploadingJobs.values()).filter(
    (jobId) => jobId === 'pending',
  ).length;
  const queuedUploadCount = pendingUploadCount + trackedJobs.filter(
    (job) => job.status !== 'running',
  ).length;
  const runningUploadCount = trackedJobs.filter((job) => job.status === 'running').length;
  const completedUploadCount = Array.from(uploadResults.values()).filter((result) => result.success).length;
  const failedUploadCount = Array.from(uploadResults.values()).filter((result) => !result.success).length;
  const observedUploadTotal = queuedUploadCount
    + runningUploadCount
    + completedUploadCount
    + failedUploadCount;
  const uploadProgress: DriveSyncUploadProgress | null = uploadBatchTotal > 0 || observedUploadTotal > 0
    ? {
        total: Math.max(uploadBatchTotal, observedUploadTotal),
        queued: queuedUploadCount,
        running: runningUploadCount,
        completed: completedUploadCount,
        failed: failedUploadCount,
      }
    : null;

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
              uploadProgress={uploadProgress}
              uploadPollingError={uploadPollingError}
              processUploadWatermark={processUploadWatermark}
              onProcessUploadWatermarkChange={setProcessUploadWatermark}
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
