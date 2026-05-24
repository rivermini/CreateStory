import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getDriveSyncConfig,
  initDriveSyncConfig,
  checkUploadable,
  checkUpdatable,
  createJob,
  getJob,
  FIXED_JSON_PREFIX,
  type DriveSyncConfig,
  type DriveFolderEntry,
  type UpdatableStoryEntry,
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type TrackedJob,
} from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';
import { StorySyncTabs, type StorySyncTab } from '../components/StorySyncTabs';
import { ConfigModal, type ConfigFormData } from '../components/ConfigModal';

interface DriveSyncPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

// ─── Job tracking types ─────────────────────────────────────────────────────────

export function DriveSyncPage({ themeMode }: DriveSyncPageProps) {
  const isDark = themeMode === 'dark';

  // ── Config ──────────────────────────────────────────────────────────────────
  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [isInitialSetup, setIsInitialSetup] = useState(false);

  const [configForm, setConfigForm] = useState<ConfigFormData>({
    folder_id: '',
    service_account_json_name: 'nova-crawler-drive-sync-445ff578305c.json',
    main_be_api_base_url: '',
    main_be_bearer_token: '',
    main_be_user_id: '',
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingConfigError, setSavingConfigError] = useState('');

  // ── Active jobs being tracked (job_id → folder info) ────────────────────────
  const [trackedJobs, setTrackedJobs] = useState<TrackedJob[]>([]);

  // ── Tabs ─────────────────────────────────────────────────────────────────────
  const [activeSubTab, setActiveSubTab] = useState<StorySyncTab>('uploadable');

  // ── Uploadable ────────────────────────────────────────────────────────────────
  const [uploadableData, setUploadableData] = useState<CheckUploadableResponse | null>(() => {
    try {
      const stored = sessionStorage.getItem('drivesync_uploadableData');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [uploadableLoading, setUploadableLoading] = useState(false);
  const [uploadableError, setUploadableError] = useState(() => {
    return sessionStorage.getItem('drivesync_uploadableError') ?? '';
  });
  // ── Upload results (folderId → result) ─────────────────────────────────────
  const [uploadResults, setUploadResults] = useState<Map<string, { success: boolean; message: string }>>(() => {
    try {
      const stored = sessionStorage.getItem('drivesync_uploadResults');
      return stored ? new Map(JSON.parse(stored)) : new Map();
    } catch {
      return new Map();
    }
  });

  // ── Updatable ─────────────────────────────────────────────────────────────────
  const [updatableData, setUpdatableData] = useState<CheckUpdatableResponse | null>(() => {
    try {
      const stored = sessionStorage.getItem('drivesync_updatableData');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [updatableLoading, setUpdatableLoading] = useState(false);
  const [updatableError, setUpdatableError] = useState(() => {
    return sessionStorage.getItem('drivesync_updatableError') ?? '';
  });
  const [updateResults, setUpdateResults] = useState<Map<string, { success: boolean; message: string }>>(() => {
    try {
      const stored = sessionStorage.getItem('drivesync_updateResults');
      return stored ? new Map(JSON.parse(stored)) : new Map();
    } catch {
      return new Map();
    }
  });
  // ── Active update jobs being tracked (server story id → job id) ─────────────────
  const [updatingJobs, setUpdatingJobs] = useState<Map<string, string>>(new Map());

  // ── Load config on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    setConfigLoading(true);
    getDriveSyncConfig()
      .then(cfg => {
        setConfig(cfg);
        if (cfg) {
          const fullCfg = cfg as DriveSyncConfig & { service_account_json_path?: string };
          const jsonName = fullCfg.service_account_json_path
            ? fullCfg.service_account_json_path.replace(FIXED_JSON_PREFIX, '')
            : 'nova-crawler-drive-sync-445ff578305c.json';
          setConfigForm(f => ({
            ...f,
            folder_id: cfg.folder_id,
            service_account_json_name: jsonName,
            main_be_api_base_url: cfg.main_be_api_base_url,
            main_be_user_id: (cfg as DriveSyncConfig & { main_be_user_id?: string }).main_be_user_id ?? '',
          }));
          setShowConfigModal(false);
        } else {
          setIsInitialSetup(true);
          setShowConfigModal(true);
        }
      })
      .catch(() => setConfigError('Failed to load config.'))
      .finally(() => setConfigLoading(false));
  }, []);

  // ── Config form helpers ───────────────────────────────────────────────────────
  const handleConfigFormChange = (data: Partial<ConfigFormData>) => {
    setConfigForm(prev => ({ ...prev, ...data }));
  };

  const handleSaveConfig = async () => {
    setSavingConfigError('');
    if (!configForm.folder_id.trim()) {
      setSavingConfigError('Folder ID is required.');
      return;
    }
    setSavingConfig(true);

    try {
      const cfg = await initDriveSyncConfig({
        folder_id: configForm.folder_id.trim(),
        service_account_json_path: FIXED_JSON_PREFIX + configForm.service_account_json_name.trim(),
        main_be_api_base_url: configForm.main_be_api_base_url.trim(),
        main_be_user_id: configForm.main_be_user_id.trim(),
        main_be_bearer_token: configForm.main_be_bearer_token.trim() || undefined,
      });
      setConfig(cfg);
      setShowConfigModal(false);
    } catch (e) {
      setSavingConfigError(e instanceof Error ? e.message : 'Failed to save config.');
    } finally {
      setSavingConfig(false);
    }
  };

  // ─── Job polling ─────────────────────────────────────────────────────────────

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll active jobs every 4 seconds
  useEffect(() => {
    const doPoll = async () => {
      if (trackedJobs.length === 0) return;

      const completedIds: string[] = [];

      for (const tracked of trackedJobs) {
        try {
          const { job } = await getJob(tracked.jobId);

          if (job.status === 'queued' || job.status === 'running') {
            continue;
          }

          completedIds.push(tracked.jobId);

          if (job.status === 'success') {
            setUploadResults(prev => {
              const next = new Map(prev).set(tracked.folderId, {
                success: true,
                message: job.result_message ?? 'Done',
              });
              sessionStorage.setItem('drivesync_uploadResults', JSON.stringify([...next]));
              return next;
            });
          } else {
            setUploadResults(prev => {
              const next = new Map(prev).set(tracked.folderId, {
                success: false,
                message: job.error ?? 'Upload failed',
              });
              sessionStorage.setItem('drivesync_uploadResults', JSON.stringify([...next]));
              return next;
            });
          }
        } catch {
          // Job might not be available yet, skip
        }
      }

      if (completedIds.length > 0) {
        setTrackedJobs(prev => prev.filter(j => !completedIds.includes(j.jobId)));
      }
    };

    const interval = setInterval(doPoll, 4000);
    return () => clearInterval(interval);
  }, [trackedJobs]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ─── Enqueue helpers ────────────────────────────────────────────────────────
  const handleCheckUploadable = async () => {
    setUploadableLoading(true);
    setUploadableError('');
    setUploadResults(new Map());
    try {
      const data = await checkUploadable();
      setUploadableData(data);
      sessionStorage.setItem('drivesync_uploadableData', JSON.stringify(data));
      sessionStorage.setItem('drivesync_uploadableError', '');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to check uploadable stories.';
      setUploadableError(msg);
      sessionStorage.setItem('drivesync_uploadableError', msg);
      sessionStorage.removeItem('drivesync_uploadableData');
    } finally {
      setUploadableLoading(false);
    }
  };

  const handleUploadSingle = useCallback(async (folder: DriveFolderEntry): Promise<string> => {
    const res = await createJob({
      kind: 'upload_single',
      folder_id: folder.id,
      folder_name: folder.name,
      display_name: folder.display_name,
    });

    setTrackedJobs(prev => [...prev, { jobId: res.id, folderId: folder.id, displayName: folder.display_name }]);
    return res.id;
  }, []);

  const handleUploadAll = useCallback(async () => {
    if (!uploadableData) return;

    const folders = uploadableData.uploadable;
    if (folders.length === 0) return;

    const newJobs: TrackedJob[] = [];
    for (const folder of folders) {
      try {
        const res = await createJob({
          kind: 'upload_single',
          folder_id: folder.id,
          folder_name: folder.name,
          display_name: folder.display_name,
        });
        newJobs.push({ jobId: res.id, folderId: folder.id, displayName: folder.display_name });
      } catch (e) {
        setUploadResults(prev => {
          const next = new Map(prev).set(folder.id, {
            success: false,
            message: e instanceof Error ? e.message : 'Failed to enqueue job',
          });
          sessionStorage.setItem('drivesync_uploadResults', JSON.stringify([...next]));
          return next;
        });
      }
    }

    if (newJobs.length > 0) {
      setTrackedJobs(prev => [...prev, ...newJobs]);
    }
  }, [uploadableData]);

  // ── Updatable handlers ─────────────────────────────────────────────────────────
  const handleCheckUpdatable = async () => {
    setUpdatableLoading(true);
    setUpdatableError('');
    setUpdateResults(new Map());
    try {
      const data = await checkUpdatable();
      setUpdatableData(data);
      sessionStorage.setItem('drivesync_updatableData', JSON.stringify(data));
      sessionStorage.setItem('drivesync_updatableError', '');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to check updatable stories.';
      setUpdatableError(msg);
      sessionStorage.setItem('drivesync_updatableError', msg);
      sessionStorage.removeItem('drivesync_updatableData');
    } finally {
      setUpdatableLoading(false);
    }
  };

  const handleUpdateSingle = useCallback(async (entry: UpdatableStoryEntry): Promise<string> => {
    const { server_story, folder } = entry;

    // Create a sync job so it appears in the history page
    let jobId: string;
    try {
      const job = await createJob({
        kind: 'update_single',
        folder_id: folder.id,
        folder_name: folder.display_name,
        display_name: folder.display_name,
      });
      jobId = job.id;
      setUpdatingJobs(prev => new Map(prev).set(server_story.id, jobId));
    } catch (e) {
      setUpdateResults(prev => {
        const next = new Map(prev).set(server_story.id, {
          success: false,
          message: e instanceof Error ? e.message : 'Failed to create update job',
        });
        sessionStorage.setItem('drivesync_updateResults', JSON.stringify([...next]));
        return next;
      });
      return server_story.id;
    }

    // Poll the job until it finishes
    const poll = async () => {
      while (true) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const { job } = await getJob(jobId);
          if (job.status !== 'queued' && job.status !== 'running') {
            setUpdateResults(prev => {
              const next = new Map(prev).set(server_story.id, {
                success: job.status === 'success',
                message: job.result_message ?? (job.status === 'success' ? 'Updated' : job.error ?? 'Update failed'),
              });
              sessionStorage.setItem('drivesync_updateResults', JSON.stringify([...next]));
              return next;
            });
            setUpdatingJobs(prev => {
              const next = new Map(prev);
              next.delete(server_story.id);
              return next;
            });
            return;
          }
        } catch {
          // Keep polling
        }
      }
    };
    poll();

    return server_story.id;
  }, []);

  const handleUpdateAll = useCallback(async () => {
    if (!updatableData) return;
    const entries = updatableData.updatable;
    if (entries.length === 0) return;
    for (const entry of entries) {
      handleUpdateSingle(entry);
    }
  }, [updatableData, handleUpdateSingle]);

  return (
    <div className={`min-h-screen flex flex-col ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
      <main className="xl:w-[68vw] px-4 sm:px-6 py-6 sm:py-8 flex flex-col flex-1 mx-auto">

        {/* ── Page Header ───────────────────────────────── */}
        <div className="mb-6">
          <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            Drive Sync
          </h1>
          <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            Sync your crawled novels with Google Drive
          </p>
        </div>

        {/* ── Loading / Error states ───────────────────────────────── */}
        {configLoading && (
          <div className={`flex items-center gap-3 p-4 mb-6 rounded-2xl ${isDark ? 'bg-slate-900/60 border border-slate-800/60' : 'bg-white border border-gray-200'}`}>
            <svg className="w-5 h-5 animate-spin text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Loading Drive Sync config...</span>
          </div>
        )}

        {configError && (
          <div className={`flex items-center gap-3 p-4 mb-6 rounded-2xl text-sm ${isDark ? 'bg-red-900/20 border border-red-800/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {configError}
          </div>
        )}

        {/* ── Main content ─────────────────────────────────────── */}
        {config && !configLoading && (
          <>
            {/* ── Config summary bar ─────────────────────────────── */}
            <div className={`flex flex-wrap items-center gap-4 mb-6 px-4 py-3 rounded-2xl text-sm ${isDark ? 'bg-slate-900/60 border border-slate-800/60' : 'bg-white border border-gray-200'}`}>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className={isDark ? 'text-slate-300' : 'text-gray-700'}>Drive Sync Active</span>
              </div>
              <span className={isDark ? 'text-slate-600' : 'text-gray-300'}>|</span>
              <span className={isDark ? 'text-slate-400' : 'text-gray-500'}>
                Folder: <span className={`${isDark ? 'text-slate-300' : 'text-gray-700'} font-mono text-xs`}>{config.folder_id.slice(0, 20)}...</span>
              </span>
              <span className={isDark ? 'text-slate-600' : 'text-gray-300'}>|</span>
              <span className={isDark ? 'text-slate-400' : 'text-gray-500'}>Manual sync only</span>
              <button
                onClick={() => setShowConfigModal(true)}
                className={`text-xs transition-colors flex items-center gap-1.5 ml-auto ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </button>
            </div>

            {/* ── Story Sync ───────────────────────────────────── */}
            <div className="min-h-[600px] flex-1">
              <StorySyncTabs
                config={config}
                activeTab={activeSubTab}
                onTabChange={setActiveSubTab}
                themeMode={themeMode}
                uploadableData={uploadableData}
                uploadableLoading={uploadableLoading}
                uploadableError={uploadableError}
                uploadResults={uploadResults}
                uploadingIds={(() => {
                  const s = new Set<string>();
                  for (const j of trackedJobs) s.add(j.folderId);
                  return s;
                })()}
                onCheckUploadable={handleCheckUploadable}
                onUploadSingle={handleUploadSingle}
                onUploadAll={handleUploadAll}
                updatableData={updatableData}
                updatableLoading={updatableLoading}
                updatableError={updatableError}
                updateResults={updateResults}
                updatingIds={new Set(updatingJobs.keys())}
                onCheckUpdatable={handleCheckUpdatable}
                onUpdateSingle={handleUpdateSingle}
                onUpdateAll={handleUpdateAll}
                updatableInvalid={updatableData?.invalid ?? []}
              />
            </div>
          </>
        )}
      </main>

      {/* ── Config Modal ──────────────────────────────────────────────── */}
      <ConfigModal
        isOpen={showConfigModal}
        onClose={() => {
          if (!config && !configLoading) return; // prevent closing during initial setup
          setShowConfigModal(false);
        }}
        config={config}
        configForm={configForm}
        onFormChange={handleConfigFormChange}
        onSave={handleSaveConfig}
        savingConfig={savingConfig}
        savingConfigError={savingConfigError}
        isInitialSetup={isInitialSetup}
        themeMode={themeMode}
      />
    </div>
  );
}
