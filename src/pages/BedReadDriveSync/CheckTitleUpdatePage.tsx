import { useRef, useState } from 'react';
import {
  checkAllTitles,
  getTitleFolderDetail,
  updateChapterTitle,
  updateFolderTitles,
  batchUpdateTitles,
  type CheckAllTitleResponse,
  type TitleFolderEntry,
  type TitleFolderStatus,
} from '../../api/BedReadDriveSync';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';
import { showToast } from '../../components/Shared/Toast';
import { useDriveSyncConfig } from '../../hooks/useDriveSyncConfig';
import type { ThemeMode } from '../../types/theme';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type FilterStatus = 'all' | TitleFolderStatus;

const STATUS_LABELS: Record<TitleFolderStatus, string> = {
  can_update: 'Can Update',
  all_match: 'All Match',
  no_server_match: 'No Server Match',
  empty_chapters: 'Empty Chapters',
};

const STATUS_COLORS: Record<TitleFolderStatus, string> = {
  can_update: '#10b981',
  all_match: '#6366f1',
  no_server_match: '#f59e0b',
  empty_chapters: '#94a3b8',
};

function StatusBadge({ status }: { status: TitleFolderStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: `${color}18`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function ChapterRow({
  chapter,
  onUpdate,
  isUpdating,
}: {
  chapter: TitleFolderEntry['chapters'][number];
  onUpdate: (chapterNumber: number) => void;
  isUpdating: boolean;
}) {
  const isUpdatable = chapter.status === 'can_update_title';
  const statusColors: Record<string, string> = {
    matched: '#10b981',
    can_update_title: '#f59e0b',
    missing_drive: '#94a3b8',
    drive_only: '#94a3b8',
    error: '#ef4444',
  };
  const statusColor = statusColors[chapter.status] ?? '#94a3b8';

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pl-4 pr-3 text-center text-sm font-medium" style={{ color: statusColor }}>
        {chapter.chapter_number}
      </td>
      <td className="py-2 px-3 text-sm" style={{ color: '#9ca3af' }}>
        {chapter.file_name ?? '—'}
      </td>
      <td className="py-2 px-3 text-sm" style={{ color: '#e5e7eb' }}>
        {chapter.drive_title || <span style={{ color: '#6b7280' }}>—</span>}
      </td>
      <td className="py-2 px-3 text-sm" style={{ color: '#9ca3af' }}>
        {chapter.server_title ?? '—'}
      </td>
      <td className="py-2 px-3">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: `${statusColor}18`, color: statusColor }}
        >
          {chapter.status}
        </span>
      </td>
      <td className="py-2 pr-4 pl-3 text-right">
        {isUpdatable && (
          <button
            className="rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: '#f59e0b55',
              background: '#f59e0b15',
              color: '#f59e0b',
            }}
            onClick={() => onUpdate(chapter.chapter_number)}
            disabled={isUpdating}
          >
            {isUpdating ? 'Updating…' : 'Update Title'}
          </button>
        )}
      </td>
    </tr>
  );
}

