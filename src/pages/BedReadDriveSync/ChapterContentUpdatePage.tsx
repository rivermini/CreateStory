import { useMemo, useState } from 'react';
import {
  batchInspectFolders,
  batchUpdateFolders,
  inspectContentUpdateFolder,
  updateContentChapter,
  type BatchChapterUpdateResult,
  type BatchFolderResult,
  type ContentUpdateChapterStatus,
  type ContentUpdateScanResponse,
  type ContentUpdateStoryRef,
} from '../../api/BedReadDriveSync';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';
import { showToast } from '../../components/Shared/Toast';
import { useDriveSyncConfig } from '../../hooks/useDriveSyncConfig';
import type { ThemeMode } from '../../types/theme';

interface ChapterContentUpdatePageProps {
  themeMode: ThemeMode;
}

type ChapterResult = { success: boolean; message: string };

export function ChapterContentUpdatePage(props: Readonly<ChapterContentUpdatePageProps>) {
  const { themeMode } = props;
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

  const [keyword, setKeyword] = useState('');
  const [checking, setChecking] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedStory, setSelectedStory] = useState<ContentUpdateStoryRef | null>(null);
  const [scanError, setScanError] = useState('');
  const [scanData, setScanData] = useState<ContentUpdateScanResponse | null>(null);
  const [updatingChapters, setUpdatingChapters] = useState<Set<number>>(new Set());
  const [updateResults, setUpdateResults] = useState<Map<number, ChapterResult>>(new Map());

  const [multiScanData, setMultiScanData] = useState<BatchFolderResult[]>([]);
  const [selectedMultiFolder, setSelectedMultiFolder] = useState<string | null>(null);
  const [multiUpdateResults, setMultiUpdateResults] = useState<Map<string, BatchChapterUpdateResult[]>>(new Map());
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);

  const pageBackground = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const searchBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const parsedFolders = useMemo(() => {
    return keyword.split(';').map((f) => f.trim()).filter(Boolean);
  }, [keyword]);

  const isMultiFolder = parsedFolders.length > 1;
  const matchedFolders = useMemo(
    () => multiScanData.filter((f) => f.found && f.story && f.folder),
    [multiScanData],
  );

  const handleSearch = async (event?: React.SubmitEvent) => {
    event?.preventDefault();
    const query = keyword.trim();
    if (!query) return;

    setChecking(true);
    setSearchError('');
    setSelectedStory(null);
    setScanData(null);
    setScanError('');
    setUpdateResults(new Map());
    setMultiScanData([]);
    setSelectedMultiFolder(null);
    setMultiUpdateResults(new Map());

    try {
      if (isMultiFolder) {
        const result = await batchInspectFolders(parsedFolders);
        setMultiScanData(result.results);
        const matchedCount = result.results.filter((f) => f.found && f.story && f.folder).length;
        if (matchedCount > 0) {
          showToast(`${matchedCount} of ${result.results.length} folders matched.`, 'success', 2000, 'top-center');
        } else {
          setSearchError('None of the folders matched a server story.');
        }
      } else {
        const result = await inspectContentUpdateFolder(query);
        setScanData(result);
        setSelectedStory(result.story);
        if (result.found && result.story && result.folder) {
          showToast('Folder and server story found.', 'success', 2000, 'top-center');
        } else {
          setSearchError(result.message || 'Folder or server story was not found.');
        }
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to check folder(s).');
    } finally {
      setChecking(false);
    }
  };

  const handleBatchUpdate = async () => {
    if (matchedFolders.length === 0) return;
    setIsBatchUpdating(true);
    setMultiUpdateResults(new Map());
    try {
      const result = await batchUpdateFolders(matchedFolders.map((f) => f.folder_name));
      const resultsMap = new Map<string, BatchChapterUpdateResult[]>();
      for (const folderResult of result.results) {
        resultsMap.set(folderResult.folder_name, folderResult.update_results);
      }
      setMultiUpdateResults(resultsMap);
      const successCount = result.results.filter((f) => f.update_results.some((r) => r.success)).length;
      showToast(`Batch update done: ${successCount}/${result.results.length} folders had updates.`, 'success', 3000, 'top-center');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch update failed.', 'error', 3000, 'top-center');
    } finally {
      setIsBatchUpdating(false);
    }
  };

  const handleConfirmUpdate = async (chapter: ContentUpdateChapterStatus) => {
    if (!scanData?.folder || !selectedStory) return;
    const chapterNumber = chapter.chapterNumber;
    setUpdatingChapters((prev) => new Set(prev).add(chapterNumber));
    setUpdateResults((prev) => {
      const next = new Map(prev);
      next.delete(chapterNumber);
      return next;
    });
    try {
      const result = await updateContentChapter(selectedStory.id, scanData.folder.id, chapterNumber);
      setUpdateResults((prev) => new Map(prev).set(chapterNumber, { success: result.success, message: result.message }));
      if (result.success) {
        setScanData((prev) => markChapterUpdated(prev, chapterNumber, result.chapter));
        showToast(`Chapter ${chapterNumber} updated.`, 'success', 1800, 'top-center');
      } else {
        const notFound = result.message.toLowerCase().includes('not found') || result.message.includes('404');
        const display = notFound
          ? `Chapter ${chapterNumber} is not on the server yet. Upload the story first before updating chapters.`
          : result.message || `Chapter ${chapterNumber} update failed.`;
        setUpdateResults((prev) => new Map(prev).set(chapterNumber, { success: false, message: display }));
        if (!notFound) {
          showToast(result.message, 'error', 3000, 'top-center');
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const notFound = raw.toLowerCase().includes('not found') || raw.includes('404');
      const message = notFound
        ? `Chapter ${chapterNumber} is not on the server yet. Upload the story first before updating chapters.`
        : e instanceof Error
          ? e.message
          : 'Chapter update failed.';
      setUpdateResults((prev) => new Map(prev).set(chapterNumber, { success: false, message }));
      if (!notFound) {
        showToast(message, 'error', 3000, 'top-center');
      }
    } finally {
      setUpdatingChapters((prev) => {
        const next = new Set(prev);
        next.delete(chapterNumber);
        return next;
      });
    }
  };

  const canSearch = Boolean(config && !configInvalid && !tokenInvalid && !checking && keyword.trim());
  const updateableChapters = useMemo(() => scanData?.chapters.filter((ch) => ch.status === 'ready') ?? [], [scanData]);
  const hasSingleScan = Boolean(scanData);
  const hasMultiScan = multiScanData.length > 0;

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
                  Chapter content update
                </h1>
                <p className="text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                  Paste Drive folder name(s) separated by <code>;</code>, verify matches, then push chapter files.
                </p>
              </div>
              {selectedStory && !hasMultiScan && (
                <div
                  className="min-w-0 rounded-xl border px-4 py-3"
                  style={{ background: mutedSurface, borderColor: panelBorder }}
                >
                  <div className="text-xs uppercase tracking-wider" style={{ color: secondaryText }}>
                    Selected
                  </div>
                  <div className="max-w-xs truncate text-sm font-semibold" style={{ color: pageText }}>
                    {selectedStory.title}
                  </div>
                </div>
              )}
            </div>
          </section>

          {configLoading && (
            <div
              className="flex items-center justify-center gap-3 rounded-2xl border p-8"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <Icon icon={appIcons.spinner} className="h-6 w-6 animate-spin" style={{ color: secondaryText }} />
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
            <div className="space-y-4">
              <section
                className="overflow-hidden rounded-2xl border"
                style={{ background: panelBackground, borderColor: panelBorder }}
              >
                <div className="p-4 sm:p-5">
                  <form onSubmit={handleSearch} className="flex flex-col gap-3 md:flex-row">
                    <div className="relative min-w-0 flex-1">
                      <Icon
                        icon={appIcons.search}
                        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                        style={{ color: tertiaryText }}
                      />
                      <input
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        className="w-full rounded-xl border py-3 pl-9 pr-4 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500"
                        placeholder={isMultiFolder ? "Folder A; Folder B; Folder C" : "Exact Drive folder name"}
                        disabled={checking}
                        style={{ background: searchBg, borderColor: panelBorder, color: pageText }}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!canSearch}
                      className="inline-flex items-center justify-center gap-2 rounded-md border px-5 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed"
                      style={{
                        background: canSearch ? '#4f46e5' : mutedSurface,
                        borderColor: canSearch ? '#4f46e5' : panelBorder,
                        color: canSearch ? '#ffffff' : secondaryText,
                        opacity: canSearch ? 1 : 0.65,
                      }}
                    >
                      {checking ? (
                        <>
                          <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
                          Checking...
                        </>
                      ) : (
                        <>
                          <Icon icon={appIcons.search} className="h-4 w-4" />
                          {isMultiFolder ? `Check ${parsedFolders.length} Folders` : 'Check Folder'}
                        </>
                      )}
                    </button>
                  </form>

                  {searchError && (
                    <p className="mt-3 text-sm" style={{ color: isDark ? '#fcd34d' : '#b45309' }}>
                      {searchError}
                    </p>
                  )}
                </div>
              </section>

              {checking && (
                <div
                  className="flex flex-col items-center justify-center rounded-2xl border p-8"
                  style={{ background: panelBackground, borderColor: panelBorder }}
                >
                  <div
                    className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
                    style={{ background: mutedSurface, border: `1px solid ${panelBorder}` }}
                  >
                    <Icon
                      icon={appIcons.spinner}
                      className="h-8 w-8 animate-spin"
                      style={{ color: isDark ? '#818cf8' : '#4f46e5' }}
                    />
                  </div>
                  <p className="text-sm" style={{ color: secondaryText }}>
                    {isMultiFolder ? `Checking ${parsedFolders.length} folders...` : 'Checking folder and loading chapter files...'}
                  </p>
                </div>
              )}

              {scanError && !checking && (
                <div
                  className="rounded-xl border p-4 text-sm"
                  style={{
                    background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)',
                    borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
                    color: isDark ? '#f87171' : '#dc2626',
                  }}
                >
                  {scanError}
                </div>
              )}

              {hasSingleScan && scanData && !checking && !hasMultiScan && (
                <SingleFolderPanel
                  scanData={scanData}
                  updateableChapters={updateableChapters}
                  isDark={isDark}
                  updateResults={updateResults}
                  updatingChapters={updatingChapters}
                  onConfirmUpdate={handleConfirmUpdate}
                  panelBackground={panelBackground}
                  panelBorder={panelBorder}
                  pageText={pageText}
                  secondaryText={secondaryText}
                  tertiaryText={tertiaryText}
                  mutedSurface={mutedSurface}
                />
              )}

              {hasMultiScan && !checking && (
                <MultiFolderPanel
                  folders={multiScanData}
                  matchedCount={matchedFolders.length}
                  selectedFolder={selectedMultiFolder}
                  multiUpdateResults={multiUpdateResults}
                  isBatchUpdating={isBatchUpdating}
                  isDark={isDark}
                  panelBackground={panelBackground}
                  panelBorder={panelBorder}
                  pageText={pageText}
                  secondaryText={secondaryText}
                  tertiaryText={tertiaryText}
                  mutedSurface={mutedSurface}
                  onSelectFolder={(name) => setSelectedMultiFolder((prev) => (prev === name ? null : name))}
                  onBatchUpdate={handleBatchUpdate}
                  onConfirmUpdate={handleConfirmUpdate}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-folder panel
// ---------------------------------------------------------------------------

function SingleFolderPanel(props: {
  scanData: ContentUpdateScanResponse;
  updateableChapters: ContentUpdateChapterStatus[];
  isDark: boolean;
  updateResults: Map<number, ChapterResult>;
  updatingChapters: Set<number>;
  onConfirmUpdate: (chapter: ContentUpdateChapterStatus) => void;
  panelBackground: string;
  panelBorder: string;
  pageText: string;
  secondaryText: string;
  tertiaryText: string;
  mutedSurface: string;
}) {
  const {
    scanData,
    updateableChapters,
    isDark,
    updateResults,
    updatingChapters,
    onConfirmUpdate,
    panelBackground,
    panelBorder,
    pageText,
    secondaryText,
    tertiaryText,
    mutedSurface,
  } = props;

  return (
    <section
      className="overflow-hidden rounded-2xl border"
      style={{ background: panelBackground, borderColor: panelBorder }}
    >
      <div className="border-b px-4 py-4 sm:px-5" style={{ borderColor: panelBorder }}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold" style={{ color: pageText }}>
                {scanData.story?.title ?? 'Server story not found'}
              </h2>
              {scanData.folder && (
                <span
                  className="rounded-md border px-2 py-0.5 text-xs font-medium"
                  style={{ background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}
                >
                  Folder matched
                </span>
              )}
              {scanData.story && (
                <span
                  className="rounded-md border px-2 py-0.5 text-xs font-medium"
                  style={{ background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.2)', color: '#818cf8' }}
                >
                  Story matched
                </span>
              )}
            </div>
            <p className="truncate font-mono text-xs" style={{ color: secondaryText }}>
              {scanData.folder?.name ?? 'No matching EXTENDED_ folder'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            <StatBox label="Files" value={scanData.summary.total} color="#f59e0b" isDark={isDark} />
            <StatBox label="Ready" value={updateableChapters.length} color="#10b981" isDark={isDark} />
            <StatBox label="Errors" value={scanData.summary.errors} color="#f87171" isDark={isDark} />
          </div>
        </div>
      </div>

      <div className="max-h-[50vh] min-h-[200px] space-y-2 overflow-y-auto p-4 sm:max-h-[calc(100vh-430px)] sm:min-h-[340px]">
        {scanData.chapters.length === 0 ? (
          <EmptyPanel isDark={isDark} />
        ) : (
          scanData.chapters.map((chapter) => (
            <ChapterRow
              key={chapter.chapterNumber}
              chapter={chapter}
              isDark={isDark}
              result={updateResults.get(chapter.chapterNumber)}
              isUpdating={updatingChapters.has(chapter.chapterNumber)}
              canUpdate={Boolean(scanData.folder && scanData.story && chapter.status === 'ready')}
              onConfirm={onConfirmUpdate}
              panelBorder={panelBorder}
              pageText={pageText}
              secondaryText={secondaryText}
              tertiaryText={tertiaryText}
              mutedSurface={mutedSurface}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Multi-folder panel
// ---------------------------------------------------------------------------

function MultiFolderPanel(props: {
  folders: BatchFolderResult[];
  matchedCount: number;
  selectedFolder: string | null;
  multiUpdateResults: Map<string, BatchChapterUpdateResult[]>;
  isBatchUpdating: boolean;
  isDark: boolean;
  panelBackground: string;
  panelBorder: string;
  pageText: string;
  secondaryText: string;
  tertiaryText: string;
  mutedSurface: string;
  onSelectFolder: (name: string) => void;
  onBatchUpdate: () => void;
  onConfirmUpdate: (chapter: ContentUpdateChapterStatus) => void;
}) {
  const {
    folders,
    matchedCount,
    selectedFolder,
    multiUpdateResults,
    isBatchUpdating,
    isDark,
    panelBackground,
    panelBorder,
    pageText,
    secondaryText,
    tertiaryText,
    mutedSurface,
    onSelectFolder,
    onBatchUpdate,
    onConfirmUpdate,
  } = props;

  return (
    <section
      className="overflow-hidden rounded-2xl border"
      style={{ background: panelBackground, borderColor: panelBorder }}
    >
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:px-5 sm:flex-row sm:items-center" style={{ borderColor: panelBorder }}>
        <div className="flex-1">
          <h2 className="text-lg font-semibold" style={{ color: pageText }}>
            {folders.length} folders scanned
          </h2>
          <p className="text-xs" style={{ color: secondaryText }}>
            {matchedCount} matched a server story
          </p>
        </div>
        {matchedCount > 0 && (
          <button
            onClick={onBatchUpdate}
            disabled={isBatchUpdating}
            className="inline-flex items-center justify-center gap-2 rounded-md border px-5 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={
              !isBatchUpdating
                ? { background: 'linear-gradient(135deg, #f59e0b, #ea580c)', borderColor: 'transparent', color: '#ffffff' }
                : { background: mutedSurface, borderColor: panelBorder, color: secondaryText, opacity: 0.65 }
            }
          >
            {isBatchUpdating ? (
              <>
                <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <Icon icon={appIcons.trends} className="h-4 w-4" />
                Update All ({matchedCount} folders)
              </>
            )}
          </button>
        )}
      </div>

      <div className="max-h-[calc(100vh-420px)] min-h-[200px] space-y-2 overflow-y-auto p-4">
        {folders.map((folder) => {
          const isSelected = folder.folder_name === selectedFolder;
          const folderResults = multiUpdateResults.get(folder.folder_name);
          const isUpdatingFolder = isBatchUpdating;
          const successCount = folderResults ? folderResults.filter((r) => r.success).length : 0;
          const failedCount = folderResults ? folderResults.filter((r) => !r.success).length : 0;
          const readyChapters = folder.chapters.filter((ch) => ch.status === 'ready');

          return (
            <div key={folder.folder_name} className="space-y-2">
              <div
                className="overflow-hidden rounded-xl border p-4 cursor-pointer transition-colors"
                style={{
                  background: mutedSurface,
                  borderColor: isSelected ? '#f59e0b' : panelBorder,
                }}
                onClick={() => onSelectFolder(folder.folder_name)}
              >
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Icon
                      icon={isSelected ? appIcons.chevronDown : appIcons.chevronRight}
                      className="h-4 w-4 shrink-0"
                      style={{ color: tertiaryText }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-sm font-semibold" style={{ color: pageText }}>
                          {folder.folder_name}
                        </span>
                        {folder.found && folder.story && folder.folder ? (
                          <span
                            className="rounded-md border px-2 py-0.5 text-xs font-medium"
                            style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.2)', color: '#10b981' }}
                          >
                            Matched
                          </span>
                        ) : (
                          <span
                            className="rounded-md border px-2 py-0.5 text-xs font-medium"
                            style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', color: '#f87171' }}
                          >
                            Not Found
                          </span>
                        )}
                        {folderResults && (
                          <span
                            className="rounded-md border px-2 py-0.5 text-xs font-medium"
                            style={{
                              background: failedCount > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                              borderColor: failedCount > 0 ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)',
                              color: failedCount > 0 ? '#f59e0b' : '#10b981',
                            }}
                          >
                            {successCount} ok, {failedCount} failed
                          </span>
                        )}
                        {folder.stopped_at && (
                          <span
                            className="rounded-md border px-2 py-0.5 text-xs font-medium"
                            style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', color: '#f87171' }}
                          >
                            Stopped at Ch. {folder.stopped_at}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: secondaryText }}>
                        {folder.story && (
                          <span className="truncate max-w-xs">{folder.story.title}</span>
                        )}
                        {!folder.found && (
                          <span className="truncate italic">{folder.message}</span>
                        )}
                        {folder.found && (
                          <>
                            <span>{readyChapters.length} ready chapters</span>
                            {folder.stop_reason && (
                              <span className="truncate italic max-w-xs" style={{ color: '#f87171' }}>
                                {folder.stop_reason}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start lg:self-center">
                    {isUpdatingFolder && folder.found && (
                      <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" style={{ color: secondaryText }} />
                    )}
                  </div>
                </div>
              </div>

              {isSelected && folder.found && folder.story && folder.folder && (
                <div className="ml-4 space-y-2 border-l-2 border-amber-500/30 pl-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wider" style={{ color: secondaryText }}>
                      Chapters
                    </span>
                    <span className="text-xs" style={{ color: tertiaryText }}>
                      {readyChapters.length} ready
                    </span>
                  </div>
                  {readyChapters.length === 0 ? (
                    <EmptyPanel isDark={isDark} />
                  ) : (
                    readyChapters.map((chapter) => (
                      <ChapterRow
                        key={chapter.chapterNumber}
                        chapter={chapter}
                        isDark={isDark}
                        result={folderResults?.find((r) => r.chapter_number === chapter.chapterNumber)}
                        isUpdating={false}
                        canUpdate={false}
                        onConfirm={onConfirmUpdate}
                        panelBorder={panelBorder}
                        pageText={pageText}
                        secondaryText={secondaryText}
                        tertiaryText={tertiaryText}
                        mutedSurface={mutedSurface}
                        compact
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function ChapterRow(props: Readonly<{
  chapter: ContentUpdateChapterStatus;
  isDark: boolean;
  result?: BatchChapterUpdateResult | ChapterResult;
  isUpdating: boolean;
  canUpdate: boolean;
  onConfirm: (chapter: ContentUpdateChapterStatus) => void;
  panelBorder: string;
  pageText: string;
  secondaryText: string;
  tertiaryText: string;
  mutedSurface: string;
  compact?: boolean;
}>) {
  const { chapter, isDark, result, isUpdating, canUpdate, onConfirm, panelBorder, pageText, secondaryText, tertiaryText, mutedSurface, compact } = props;
  const status = getChapterStatus(chapter.status, isDark);
  const rowBorder = chapter.status === 'ready' ? 'rgba(245,158,11,0.28)' : panelBorder;

  return (
    <div
      className="overflow-hidden rounded-xl border p-3 sm:p-4"
      style={{ background: mutedSurface, borderColor: rowBorder }}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className="rounded-lg px-2 py-1 font-mono text-xs"
              style={{ background: mutedSurface, color: secondaryText }}
            >
              Ch. {chapter.chapterNumber}
            </span>
            <h3 className="truncate text-sm font-semibold" style={{ color: pageText }}>
              {chapter.title || chapter.fileName || 'Untitled'}
            </h3>
            <span
              className="rounded-md border px-2 py-0.5 text-xs font-medium"
              style={{ background: `${status.color}14`, borderColor: `${status.color}40`, color: status.color }}
            >
              {status.label}
            </span>
          </div>
          {!compact && (
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: tertiaryText }}>
              {chapter.fileName && (
                <span className="max-w-md truncate font-mono">{chapter.fileName}</span>
              )}
              {chapter.serverLength > 0 && (
                <span>Server text: {chapter.serverLength.toLocaleString()} chars</span>
              )}
              <span>Drive text: {chapter.driveLength.toLocaleString()} chars</span>
            </div>
          )}
          {result && (
            <p
              className="mt-1 text-xs"
              style={{ color: result.success ? '#34d399' : '#f87171' }}
            >
              {result.message}
            </p>
          )}
        </div>
        {canUpdate && (
          <div className="flex items-center gap-2 self-start lg:self-center">
            <button
              onClick={() => onConfirm(chapter)}
              disabled={!canUpdate || isUpdating}
              className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
              style={
                canUpdate && !isUpdating
                  ? { background: 'linear-gradient(135deg, #f59e0b, #ea580c)', borderColor: 'transparent', color: '#ffffff' }
                  : { background: mutedSurface, borderColor: panelBorder, color: secondaryText, opacity: 0.65 }
              }
            >
              {isUpdating ? (
                <>
                  <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Icon icon={appIcons.trends} className="h-4 w-4" />
                  Update
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox(props: Readonly<{
  label: string;
  value: number;
  color: string;
  isDark: boolean;
}>) {
  const { label, value, color, isDark } = props;
  return (
    <div
      className="min-w-24 rounded-xl border px-3 py-2"
      style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)' }}
    >
      <div className="text-lg font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px]" style={{ color: isDark ? 'rgba(255,255,255,0.42)' : 'rgba(55,53,47,0.42)' }}>
        {label}
      </div>
    </div>
  );
}

function EmptyPanel(props: Readonly<{ isDark: boolean }>) {
  const { isDark } = props;
  return (
    <div
      className="flex h-full min-h-[200px] flex-col items-center justify-center text-center"
      style={{ color: isDark ? 'rgba(255,255,255,0.42)' : 'rgba(55,53,47,0.42)' }}
    >
      <Icon icon={appIcons.check} className="mb-2 h-9 w-9" />
      <p className="text-sm">No chapters to show.</p>
    </div>
  );
}

function markChapterUpdated(
  prev: ContentUpdateScanResponse | null,
  chapterNumber: number,
  updatedChapter?: ContentUpdateChapterStatus | null,
): ContentUpdateScanResponse | null {
  if (!prev) return prev;
  const oldChapter = prev.chapters.find((ch) => ch.chapterNumber === chapterNumber);
  const wasReady = oldChapter?.status === 'ready';
  return {
    ...prev,
    summary: {
      ...prev.summary,
      different: wasReady ? Math.max(0, prev.summary.different - 1) : prev.summary.different,
      same: wasReady ? prev.summary.same + 1 : prev.summary.same,
    },
    chapters: prev.chapters.map((ch) =>
      ch.chapterNumber === chapterNumber
        ? {
            ...ch,
            ...(updatedChapter ?? null),
            status: 'updated' as const,
            message: 'Updated from Drive.',
            serverLength: updatedChapter?.serverLength ?? ch.driveLength,
          }
        : ch,
    ),
  };
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
