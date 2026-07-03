import { useRef, useState } from 'react';
import { type CheckUpdatedResponse, type CoverUpdateEntry } from '../../../api';
import { Icon, appIcons } from '../../Shared/Icon';
import { EmptyState, LoadingAppIcon } from '../DriveSync/SyncTabShared';
import type { ThemeMode } from '../../../types/theme';

function formatLastUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface CheckUpdatedCoverTabProps {
  data: CheckUpdatedResponse | null;
  loading: boolean;
  error: string;
  uploadResults: Map<string, { success: boolean; message: string }>;
  uploadingIds: Set<string>;
  onCheck: () => void;
  onUploadCover: (folderId: string, storyId: string) => Promise<void>;
  themeMode: ThemeMode;
  coverFilename?: string;
}

export function CheckUpdatedCoverTab({
  data,
  loading,
  error,
  uploadResults,
  uploadingIds,
  onCheck,
  onUploadCover,
  themeMode,
  coverFilename = 'cover1',
}: Readonly<CheckUpdatedCoverTabProps>) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState<'all' | 'updated' | 'no_cover' | 'never_updated'>('all');
  const [bulkUploading, setBulkUploading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const query = search.toLowerCase().trim();
  const filter = (entries: CoverUpdateEntry[]) =>
    entries.filter(
      (entry) =>
        !query ||
        entry.story_title.toLowerCase().includes(query) ||
        entry.folder_name.toLowerCase().includes(query),
    );

  const allEntries = data?.entries ?? [];
  const filteredEntries = filter(allEntries);
  const filteredUpdated = filteredEntries.filter((entry) => entry.status === 'updated');
  const filteredNoCover = filteredEntries.filter((entry) => entry.status === 'no_cover1_file');
  const filteredNeverUpdated = filteredEntries.filter((entry) => entry.status === 'never_updated');

  const updatedCount = filteredUpdated.length;
  const noCoverCount = filteredNoCover.length;
  const neverUpdatedCount = filteredNeverUpdated.length;
  const availableUpdateEntries = filteredUpdated.filter((entry) => entry.story_id && !uploadingIds.has(entry.folder_id));

  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const searchBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const handleUpdateAll = async () => {
    if (bulkUploading || availableUpdateEntries.length === 0) return;
    setBulkUploading(true);
    try {
      await Promise.allSettled(
        availableUpdateEntries.map((entry) => onUploadCover(entry.folder_id, entry.story_id!)),
      );
    } finally {
      setBulkUploading(false);
    }
  };

  return (
    <div className="flex h-full min-h-[400px] flex-col">
      <div
        className="sticky top-0 z-10 flex flex-col gap-3 p-4 sm:flex-row"
        style={{ background: isDark ? '#202020' : '#ffffff', borderBottom: `1px solid ${panelBorder}` }}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2.5 transition"
          style={{
            background: searchBg,
            borderColor: panelBorder,
          }}
        >
          <Icon icon={appIcons.search} className="h-4 w-4 shrink-0" style={{ color: tertiaryText }} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClick={() => searchInputRef.current?.focus()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') searchInputRef.current?.focus(); }}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            style={{
              color: pageText,
              caretColor: pageText,
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="-m-1 rounded p-1 transition-colors" style={{ color: secondaryText }}>
              <Icon icon={appIcons.close} className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleUpdateAll}
            disabled={bulkUploading || loading || availableUpdateEntries.length === 0}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              background: bulkUploading || loading || availableUpdateEntries.length === 0 ? mutedSurface : isDark ? '#b45309' : '#d97706',
              borderColor: bulkUploading || loading || availableUpdateEntries.length === 0 ? panelBorder : isDark ? '#b45309' : '#d97706',
              color: bulkUploading || loading || availableUpdateEntries.length === 0 ? secondaryText : '#ffffff',
              opacity: bulkUploading || loading || availableUpdateEntries.length === 0 ? 0.65 : 1,
            }}
          >
            {bulkUploading ? (
              <LoadingAppIcon isDark={isDark} color="currentColor" />
            ) : (
              <Icon icon={appIcons.uploadFile} className="h-4 w-4" />
            )}
            Update All ({availableUpdateEntries.length})
          </button>
          <button
            onClick={onCheck}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              background: loading ? mutedSurface : isDark ? '#b45309' : '#d97706',
              borderColor: loading ? panelBorder : isDark ? '#b45309' : '#d97706',
              color: loading ? secondaryText : '#ffffff',
              opacity: loading ? 0.65 : 1,
            }}
          >
            {loading ? (
              <>
                <LoadingAppIcon isDark={isDark} color="currentColor" />
                Loading...
              </>
            ) : (
              <>
                <Icon icon={appIcons.refresh} className="h-4 w-4" />
                Check Updated Cover
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-xl border p-3" style={{ background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)', borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)', color: isDark ? '#f87171' : '#dc2626' }}>
          <Icon icon={appIcons.error} className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {data && (
        <div className="flex items-center gap-1 border-b px-4 py-2" style={{ background: mutedSurface, borderColor: panelBorder }}>
          <FilterChip label="All" count={filteredEntries.length} active={filterSection === 'all'} onClick={() => setFilterSection('all')} isDark={isDark} />
          <FilterChip label="Updated" count={updatedCount} active={filterSection === 'updated'} onClick={() => setFilterSection('updated')} variant="green" isDark={isDark} />
          <FilterChip label="Never updated" count={neverUpdatedCount} active={filterSection === 'never_updated'} onClick={() => setFilterSection('never_updated')} variant="amber" isDark={isDark} />
          <FilterChip label={`No ${coverFilename}`} count={noCoverCount} active={filterSection === 'no_cover'} onClick={() => setFilterSection('no_cover')} variant="red" isDark={isDark} />
        </div>
      )}

      {data && !loading && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2 text-xs" style={{ background: mutedSurface, color: secondaryText }}>
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.folder} className="h-3.5 w-3.5" style={{ color: isDark ? '#fcd34d' : '#b45309' }} />
            {allEntries.length} total records
          </div>
          {updatedCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#fcd34d' : '#b45309' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              {updatedCount} updated
            </div>
          )}
          {neverUpdatedCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#fcd34d' : '#b45309' }}>
              <Icon icon={appIcons.folder} className="h-3.5 w-3.5" />
              {neverUpdatedCount} never updated
            </div>
          )}
          {noCoverCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
              <Icon icon={appIcons.close} className="h-3.5 w-3.5" />
              {noCoverCount} no {coverFilename}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 p-4">
        {!loading && !data && (
          <EmptyState isDark={isDark} message="Click 'Check Updated Cover' to view all cover update history records." icon={<Icon icon={appIcons.folder} className="h-8 w-8" style={{ color: tertiaryText }} />} />
        )}

        {loading && (
          <div className="flex h-full w-full flex-col items-center justify-center py-16">
            <LoadingAppIcon
              isDark={isDark}
              color={isDark ? '#fcd34d' : '#b45309'}
              size="lg"
            />
            <p className="text-sm" style={{ color: secondaryText }}>
              Loading cover update history...
            </p>
          </div>
        )}

        {data && filterSection === 'all' && filteredEntries.length > 0 && (
          <div className="space-y-2">
            {filteredEntries.map((entry) => (
              <HistoryEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadCover} isDark={isDark} coverFilename={coverFilename} />
            ))}
          </div>
        )}
        {data && filterSection === 'all' && filteredEntries.length === 0 && <EmptySection isDark={isDark} message="No records found." />}

        {data && filterSection === 'updated' && filteredUpdated.length > 0 && (
          <div className="space-y-2">
            {filteredUpdated.map((entry) => (
              <HistoryEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadCover} isDark={isDark} coverFilename={coverFilename} />
            ))}
          </div>
        )}
        {data && filterSection === 'updated' && filteredUpdated.length === 0 && <EmptySection isDark={isDark} message="No updated cover records found." />}

        {data && filterSection === 'never_updated' && filteredNeverUpdated.length > 0 && (
          <div className="space-y-2">
            {filteredNeverUpdated.map((entry) => (
              <HistoryEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadCover} isDark={isDark} coverFilename={coverFilename} />
            ))}
          </div>
        )}
        {data && filterSection === 'never_updated' && filteredNeverUpdated.length === 0 && <EmptySection isDark={isDark} message="No never-updated cover records found." />}

        {data && filterSection === 'no_cover' && filteredNoCover.length > 0 && (
          <div className="space-y-2">
            {filteredNoCover.map((entry) => (
              <HistoryEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadCover} isDark={isDark} coverFilename={coverFilename} />
            ))}
          </div>
        )}
        {data && filterSection === 'no_cover' && filteredNoCover.length === 0 && <EmptySection isDark={isDark} message={`No no-${coverFilename} records found.`} />}
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick, variant, isDark }: Readonly<{ label: string; count: number; active: boolean; onClick: () => void; variant?: 'green' | 'amber' | 'red'; isDark: boolean }>) {
  const colors = variant === 'green'
    ? { active: 'rgba(52,211,153,0.15)', activeText: isDark ? '#34d399' : '#059669', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }
    : variant === 'amber'
    ? { active: 'rgba(251,191,36,0.15)', activeText: isDark ? '#fcd34d' : '#b45309', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }
    : variant === 'red'
    ? { active: 'rgba(248,113,113,0.15)', activeText: isDark ? '#f87171' : '#b91c1c', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }
    : { active: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.06)', activeText: isDark ? 'rgba(255,255,255,0.85)' : '#37352f', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' };

  return <button onClick={onClick} className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors" style={{ background: active ? colors.active : 'transparent', color: active ? colors.activeText : colors.inactive }}>{label} ({count})</button>;
}

