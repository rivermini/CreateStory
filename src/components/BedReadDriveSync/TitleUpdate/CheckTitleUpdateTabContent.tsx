import { useState } from 'react';
import {
  type CheckAllTitleResponse,
  type TitleFolderEntry,
  type TitleFolderStatus,
} from '../../../api';
import { Icon, appIcons } from '../../Shared/Icon';
import { EmptyState } from '../DriveSync/SyncTabShared';
import type { ThemeMode } from '../../../types/theme';

// ---------------------------------------------------------------------------
// Shared look-ups
// ---------------------------------------------------------------------------

type FilterStatus = 'all' | TitleFolderStatus;

// ---------------------------------------------------------------------------
// Main tab content
// ---------------------------------------------------------------------------

interface CheckTitleUpdateTabContentProps {
  data: CheckAllTitleResponse | null;
  loading: boolean;
  error: string;
  folderDetails: Map<string, TitleFolderEntry>;
  loadingDetailId: string | null;
  updatingFolderIds: Set<string>;
  chapterUpdateVersions: Map<string, number>;
  onCheckAll: () => void;
  onRequestDetail: (folderId: string) => void;
  onChapterUpdate: (folderId: string, storyId: string, chapterNumber: number) => void;
  onFolderUpdate: (entry: TitleFolderEntry) => void;
  onBatchUpdateAll: () => void;
  themeMode: ThemeMode;
}