function FolderCard({
  entry,
  expandedId,
  setExpandedId,
  detailEntry,
  detailLoading,
  onChapterUpdate,
  onFolderUpdate,
  onRequestDetail,
  updatingFolderIds,
  chapterUpdateVersions,
  themeMode,
}: {
  entry: TitleFolderEntry;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  detailEntry: TitleFolderEntry | null;
  detailLoading: boolean;
  onChapterUpdate: (folderId: string, storyId: string, chapterNumber: number) => void;
  onFolderUpdate: (entry: TitleFolderEntry) => void;
  onRequestDetail: (folderId: string) => void;
  updatingFolderIds: Set<string>;
  chapterUpdateVersions: Map<string, number>;
  themeMode: ThemeMode;
}) {
  const isDark = themeMode === 'dark';
  const isExpanded = expandedId === entry.folder_id;
  const isUpdatingFolder = updatingFolderIds.has(entry.folder_id);
  const chapterVersion = chapterUpdateVersions.get(entry.folder_id) ?? 0;

  // When expanded, prefer the on-demand detail entry. If still loading or
  // not yet fetched, fall back to the summary entry.
  const renderChapters = isExpanded
    ? (detailEntry?.chapters ?? entry.chapters)
    : entry.chapters;
  const renderLoading = isExpanded && detailLoading && !detailEntry;

  return (
    <div
      className="rounded-xl border transition-all"
      style={{
        background: isDark ? '#1e1e1e' : '#ffffff',
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)',
      }}
    >
      <button
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors"
        style={{}}
        onClick={() => {
          const next = isExpanded ? null : entry.folder_id;
          setExpandedId(next);
          if (next && entry.chapters.length === 0) {
            onRequestDetail(entry.folder_id);
          }
        }}
      >
        <Icon
          icon={appIcons.chevronRight}
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
          style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(55,53,47,0.5)' }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="truncate text-sm font-medium"
              style={{ color: isDark ? 'rgba(255,255,255,0.9)' : '#37352f' }}
            >
              {entry.story_title || entry.folder_name}
            </span>
            <StatusBadge status={entry.folder_status} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(55,53,47,0.5)' }}>
            <span>{entry.folder_name}</span>
            {entry.story_id && <span>ID: {entry.story_id}</span>}
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#10b981' }} />
              {entry.matched_count} matched
            </span>
            {entry.can_update_count > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#f59e0b' }} />
                {entry.can_update_count} can update
              </span>
            )}
            {entry.missing_drive_count > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#94a3b8' }} />
                {entry.missing_drive_count} missing drive
              </span>
            )}
            {entry.drive_only_count > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#94a3b8' }} />
                {entry.drive_only_count} drive only
              </span>
            )}
          </div>
        </div>
        {entry.can_update_count > 0 && (
          <button
            className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: '#f59e0b55',
              background: '#f59e0b15',
              color: '#f59e0b',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onFolderUpdate(entry);
            }}
            disabled={isUpdatingFolder}
          >
            {isUpdatingFolder ? 'Updating…' : `Update All (${entry.can_update_count})`}
          </button>
        )}
      </button>

      {isExpanded && (
        <div
          className="border-t px-4 py-3"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(55,53,47,0.08)' }}
        >
          {renderLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" style={{ color: '#10b981' }} />
              <span className="text-sm" style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(55,53,47,0.5)' }}>
                Loading chapter details…
              </span>
            </div>
          ) : renderChapters.length === 0 ? (
            <p className="py-2 text-sm" style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(55,53,47,0.5)' }}>
              No chapter data available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr
                    className="border-b text-xs"
                    style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(55,53,47,0.08)' }}
                  >
                    <th className="pb-1.5 pl-4 pr-3 font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.6)' }}>#</th>
                    <th className="pb-1.5 px-3 font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.6)' }}>File Name</th>
                    <th className="pb-1.5 px-3 font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.6)' }}>Drive Title</th>
                    <th className="pb-1.5 px-3 font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.6)' }}>Server Title</th>
                    <th className="pb-1.5 px-3 font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.6)' }}>Status</th>
                    <th className="pb-1.5 pr-4 pl-3 font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.6)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {renderChapters.map((ch) => (
                    <ChapterRow
                      key={`${entry.folder_id}-${ch.chapter_number}-${chapterVersion}`}
                      chapter={ch}
                      onUpdate={(cn) => {
                        if (entry.story_id) {
                          onChapterUpdate(entry.folder_id, entry.story_id, cn);
                        }
                      }}
                      isUpdating={isUpdatingFolder}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

interface CheckTitleUpdatePageProps {
  readonly themeMode: ThemeMode;
}

export function CheckTitleUpdatePage({ themeMode }: CheckTitleUpdatePageProps) {
  const isDark = themeMode === 'dark';

  const {
    config,
    configLoading,
    configError,
    configInvalid,
    tokenInvalid,
  } = useDriveSyncConfig({ validateToken: false, enableEditing: false });

  const [checkAllData, setCheckAllData] = useState<CheckAllTitleResponse | null>(null);
  const [checkAllLoading, setCheckAllLoading] = useState(false);
  const [checkAllError, setCheckAllError] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [searchKeyword, setSearchKeyword] = useState('');

  // On-demand per-folder chapter details, loaded when the user expands a folder.
  // Summary check-all does NOT include chapter lists, so we fetch them here.
  const [folderDetails, setFolderDetails] = useState<Map<string, TitleFolderEntry>>(new Map());
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const detailLocksRef = useRef<Set<string>>(new Set());

  const [updatingFolderIds, setUpdatingFolderIds] = useState<Set<string>>(new Set());
  const [chapterUpdateVersions, setChapterUpdateVersions] = useState<Map<string, number>>(new Map());
  const updateLocksRef = useRef<Set<string>>(new Set());
  const updateResultVersionRef = useRef(0);

  const pageBackground = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';

  const allFolders: TitleFolderEntry[] = checkAllData
    ? [...checkAllData.can_update, ...checkAllData.all_match, ...checkAllData.no_server_match, ...checkAllData.empty_chapters]
    : [];

  const filteredFolders = allFolders.filter((f) => {
    if (filterStatus !== 'all' && f.folder_status !== filterStatus) return false;
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      return f.story_title.toLowerCase().includes(kw) || f.folder_name.toLowerCase().includes(kw);
    }
    return true;
  });

  const statusCounts: Record<FilterStatus, number> = {
    all: allFolders.length,
    can_update: (checkAllData?.can_update.length ?? 0),
    all_match: (checkAllData?.all_match.length ?? 0),
    no_server_match: (checkAllData?.no_server_match.length ?? 0),
    empty_chapters: (checkAllData?.empty_chapters.length ?? 0),
  };

  const canUpdateIds = checkAllData?.can_update.map((f) => f.folder_id) ?? [];

  const handleRequestDetail = async (folderId: string) => {
    if (detailLocksRef.current.has(folderId)) return;
    // Already loaded — no need to refetch.
    if (folderDetails.has(folderId)) return;
    detailLocksRef.current.add(folderId);
    setLoadingDetailId(folderId);
    try {
      const detail = await getTitleFolderDetail(folderId);
      setFolderDetails((prev) => {
        const next = new Map(prev);
        next.set(folderId, detail);
        return next;
      });
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Failed to load chapter details.',
        'error',
        4000,
        'top-center'
      );
    } finally {
      detailLocksRef.current.delete(folderId);
      setLoadingDetailId((cur) => (cur === folderId ? null : cur));
    }
  };

  const handleCheckAll = async () => {
    setCheckAllData(null);
    setCheckAllLoading(true);
    setCheckAllError('');
    setExpandedId(null);
    setFolderDetails(new Map());
    setLoadingDetailId(null);
    try {
      const data = await checkAllTitles();
      setCheckAllData(data);
    } catch (e) {
      setCheckAllError(e instanceof Error ? e.message : 'Failed to check title updates.');
    } finally {
      setCheckAllLoading(false);
    }
  };

  const handleChapterUpdate = async (folderId: string, storyId: string, chapterNumber: number) => {
    if (updateLocksRef.current.has(folderId)) return;
    const resultVersion = updateResultVersionRef.current;
    updateLocksRef.current.add(folderId);
    setUpdatingFolderIds((prev) => new Set(prev).add(folderId));

    try {
      const result = await updateChapterTitle(storyId, folderId, chapterNumber);
      if (resultVersion === updateResultVersionRef.current) {
        showToast(
          result.success ? `Chapter ${chapterNumber} title updated.` : result.message,
          result.success ? 'success' : 'error',
          3000,
          'top-center'
        );
        if (result.success) {
          setChapterUpdateVersions((prev) => {
            const next = new Map(prev);
            next.set(folderId, (prev.get(folderId) ?? 0) + 1);
            return next;
          });
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Chapter update failed.', 'error', 4000, 'top-center');
    } finally {
      updateLocksRef.current.delete(folderId);
      setUpdatingFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  };

  const handleFolderUpdate = async (entry: TitleFolderEntry) => {
    if (!entry.story_id || updateLocksRef.current.has(entry.folder_id)) return;
    const resultVersion = updateResultVersionRef.current;
    updateLocksRef.current.add(entry.folder_id);
    setUpdatingFolderIds((prev) => new Set(prev).add(entry.folder_id));

    try {
      const result = await updateFolderTitles(entry.story_id, entry.folder_id);
      if (resultVersion === updateResultVersionRef.current) {
        const msg =
          result.failed_count === 0
            ? `Folder updated: ${result.success_count} titles changed.`
            : `Folder updated: ${result.success_count} changed, ${result.failed_count} failed.`;
        showToast(msg, result.failed_count > 0 ? 'warning' : 'success', 4000, 'top-center');
        if (result.success_count > 0) {
          updateResultVersionRef.current += 1;
          setChapterUpdateVersions((prev) => {
            const next = new Map(prev);
            next.set(entry.folder_id, (prev.get(entry.folder_id) ?? 0) + 1);
            return next;
          });
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Folder update failed.', 'error', 4000, 'top-center');
    } finally {
      updateLocksRef.current.delete(entry.folder_id);
      setUpdatingFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.folder_id);
        return next;
      });
    }
  };

  const handleBatchUpdateAll = async () => {
    if (canUpdateIds.length === 0) return;
    const resultVersion = updateResultVersionRef.current;

    try {
      const result = await batchUpdateTitles(canUpdateIds, 2);
      if (resultVersion === updateResultVersionRef.current) {
        let totalSuccess = 0;
        let totalFailed = 0;
        for (const folder of result.results) {
          totalSuccess += folder.success_count;
          totalFailed += folder.failed_count;
        }
        showToast(
          totalFailed === 0
            ? `Batch complete: ${totalSuccess} titles updated across ${result.results.length} folders.`
            : `Batch complete: ${totalSuccess} updated, ${totalFailed} failed across ${result.results.length} folders.`,
          totalFailed > 0 ? 'warning' : 'success',
          5000,
          'top-center'
        );
        updateResultVersionRef.current += 1;
        setChapterUpdateVersions(new Map());
        setCheckAllData(null);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Batch update failed.', 'error', 4000, 'top-center');
    }
  };

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <main className="space-y-4">
          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Sync
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                Chapter title update
              </h1>
              <p className="text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                Compare and update chapter titles between Drive `DONE_`/`EXTENDED_` folders and the main server.
              </p>
            </div>
          </section>

          {config && !configLoading && (
            <div
              className="flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-3"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ background: '#10b981' }} />
                <span className="text-sm font-medium" style={{ color: pageText }}>Ready</span>
              </div>
              <div className="hidden h-5 sm:block" style={{ width: '1px', background: panelBorder }} />
              <div className="flex min-w-0 items-center gap-2">
                <Icon icon={appIcons.folder} className="h-4 w-4 shrink-0" style={{ color: tertiaryText }} />
                <span className="truncate text-xs sm:text-sm" style={{ color: tertiaryText }}>
                  {config.folder_id}
                </span>
              </div>
            </div>
          )}

          {configLoading && (
            <div
              className="flex items-center justify-center gap-3 rounded-2xl border p-8"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <Icon icon={appIcons.spinner} className="h-6 w-6 animate-spin" style={{ color: secondaryText }} />
              <span className="text-sm" style={{ color: secondaryText }}>Loading Drive Sync…</span>
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
            <section
              className="rounded-2xl border px-5 py-4"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    borderColor: '#10b98155',
                    background: '#10b98115',
                    color: '#10b981',
                  }}
                  onClick={handleCheckAll}
                  disabled={checkAllLoading}
                >
                  {checkAllLoading ? 'Checking…' : 'Check All'}
                </button>

                {checkAllData && statusCounts.can_update > 0 && (
                  <button
                    className="rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      borderColor: '#f59e0b55',
                      background: '#f59e0b15',
                      color: '#f59e0b',
                    }}
                    onClick={handleBatchUpdateAll}
                  >
                    Update All ({statusCounts.can_update} folders, 2 at a time)
                  </button>
                )}

                <div className="h-5 w-px" style={{ background: panelBorder }} />

                <div className="relative flex-1 min-w-48 max-w-xs">
                  <Icon
                    icon={appIcons.search}
                    className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                    style={{ color: tertiaryText }}
                  />
                  <input
                    type="text"
                    placeholder="Search folders…"
                    className="w-full rounded-lg border bg-transparent py-1.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-[#10b981]"
                    style={{
                      borderColor: panelBorder,
                      color: pageText,
                      background: isDark ? '#1e1e1e' : '#f9f9f8',
                    }}
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                  />
                </div>
              </div>

              {checkAllLoading && (
                <div className="mt-4 flex items-center gap-3 py-4">
                  <Icon icon={appIcons.spinner} className="h-5 w-5 animate-spin" style={{ color: '#10b981' }} />
                  <span className="text-sm" style={{ color: secondaryText }}>
                    Scanning DONE_/EXTENDED_ folders and comparing titles…
                  </span>
                </div>
              )}

              {checkAllError && (
                <div
                  className="mt-4 rounded-xl border p-3 text-sm"
                  style={{
                    background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
                    borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
                    color: isDark ? '#f87171' : '#dc2626',
                  }}
                >
                  {checkAllError}
                </div>
              )}

              {checkAllData && (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {(['all', 'can_update', 'all_match', 'no_server_match', 'empty_chapters'] as FilterStatus[]).map((s) => {
                      const count = statusCounts[s];
                      const isActive = filterStatus === s;
                      const chipColor = s === 'all' ? undefined : STATUS_COLORS[s as TitleFolderStatus];
                      return (
                        <button
                          key={s}
                          className="rounded-full border px-3 py-1 text-xs font-medium transition-all"
                          style={{
                            borderColor: isActive ? (chipColor ?? '#10b981') : panelBorder,
                            background: isActive ? `${chipColor ?? '#10b981'}18` : 'transparent',
                            color: isActive ? (chipColor ?? '#10b981') : tertiaryText,
                          }}
                          onClick={() => setFilterStatus(s)}
                        >
                          {s === 'all' ? 'All' : STATUS_LABELS[s as TitleFolderStatus]} ({count})
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 space-y-2">
                    {filteredFolders.length === 0 ? (
                      <p className="py-6 text-center text-sm" style={{ color: tertiaryText }}>
                        No folders match the current filter.
                      </p>
                    ) : (
                      filteredFolders.map((entry) => (
                        <FolderCard
                          key={entry.folder_id}
                          entry={entry}
                          expandedId={expandedId}
                          setExpandedId={setExpandedId}
                          detailEntry={folderDetails.get(entry.folder_id) ?? null}
                          detailLoading={loadingDetailId === entry.folder_id}
                          onChapterUpdate={handleChapterUpdate}
                          onFolderUpdate={handleFolderUpdate}
                          onRequestDetail={handleRequestDetail}
                          updatingFolderIds={updatingFolderIds}
                          chapterUpdateVersions={chapterUpdateVersions}
                          themeMode={themeMode}
                        />
                      ))
                    )}
                  </div>
                </>
              )}

              {!checkAllData && !checkAllLoading && (
                <div className="mt-4 py-6 text-center">
                  <p className="text-sm" style={{ color: tertiaryText }}>
                    Click <strong style={{ color: '#10b981' }}>Check All</strong> to scan all DONE_/EXTENDED_ folders.
                  </p>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
