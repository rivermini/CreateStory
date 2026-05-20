import { useCallback, useEffect, useState } from 'react';
import {
  getDriveSyncConfig,
  initDriveSyncConfig,
  syncSingleDriveFolder,
  checkUploadable,
  checkUpdatable,
  updateChapterCount,
  getHistory,
  addHistoryEntry,
  updateHistoryEntry,
  deleteHistoryEntries,
  type DriveSyncConfig,
  type DriveFolderEntry,
  type UpdatableStoryEntry,
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type HistoryEntry,
  type HistoryItem,
} from '../api/client';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';
import { ActionHistoryPanel } from '../components/ActionHistoryPanel';
import { StorySyncTabs, type StorySyncTab } from '../components/StorySyncTabs';
import { ConfigModal, type ConfigFormData } from '../components/ConfigModal';

interface DriveSyncPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

export function DriveSyncPage({ themeMode, onThemeChange }: DriveSyncPageProps) {
  // ── Config ──────────────────────────────────────────────────────────────────
  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [isInitialSetup, setIsInitialSetup] = useState(false);

  const FIXED_USER_ID = '3b2fae40-e482-4ea1-af7a-96e35ecfbf5f';
  const FIXED_BE_URL = 'https://api-novel.santngo.com';
  const FIXED_JSON_PREFIX = 'credentials/';
  const [configForm, setConfigForm] = useState<ConfigFormData>({
    folder_id: '',
    service_account_json_name: 'nova-crawler-drive-sync-445ff578305c.json',
    schedule_enabled: true,
    schedule_hour: 6,
    schedule_minute: 0,
    main_be_bearer_token: '',
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingConfigError, setSavingConfigError] = useState('');

  // ── Tabs ─────────────────────────────────────────────────────────────────────
  const [activeSubTab, setActiveSubTab] = useState<StorySyncTab>('uploadable');

  // ── Uploadable ────────────────────────────────────────────────────────────────
  const [uploadableData, setUploadableData] = useState<CheckUploadableResponse | null>(null);
  const [uploadableLoading, setUploadableLoading] = useState(false);
  const [uploadableError, setUploadableError] = useState('');
  const [uploadResults, setUploadResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());

  // ── Updatable ─────────────────────────────────────────────────────────────────
  const [updatableData, setUpdatableData] = useState<CheckUpdatableResponse | null>(null);
  const [updatableLoading, setUpdatableLoading] = useState(false);
  const [updatableError, setUpdatableError] = useState('');
  const [updateResults, setUpdateResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  // ── Action History ─────────────────────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const loadHistoryFromBE = useCallback(async () => {
    try {
      const data = await getHistory(200, 0);
      setHistory(data.entries);
    } catch {
      // silently fail — history is non-critical
    }
  }, []);

  // Load history on mount
  useEffect(() => {
    loadHistoryFromBE();
  }, [loadHistoryFromBE]);

  const addHistory = useCallback(async (entry: Omit<HistoryEntry, 'timestamp'>): Promise<string> => {
    try {
      const result = await addHistoryEntry(entry);
      // Re-fetch to get the server-side timestamp
      await loadHistoryFromBE();
      return result.id;
    } catch {
      // Fallback: add optimistically
      const newEntry: HistoryEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
      };
      setHistory(prev => [newEntry, ...prev].slice(0, 200));
      return entry.id;
    }
  }, [loadHistoryFromBE]);

  const updateHistory = useCallback(async (id: string, patch: Partial<HistoryEntry>) => {
    try {
      await updateHistoryEntry(id, patch);
      await loadHistoryFromBE();
    } catch {
      // Fallback: update locally
      setHistory(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    }
  }, [loadHistoryFromBE]);

  const handleDeleteHistory = useCallback(async (ids: string[]) => {
    try {
      await deleteHistoryEntries(ids);
      await loadHistoryFromBE();
    } catch {
      setHistory(prev => prev.filter(e => !ids.includes(e.id)));
    }
  }, [loadHistoryFromBE]);

  const handleClearAllHistory = useCallback(async () => {
    try {
      await deleteHistoryEntries([]);
      await loadHistoryFromBE();
    } catch {
      setHistory([]);
    }
  }, [loadHistoryFromBE]);

  const handleRetry = useCallback((_entry: HistoryEntry) => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

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
            schedule_enabled: cfg.schedule_enabled ?? true,
            schedule_hour: cfg.schedule_hour,
            schedule_minute: cfg.schedule_minute,
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

    const historyId = await addHistory({
      id: makeId(),
      kind: 'config_save',
      status: 'running',
      title: 'Saving Drive Sync config...',
      subtitle: configForm.folder_id.slice(0, 30) + (configForm.folder_id.length > 30 ? '...' : ''),
    });

    try {
      const cfg = await initDriveSyncConfig({
        folder_id: configForm.folder_id.trim(),
        service_account_json_path: FIXED_JSON_PREFIX + configForm.service_account_json_name.trim(),
        main_be_api_base_url: FIXED_BE_URL,
        main_be_user_id: FIXED_USER_ID,
        schedule_enabled: configForm.schedule_enabled,
        schedule_hour: configForm.schedule_hour,
        schedule_minute: configForm.schedule_minute,
        main_be_bearer_token: configForm.main_be_bearer_token.trim() || undefined,
      });
      setConfig(cfg);
      setShowConfigModal(false);
      updateHistory(historyId, {
        status: 'success',
        title: 'Drive Sync config saved',
        subtitle: configForm.folder_id.slice(0, 30) + (configForm.folder_id.length > 30 ? '...' : ''),
      });
    } catch (e) {
      updateHistory(historyId, {
        status: 'error',
        title: 'Failed to save config',
        error: e instanceof Error ? e.message : 'Unknown error',
      });
      setSavingConfigError(e instanceof Error ? e.message : 'Failed to save config.');
    } finally {
      setSavingConfig(false);
    }
  };

  // ── Uploadable handlers ─────────────────────────────────────────────────────────
  const handleCheckUploadable = async () => {
    setUploadableLoading(true);
    setUploadableError('');
    setUploadResults(new Map());
    try {
      const data = await checkUploadable();
      setUploadableData(data);
    } catch (e) {
      setUploadableError(e instanceof Error ? e.message : 'Failed to check uploadable stories.');
    } finally {
      setUploadableLoading(false);
    }
  };

  const handleUploadSingle = async (folder: DriveFolderEntry): Promise<string> => {
    setUploadingIds(prev => new Set(prev).add(folder.id));

    const historyId = await addHistory({
      id: makeId(),
      kind: 'upload_single',
      status: 'running',
      title: `Uploading: ${folder.display_name}`,
      subtitle: folder.prefix,
      items: [{ id: makeId(), label: folder.display_name, status: 'running' }],
    });

    try {
      const result = await syncSingleDriveFolder(folder.id);
      setUploadResults(prev => new Map(prev).set(folder.id, result));

      if (result.success) {
        updateHistory(historyId, { status: 'success', items: [{ id: makeId(), label: folder.display_name, status: 'success', message: result.message }] });
      } else {
        updateHistory(historyId, { status: 'error', error: result.message, items: [{ id: makeId(), label: folder.display_name, status: 'error', message: result.message }] });
      }
      return result.success ? 'success' : 'error';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setUploadResults(prev => new Map(prev).set(folder.id, { success: false, message: msg }));
      updateHistory(historyId, { status: 'error', error: msg, items: [{ id: makeId(), label: folder.display_name, status: 'error', message: msg }] });
      return 'error';
    } finally {
      setUploadingIds(prev => { const n = new Set(prev); n.delete(folder.id); return n; });
    }
  };

  const handleUploadAll = async () => {
    if (!uploadableData) return;
    const items: HistoryItem[] = uploadableData.uploadable
      .filter(f => f.is_valid_format)
      .map(f => ({ id: makeId(), label: f.display_name, status: 'running' }));

    const historyId = await addHistory({
      id: makeId(),
      kind: 'upload_batch',
      status: 'running',
      title: `Uploading ${items.length} stories...`,
      subtitle: 'Upload All',
      items,
    });

    let successCount = 0;
    let errorCount = 0;
    const updatedItems = [...items];

    for (let i = 0; i < uploadableData.uploadable.length; i++) {
      const folder = uploadableData.uploadable[i];
      if (!folder.is_valid_format) continue;

      try {
        const result = await syncSingleDriveFolder(folder.id);
        setUploadResults(prev => new Map(prev).set(folder.id, result));

        const itemIdx = updatedItems.findIndex(it => it.label === folder.display_name && it.status === 'running');
        if (itemIdx !== -1) {
          if (result.success) {
            successCount++;
            updatedItems[itemIdx] = { ...updatedItems[itemIdx], status: 'success', message: result.message };
          } else {
            errorCount++;
            updatedItems[itemIdx] = { ...updatedItems[itemIdx], status: 'error', message: result.message };
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Upload failed';
        errorCount++;
        const itemIdx = updatedItems.findIndex(it => it.label === folder.display_name && it.status === 'running');
        if (itemIdx !== -1) {
          updatedItems[itemIdx] = { ...updatedItems[itemIdx], status: 'error', message: msg };
        }
      }

      updateHistory(historyId, { items: [...updatedItems] });
    }

    updateHistory(historyId, {
      status: errorCount === 0 ? 'success' : successCount === 0 ? 'error' : 'success',
      title: `Upload All — ${successCount} succeeded${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
      subtitle: `${uploadableData.uploadable.filter(f => f.is_valid_format).length} total`,
    });
  };

  // ── Updatable handlers ─────────────────────────────────────────────────────────
  const handleCheckUpdatable = async () => {
    setUpdatableLoading(true);
    setUpdatableError('');
    setUpdateResults(new Map());
    try {
      const data = await checkUpdatable();
      setUpdatableData(data);
    } catch (e) {
      setUpdatableError(e instanceof Error ? e.message : 'Failed to check updatable stories.');
    } finally {
      setUpdatableLoading(false);
    }
  };

  const handleUpdateSingle = async (entry: UpdatableStoryEntry): Promise<string> => {
    const { server_story, folder } = entry;
    setUpdatingIds(prev => new Set(prev).add(server_story.id));

    const delta = (folder.chapter_count ?? 0) - server_story.maxChapter;
    const historyId = await addHistory({
      id: makeId(),
      kind: 'update_single',
      status: 'running',
      title: `Updating: ${folder.display_name}`,
      subtitle: `+${delta} chapters`,
      items: [{ id: makeId(), label: `${folder.display_name} (${server_story.maxChapter} → ${folder.chapter_count ?? 0})`, status: 'running' }],
    });

    try {
      const result = await updateChapterCount(server_story.id, folder.chapter_count ?? 0);
      setUpdateResults(prev => new Map(prev).set(server_story.id, { success: result.success, message: result.message }));

      if (result.success) {
        updateHistory(historyId, { status: 'success', items: [{ id: makeId(), label: folder.display_name, status: 'success', message: result.message }] });
      } else {
        updateHistory(historyId, { status: 'error', error: result.message, items: [{ id: makeId(), label: folder.display_name, status: 'error', message: result.message }] });
      }
      return result.success ? 'success' : 'error';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setUpdateResults(prev => new Map(prev).set(server_story.id, { success: false, message: msg }));
      updateHistory(historyId, { status: 'error', error: msg, items: [{ id: makeId(), label: folder.display_name, status: 'error', message: msg }] });
      return 'error';
    } finally {
      setUpdatingIds(prev => { const n = new Set(prev); n.delete(server_story.id); return n; });
    }
  };

  const handleUpdateAll = async () => {
    if (!updatableData) return;
    const items: HistoryItem[] = updatableData.updatable.map((e: UpdatableStoryEntry) => {
      const delta = (e.folder.chapter_count ?? 0) - e.server_story.maxChapter;
      return { id: makeId(), label: `${e.folder.display_name} (+${delta})`, status: 'running' };
    });

    const historyId = await addHistory({
      id: makeId(),
      kind: 'update_batch',
      status: 'running',
      title: `Updating ${items.length} stories...`,
      subtitle: 'Update All',
      items,
    });

    let successCount = 0;
    let errorCount = 0;
    const updatedItems = [...items];

    for (let i = 0; i < updatableData.updatable.length; i++) {
      const entry = updatableData.updatable[i];

      try {
        const result = await updateChapterCount(entry.server_story.id, entry.folder.chapter_count ?? 0);
        setUpdateResults(prev => new Map(prev).set(entry.server_story.id, { success: result.success, message: result.message }));

        const itemIdx = updatedItems.findIndex(it => it.label.startsWith(entry.folder.display_name));
        if (itemIdx !== -1) {
          if (result.success) {
            successCount++;
            updatedItems[itemIdx] = { ...updatedItems[itemIdx], status: 'success', message: result.message };
          } else {
            errorCount++;
            updatedItems[itemIdx] = { ...updatedItems[itemIdx], status: 'error', message: result.message };
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Update failed';
        errorCount++;
        const itemIdx = updatedItems.findIndex(it => it.label.startsWith(entry.folder.display_name));
        if (itemIdx !== -1) {
          updatedItems[itemIdx] = { ...updatedItems[itemIdx], status: 'error', message: msg };
        }
      }

      updateHistory(historyId, { items: [...updatedItems] });
    }

    updateHistory(historyId, {
      status: errorCount === 0 ? 'success' : successCount === 0 ? 'error' : 'success',
      title: `Update All — ${successCount} succeeded${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
      subtitle: `${updatableData.updatable.length} total`,
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title="Drive Sync"
        subtitle="Sync stories from Google Drive to main BE"
      />

      <main className="w-full px-4 sm:px-6 py-6 sm:py-8 flex flex-col flex-1">

        {/* ── Loading / Error states ───────────────────────────────── */}
        {configLoading && (
          <div className="flex items-center gap-3 p-4 mb-6 bg-slate-800/80 border border-slate-700 rounded-2xl">
            <svg className="w-5 h-5 animate-spin text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-sm text-slate-400">Loading Drive Sync config...</span>
          </div>
        )}

        {configError && (
          <div className="flex items-center gap-3 p-4 mb-6 bg-red-900/20 border border-red-800/50 rounded-2xl text-red-400 text-sm">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {configError}
          </div>
        )}

        {/* ── Main content: tabs + history ─────────────────────────── */}
        {config && !configLoading && (
          <>
            {/* ── Config summary bar ─────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3 mb-6 px-4 py-3 bg-slate-800/60 border border-slate-700/50 rounded-xl text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-slate-300">Drive Sync Active</span>
              </div>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">
                Folder: <span className="text-slate-300 font-mono text-xs">{config.folder_id.slice(0, 20)}...</span>
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">
                Schedule: <span className="text-slate-300">
                  {config.schedule_enabled
                    ? String(config.schedule_hour).padStart(2, '0') + ':' + String(config.schedule_minute).padStart(2, '0') + ' UTC = ' + String((config.schedule_hour - 7 + 24) % 24).padStart(2, '0') + ':' + String(config.schedule_minute).padStart(2, '0') + ' (UTC+7)'
                    : 'Disabled'
                  }
                </span>
              </span>
              <button
                onClick={() => setShowConfigModal(true)}
                className="ml-auto text-indigo-400 hover:text-indigo-300 text-xs transition-colors flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </button>
            </div>

            {/* ── Story Sync + History layout ─────────────────────── */}
            <div className="flex flex-col lg:flex-row gap-6 min-h-[600px] flex-1">
              {/* Story Sync (left/main) */}
              <div className="flex-1 min-w-0 flex flex-col">
                <StorySyncTabs
                  config={config}
                  activeTab={activeSubTab}
                  onTabChange={setActiveSubTab}
                  onOpenSettings={() => setShowConfigModal(true)}
                  uploadableData={uploadableData}
                  uploadableLoading={uploadableLoading}
                  uploadableError={uploadableError}
                  uploadResults={uploadResults}
                  uploadingIds={uploadingIds}
                  onCheckUploadable={handleCheckUploadable}
                  onUploadSingle={handleUploadSingle}
                  onUploadAll={handleUploadAll}
                  updatableData={updatableData}
                  updatableLoading={updatableLoading}
                  updatableError={updatableError}
                  updateResults={updateResults}
                  updatingIds={updatingIds}
                  onCheckUpdatable={handleCheckUpdatable}
                  onUpdateSingle={handleUpdateSingle}
                  onUpdateAll={handleUpdateAll}
                />
              </div>

              {/* Action History (right/sidebar) */}
              <div className="w-full lg:w-96 lg:flex-shrink-0 flex flex-col">
                <ActionHistoryPanel
                  entries={history}
                  onDelete={handleDeleteHistory}
                  onClearAll={handleClearAllHistory}
                  onRetry={handleRetry}
                />
              </div>
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
      />
    </div>
  );
}