export function CheckTitleUpdateTabContent({
  data,
  loading,
  error,
  folderDetails,
  loadingDetailId,
  updatingFolderIds,
  chapterUpdateVersions,
  onCheckAll,
  onRequestDetail,
  onChapterUpdate,
  onFolderUpdate,
  onBatchUpdateAll,
  themeMode,
}: Readonly<CheckTitleUpdateTabContentProps>) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState<FilterStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batchUpdating, setBatchUpdating] = useState(false);

  const query = search.toLowerCase().trim();
  const matchesQuery = (entry: TitleFolderEntry) =>
    !query ||
    entry.story_title.toLowerCase().includes(query) ||
    entry.folder_name.toLowerCase().includes(query);

  const allFolders: TitleFolderEntry[] = data
    ? [...data.can_update, ...data.all_match, ...data.no_server_match, ...data.empty_chapters]
    : [];

  const filteredByQuery = (entries: TitleFolderEntry[]) => entries.filter(matchesQuery);
  const filteredCanUpdate = filteredByQuery(data?.can_update ?? []);
  const filteredAllMatch = filteredByQuery(data?.all_match ?? []);
  const filteredNoServerMatch = filteredByQuery(data?.no_server_match ?? []);
  const filteredEmptyChapters = filteredByQuery(data?.empty_chapters ?? []);

  const canUpdateCount = filteredCanUpdate.length;
  const allMatchCount = filteredAllMatch.length;
  const noServerMatchCount = filteredNoServerMatch.length;
  const emptyChaptersCount = filteredEmptyChapters.length;
  const totalCount = canUpdateCount + allMatchCount + noServerMatchCount + emptyChaptersCount;

  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const searchBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const handleBatchUpdateAll = async () => {
    if (batchUpdating) return;
    setBatchUpdating(true);
    try {
      onBatchUpdateAll();
    } finally {
      setBatchUpdating(false);
    }
  };

  return (
    <div className="flex h-full min-h-[400px] flex-col">
      {/* Sticky toolbar */}
      <div
        className="sticky top-0 z-10 flex flex-col gap-3 p-4 sm:flex-row"
        style={{ background: isDark ? '#202020' : '#ffffff', borderBottom: `1px solid ${panelBorder}` }}
      >
        <div className="relative min-w-0 flex-1">
          <Icon icon={appIcons.search} className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: tertiaryText }} />
          <input
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-xl border py-2.5 pl-9 pr-10 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            style={{ background: searchBg, borderColor: panelBorder, color: pageText }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 transition-colors"
              style={{ color: secondaryText }}
            >
              <Icon icon={appIcons.close} className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleBatchUpdateAll}
            disabled={batchUpdating || loading || (data?.can_update.length ?? 0) === 0}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              background: batchUpdating || loading || (data?.can_update.length ?? 0) === 0 ? mutedSurface : '#ff5b00',
              borderColor: batchUpdating || loading || (data?.can_update.length ?? 0) === 0 ? panelBorder : '#ff5b00',
              color: batchUpdating || loading || (data?.can_update.length ?? 0) === 0 ? secondaryText : '#ffffff',
              opacity: batchUpdating || loading || (data?.can_update.length ?? 0) === 0 ? 0.65 : 1,
            }}
            title={
              batchUpdating
                ? 'Batch update in progress'
                : loading
                ? 'Scan in progress'
                : (data?.can_update.length ?? 0) === 0
                ? 'No folders to update. Run Check Title Update first.'
                : undefined
            }
          >
            <Icon icon={batchUpdating ? appIcons.spinner : appIcons.uploadFile} className={`h-4 w-4 ${batchUpdating ? 'animate-spin' : ''}`} />
            Update All ({data?.can_update.length ?? 0} folders, 2 at a time)
          </button>
          <button
            onClick={onCheckAll}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              background: loading ? mutedSurface : '#ff5b00',
              borderColor: loading ? panelBorder : '#ff5b00',
              color: loading ? secondaryText : '#ffffff',
              opacity: loading ? 0.65 : 1,
            }}
          >
            {loading ? (
              <>
                <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Icon icon={appIcons.search} className="h-4 w-4" />
                Check Title Update
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="mx-4 mt-4 flex items-center gap-3 rounded-xl border p-3"
          style={{
            background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)',
            borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
            color: isDark ? '#f87171' : '#dc2626',
          }}
        >
          <Icon icon={appIcons.error} className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {/* Filter chips */}
      {data && (
        <div className="flex items-center gap-1 border-b px-4 py-2" style={{ background: mutedSurface, borderColor: panelBorder }}>
          <FilterChip label="All" count={totalCount} active={filterSection === 'all'} onClick={() => setFilterSection('all')} isDark={isDark} />
          <FilterChip label="Can Update" count={canUpdateCount} active={filterSection === 'can_update'} onClick={() => setFilterSection('can_update')} variant="green" isDark={isDark} />
          <FilterChip label="All Match" count={allMatchCount} active={filterSection === 'all_match'} onClick={() => setFilterSection('all_match')} variant="indigo" isDark={isDark} />
          <FilterChip label="No Server Match" count={noServerMatchCount} active={filterSection === 'no_server_match'} onClick={() => setFilterSection('no_server_match')} variant="amber" isDark={isDark} />
          <FilterChip label="Empty Chapters" count={emptyChaptersCount} active={filterSection === 'empty_chapters'} onClick={() => setFilterSection('empty_chapters')} isDark={isDark} />
        </div>
      )}

      {/* Stats row */}
      {data && !loading && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2 text-xs" style={{ background: mutedSurface, color: secondaryText }}>
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.folder} className="h-3.5 w-3.5" style={{ color: isDark ? '#ff7c33' : '#ff5b00' }} />
            {allFolders.length} DONE_/EXTENDED_ folders
          </div>
          {canUpdateCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#34d399' : '#059669' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              {canUpdateCount} can update
            </div>
          )}
          {allMatchCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#ff7c33' : '#ff5b00' }}>
              <Icon icon={appIcons.checkCircle} className="h-3.5 w-3.5" />
              {allMatchCount} all match
            </div>
          )}
          {noServerMatchCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#fbbf24' : '#d97706' }}>
              <Icon icon={appIcons.folder} className="h-3.5 w-3.5" />
              {noServerMatchCount} no server match
            </div>
          )}
          {emptyChaptersCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }}>
              <Icon icon={appIcons.file} className="h-3.5 w-3.5" />
              {emptyChaptersCount} empty chapters
            </div>
          )}
        </div>
      )}

      {/* Main scrollable content */}
      <div className="flex-1 p-4">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Check Title Update' to scan DONE_/EXTENDED_ folders and compare chapter titles."
            icon={<Icon icon={appIcons.folder} className="h-8 w-8" style={{ color: tertiaryText }} />}
          />
        )}

        {loading && (
          <div className="flex h-full w-full flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: mutedSurface, border: `1px solid ${panelBorder}` }}>
              <Icon icon={appIcons.spinner} className="h-8 w-8 animate-spin" style={{ color: isDark ? '#ff7c33' : '#ff5b00' }} />
            </div>
            <p className="text-sm" style={{ color: secondaryText }}>
              Scanning DONE_/EXTENDED_ folders and comparing titles...
            </p>
          </div>
        )}

        {data && filterSection === 'all' && (
          <>
            {filteredCanUpdate.length > 0 && (
              <div className="mb-4">
                <SectionHeader label={`Can Update (${filteredCanUpdate.length})`} color="#34d399" icon={<Icon icon={appIcons.check} className="h-4 w-4" style={{ color: '#34d399' }} />} />
                <div className="space-y-3">
                  {filteredCanUpdate.map((entry) => (
                    <FolderCard
                      key={entry.folder_id}
                      entry={entry}
                      expandedId={expandedId}
                      setExpandedId={setExpandedId}
                      detailEntry={folderDetails.get(entry.folder_id) ?? null}
                      detailLoading={loadingDetailId === entry.folder_id}
                      onChapterUpdate={onChapterUpdate}
                      onFolderUpdate={onFolderUpdate}
                      onRequestDetail={onRequestDetail}
                      updatingFolderIds={updatingFolderIds}
                      chapterUpdateVersions={chapterUpdateVersions}
                      themeMode={themeMode}
                    />
                  ))}
                </div>
              </div>
            )}
            {filteredAllMatch.length > 0 && (
              <div className="mb-4">
                <SectionHeader label={`All Match (${filteredAllMatch.length})`} color="#ff7c33" icon={<Icon icon={appIcons.checkCircle} className="h-4 w-4" style={{ color: '#ff7c33' }} />} />
                <div className="space-y-3">
                  {filteredAllMatch.map((entry) => (
                    <FolderCard
                      key={entry.folder_id}
                      entry={entry}
                      expandedId={expandedId}
                      setExpandedId={setExpandedId}
                      detailEntry={folderDetails.get(entry.folder_id) ?? null}
                      detailLoading={loadingDetailId === entry.folder_id}
                      onChapterUpdate={onChapterUpdate}
                      onFolderUpdate={onFolderUpdate}
                      onRequestDetail={onRequestDetail}
                      updatingFolderIds={updatingFolderIds}
                      chapterUpdateVersions={chapterUpdateVersions}
                      themeMode={themeMode}
                    />
                  ))}
                </div>
              </div>
            )}
            {filteredNoServerMatch.length > 0 && (
              <div className="mb-4">
                <SectionHeader label={`No Server Match (${filteredNoServerMatch.length})`} color="#fbbf24" icon={<Icon icon={appIcons.folder} className="h-4 w-4" style={{ color: '#fbbf24' }} />} />
                <div className="space-y-3">
                  {filteredNoServerMatch.map((entry) => (
                    <FolderCard
                      key={entry.folder_id}
                      entry={entry}
                      expandedId={expandedId}
                      setExpandedId={setExpandedId}
                      detailEntry={folderDetails.get(entry.folder_id) ?? null}
                      detailLoading={loadingDetailId === entry.folder_id}
                      onChapterUpdate={onChapterUpdate}
                      onFolderUpdate={onFolderUpdate}
                      onRequestDetail={onRequestDetail}
                      updatingFolderIds={updatingFolderIds}
                      chapterUpdateVersions={chapterUpdateVersions}
                      themeMode={themeMode}
                    />
                  ))}
                </div>
              </div>
            )}
            {filteredEmptyChapters.length > 0 && (
              <div>
                <SectionHeader label={`Empty Chapters (${filteredEmptyChapters.length})`} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)'} icon={<Icon icon={appIcons.file} className="h-4 w-4" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }} />} />
                <div className="space-y-3">
                  {filteredEmptyChapters.map((entry) => (
                    <FolderCard
                      key={entry.folder_id}
                      entry={entry}
                      expandedId={expandedId}
                      setExpandedId={setExpandedId}
                      detailEntry={folderDetails.get(entry.folder_id) ?? null}
                      detailLoading={loadingDetailId === entry.folder_id}
                      onChapterUpdate={onChapterUpdate}
                      onFolderUpdate={onFolderUpdate}
                      onRequestDetail={onRequestDetail}
                      updatingFolderIds={updatingFolderIds}
                      chapterUpdateVersions={chapterUpdateVersions}
                      themeMode={themeMode}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {data && filterSection === 'can_update' && filteredCanUpdate.length > 0 && (
          <div className="space-y-3">
            {filteredCanUpdate.map((entry) => (
              <FolderCard
                key={entry.folder_id}
                entry={entry}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
                detailEntry={folderDetails.get(entry.folder_id) ?? null}
                detailLoading={loadingDetailId === entry.folder_id}
                onChapterUpdate={onChapterUpdate}
                onFolderUpdate={onFolderUpdate}
                onRequestDetail={onRequestDetail}
                updatingFolderIds={updatingFolderIds}
                chapterUpdateVersions={chapterUpdateVersions}
                themeMode={themeMode}
              />
            ))}
          </div>
        )}
        {data && filterSection === 'can_update' && filteredCanUpdate.length === 0 && <EmptySection isDark={isDark} message="No folders can be updated." />}

        {data && filterSection === 'all_match' && filteredAllMatch.length > 0 && (
          <div className="space-y-3">
            {filteredAllMatch.map((entry) => (
              <FolderCard
                key={entry.folder_id}
                entry={entry}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
                detailEntry={folderDetails.get(entry.folder_id) ?? null}
                detailLoading={loadingDetailId === entry.folder_id}
                onChapterUpdate={onChapterUpdate}
                onFolderUpdate={onFolderUpdate}
                onRequestDetail={onRequestDetail}
                updatingFolderIds={updatingFolderIds}
                chapterUpdateVersions={chapterUpdateVersions}
                themeMode={themeMode}
              />
            ))}
          </div>
        )}
        {data && filterSection === 'all_match' && filteredAllMatch.length === 0 && <EmptySection isDark={isDark} message="No folders with all matching titles." />}

        {data && filterSection === 'no_server_match' && filteredNoServerMatch.length > 0 && (
          <div className="space-y-3">
            {filteredNoServerMatch.map((entry) => (
              <FolderCard
                key={entry.folder_id}
                entry={entry}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
                detailEntry={folderDetails.get(entry.folder_id) ?? null}
                detailLoading={loadingDetailId === entry.folder_id}
                onChapterUpdate={onChapterUpdate}
                onFolderUpdate={onFolderUpdate}
                onRequestDetail={onRequestDetail}
                updatingFolderIds={updatingFolderIds}
                chapterUpdateVersions={chapterUpdateVersions}
                themeMode={themeMode}
              />
            ))}
          </div>
        )}
        {data && filterSection === 'no_server_match' && filteredNoServerMatch.length === 0 && <EmptySection isDark={isDark} message="No folders without a server match." />}

        {data && filterSection === 'empty_chapters' && filteredEmptyChapters.length > 0 && (
          <div className="space-y-3">
            {filteredEmptyChapters.map((entry) => (
              <FolderCard
                key={entry.folder_id}
                entry={entry}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
                detailEntry={folderDetails.get(entry.folder_id) ?? null}
                detailLoading={loadingDetailId === entry.folder_id}
                onChapterUpdate={onChapterUpdate}
                onFolderUpdate={onFolderUpdate}
                onRequestDetail={onRequestDetail}
                updatingFolderIds={updatingFolderIds}
                chapterUpdateVersions={chapterUpdateVersions}
                themeMode={themeMode}
              />
            ))}
          </div>
        )}
        {data && filterSection === 'empty_chapters' && filteredEmptyChapters.length === 0 && <EmptySection isDark={isDark} message="No folders with empty chapters." />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterChip({ label, count, active, onClick, variant, isDark }: { readonly label: string; readonly count: number; readonly active: boolean; readonly onClick: () => void; readonly variant?: 'green' | 'indigo' | 'amber'; readonly isDark: boolean }) {
  const colors = variant === 'green'
    ? { active: 'rgba(52,211,153,0.15)', activeText: isDark ? '#34d399' : '#059669', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }
    : variant === 'indigo'
    ? { active: 'rgba(255,91,0,0.15)', activeText: isDark ? '#ff7c33' : '#ff5b00', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }
    : variant === 'amber'
    ? { active: 'rgba(251,191,36,0.15)', activeText: isDark ? '#fbbf24' : '#d97706', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }
    : { active: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.06)', activeText: isDark ? 'rgba(255,255,255,0.85)' : '#37352f', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' };

  return (
    <button onClick={onClick} className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors" style={{ background: active ? colors.active : 'transparent', color: active ? colors.activeText : colors.inactive }}>
      {label} ({count})
    </button>
  );
}

function SectionHeader({ label, color, icon }: { readonly label: string; readonly color: string; readonly icon: React.ReactNode }) {
  return <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color }}>{icon}{label}</h3>;
}

function EmptySection({ isDark, message }: { readonly isDark: boolean; readonly message: string }) {
  return (
    <div className="py-8 text-center" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.42)' }}>
      <Icon icon={appIcons.checkCircle} className="mx-auto mb-2 h-8 w-8" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.34)' }} />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function StatusChip({ status, isDark }: { status: TitleFolderStatus; isDark: boolean }) {
  const variants: Record<TitleFolderStatus, { bg: string; text: string; label: string }> = {
    can_update: { bg: isDark ? 'rgba(52,211,153,0.15)' : 'rgba(5,150,105,0.08)', text: isDark ? '#34d399' : '#059669', label: 'CAN UPDATE' },
    all_match: { bg: isDark ? 'rgba(255,91,0,0.15)' : 'rgba(255,91,0,0.06)', text: isDark ? '#ff7c33' : '#ff5b00', label: 'ALL MATCH' },
    no_server_match: { bg: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.06)', text: isDark ? '#fbbf24' : '#d97706', label: 'NO MATCH' },
    empty_chapters: { bg: isDark ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.06)', text: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(55,53,47,0.7)', label: 'EMPTY CHAPTERS' },
  };
  const variant = variants[status];
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: variant.bg, color: variant.text }}
    >
      {variant.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FolderCard: expandable card with on-demand chapter details
// ---------------------------------------------------------------------------

interface FolderCardProps {
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
}: FolderCardProps) {
  const isDark = themeMode === 'dark';
  const isExpanded = expandedId === entry.folder_id;
  const isUpdatingFolder = updatingFolderIds.has(entry.folder_id);
  const chapterVersion = chapterUpdateVersions.get(entry.folder_id) ?? 0;
  const canUpdateAll = entry.can_update_count > 0 && !!entry.story_id;

  const renderChapters = isExpanded
    ? (detailEntry?.chapters ?? entry.chapters)
    : entry.chapters;
  const renderLoading = isExpanded && detailLoading && !detailEntry;

  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const mutedText = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(55,53,47,0.5)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const isAllMatch = entry.folder_status === 'all_match';
  const isNoMatch = entry.folder_status === 'no_server_match';
  const isEmptyChapters = entry.folder_status === 'empty_chapters';
  const borderColor = isNoMatch
    ? isDark ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.25)'
    : isAllMatch
    ? isDark ? 'rgba(255,91,0,0.2)' : 'rgba(255,91,0,0.15)'
    : isEmptyChapters
    ? isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.25)'
    : panelBorder;

  return (
    <div
      className="rounded-xl border p-4 transition-all"
      style={{ background: mutedSurface, borderColor }}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 select-text">
          <div className="mb-1 flex items-center gap-2">
            <StatusChip status={entry.folder_status} isDark={isDark} />
            <h4 className="truncate text-sm font-medium" style={{ color: pageText }}>
              {entry.story_title || entry.folder_name}
            </h4>
          </div>
          <p className="mb-1 font-mono text-xs" style={{ color: secondaryText }}>{entry.folder_name}</p>
          {entry.story_id && (
            <p className="mb-1 font-mono text-xs" style={{ color: mutedText }}>ID: {entry.story_id}</p>
          )}
          <p className="text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }}>
            {entry.matched_count} matched · {entry.can_update_count} can update
            {entry.missing_drive_count > 0 && ` · ${entry.missing_drive_count} missing drive`}
            {entry.drive_only_count > 0 && ` · ${entry.drive_only_count} drive only`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {canUpdateAll ? (
            <button
              type="button"
              onClick={() => onFolderUpdate(entry)}
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
              style={{ background: '#ff5b00', borderColor: '#ff5b00', color: '#ffffff' }}
            >
              <Icon icon={appIcons.uploadFile} className="h-4 w-4" />
              Update All ({entry.can_update_count})
            </button>
          ) : isUpdatingFolder ? (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium opacity-65"
              style={{ background: mutedSurface, borderColor, color: secondaryText }}
            >
              <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
              Updating…
            </button>
          ) : entry.folder_status === 'all_match' ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
              style={{ background: isDark ? 'rgba(255,91,0,0.14)' : 'rgba(255,91,0,0.08)', borderColor: isDark ? 'rgba(255,91,0,0.24)' : 'rgba(255,91,0,0.2)', color: isDark ? '#ff7c33' : '#ff5b00' }}
            >
              <Icon icon={appIcons.checkCircle} className="h-3.5 w-3.5" />
              All Match
            </span>
          ) : entry.folder_status === 'no_server_match' ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
              style={{ background: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(251,191,36,0.08)', borderColor: isDark ? 'rgba(251,191,36,0.24)' : 'rgba(251,191,36,0.2)', color: isDark ? '#fbbf24' : '#d97706' }}
            >
              <Icon icon={appIcons.folder} className="h-3.5 w-3.5" />
              No Match
            </span>
          ) : entry.folder_status === 'empty_chapters' ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
              style={{ background: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(148,163,184,0.08)', borderColor: isDark ? 'rgba(148,163,184,0.24)' : 'rgba(148,163,184,0.2)', color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(55,53,47,0.7)' }}
            >
              <Icon icon={appIcons.file} className="h-3.5 w-3.5" />
              Empty Chapters
            </span>
          ) : null}
        </div>
      </div>

      {/* Expand row — small bordered toggle, mirrors the metadata diff-chip pattern */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const next = isExpanded ? null : entry.folder_id;
            setExpandedId(next);
            if (next && entry.chapters.length === 0) {
              onRequestDetail(entry.folder_id);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
          style={{
            background: isExpanded ? (isDark ? 'rgba(255,91,0,0.16)' : 'rgba(255,91,0,0.1)') : mutedSurface,
            borderColor: isExpanded ? (isDark ? 'rgba(255,91,0,0.35)' : 'rgba(255,91,0,0.25)') : panelBorder,
            color: isExpanded ? (isDark ? '#ff9b66' : '#ff5b00') : pageText,
          }}
          aria-expanded={isExpanded}
        >
          <Icon
            icon={appIcons.chevronRight}
            className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
          />
          {isExpanded ? 'Hide chapters' : 'Show chapters'}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-3">
          {renderLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" style={{ color: '#10b981' }} />
              <span className="text-sm" style={{ color: mutedText }}>
                Loading chapter details…
              </span>
            </div>
          ) : renderChapters.length === 0 ? (
            <p className="py-2 text-sm" style={{ color: mutedText }}>
              No chapter data available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b text-xs" style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(55,53,47,0.08)' }}>
                    <th className="pb-1.5 pl-4 pr-3 font-medium" style={{ color: mutedText }}>#</th>
                    <th className="pb-1.5 px-3 font-medium" style={{ color: mutedText }}>File Name</th>
                    <th className="pb-1.5 px-3 font-medium" style={{ color: mutedText }}>Drive Title</th>
                    <th className="pb-1.5 px-3 font-medium" style={{ color: mutedText }}>Server Title</th>
                    <th className="pb-1.5 px-3 font-medium" style={{ color: mutedText }}>Status</th>
                    <th className="pb-1.5 pr-4 pl-3 font-medium" style={{ color: mutedText }}></th>
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
                      isDark={isDark}
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
// ChapterRow: one row in the expanded FolderCard
// ---------------------------------------------------------------------------

const CHAPTER_STATUS_COLORS: Record<string, string> = {
  matched: '#10b981',
  can_update_title: '#f59e0b',
  missing_drive: '#94a3b8',
  drive_only: '#94a3b8',
  error: '#ef4444',
};

function ChapterRow({
  chapter,
  onUpdate,
  isUpdating,
  isDark,
}: {
  readonly chapter: TitleFolderEntry['chapters'][number];
  readonly onUpdate: (chapterNumber: number) => void;
  readonly isUpdating: boolean;
  readonly isDark: boolean;
}) {
  const isUpdatable = chapter.status === 'can_update_title';
  const statusColor = CHAPTER_STATUS_COLORS[chapter.status] ?? '#94a3b8';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const emptyText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.34)';

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pl-4 pr-3 text-center text-sm font-medium" style={{ color: statusColor }}>
        {chapter.chapter_number}
      </td>
      <td className="py-2 px-3 text-sm" style={{ color: secondaryText }}>
        {chapter.file_name ?? '—'}
      </td>
      <td className="py-2 px-3 text-sm" style={{ color: pageText }}>
        {chapter.drive_title || <span style={{ color: emptyText }}>—</span>}
      </td>
      <td className="py-2 px-3 text-sm" style={{ color: secondaryText }}>
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
              borderColor: '#ff5b00',
              background: 'rgba(255,91,0,0.12)',
              color: isDark ? '#ff9b66' : '#ff5b00',
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
