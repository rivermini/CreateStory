import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDriveSyncConfig,
  initDriveSyncConfig,
  listDriveFolders,
  previewDriveStory,
  getDriveSyncStatus,
  syncSingleDriveFolder,
  checkUploadable,
  checkUpdatable,
  updateChapterCount,
  type DriveFolderEntry,
  type DriveStoryPreview,
  type DriveSyncConfig,
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type UpdatableStoryEntry,
} from '../api/client';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface DriveSyncPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

// ─── Action History Types ──────────────────────────────────────────────────────

type ActionKind = 'upload_single' | 'upload_batch' | 'update_single' | 'update_batch' | 'test_sync' | 'config_save';
type ActionStatus = 'running' | 'success' | 'error' | 'cancelled';

interface HistoryEntry {
  id: string;
  timestamp: string; // ISO string
  kind: ActionKind;
  status: ActionStatus;
  title: string;
  subtitle: string;
  items?: HistoryItem[];
  error?: string;
}

interface HistoryItem {
  id: string;
  label: string;
  status: ActionStatus;
  message?: string;
}

interface UpdateHistoryPatch {
  status?: ActionStatus;
  items?: HistoryItem[];
  error?: string;
  subtitle?: string;
  title?: string;
}

const STORAGE_KEY = 'drive_sync_history';

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    // Keep last 200 entries
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-200)));
  } catch {
    // storage full or unavailable — ignore
  }
}

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

// ─── ActionHistoryPanel ────────────────────────────────────────────────────────

interface ActionHistoryPanelProps {
  entries: HistoryEntry[];
  onClear: () => void;
  onRetry: (entry: HistoryEntry) => void;
}

type HistoryFilter = 'all' | 'upload' | 'update' | 'sync';