function EmptySection({ isDark, message }: Readonly<{ isDark: boolean; message: string }>) {
  return (
    <div className="py-8 text-center" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.42)' }}>
      <Icon icon={appIcons.checkCircle} className="mx-auto mb-2 h-8 w-8" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.34)' }} />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function HistoryEntryCard({
  entry,
  result,
  isUploading,
  onUpload,
  isDark,
  coverFilename = 'cover1',
}: Readonly<{
  entry: CoverUpdateEntry;
  result?: { success: boolean; message: string };
  isUploading: boolean;
  onUpload: (folderId: string, storyId: string) => Promise<void>;
  isDark: boolean;
  coverFilename?: string;
}>) {
  const isUpdated = entry.status === 'updated';
  const isNoCover = entry.status === 'no_cover1_file';
  const isNeverUpdated = entry.status === 'never_updated';
  const canUpload = isUpdated && Boolean(entry.story_id) && !isUploading;
  const isSuccess = result?.success;
  const isFailed = result ? !result.success : false;
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const borderColor = isNoCover ? (isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.25)') : panelBorder;

  return (
    <div className="rounded-xl border p-4" style={{ background: mutedSurface, borderColor }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <HistoryStatusChip status={entry.status} isDark={isDark} coverFilename={coverFilename} />
            <h4 className="truncate text-sm font-medium" style={{ color: pageText }}>{entry.story_title || entry.folder_name}</h4>
          </div>
          <p className="mb-1 font-mono text-xs" style={{ color: secondaryText }}>{entry.folder_name}</p>
          {entry.cover_file_name && <p className="text-xs" style={{ color: tertiaryText }}>cover: {entry.cover_file_name}</p>}
          {entry.last_updated && <p className="mt-1 text-xs" style={{ color: tertiaryText }}>last updated: {formatLastUpdated(entry.last_updated)}</p>}
          {result && (
            <p className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: isSuccess ? (isDark ? '#34d399' : '#059669') : isFailed ? (isDark ? '#f87171' : '#dc2626') : tertiaryText }}>
              {isSuccess && <Icon icon={appIcons.check} className="h-3.5 w-3.5" />}
              {isFailed && <Icon icon={appIcons.close} className="h-3.5 w-3.5" />}
              {result.message}
            </p>
          )}
        </div>

        <div className="flex items-end">
          {canUpload ? (
            <button onClick={() => onUpload(entry.folder_id, entry.story_id!)} className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors" style={{ background: isDark ? '#b45309' : '#d97706', borderColor: isDark ? '#b45309' : '#d97706', color: '#ffffff' }}>
              <Icon icon={appIcons.uploadFile} className="h-4 w-4" />
              Update Cover
            </button>
          ) : isUploading ? (
            <button className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium opacity-65" style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}>
              <LoadingAppIcon isDark={isDark} color="currentColor" />
              Uploading...
            </button>
          ) : isUpdated ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(52,211,153,0.14)' : 'rgba(5,150,105,0.08)', borderColor: isDark ? 'rgba(52,211,153,0.24)' : 'rgba(5,150,105,0.2)', color: isDark ? '#34d399' : '#059669' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              Updated
            </span>
          ) : isNoCover ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(239,68,68,0.14)' : 'rgba(239,68,68,0.08)', borderColor: isDark ? 'rgba(239,68,68,0.24)' : 'rgba(239,68,68,0.2)', color: isDark ? '#f87171' : '#dc2626' }}>
              <Icon icon={appIcons.close} className="h-3.5 w-3.5" />
              No {coverFilename}
            </span>
          ) : isNeverUpdated ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(251,191,36,0.08)', borderColor: isDark ? 'rgba(251,191,36,0.24)' : 'rgba(251,191,36,0.2)', color: isDark ? '#fcd34d' : '#b45309' }}>
              <Icon icon={appIcons.folder} className="h-3.5 w-3.5" />
              Never Updated
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}>
              <Icon icon={appIcons.folder} className="h-3.5 w-3.5" />
              {entry.status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryStatusChip({ status, isDark, coverFilename = 'cover1' }: Readonly<{ status: string; isDark: boolean; coverFilename?: string }>) {
  const noCoverLabel = `NO ${coverFilename.toUpperCase()}`;
  const variants: Record<string, { bg: string; text: string; label: string }> = {
    updated: { bg: isDark ? 'rgba(52,211,153,0.15)' : 'rgba(5,150,105,0.08)', text: isDark ? '#34d399' : '#059669', label: 'UPDATED' },
    no_cover1_file: { bg: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.06)', text: isDark ? '#f87171' : '#dc2626', label: noCoverLabel },
    never_updated: { bg: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.08)', text: isDark ? '#fcd34d' : '#b45309', label: 'NEVER UPDATED' },
    error: { bg: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.06)', text: isDark ? '#f87171' : '#dc2626', label: 'ERROR' },
  };

  const variant = variants[status] ?? { bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.06)', text: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(55,53,47,0.55)', label: status };

  return <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ background: variant.bg, color: variant.text }}>{variant.label}</span>;
}
