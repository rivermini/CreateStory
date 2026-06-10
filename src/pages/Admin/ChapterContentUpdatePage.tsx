import { useMemo, useState } from 'react';
import {
  inspectContentUpdateFolder,
  updateContentChapter,
  type ContentUpdateChapterStatus,
  type ContentUpdateScanResponse,
  type ContentUpdateStoryRef,
} from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';
import { showToast } from '../../components/Shared/Toast';
import { useDriveSyncConfig } from '../../hooks/useDriveSyncConfig';
import type { ThemeMode } from '../../types/theme';

interface ChapterContentUpdatePageProps {
  themeMode: ThemeMode;
}

type ChapterResult = { success: boolean; message: string };

export function ChapterContentUpdatePage({ themeMode }: ChapterContentUpdatePageProps) {
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

  const handleSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = keyword.trim();
    if (!query) return;
    setChecking(true);
    setSearchError('');
    setSelectedStory(null);
    setScanData(null);
    setScanError('');
    setUpdateResults(new Map());
    try {
      const result = await inspectContentUpdateFolder(query);
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
  const hasScan = Boolean(scanData);

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
                  Paste a Drive folder name, verify its server story, then push chapter files one at a time.
                </p>
              </div>
              {selectedStory && (
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
                        placeholder="Exact Drive folder name"
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
                          Check Folder
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
                    Checking folder and loading chapter files...
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

              {hasScan && scanData && !checking && (
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
                              style={{
                                background: 'rgba(245,158,11,0.12)',
                                borderColor: 'rgba(245,158,11,0.2)',
                                color: '#f59e0b',
                              }}
                            >
                              Folder matched
                            </span>
                          )}
                          {scanData.story && (
                            <span
                              className="rounded-md border px-2 py-0.5 text-xs font-medium"
                              style={{
                                background: 'rgba(99,102,241,0.1)',
                                borderColor: 'rgba(99,102,241,0.2)',
                                color: '#818cf8',
                              }}
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
                        <StatBox
                          label="Ready"
                          value={updateableChapters.length}
                          color="#10b981"
                          isDark={isDark}
                        />
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
            ...(updatedChapter ?? {}),
            status: 'updated',
            message: 'Updated from Drive.',
            serverLength: updatedChapter?.serverLength ?? ch.driveLength,
          }
        : ch,
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
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const status = getChapterStatus(chapter.status, isDark);

  const rowBorder = chapter.status === 'ready' ? 'rgba(245,158,11,0.28)' : panelBorder;

  return (
    <div
      className="overflow-hidden rounded-xl border p-4"
      style={{
        background: mutedSurface,
        borderColor: rowBorder,
      }}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
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
              style={{
                background: `${status.color}14`,
                borderColor: `${status.color}40`,
                color: status.color,
              }}
            >
              {status.label}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: tertiaryText }}>
            {chapter.fileName && (
              <span className="max-w-md truncate font-mono">{chapter.fileName}</span>
            )}
            {chapter.serverLength > 0 && (
              <span>Server text: {chapter.serverLength.toLocaleString()} chars</span>
            )}
            <span>Drive text: {chapter.driveLength.toLocaleString()} chars</span>
          </div>
          {(chapter.message || result) && (
            <p
              className="mt-1.5 text-xs"
              style={{ color: result ? (result.success ? '#34d399' : '#f87171') : tertiaryText }}
            >
              {result?.message ?? chapter.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 self-start lg:self-center">
          <button
            onClick={onConfirm}
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
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  color,
  isDark,
}: {
  label: string;
  value: number;
  color: string;
  isDark: boolean;
}) {
  return (
    <div className="min-w-24 rounded-xl border px-3 py-2" style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)' }}>
      <div className="text-lg font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px]" style={{ color: isDark ? 'rgba(255,255,255,0.42)' : 'rgba(55,53,47,0.42)' }}>
        {label}
      </div>
    </div>
  );
}

function EmptyPanel({ isDark }: { isDark: boolean }) {
  return (
    <div
      className="flex h-full min-h-[260px] flex-col items-center justify-center text-center"
      style={{ color: isDark ? 'rgba(255,255,255,0.42)' : 'rgba(55,53,47,0.42)' }}
    >
      <Icon icon={appIcons.check} className="mb-2 h-9 w-9" />
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