function ActionHistoryPanel({ entries, onClear, onRetry }: ActionHistoryPanelProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(entries.length);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to top when new entries are added
  useEffect(() => {
    if (autoScroll && entries.length > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevLenRef.current = entries.length;
  }, [entries.length, autoScroll]);

  const filtered = entries.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'upload') return e.kind === 'upload_single' || e.kind === 'upload_batch';
    if (filter === 'update') return e.kind === 'update_single' || e.kind === 'update_batch';
    if (filter === 'sync') return e.kind === 'test_sync' || e.kind === 'config_save';
    return true;
  });

  const kindLabel = (kind: ActionKind) => {
    switch (kind) {
      case 'upload_single': return 'Upload';
      case 'upload_batch':  return 'Upload All';
      case 'update_single': return 'Update';
      case 'update_batch':  return 'Update All';
      case 'test_sync':     return 'Test Sync';
      case 'config_save':   return 'Config';
    }
  };

  const kindIcon = (kind: ActionKind) => {
    if (kind === 'upload_single' || kind === 'upload_batch') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      );
    }
    if (kind === 'update_single' || kind === 'update_batch') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      );
    }
    if (kind === 'test_sync') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  };

  const statusBadge = (status: ActionStatus) => {
    if (status === 'running') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-900/50 text-indigo-300 border border-indigo-700/40">
        <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Running
      </span>
    );
    if (status === 'success') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Success
      </span>
    );
    if (status === 'error') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-900/50 text-red-300 border border-red-700/40">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        Error
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-slate-700/50 text-slate-400 border border-slate-600/40">
        Cancelled
      </span>
    );
  };

  const kindBadgeColor = (kind: ActionKind) => {
    if (kind === 'upload_single' || kind === 'upload_batch') return 'bg-indigo-900/50 text-indigo-300 border-indigo-700/40';
    if (kind === 'update_single' || kind === 'update_batch') return 'bg-amber-900/50 text-amber-300 border-amber-700/40';
    if (kind === 'test_sync') return 'bg-cyan-900/50 text-cyan-300 border-cyan-700/40';
    return 'bg-slate-700/50 text-slate-300 border-slate-600/40';
  };

  const itemStatusIcon = (status: ActionStatus) => {
    if (status === 'running') return (
      <svg className="w-3 h-3 text-indigo-400 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    );
    if (status === 'success') return (
      <svg className="w-3 h-3 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
    if (status === 'error') return (
      <svg className="w-3 h-3 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
    return <div className="w-3 h-3 rounded-full border border-slate-500 flex-shrink-0" />;
  };

  return (
    <section className="bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-700/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Action History
          </h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
                className="accent-indigo-500"
              />
              Auto-scroll
            </label>
            {entries.length > 0 && (
              <button
                onClick={onClear}
                className="text-xs text-slate-500 hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-900/40 rounded-lg w-fit">
          {([
            ['all', 'All'],
            ['upload', 'Upload'],
            ['update', 'Update'],
            ['sync', 'Sync'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                filter === value
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* History list */}
      <div
        ref={scrollRef}
        className="max-h-[420px] overflow-y-auto"
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm">
            <svg className="w-10 h-10 mb-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>No actions yet</p>
            <p className="text-xs text-slate-600 mt-1">Actions will appear here as you work</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700/40">
            {filtered.map(entry => (
              <div key={entry.id} className="px-4 py-3 hover:bg-slate-700/20 transition-colors">
                {/* Entry header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div className={`mt-0.5 p-1.5 rounded-lg border flex-shrink-0 ${kindBadgeColor(entry.kind)}`}>
                      {kindIcon(entry.kind)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-300">{kindLabel(entry.kind)}</span>
                        {statusBadge(entry.status)}
                      </div>
                      <p className="text-sm text-slate-200 font-medium mt-0.5 truncate">{entry.title}</p>
                      {entry.subtitle && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{entry.subtitle}</p>
                      )}
                      {entry.error && (
                        <p className="text-xs text-red-400 mt-1">{entry.error}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-slate-500">
                      {new Date(entry.timestamp).toLocaleString()}
                    </p>
                    {entry.status === 'error' && entry.kind !== 'upload_batch' && entry.kind !== 'update_batch' && (
                      <button
                        onClick={() => onRetry(entry)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 transition-colors"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>

                {/* Item breakdown */}
                {entry.items && entry.items.length > 0 && (
                  <div className="mt-2 ml-9 space-y-1">
                    {entry.items.map(item => (
                      <div key={item.id} className="flex items-center gap-2 text-xs">
                        {itemStatusIcon(item.status)}
                        <span className={
                          item.status === 'error' ? 'text-red-400' :
                          item.status === 'success' ? 'text-emerald-400' :
                          'text-slate-400'
                        }>
                          {item.label}
                        </span>
                        {item.message && (
                          <span className="text-slate-500 truncate max-w-[200px]">— {item.message}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function DriveSyncPage({ themeMode, onThemeChange }: DriveSyncPageProps) {
  // Config
  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');

  // Folders
  const [folders, setFolders] = useState<DriveFolderEntry[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState('');
  const [foldersTotal, setFoldersTotal] = useState(0);
  const [foldersOffset, setFoldersOffset] = useState(0);
  const FOLDER_PAGE_SIZE = 50;

  // Selected folder
  const [selectedFolder, setSelectedFolder] = useState<DriveFolderEntry | null>(null);
  const [preview, setPreview] = useState<DriveStoryPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Sync status
  const [syncRunning, setSyncRunning] = useState(false);

  // Uploadable / Updatable tabs
  type SubTab = 'uploadable' | 'updatable';
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('uploadable');

  const [uploadableData, setUploadableData] = useState<CheckUploadableResponse | null>(null);
  const [uploadableLoading, setUploadableLoading] = useState(false);
  const [uploadableError, setUploadableError] = useState('');
  const [uploadResults, setUploadResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());

  const [updatableData, setUpdatableData] = useState<CheckUpdatableResponse | null>(null);
  const [updatableLoading, setUpdatableLoading] = useState(false);
  const [updatableError, setUpdatableError] = useState('');
  const [updateResults, setUpdateResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  // Config form
  const [showConfigForm, setShowConfigForm] = useState(false);
  const FIXED_USER_ID = '3b2fae40-e482-4ea1-af7a-96e35ecfbf5f';
  const FIXED_BE_URL = 'https://api-novel.santngo.com';
  const FIXED_JSON_PREFIX = 'credentials/';
  const [configForm, setConfigForm] = useState({
    folder_id: '',
    service_account_json_name: 'nova-crawler-drive-sync-445ff578305c.json',
    schedule_enabled: true,
    schedule_hour: 6,
    schedule_minute: 0,
    main_be_bearer_token: '',
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingConfigError, setSavingConfigError] = useState('');

  // ── Action History ──────────────────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  const addHistory = useCallback((entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => {
    const newEntry: HistoryEntry = {
      ...entry,
      id: makeId(),
      timestamp: new Date().toISOString(),
    };
    setHistory(prev => {
      const next = [newEntry, ...prev];
      saveHistory(next);
      return next;
    });
    return newEntry.id;
  }, []);

  const updateHistory = useCallback((id: string, patch: UpdateHistoryPatch) => {
    setHistory(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...patch } : e);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  // ── Poll sync status while running ─────────────────────────────────────────
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load config on mount
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
          setShowConfigForm(false);
          loadFolders(true);
        } else {
          setShowConfigForm(true);
        }
      })
      .catch(() => setConfigError('Failed to load config.'))
      .finally(() => setConfigLoading(false));
  }, []);

  useEffect(() => {
    if (!syncRunning) return;
    const poll = () => {
      getDriveSyncStatus()
        .then(() => {}) // status is shown in history now
        .catch(() => {});
    };
    poll();
    pollIntervalRef.current = setInterval(poll, 3000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [syncRunning]);

  const loadFolders = useCallback((reset: boolean = false) => {
    const offset = reset ? 0 : foldersOffset;
    setFoldersLoading(true);
    setFoldersError('');
    listDriveFolders({ limit: FOLDER_PAGE_SIZE, offset })
      .then(resp => {
        if (reset) {
          setFolders(resp.folders);
        } else {
          setFolders(prev => [...prev, ...resp.folders]);
        }
        setFoldersTotal(resp.total);
        setFoldersOffset(offset + resp.folders.length);
      })
      .catch(e => setFoldersError(e instanceof Error ? e.message : 'Failed to load folders.'))
      .finally(() => setFoldersLoading(false));
  }, [foldersOffset]);

  const handleSelectFolder = useCallback((folder: DriveFolderEntry) => {
    setSelectedFolder(folder);
    setPreview(null);
    setPreviewError('');
    setPreviewLoading(true);

    previewDriveStory(folder.id)
      .then(setPreview)
      .catch(e => setPreviewError(e instanceof Error ? e.message : 'Failed to load preview.'))
      .finally(() => setPreviewLoading(false));
  }, []);

  // ── Handlers with history logging ──────────────────────────────────────────

  const handleSaveConfig = async () => {
    setSavingConfigError('');
    if (!configForm.folder_id.trim()) {
      setSavingConfigError('Folder ID is required.');
      return;
    }
    setSavingConfig(true);

    const historyId = addHistory({
      kind: 'config_save',
      status: 'running' as const,
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
      setShowConfigForm(false);
      setFolders([]);
      setFoldersOffset(0);
      loadFolders(true);
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

  const handleTestSync = async () => {
    setSyncRunning(true);

    const historyId = addHistory({
      kind: 'test_sync',
      status: 'running' as const,
      title: 'Syncing to main BE...',
      subtitle: selectedFolder!.display_name,
      items: [],
    });

    try {
      const result = await syncSingleDriveFolder(selectedFolder!.id);

      if (result.success) {
        updateHistory(historyId, {
          status: 'success',
          title: 'Sync complete',
          subtitle: selectedFolder!.display_name,
        });
      } else {
        updateHistory(historyId, {
          status: 'error',
          title: 'Sync failed',
          subtitle: selectedFolder!.display_name,
          error: result.message,
        });
      }
    } catch (e) {
      updateHistory(historyId, {
        status: 'error',
        title: 'Sync failed',
        subtitle: selectedFolder!.display_name,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setSyncRunning(false);
    }
  };

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

    const historyId = addHistory({
      kind: 'upload_single',
      status: 'running' as const,
      title: `Uploading: ${folder.display_name}`,
      subtitle: folder.prefix,
      items: [{ id: makeId(), label: folder.display_name, status: 'running' as ActionStatus }],
    });

    try {
      const result = await syncSingleDriveFolder(folder.id);
      setUploadResults(prev => new Map(prev).set(folder.id, result));

      if (result.success) {
        updateHistory(historyId, {
          status: 'success',
          items: [{ id: makeId(), label: folder.display_name, status: 'success' as ActionStatus, message: result.message }],
        });
      } else {
        updateHistory(historyId, {
          status: 'error',
          error: result.message,
          items: [{ id: makeId(), label: folder.display_name, status: 'error' as ActionStatus, message: result.message }],
        });
      }
      return result.success ? 'success' : 'error';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setUploadResults(prev => new Map(prev).set(folder.id, { success: false, message: msg }));
      updateHistory(historyId, {
        status: 'error',
        error: msg,
          items: [{ id: makeId(), label: folder.display_name, status: 'error' as ActionStatus, message: msg }],
      });
      return 'error';
    } finally {
      setUploadingIds(prev => { const n = new Set(prev); n.delete(folder.id); return n; });
    }
  };

  const handleUploadAll = async () => {
    if (!uploadableData) return;
    const items: HistoryItem[] = uploadableData.uploadable
      .filter(f => f.is_valid_format)
      .map(f => ({ id: makeId(), label: f.display_name, status: 'running' as ActionStatus }));

    const historyId = addHistory({
      kind: 'upload_batch',
      status: 'running' as const,
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
    const historyId = addHistory({
      kind: 'update_single',
      status: 'running' as const,
      title: `Updating: ${folder.display_name}`,
      subtitle: `+${delta} chapters`,
      items: [{ id: makeId(), label: `${folder.display_name} (${server_story.maxChapter} → ${folder.chapter_count ?? 0})`, status: 'running' as ActionStatus }],
    });

    try {
      const result = await updateChapterCount(server_story.id, folder.chapter_count ?? 0);
      setUpdateResults(prev => new Map(prev).set(server_story.id, { success: result.success, message: result.message }));

      if (result.success) {
        updateHistory(historyId, {
          status: 'success',
          items: [{ id: makeId(), label: folder.display_name, status: 'success' as ActionStatus, message: result.message }],
        });
      } else {
        updateHistory(historyId, {
          status: 'error',
          error: result.message,
          items: [{ id: makeId(), label: folder.display_name, status: 'error' as ActionStatus, message: result.message }],
        });
      }
      return result.success ? 'success' : 'error';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setUpdateResults(prev => new Map(prev).set(server_story.id, { success: false, message: msg }));
      updateHistory(historyId, {
        status: 'error',
        error: msg,
          items: [{ id: makeId(), label: folder.display_name, status: 'error' as ActionStatus, message: msg }],
      });
      return 'error';
    } finally {
      setUpdatingIds(prev => { const n = new Set(prev); n.delete(server_story.id); return n; });
    }
  };

  const handleUpdateAll = async () => {
    if (!updatableData) return;
    const items: HistoryItem[] = updatableData.updatable.map((e: UpdatableStoryEntry) => {
      const delta = (e.folder.chapter_count ?? 0) - e.server_story.maxChapter;
      return {
        id: makeId(),
        label: `${e.folder.display_name} (+${delta})`,
        status: 'running' as ActionStatus,
      };
    });

    const historyId = addHistory({
      kind: 'update_batch',
      status: 'running' as const,
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

  // Retry helper — re-dispatches based on kind
  const handleRetry = useCallback((_entry: HistoryEntry) => {
    // Re-triggering from history requires context (folder entry).
    // For single actions, we can't easily replay without re-fetching state.
    // For now, scroll the page to the relevant section as a UX hint.
    // The history panel itself serves as the record; retry for complex actions
    // should be done via the UI controls.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const statusColor = (prefix: string) => {
    if (prefix === 'DONE' || prefix === 'EXTENDED') return 'bg-emerald-900/50 text-emerald-400 border-emerald-700';
    if (prefix === 'ING') return 'bg-amber-900/50 text-amber-400 border-amber-700';
    return 'bg-slate-700/50 text-slate-400 border-slate-600';
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title="Drive Sync"
        subtitle="Sync stories from Google Drive to main BE"
      />

      <main className="w-full xl:w-[75vw] mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* ── Config setup banner ─────────────────────────────────── */}
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

        {showConfigForm && !configLoading && (
          <section className="mb-6 bg-slate-800/80 border border-indigo-700/40 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <h2 className="text-base font-semibold text-slate-100">Drive Sync Configuration</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* User ID — fixed */}
              <div>
                <label className="block text-sm text-slate-400 mb-1">User ID (x-user-id)</label>
                <input
                  type="text"
                  value={FIXED_USER_ID}
                  readOnly
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg
                             text-slate-400 text-sm cursor-not-allowed font-mono"
                />
              </div>
              {/* Main BE API URL — fixed */}
              <div>
                <label className="block text-sm text-slate-400 mb-1">Main BE API URL</label>
                <input
                  type="text"
                  value={FIXED_BE_URL}
                  readOnly
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg
                             text-slate-400 text-sm cursor-not-allowed"
                />
              </div>
              {/* Drive Folder ID */}
              <div>
                <label className="block text-sm text-slate-400 mb-1">Drive Folder ID</label>
                <input
                  type="text"
                  value={configForm.folder_id}
                  onChange={e => setConfigForm(f => ({ ...f, folder_id: e.target.value }))}
                  placeholder="1r6AVDCI4GMETi3piMjSyIxlOEW9CqDEa"
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg
                             text-slate-100 placeholder-slate-500 text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {/* Service Account JSON — prefix fixed */}
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Service Account JSON{' '}
                  <span className="text-slate-600 font-normal">(credentials/ + filename)</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg
                                   text-slate-400 text-sm whitespace-nowrap select-none">
                    {FIXED_JSON_PREFIX}
                  </span>
                  <input
                    type="text"
                    value={configForm.service_account_json_name}
                    onChange={e => setConfigForm(f => ({ ...f, service_account_json_name: e.target.value }))}
                    placeholder="nova-crawler-drive-sync-445ff578305c.json"
                    className="flex-1 min-w-0 px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg
                               text-slate-100 placeholder-slate-500 text-sm font-mono
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              {/* Daily Schedule — with enable toggle */}
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm text-slate-400">Daily Sync Schedule (UTC+7)</label>
                  <button
                    type="button"
                    onClick={() => setConfigForm(f => ({ ...f, schedule_enabled: !f.schedule_enabled }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-800 ${
                      configForm.schedule_enabled ? 'bg-indigo-600' : 'bg-slate-600'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                      configForm.schedule_enabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                {configForm.schedule_enabled && (
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={0} max={23}
                        value={configForm.schedule_hour}
                        onChange={e => setConfigForm(f => ({ ...f, schedule_hour: parseInt(e.target.value) || 0 }))}
                        className="w-16 px-2 py-2 bg-slate-700 border border-slate-600 rounded-lg
                                   text-slate-100 text-sm text-center
                                   focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="text-slate-400 text-sm">:</span>
                      <input
                        type="number" min={0} max={59}
                        value={String(configForm.schedule_minute).padStart(2, '0')}
                        onChange={e => setConfigForm(f => ({ ...f, schedule_minute: parseInt(e.target.value) || 0 }))}
                        className="w-16 px-2 py-2 bg-slate-700 border border-slate-600 rounded-lg
                                   text-slate-100 text-sm text-center
                                   focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-slate-500">
                        ICT = {(() => {
                          const utcH = configForm.schedule_hour;
                          const localH = (utcH - 7 + 24) % 24;
                          return localH + ':' + String(configForm.schedule_minute).padStart(2, '0') + ' (UTC+7)';
                        })()}
                      </span>
                    </div>
                  </div>
                )}
                {!configForm.schedule_enabled && (
                  <p className="text-xs text-slate-500 mt-1">Scheduled sync is disabled.</p>
                )}
              </div>
              {/* Bearer token for main BE API */}
              <div className="sm:col-span-2">
                <label className="block text-sm text-slate-400 mb-1">
                  Main BE Bearer Token
                  <span className="text-slate-600 font-normal"> (for check-uploadable & chapter update features)</span>
                </label>
                <input
                  type="password"
                  value={configForm.main_be_bearer_token}
                  onChange={e => setConfigForm(f => ({ ...f, main_be_bearer_token: e.target.value }))}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg
                             text-slate-100 placeholder-slate-500 text-sm font-mono
                             focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-600 mt-1">Required for checking server stories and updating chapter counts.</p>
              </div>
            </div>
            {savingConfigError && (
              <p className="mt-3 text-sm text-red-400">{savingConfigError}</p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="px-5 py-2.5 text-white font-semibold bg-indigo-600 hover:bg-indigo-500
                           disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                           rounded-lg transition-colors flex items-center gap-2"
              >
                {savingConfig ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M5 13l4 4L19 7" />
                    </svg>
                    Save Config
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        {/* ── Config summary bar ──────────────────────────────────── */}
        {config && !configLoading && (
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
            <span className="text-slate-600">|</span>
            <button
              onClick={() => setShowConfigForm(v => !v)}
              className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
            >
              {showConfigForm ? 'Hide config' : 'Edit config'}
            </button>
            {showConfigForm && (
              <button
                onClick={() => {
                  setShowConfigForm(false);
                  if (folders.length === 0) loadFolders(true);
                }}
                className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* ── Action History Panel ────────────────────────────────── */}
        {config && !configLoading && (
          <div className="mb-6">
            <ActionHistoryPanel
              entries={history}
              onClear={clearHistory}
              onRetry={handleRetry}
            />
          </div>
        )}

        {/* ── Check Uploadable / Update Chapters tabs ─────────────────── */}
        {config && !configLoading && (
          <section className="mb-6 bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-slate-700/50">
              <button
                onClick={() => setActiveSubTab('uploadable')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  activeSubTab === 'uploadable'
                    ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-700/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/20'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Check Uploadable
                {uploadableData && (
                  <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                    uploadableData.uploadable.length > 0 ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {uploadableData.uploadable.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveSubTab('updatable')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  activeSubTab === 'updatable'
                    ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-700/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/20'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                Update Chapters
                {updatableData && (
                  <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                    updatableData.updatable.length > 0 ? 'bg-amber-900/50 text-amber-400' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {updatableData.updatable.length}
                  </span>
                )}
              </button>
            </div>

            {/* ── Check Uploadable tab ── */}
            {activeSubTab === 'uploadable' && (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCheckUploadable}
                      disabled={uploadableLoading}
                      className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500
                                 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                                 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      {uploadableLoading ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Checking...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          Check Uploadable
                        </>
                      )}
                    </button>
                    {uploadableData && (
                      <span className="text-sm text-slate-400">
                        {uploadableData.uploadable.length} new / {uploadableData.already_on_server.length} already uploaded
                        {uploadableData.drive_folders.length > 0 && ` (from ${uploadableData.drive_folders.length} DONE_ folders)`}
                      </span>
                    )}
                  </div>
                  {uploadableData && uploadableData.uploadable.length > 0 && (
                    <button
                      onClick={handleUploadAll}
                      disabled={uploadingIds.size > 0}
                      className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500
                                 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                                 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      {uploadingIds.size > 0 ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                      )}
                      Upload All
                      {uploadingIds.size > 0 && ` (${uploadingIds.size})`}
                    </button>
                  )}
                </div>

                {uploadableError && (
                  <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg text-sm text-red-400">
                    {uploadableError}
                  </div>
                )}

                {uploadableData && (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {/* Uploadable section */}
                    {uploadableData.uploadable.length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                          Ready to Upload ({uploadableData.uploadable.length})
                        </p>
                        {uploadableData.uploadable.map(folder => {
                          const isInvalid = !folder.is_valid_format;
                          return (
                          <div key={folder.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                            isInvalid
                              ? 'bg-red-950/20 border-red-700/40'
                              : 'bg-slate-700/30 border-slate-700/40'
                          }`}>
                            <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(folder.prefix)}`}>
                              {folder.prefix}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className={`text-sm font-medium truncate ${isInvalid ? 'text-red-300' : 'text-slate-200'}`}>{folder.display_name}</p>
                                {isInvalid && (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-900/60 text-red-300 rounded border border-red-700/50">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                                    WRONG FORMAT
                                  </span>
                                )}
                              </div>
                              <span className={`text-xs font-mono ${isInvalid ? 'text-red-400/80' : 'text-slate-500'}`}>{folder.name}</span>
                              {uploadResults.get(folder.id) && (
                                <p className={`text-xs mt-0.5 ${uploadResults.get(folder.id)!.success ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {uploadResults.get(folder.id)!.message}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => handleUploadSingle(folder)}
                              disabled={uploadingIds.has(folder.id) || !!uploadResults.get(folder.id)?.success}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                                isInvalid
                                  ? 'bg-red-700/60 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white'
                                  : 'bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white'
                              }`}
                            >
                              {uploadingIds.has(folder.id) ? (
                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                              ) : uploadResults.get(folder.id)?.success ? (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : null}
                              {uploadingIds.has(folder.id) ? 'Uploading...' : uploadResults.get(folder.id)?.success ? 'Uploaded' : 'Upload'}
                            </button>
                          </div>
                          );
                        })}
                      </>
                    )}

                    {/* Already uploaded section */}
                    {uploadableData.already_on_server.length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-4">
                          Already on Server ({uploadableData.already_on_server.length})
                        </p>
                        {uploadableData.already_on_server.map(folder => (
                          <div key={folder.id} className="flex items-center gap-3 p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl opacity-60">
                            <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(folder.prefix)}`}>
                              {folder.prefix}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-400 font-medium truncate">{folder.display_name}</p>
                              <span className="text-xs text-slate-500 font-mono">{folder.name}</span>
                            </div>
                            <span className="px-2 py-1 text-xs text-slate-500 rounded-lg bg-slate-700/50">Already uploaded</span>
                          </div>
                        ))}
                      </>
                    )}

                    {!uploadableLoading && !uploadableData && (
                      <p className="text-sm text-slate-500 text-center py-4">Click "Check Uploadable" to scan Drive folders against the server.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Update Chapters tab ── */}
            {activeSubTab === 'updatable' && (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCheckUpdatable}
                      disabled={updatableLoading}
                      className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500
                                 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                                 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      {updatableLoading ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Checking...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          Check Update
                        </>
                      )}
                    </button>
                    {updatableData && (
                      <span className="text-sm text-slate-400">
                        {updatableData.updatable.length} can update / {updatableData.no_update_needed.length} up-to-date
                        {updatableData.all_extended_folders.length > 0 && ` (from ${updatableData.all_extended_folders.length} EXTENDED_ folders)`}
                      </span>
                    )}
                  </div>
                  {updatableData && updatableData.updatable.length > 0 && (
                    <button
                      onClick={handleUpdateAll}
                      disabled={updatingIds.size > 0}
                      className="px-4 py-2 text-sm font-semibold bg-amber-600 hover:bg-amber-500
                                 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                                 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      {updatingIds.size > 0 ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                      )}
                      Update All
                      {updatingIds.size > 0 && ` (${updatingIds.size})`}
                    </button>
                  )}
                </div>

                {updatableError && (
                  <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg text-sm text-red-400">
                    {updatableError}
                  </div>
                )}

                {updatableData && (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {/* Updatable section */}
                    {updatableData.updatable.length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                          Can Update ({updatableData.updatable.length})
                        </p>
                        {updatableData.updatable.map((entry: UpdatableStoryEntry) => {
                          const delta = (entry.folder.chapter_count ?? 0) - entry.server_story.maxChapter;
                          return (
                            <div key={entry.server_story.id} className="flex items-center gap-3 p-3 bg-slate-700/30 border border-slate-700/40 rounded-xl">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-200 font-medium truncate">{entry.folder.display_name}</p>
                                <div className="flex items-center gap-3 mt-0.5">
                                  <span className="text-xs text-slate-500">
                                    Server: <span className="text-slate-300">{entry.server_story.maxChapter}</span>
                                  </span>
                                  <span className="text-slate-600">{'->'}</span>
                                  <span className="text-xs text-slate-500">
                                    Drive: <span className="text-slate-300">{entry.folder.chapter_count ?? 0}</span>
                                  </span>
                                  <span className="text-xs text-amber-400 font-semibold">+{delta}</span>
                                </div>
                                {updateResults.get(entry.server_story.id) && (
                                  <p className={`text-xs mt-0.5 ${updateResults.get(entry.server_story.id)!.success ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {updateResults.get(entry.server_story.id)!.message}
                                  </p>
                                )}
                              </div>
                              <button
                                onClick={() => handleUpdateSingle(entry)}
                                disabled={updatingIds.has(entry.server_story.id) || !!updateResults.get(entry.server_story.id)?.success}
                                className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500
                                           disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                                           text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                              >
                                {updatingIds.has(entry.server_story.id) ? (
                                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                ) : updateResults.get(entry.server_story.id)?.success ? (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : null}
                                {updatingIds.has(entry.server_story.id) ? 'Updating...' : updateResults.get(entry.server_story.id)?.success ? 'Updated' : 'Update'}
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}

                    {/* No update needed section */}
                    {updatableData.no_update_needed.length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-4">
                          Up-to-Date ({updatableData.no_update_needed.length})
                        </p>
                        {updatableData.no_update_needed.map(entry => (
                          <div key={entry.server_story.id} className="flex items-center gap-3 p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl opacity-60">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-400 font-medium truncate">{entry.folder.display_name}</p>
                              <div className="flex items-center gap-3 mt-0.5">
                                <span className="text-xs text-slate-500">
                                  Server: <span className="text-slate-300">{entry.server_story.maxChapter}</span>
                                </span>
                                <span className="text-slate-600">{'->'}</span>
                                <span className="text-xs text-slate-500">
                                  Drive: <span className="text-slate-300">{entry.folder.chapter_count ?? 0}</span>
                                </span>
                              </div>
                            </div>
                            <span className="px-2 py-1 text-xs text-slate-500 rounded-lg bg-slate-700/50">Up-to-date</span>
                          </div>
                        ))}
                      </>
                    )}

                    {!updatableLoading && !updatableData && (
                      <p className="text-sm text-slate-500 text-center py-4">Click "Check Update" to scan EXTENDED_ folders against the server.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── Two-column layout ───────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-6">

          {/* ── Left: Folder list ──────────────────────────────────── */}
          <div className="lg:w-[420px] lg:flex-shrink-0 space-y-4">
            <section className="bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden shadow-xl shadow-black/20">
              <div className="px-4 pt-4 pb-3 border-b border-slate-700/50">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    Drive Folders
                  </h2>
                  <button
                    onClick={() => loadFolders()}
                    disabled={foldersLoading}
                    className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors"
                    title="Refresh folders"
                  >
                    Refresh
                  </button>
                </div>
                <p className="text-xs text-slate-500">Showing DONE / EXTENDED / ING / INCOMPLETE folders</p>
              </div>

              <div className="max-h-[60vh] overflow-y-auto">
                {foldersLoading && folders.length === 0 && (
                <div className="p-2 space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex gap-3 p-3 rounded-xl bg-slate-700/20 border border-transparent animate-pulse">
                      <div className="w-10 h-10 rounded-lg bg-slate-700/60 flex-shrink-0" />
                      <div className="flex-1 py-0.5 space-y-2">
                        <div className="h-4 bg-slate-700/60 rounded w-3/4" />
                        <div className="h-3 bg-slate-700/40 rounded w-1/2" />
                        <div className="flex gap-2">
                          <div className="h-5 w-16 bg-slate-700/60 rounded-full" />
                          <div className="h-5 w-12 bg-slate-700/40 rounded-full" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {foldersLoading && folders.length > 0 && (
                <div className="p-2 flex items-center justify-center">
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Loading more...
                  </div>
                </div>
              )}

                {foldersError && (
                  <div className="p-4">
                    <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg text-sm text-red-400">
                      {foldersError}
                    </div>
                  </div>
                )}

                {!foldersLoading && !foldersError && folders.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm">
                    <svg className="w-12 h-12 mb-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <p>No story folders found</p>
                    <p className="text-xs text-slate-600 mt-1">Check that folders start with DONE_, EXTENDED_, ING_, or INCOMPLETE_</p>
                  </div>
                )}

                <div className="p-2 space-y-2">
                  {folders.map(folder => (
                    <button
                      key={folder.id}
                      onClick={() => handleSelectFolder(folder)}
                      className={
                        'w-full flex gap-3 p-3 rounded-xl text-left transition-all duration-200 group ' +
                        (selectedFolder?.id === folder.id
                          ? 'bg-gradient-to-r from-indigo-900/50 to-slate-800/80 border border-indigo-600/50 shadow-lg shadow-indigo-900/20'
                          : 'bg-slate-700/30 border border-transparent hover:bg-slate-700/50 hover:border-slate-600/30')
                      }
                    >
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-800/50 to-slate-700 flex-shrink-0 flex items-center justify-center">
                        <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="text-sm font-medium text-slate-200 line-clamp-2 leading-snug">{folder.display_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5 truncate font-mono">{folder.name}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(folder.prefix)}`}>
                            {folder.prefix}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-slate-600/50 text-slate-400">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            {folder.chapter_count != null ? folder.chapter_count : '?'}
                          </span>
                          {folder.modified_time && (
                            <span className="text-xs text-slate-600">
                              {new Date(folder.modified_time).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={`flex-shrink-0 self-center transition-all duration-200 ${selectedFolder?.id === folder.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                        <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {!foldersLoading && !foldersError && (
                <div className="border-t border-slate-700/50 px-4 py-2 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    {folders.length} of {foldersTotal} folders
                  </span>
                  {folders.length < foldersTotal && (
                    <button
                      onClick={() => loadFolders(false)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Load more
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* ── Right: Preview + Actions ──────────────────────────── */}
          <div className="flex-1 space-y-4 lg:sticky lg:top-20">

            {/* Story preview */}
            {previewLoading && (
              <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 animate-pulse space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-slate-700/60 flex-shrink-0" />
                  <div className="flex-1 space-y-3">
                    <div className="h-5 bg-slate-700/60 rounded w-1/2" />
                    <div className="h-4 bg-slate-700/40 rounded w-1/4" />
                    <div className="flex gap-2">
                      <div className="h-6 w-16 bg-slate-700/40 rounded-full" />
                      <div className="h-6 w-20 bg-slate-700/40 rounded-full" />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-slate-700/40 rounded w-1/6" />
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-16 bg-slate-700/30 rounded-lg" />
                  ))}
                </div>
                <div className="h-10 bg-slate-700/40 rounded-lg w-1/3" />
              </section>
            )}

            {previewError && (
              <section className="bg-slate-800 border border-red-800/50 rounded-xl p-6">
                <div className="flex items-center gap-2 text-red-400 text-sm mb-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Preview Error
                </div>
                <p className="text-sm text-slate-400">{previewError}</p>
              </section>
            )}

            {preview && !previewLoading && (
              <>
                {/* Story metadata */}
                <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-800/50 to-slate-700 flex-shrink-0 flex items-center justify-center">
                      <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold text-slate-100">{preview.display_name}</h2>
                      <p className="text-xs text-slate-500 mt-0.5 font-mono">{preview.folder_name}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`inline-flex items-center px-2.5 py-1 text-xs rounded-full border font-medium ${statusColor(preview.prefix)}`}>
                          {preview.prefix}
                        </span>
                        <span className="text-sm text-slate-400">
                          {preview.is_completed ? 'Completed' : 'In Progress'}
                        </span>
                        <span className="text-slate-600">|</span>
                        <span className="text-sm text-slate-400">{preview.chapter_count} chapters</span>
                        {preview.modified_time && (
                          <>
                            <span className="text-slate-600">|</span>
                            <span className="text-xs text-slate-500">Modified: {new Date(preview.modified_time).toLocaleString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Chapter list */}
                <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-3">
                  <h3 className="text-sm font-medium text-slate-300">
                    Chapters ({preview.chapters.length})
                  </h3>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {preview.chapters.map((ch, idx) => (
                      <details key={idx} className="group">
                        <summary className={
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer select-none transition-colors ' +
                          (ch.download_error
                            ? 'bg-red-900/20 hover:bg-red-900/30 border border-red-800/30'
                            : 'bg-slate-700/40 hover:bg-slate-700/60 border border-transparent')
                        }>
                          <div className="flex-shrink-0 w-8 h-8 rounded-md bg-slate-600/60 flex items-center justify-center text-xs font-mono text-slate-400">
                            {ch.index}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${
                              ch.download_error ? 'text-red-400' : 'text-slate-200'
                            }`}>
                              {ch.title}
                            </p>
                            <p className="text-xs text-slate-500 truncate font-mono">{ch.file_name}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {ch.download_error ? (
                              <span className="text-xs text-red-400">Error</span>
                            ) : (
                              <span className="text-xs text-slate-500">{ch.content_length.toLocaleString()} chars</span>
                            )}
                            <svg className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </summary>
                        {!ch.download_error && (
                          <div className="mt-1 ml-4 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/30">
                            <p className="text-xs text-slate-400 font-mono mb-1">
                              {ch.content_length.toLocaleString()} characters
                            </p>
                            <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                              {ch.content_preview}
                            </p>
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                </section>

                {/* Test Sync Action */}
                <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-4">
                  <h3 className="text-sm font-medium text-slate-300">Test Sync</h3>
                  <p className="text-xs text-slate-500">
                    This will POST the story and all {preview.chapters.filter(c => !c.download_error).length} chapters to the main BE.
                    Review the chapter data above before clicking sync.
                  </p>
                  <button
                    onClick={handleTestSync}
                    disabled={syncRunning || preview.chapters.filter(c => !c.download_error).length === 0}
                    className="px-6 py-2.5 text-white font-semibold bg-indigo-600 hover:bg-indigo-500
                               disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                               rounded-lg transition-colors flex items-center gap-2"
                  >
                    {syncRunning ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Syncing...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Sync to Main BE
                      </>
                    )}
                  </button>
                </section>
              </>
            )}

            {/* Empty state */}
            {!selectedFolder && !previewLoading && (
              <section className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center">
                <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="text-slate-400 text-sm">Select a folder from the list to preview its chapters.</p>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
