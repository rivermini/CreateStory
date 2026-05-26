import { useEffect, useState, useCallback } from 'react';
import {
  getDriveSyncConfig,
  initDriveSyncConfig,
  checkUploadable,
  checkUpdatable,
  checkUpdatableReaderFinished,
  createJob,
  getJob,
  getStoriesNeedingUpdate,
  FIXED_JSON_PREFIX,
  type DriveSyncConfig,
  type DriveFolderEntry,
  type UpdatableStoryEntry,
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type TrackedJob,
  type StoriesNeedingUpdateEntry,
} from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';
import { StorySyncTabs, type StorySyncTab } from '../components/StorySyncTabs';
import { ConfigModal, type ConfigFormData } from '../components/ConfigModal';
import { ServerModeBanner } from '../components/ServerModeBanner';
import { showToast } from '../components/Toast';

interface DriveSyncPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function DriveSyncPage({ themeMode }: DriveSyncPageProps) {
  const isDark = themeMode === 'dark';

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

  const [trackedJobs, setTrackedJobs] = useState<TrackedJob[]>([]);

  const [activeSubTab, setActiveSubTab] = useState<StorySyncTab>('uploadable');

  const [uploadableData, setUploadableData] = useState<CheckUploadableResponse | null>(null);
  const [uploadableLoading, setUploadableLoading] = useState(false);
  const [uploadableError, setUploadableError] = useState('');
  const [uploadResults, setUploadResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());

