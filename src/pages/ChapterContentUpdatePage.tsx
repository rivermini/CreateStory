import { useEffect, useMemo, useState } from 'react';
import {
  FIXED_JSON_PREFIX,
  checkCredentialsExists,
  getDriveSyncConfig,
  inspectContentUpdateFolder,
  initDriveSyncConfig,
  updateContentChapter,
  validateMainBeToken,
  type ContentUpdateChapterStatus,
  type ContentUpdateScanResponse,
  type ContentUpdateStoryRef,
  type DriveSyncConfig,
} from '../api/client';
import { ConfigModal, type ConfigFormData } from '../components/ConfigModal';
import { Icon, appIcons } from '../components/Icon';
import { ServerModeBanner } from '../components/ServerModeBanner';
import { showToast } from '../components/Toast';
import type { ThemeMode } from '../types/theme';

interface ChapterContentUpdatePageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

type ChapterResult = { success: boolean; message: string };

export function ChapterContentUpdatePage({ themeMode }: ChapterContentUpdatePageProps) {
  const isDark = themeMode === 'dark';

  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [configInvalid, setConfigInvalid] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [isInitialSetup, setIsInitialSetup] = useState(false);
  const [configForm, setConfigForm] = useState<ConfigFormData>({
    folder_id: '',
    service_account_json_name: 'google-service-account.json',
    main_be_api_base_url: '',
    main_be_bearer_token: '',
    main_be_user_id: '',
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingConfigError, setSavingConfigError] = useState('');
  const [credentialFileExists, setCredentialFileExists] = useState(true);

  const [keyword, setKeyword] = useState('');
  const [checking, setChecking] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedStory, setSelectedStory] = useState<ContentUpdateStoryRef | null>(null);

  const [scanError, setScanError] = useState('');
  const [scanData, setScanData] = useState<ContentUpdateScanResponse | null>(null);

  const [updatingChapters, setUpdatingChapters] = useState<Set<number>>(new Set());
  const [updateResults, setUpdateResults] = useState<Map<number, ChapterResult>>(new Map());

  useEffect(() => {
    async function loadConfig() {
      setConfigLoading(true);
      try {
        const cfg = await getDriveSyncConfig();
        setConfig(cfg);
        if (cfg) {
          const fullCfg = cfg as DriveSyncConfig & { service_account_json_path?: string };
          const jsonName = fullCfg.service_account_json_path
            ? fullCfg.service_account_json_path.replace(FIXED_JSON_PREFIX, '')
            : 'google-service-account.json';
          setConfigForm(f => ({
            ...f,
            folder_id: cfg.folder_id,
            service_account_json_name: jsonName,
            main_be_api_base_url: cfg.main_be_api_base_url,
            main_be_user_id: cfg.main_be_user_id ?? '',
          }));
          const hasBaseUrl = Boolean(cfg.main_be_api_base_url);
          const hasUserId = Boolean(cfg.main_be_user_id);
          setConfigInvalid(!hasBaseUrl || !hasUserId);
          if (jsonName) {
            const exists = await checkCredentialsExists(jsonName);
            setCredentialFileExists(exists);
          }
          if (hasBaseUrl && hasUserId) {
            try {
              const tokenResult = await validateMainBeToken();
              setTokenInvalid(!tokenResult.valid);
            } catch {
              setTokenInvalid(false);
            }
          }
          setShowConfigModal(false);
        } else {
          setIsInitialSetup(true);
          setConfigInvalid(true);
          setShowConfigModal(true);
        }
      } catch {
        setConfigError('Failed to load config.');
        setConfigInvalid(true);
      } finally {
        setConfigLoading(false);
      }
    }
    loadConfig();
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
      setConfigInvalid(false);
      setTokenInvalid(false);
      showToast('Drive Sync configuration saved successfully.', 'success', 2000, 'top-center');
    } catch (e) {
      setSavingConfigError(e instanceof Error ? e.message : 'Failed to save config.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = keyword.trim();
    if (!q) return;
    setChecking(true);
    setSearchError('');
    setSelectedStory(null);
    setScanData(null);
    setScanError('');
    setUpdateResults(new Map());
    try {
      const result = await inspectContentUpdateFolder(q);
      setScanData(result);
      setSelectedStory(result.story);
      if (result.found && result.story && result.folder) {
        showToast('Folder and server story found.', 'success', 2000, 'top-center');
      } else {
        setSearchError(result.message || 'Folder or server story was not found.');
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to check folder.');
    } finally {
      setChecking(false);
    }
  };

  const handleConfirmUpdate = async (chapter: ContentUpdateChapterStatus) => {
    if (!scanData?.folder || !selectedStory) return;
    const chapterNumber = chapter.chapterNumber;
    setUpdatingChapters(prev => new Set(prev).add(chapterNumber));
    setUpdateResults(prev => {
      const next = new Map(prev);
      next.delete(chapterNumber);
      return next;
    });
    try {
      const result = await updateContentChapter(selectedStory.id, scanData.folder.id, chapterNumber);
      setUpdateResults(prev => new Map(prev).set(chapterNumber, { success: result.success, message: result.message }));
      if (result.success) {
        setScanData(prev => markChapterUpdated(prev, chapterNumber, result.chapter));
        showToast(`Chapter ${chapterNumber} updated.`, 'success', 1800, 'top-center');
      } else {
        const notFound = result.message.toLowerCase().includes('not found') || result.message.includes('404');
        const display = notFound
          ? `Chapter ${chapterNumber} is not on the server yet. Upload the story first before updating chapters.`
          : result.message || `Chapter ${chapterNumber} update failed.`;
        setUpdateResults(prev => new Map(prev).set(chapterNumber, { success: false, message: display }));
        if (!notFound) {
          showToast(result.message, 'error', 3000, 'top-center');
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const notFound = raw.toLowerCase().includes('not found') || raw.includes('404');
      const message = notFound
        ? `Chapter ${chapterNumber} is not on the server yet. Upload the story first before updating chapters.`
        : (e instanceof Error ? e.message : 'Chapter update failed.');
      setUpdateResults(prev => new Map(prev).set(chapterNumber, { success: false, message }));
      if (!notFound) {
        showToast(message, 'error', 3000, 'top-center');
      }
    } finally {
      setUpdatingChapters(prev => {
        const next = new Set(prev);
        next.delete(chapterNumber);
        return next;
      });
    }
  };

  const canSearch = Boolean(config && !configInvalid && !tokenInvalid && !checking && keyword.trim());
  const updateableChapters = useMemo(
    () => scanData?.chapters.filter(ch => ch.status === 'ready') ?? [],
    [scanData]
  );
  const hasScan = Boolean(scanData);

  const textMain = isDark ? 'text-white/90' : 'text-black/85';
  const textSub = isDark ? 'text-white/45' : 'text-black/40';
  const inputBase = isDark
    ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-amber-500 focus:ring-0'
    : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-amber-500 focus:ring-0';

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: isDark ? 'linear-gradient(135deg, #0a0a14 0%, #101522 45%, #15131d 100%)' : 'linear-gradient(135deg, #eef2ff 0%, #edf7f4 45%, #f8eef2 100%)' }}>
      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <header className="relative overflow-hidden">
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
            <div className="lg-glass-deep px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className={`text-xl sm:text-2xl font-bold tracking-tight ${textMain}`}>Chapter Content Update</h1>
                <p className={`mt-1 text-sm sm:text-base ${textSub}`}>Paste a Drive folder name, verify its server story, then push chapter files one at a time.</p>
              </div>
              {selectedStory && (
                <div className={`lg-glass px-4 py-3 rounded-2xl min-w-0 ${isDark ? 'text-white/70' : 'text-black/55'}`}>
                  <div className="text-xs uppercase tracking-wider opacity-60">Selected</div>
                  <div className="text-sm font-semibold truncate max-w-xs">{selectedStory.title}</div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {configLoading && (
            <div className="lg-glass p-8 flex items-center justify-center gap-4">
              <Spinner className="w-6 h-6 text-amber-400" />
              <span className={`text-sm ${textSub}`}>Loading Drive Sync...</span>
            </div>
          )}

          {configError && (
            <div className={`lg-glass-card p-4 text-sm ${isDark ? 'text-red-400' : 'text-red-500'}`}>{configError}</div>
          )}

          <ServerModeBanner
            serverUrl={config?.main_be_api_base_url ?? null}
            isDark={isDark}
            isConfigLoading={configLoading}
            isConfigValid={tokenInvalid ? undefined : (configInvalid ? false : (configLoading ? undefined : Boolean(config?.main_be_api_base_url && config?.main_be_user_id)))}
            tokenInvalid={tokenInvalid}
            onConfigure={() => setShowConfigModal(true)}
          />

          {config && !configLoading && (
            <div className="mt-4 space-y-4">
              <section className="lg-glass-card overflow-hidden" style={{ borderRadius: 24 }}>
                <div className="p-4 sm:p-5">
                  <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-3">
                    <div className="relative flex-1 min-w-0">
                      <SearchIcon className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-white/45' : 'text-black/30'}`} />
                      <input
                        value={keyword}
                        onChange={e => setKeyword(e.target.value)}
                        className={`w-full pl-9 pr-4 py-3 rounded-xl border text-sm transition-colors ${inputBase}`}
                        placeholder="Exact Drive folder name"
                        disabled={checking}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!canSearch}
                      className={!canSearch ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}
                    >
                      {checking ? <><Spinner className="w-4 h-4" /> Checking...</> : <><SearchIcon className="w-4 h-4" /> Check Folder</>}
                    </button>
                  </form>

                  {searchError && (
                    <div className={`mt-3 text-sm ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>{searchError}</div>
                  )}

                </div>
              </section>

              {checking && (
                <div className="lg-glass-card p-8 flex flex-col items-center justify-center">
                  <div className="lg-glass w-16 h-16 rounded-full flex items-center justify-center mb-4">
                    <Spinner className="w-8 h-8 text-amber-400" />
                  </div>
                  <p className={`text-sm ${textSub}`}>Checking folder and loading chapter files...</p>
                </div>
              )}

              {scanError && !checking && (
                <div className={`lg-glass-card p-4 text-sm ${isDark ? 'text-red-300' : 'text-red-600'}`}>
                  {scanError}
                </div>
              )}

              {hasScan && scanData && !checking && (
                <section className="lg-glass-card overflow-hidden" style={{ borderRadius: 24 }}>
                  <div className={`px-4 sm:px-5 py-4 border-b ${isDark ? 'border-white/[0.06]' : 'border-black/6'}`}>
                    <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h2 className={`text-lg font-semibold truncate ${textMain}`}>{scanData.story?.title ?? 'Server story not found'}</h2>
                          {scanData.folder && <span className="lg-chip lg-chip-amber">Folder matched</span>}
                          {scanData.story && <span className="lg-chip lg-chip-blue">Story matched</span>}
                        </div>
                        <p className={`text-xs font-mono truncate ${textSub}`}>{scanData.folder?.name ?? 'No matching EXTENDED_ folder'}</p>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <StatBox label="Files" value={scanData.summary.total} color="#f59e0b" isDark={isDark} />
                        <StatBox label="Ready" value={updateableChapters.length} color="#10b981" isDark={isDark} />
                        <StatBox label="Errors" value={scanData.summary.errors} color="#fb7185" isDark={isDark} />
                      </div>
                    </div>
                  </div>

                  <div className="max-h-[50vh] sm:max-h-[calc(100vh-430px)] min-h-[200px] sm:min-h-[340px] overflow-y-auto p-4 space-y-2">
                    {scanData.chapters.length === 0 ? (
                      <EmptyPanel isDark={isDark} />
                    ) : (
                      scanData.chapters.map(chapter => (
                        <ChapterRow
                          key={chapter.chapterNumber}
                          chapter={chapter}
                          isDark={isDark}
                          result={updateResults.get(chapter.chapterNumber)}
                          isUpdating={updatingChapters.has(chapter.chapterNumber)}
                          canUpdate={Boolean(scanData.folder && scanData.story && chapter.status === 'ready')}
                          onConfirm={() => handleConfirmUpdate(chapter)}
                        />
                      ))
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </main>

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
          credentialFileExists={credentialFileExists}
          onCredentialUploadSuccess={() => setCredentialFileExists(true)}
        />
      </div>
    </div>
  );
}

function markChapterUpdated(
  prev: ContentUpdateScanResponse | null,
  chapterNumber: number,
  updatedChapter?: ContentUpdateChapterStatus | null,
): ContentUpdateScanResponse | null {
  if (!prev) return prev;
  const oldChapter = prev.chapters.find(ch => ch.chapterNumber === chapterNumber);
  const wasReady = oldChapter?.status === 'ready';
  return {
    ...prev,
    summary: {
      ...prev.summary,
      different: wasReady ? Math.max(0, prev.summary.different - 1) : prev.summary.different,
      same: wasReady ? prev.summary.same + 1 : prev.summary.same,
    },
    chapters: prev.chapters.map(ch => ch.chapterNumber === chapterNumber
      ? {
        ...ch,
        ...(updatedChapter ?? {}),
        status: 'updated',
        message: 'Updated from Drive.',
        serverLength: updatedChapter?.serverLength ?? ch.driveLength,
      }
      : ch
    ),
  };
}

function ChapterRow({
  chapter,
  isDark,
  result,
  isUpdating,
  canUpdate,
  onConfirm,
}: {
  chapter: ContentUpdateChapterStatus;
  isDark: boolean;
  result?: ChapterResult;
  isUpdating: boolean;
  canUpdate: boolean;
  onConfirm: () => void;
}) {
  const textMain = isDark ? 'text-white/85' : 'text-black/80';
  const textSub = isDark ? 'text-white/45' : 'text-black/40';
  const status = getChapterStatus(chapter.status, isDark);

  return (
    <div className="lg-glass-card p-4" style={{ borderRadius: 16, border: chapter.status === 'ready' ? '1px solid rgba(245,158,11,0.28)' : undefined }}>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-mono px-2 py-1 rounded-lg ${isDark ? 'bg-white/[0.06] text-white/60' : 'bg-black/5 text-black/45'}`}>Ch. {chapter.chapterNumber}</span>
            <h3 className={`text-sm font-semibold truncate ${textMain}`}>{chapter.title || chapter.fileName || 'Untitled'}</h3>
            <span className="lg-chip" style={{ color: status.color, borderColor: `${status.color}40`, background: `${status.color}14` }}>{status.label}</span>
          </div>
          <div className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${textSub}`}>
            {chapter.fileName && <span className="font-mono truncate max-w-md">{chapter.fileName}</span>}
            {chapter.serverLength > 0 && <span>Server text: {chapter.serverLength.toLocaleString()} chars</span>}
            <span>Drive text: {chapter.driveLength.toLocaleString()} chars</span>
          </div>
          {(chapter.message || result) && (
            <div className={`mt-1.5 text-xs ${result ? (result.success ? 'text-emerald-400' : 'text-red-400') : textSub}`}>
              {result?.message ?? chapter.message}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 self-start lg:self-center">
          <button
            onClick={onConfirm}
            disabled={!canUpdate || isUpdating}
            className={!canUpdate || isUpdating ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}
            style={canUpdate && !isUpdating ? { background: 'linear-gradient(135deg, #f59e0b, #ea580c)', boxShadow: '0 4px 16px rgba(245,158,11,0.35)', color: 'white' } : undefined}
          >
            {isUpdating ? <><Spinner className="w-4 h-4" /> Updating...</> : <><RefreshIcon className="w-4 h-4" /> Update</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color, isDark }: { label: string; value: number; color: string; isDark: boolean }) {
  return (
    <div className={`px-3 py-2 rounded-xl min-w-24 ${isDark ? 'bg-white/[0.04]' : 'bg-black/5'}`}>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
      <div className={`text-[11px] ${isDark ? 'text-white/45' : 'text-black/35'}`}>{label}</div>
    </div>
  );
}

function EmptyPanel({ isDark }: { isDark: boolean }) {
  return (
    <div className={`h-full min-h-[260px] flex flex-col items-center justify-center text-center ${isDark ? 'text-white/45' : 'text-black/35'}`}>
      <CheckIcon className="w-9 h-9 mb-2" />
      <p className="text-sm">No chapters to show.</p>
    </div>
  );
}

function getChapterStatus(status: ContentUpdateChapterStatus['status'], isDark: boolean) {
  switch (status) {
    case 'ready':
      return { label: 'Ready', color: '#f59e0b' };
    case 'updated':
      return { label: 'Updated', color: '#10b981' };
    case 'different':
      return { label: 'Different', color: '#f59e0b' };
    case 'same':
      return { label: 'Same', color: '#10b981' };
    case 'missing_drive':
      return { label: 'Missing Drive', color: '#f87171' };
    case 'drive_only':
      return { label: 'Drive Only', color: '#60a5fa' };
    default:
      return { label: 'Error', color: isDark ? '#fb7185' : '#e11d48' };
  }
}

function Spinner({ className }: { className?: string }) {
  return <Icon icon={appIcons.spinner} className={`animate-spin ${className ?? ''}`} />;
}

function SearchIcon({ className }: { className?: string }) {
  return <Icon icon={appIcons.search} className={className} />;
}

function RefreshIcon({ className }: { className?: string }) {
  return <Icon icon={appIcons.trends} className={className} />;
}

function CheckIcon({ className }: { className?: string }) {
  return <Icon icon={appIcons.check} className={className} />;
}