  const [updatableData, setUpdatableData] = useState<CheckUpdatableResponse | null>(null);
  const [updatableLoading, setUpdatableLoading] = useState(false);
  const [updatableError, setUpdatableError] = useState('');
  const [updateResults, setUpdateResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [updatingJobs, setUpdatingJobs] = useState<Map<string, string>>(new Map());
  const [storiesNeedingUpdate, setStoriesNeedingUpdate] = useState<StoriesNeedingUpdateEntry[]>([]);

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
      showToast('Drive Sync configuration saved successfully.', 'success', 2000, 'top-center');
    } catch (e) {
      setSavingConfigError(e instanceof Error ? e.message : 'Failed to save config.');
    } finally {
      setSavingConfig(false);
    }
  };

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
              return next;
            });
          } else {
            setUploadResults(prev => {
              const next = new Map(prev).set(tracked.folderId, {
                success: false,
                message: job.error ?? 'Upload failed',
              });
              return next;
            });
          }
        } catch {
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
      const msg = e instanceof Error ? e.message : 'Failed to check uploadable stories.';
      setUploadableError(msg);
      setUploadableData(null);
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
      main_be_api_base_url: config?.main_be_api_base_url,
    });

    setTrackedJobs(prev => [...prev, { jobId: res.id, folderId: folder.id, displayName: folder.display_name }]);
    return res.id;
  }, [config]);

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
          main_be_api_base_url: config?.main_be_api_base_url,
        });
        newJobs.push({ jobId: res.id, folderId: folder.id, displayName: folder.display_name });
      } catch (e) {
        setUploadResults(prev => {
          const next = new Map(prev).set(folder.id, {
            success: false,
            message: e instanceof Error ? e.message : 'Failed to enqueue job',
          });
          return next;
        });
      }
    }

    if (newJobs.length > 0) {
      setTrackedJobs(prev => [...prev, ...newJobs]);
    }
  }, [uploadableData, config]);

  const handleCheckUpdatable = async () => {
    setUpdatableData(null);
    setUpdatableLoading(true);
    setUpdatableError('');
    setUpdateResults(new Map());
    try {
      const [data, storiesResp] = await Promise.all([
        checkUpdatable(),
        getStoriesNeedingUpdate(),
      ]);
      setUpdatableData(data);
      setStoriesNeedingUpdate(storiesResp.success && storiesResp.data ? storiesResp.data.data : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to check updatable stories.';
      setUpdatableError(msg);
      setUpdatableData(null);
      setStoriesNeedingUpdate([]);
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
      const [data, storiesResp] = await Promise.all([
        checkUpdatableReaderFinished(),
        getStoriesNeedingUpdate(),
      ]);
      setUpdatableData(data);
      setStoriesNeedingUpdate(storiesResp.success && storiesResp.data ? storiesResp.data.data : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to check reader finished stories.';
      setUpdatableError(msg);
      setUpdatableData(null);
      setStoriesNeedingUpdate([]);
    } finally {
      setUpdatableLoading(false);
    }
  };

  const handleUpdateSingle = useCallback(async (entry: UpdatableStoryEntry, chaptersCount?: number): Promise<string> => {
    const { server_story, folder } = entry;

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
      setUpdatingJobs(prev => new Map(prev).set(server_story.id, jobId));
    } catch (e) {
      setUpdateResults(prev => {
        const next = new Map(prev).set(server_story.id, {
          success: false,
          message: e instanceof Error ? e.message : 'Failed to create update job',
        });
        return next;
      });
      return server_story.id;
    }

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
        }
      }
    };
    poll();

    return server_story.id;
  }, []);

  const handleUpdateAll = useCallback(async (entries: import('../api/client').UpdatableStoryEntry[], chapterInputs: Map<string, number>) => {
    if (entries.length === 0) return;
    for (const entry of entries) {
      const count = chapterInputs.get(entry.server_story.id) ?? 1;
      handleUpdateSingle(entry, count);
    }
  }, [handleUpdateSingle, config]);

  const hasActiveJobs = trackedJobs.length > 0 || updatingJobs.size > 0;
  const totalUploadable = uploadableData?.uploadable.length ?? 0;
  const totalUpdatable = updatableData?.updatable.length ?? 0;
  const successfulUploads = Array.from(uploadResults.values()).filter(r => r.success).length;

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
      {/* Hero Header */}
      <header className={`relative overflow-hidden ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div>
                <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Drive Sync
                </h1>
                <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                  Sync your crawled novels with Google Drive
                </p>
              </div>
            </div>

            {/* Settings Button */}
            <button
              onClick={() => setShowConfigModal(true)}
              className={`self-start sm:self-auto px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                isDark
                  ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/50'
                  : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-sm'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Drive Config Settings
            </button>
          </div>

          {/* Status Bar */}
          {config && !configLoading && (
            <div className={`mt-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 p-4 rounded-2xl ${isDark ? 'bg-slate-900/60 backdrop-blur-sm border border-slate-800/60' : 'bg-white/80 backdrop-blur-sm border border-gray-200/80'}`}>
              {/* Status indicator */}
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${hasActiveJobs ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                <span className={`text-sm font-medium ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                  {hasActiveJobs ? 'Syncing...' : 'Ready'}
                </span>
              </div>

              {/* Divider */}
              <div className={`hidden sm:block w-px h-5 ${isDark ? 'bg-slate-700' : 'bg-gray-200'}`} />

              {/* Folder info */}
              <div className="flex items-center gap-2 min-w-0">
                <svg className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className={`text-xs sm:text-sm truncate ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                  {config.folder_id}
                </span>
              </div>

              {/* Stats badges */}
              <div className="flex items-center gap-2 sm:ml-auto">
                <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-600'}`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {totalUploadable} ready to upload
                </div>
                <div className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-600'}`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  {totalUpdatable} can update
                </div>
                {successfulUploads > 0 && (
                  <div className={`hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-500`}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {successfulUploads} uploaded
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-2">
        {/* Loading state */}
        {configLoading && (
          <div className={`flex items-center justify-center gap-4 p-8 rounded-2xl ${isDark ? 'bg-slate-900/60 border border-slate-800/60' : 'bg-white border border-gray-200'}`}>
            <svg className="w-6 h-6 animate-spin text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Loading Drive Sync...</span>
          </div>
        )}

        {/* Error state */}
        {configError && (
          <div className={`flex items-center gap-3 p-4 rounded-2xl text-sm ${isDark ? 'bg-red-900/20 border border-red-800/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {configError}
          </div>
        )}

        {/* Main content */}
        {config && !configLoading && (
          <div className="mt-2">
            {/* Server Mode Banner */}
            <ServerModeBanner serverUrl={config.main_be_api_base_url} isDark={isDark} />

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
              onCheckReaderFinished={handleCheckReaderFinished}
              onUpdateSingle={handleUpdateSingle}
              onUpdateAll={handleUpdateAll}
              updatableInvalid={updatableData?.invalid ?? []}
              updatableNoServerMatch={updatableData?.no_server_match ?? []}
              updatableEmptyExtended={updatableData?.empty_extended ?? []}
              storiesNeedingUpdate={storiesNeedingUpdate}
            />
          </div>
        )}
      </main>

      {/* Config Modal */}
      <ConfigModal
        isOpen={showConfigModal}
        onClose={() => {
          if (!config && !configLoading) return;
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
