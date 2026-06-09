import { useState } from 'react';
import { type CheckUpdatedResponse, type CoverUpdateEntry } from '../api/client';
import type { ThemeMode } from '../types/theme';
import { Icon, appIcons } from './Icon';
import { EmptyState } from './SyncTabShared';

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
}: CheckUpdatedCoverTabProps) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState<'all' | 'updated' | 'no_cover'>('all');
  const [bulkUploading, setBulkUploading] = useState(false);

  const q = search.toLowerCase().trim();

  const filter = (entries: CoverUpdateEntry[]) =>
    entries.filter(e =>
      !q ||
      e.story_title.toLowerCase().includes(q) ||
      e.folder_name.toLowerCase().includes(q)
    );

  const allEntries = data?.entries ?? [];
  const filteredEntries = filter(allEntries);

  const filteredUpdated = filteredEntries.filter(e => e.status === 'updated');
  const filteredNoCover = filteredEntries.filter(e => e.status === 'no_cover1_file');

  const updatedCount = filteredUpdated.length;
  const noCoverCount = filteredNoCover.length;
  const availableUpdateEntries = filteredUpdated.filter(
    entry => entry.story_id && !uploadingIds.has(entry.folder_id)
  );

  const handleUpdateAll = async () => {
    if (bulkUploading || availableUpdateEntries.length === 0) return;
    setBulkUploading(true);
    try {
      await Promise.allSettled(
        availableUpdateEntries.map(entry => onUploadCover(entry.folder_id, entry.story_id!))
      );
    } finally {
      setBulkUploading(false);
    }
  };

  const inputBase = isDark
    ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-indigo-500 focus:ring-0'
    : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-indigo-500 focus:ring-0';

  return (
    <div className="flex flex-col min-h-[400px] h-full">
      <div className="lg-glass flex flex-col sm:flex-row gap-3 p-4 sticky top-0 z-10" style={{ borderRadius: 0 }}>
        <div className="relative flex-1 min-w-0">
          <Icon icon={appIcons.search} className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-white/50' : 'text-black/30'}`} />
          <input
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition-colors ${inputBase}`}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${isDark ? 'text-white/50 hover:text-white/80' : 'text-black/30 hover:text-black/60'}`}
            >
              <Icon icon={appIcons.close} className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleUpdateAll}
            disabled={bulkUploading || loading || availableUpdateEntries.length === 0}
            className={bulkUploading || loading || availableUpdateEntries.length === 0 ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}
          >
            {bulkUploading ? (
              <Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />
            ) : (
              <Icon icon={appIcons.uploadFile} className="w-4 h-4" />
            )}
            Update All ({availableUpdateEntries.length})
          </button>
          <button
            onClick={onCheck}
            disabled={loading}
            className={loading ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}
          >
            {loading ? (
              <>
                <Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Icon icon={appIcons.refresh} className="w-4 h-4" />
                Check Updated Cover
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 flex items-center gap-3 p-3 lg-glass" style={{ border: isDark ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(239,68,68,0.3)', background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)' }}>
          <Icon icon={appIcons.error} className="w-5 h-5 flex-shrink-0 text-red-400" />
          {error}
        </div>
      )}

      {data && (
        <div className={`flex items-center gap-1 px-4 py-2 ${isDark ? 'bg-black/20 border-b border-white/6' : 'bg-black/5 border-b border-black/6'}`}>
          <FilterChip label="All" count={filteredEntries.length} active={filterSection === 'all'} onClick={() => setFilterSection('all')} isDark={isDark} />
          <FilterChip label="Updated" count={updatedCount} active={filterSection === 'updated'} onClick={() => setFilterSection('updated')} variant="green" isDark={isDark} />
          <FilterChip label="No Cover1" count={noCoverCount} active={filterSection === 'no_cover'} onClick={() => setFilterSection('no_cover')} variant="red" isDark={isDark} />
        </div>
      )}

      {data && !loading && (
        <div className={`mx-4 mt-3 flex flex-wrap items-center gap-3 px-4 py-2 rounded-xl text-xs ${isDark ? 'bg-black/10' : 'bg-black/5'}`}>
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-white/75' : 'text-black/45'}`}>
            <Icon icon={appIcons.folder} className="w-3.5 h-3.5 text-indigo-400" />
            {allEntries.length} total records
          </div>
          {updatedCount > 0 && (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
              <Icon icon={appIcons.check} className="w-3.5 h-3.5" />
              {updatedCount} updated
            </div>
          )}
          {noCoverCount > 0 && (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              <Icon icon={appIcons.close} className="w-3.5 h-3.5" />
              {noCoverCount} no cover1
            </div>
          )}
        </div>
      )}

      <div className="p-4 flex-1">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Check Updated Cover' to view all cover update history records."
            icon={<Icon icon={appIcons.folder} className={`w-8 h-8 ${isDark ? 'text-white/40' : 'text-black/20'}`} />}
          />
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 w-full h-full">
            <div className="lg-glass w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <Icon icon={appIcons.spinner} className="w-8 h-8 animate-spin text-indigo-400" />
            </div>
            <p className={`text-sm ${isDark ? 'text-white/65' : 'text-black/45'}`}>Loading cover update history...</p>
          </div>
        )}

        {data && filterSection === 'all' && filteredEntries.length > 0 && (
          <div className="space-y-2">
            {filteredEntries.map(entry => (
              <HistoryEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadCover} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'updated' && filteredUpdated.length > 0 && (
          <div className="space-y-2">
            {filteredUpdated.map(entry => (
              <HistoryEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadCover} isDark={isDark} />
            ))}
          </div>
        )}
        {data && filterSection === 'updated' && filteredUpdated.length === 0 && (
          <EmptySection isDark={isDark} message="No updated cover records found." />
        )}

        {data && filterSection === 'no_cover' && filteredNoCover.length > 0 && (
          <div className="space-y-2">
            {filteredNoCover.map(entry => (
              <HistoryEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadCover} isDark={isDark} />
            ))}
          </div>
        )}
        {data && filterSection === 'no_cover' && filteredNoCover.length === 0 && (
          <EmptySection isDark={isDark} message="No no-cover1 records found." />
        )}

        {data && filterSection === 'all' && filteredEntries.length === 0 && (
          <EmptySection isDark={isDark} message="No records found." />
        )}
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick, variant, isDark }: { label: string; count: number; active: boolean; onClick: () => void; variant?: 'green' | 'amber' | 'red'; isDark: boolean }) {
  const colors = variant === 'green'
    ? { active: 'rgba(52,211,153,0.15)', activeText: isDark ? '#34d399' : '#059669', inactive: isDark ? 'text-white/75' : 'text-black/30' }
    : variant === 'amber'
    ? { active: 'rgba(251,191,36,0.15)', activeText: isDark ? '#fbbf24' : '#d97706', inactive: isDark ? 'text-white/75' : 'text-black/30' }
    : variant === 'red'
    ? { active: 'rgba(248,113,113,0.15)', activeText: isDark ? '#f87171' : '#b91c1c', inactive: isDark ? 'text-white/75' : 'text-black/30' }
    : { active: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', activeText: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)', inactive: isDark ? 'text-white/75' : 'text-black/30' };

  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200"
      style={{ background: active ? colors.active : 'transparent', color: active ? colors.activeText : colors.inactive }}
    >
      {label} ({count})
    </button>
  );
}

function EmptySection({ isDark, message }: { isDark: boolean; message: string }) {
  return (
    <div className={`text-center py-8 ${isDark ? 'text-white/75' : 'text-black/35'}`}>
      <Icon icon={appIcons.checkCircle} className={`w-8 h-8 mx-auto mb-2 ${isDark ? 'text-white/40' : 'text-black/15'}`} />
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
}: {
  entry: CoverUpdateEntry;
  result?: { success: boolean; message: string };
  isUploading: boolean;
  onUpload: (folderId: string, storyId: string) => Promise<void>;
  isDark: boolean;
}) {
  const isUpdated = entry.status === 'updated';
  const isNoCover = entry.status === 'no_cover1_file';
  const canUpload = isUpdated && Boolean(entry.story_id) && !isUploading;
  const isSuccess = result?.success;
  const isFailed = result && !result.success;

  const borderColor = isNoCover
    ? (isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.25)')
    : undefined;

  return (
    <div className="lg-glass-card p-4" style={{ border: borderColor ? `1px solid ${borderColor}` : undefined }}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <HistoryStatusChip status={entry.status} isDark={isDark} />
            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-white/85' : 'text-black/85'}`}>
              {entry.story_title || entry.folder_name}
            </h4>
          </div>
          <p className={`text-xs font-mono mb-1 ${isDark ? 'text-white/50' : 'text-black/30'}`}>{entry.folder_name}</p>
          {entry.cover_file_name && (
            <p className={`text-xs ${isDark ? 'text-white/40' : 'text-black/25'}`}>cover: {entry.cover_file_name}</p>
          )}
          {entry.last_updated && (
            <p className={`text-xs mt-1 ${isDark ? 'text-white/40' : 'text-black/25'}`}>
              last updated: {formatLastUpdated(entry.last_updated)}
            </p>
          )}
          {result && (
            <p className={`text-xs mt-1.5 flex items-center gap-1 ${isSuccess ? 'text-emerald-400' : isFailed ? 'text-red-400' : ''}`}>
              {isSuccess && <Icon icon={appIcons.check} className="w-3.5 h-3.5" />}
              {isFailed && <Icon icon={appIcons.close} className="w-3.5 h-3.5" />}
              {result.message}
            </p>
          )}
        </div>

        <div className="flex items-end">
          {canUpload ? (
            <button
              onClick={() => onUpload(entry.folder_id, entry.story_id!)}
              className="lg-btn-primary"
            >
              <Icon icon={appIcons.uploadFile} className="w-4 h-4" />
              Update Cover
            </button>
          ) : isUploading ? (
            <button className="lg-btn-ghost opacity-50 cursor-not-allowed">
              <Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />
              Uploading...
            </button>
          ) : isUpdated ? (
            <span className="lg-chip lg-chip-green">
              <Icon icon={appIcons.check} className="w-3.5 h-3.5" />
              Updated
            </span>
          ) : isNoCover ? (
            <span className="lg-chip lg-chip-red">
              <Icon icon={appIcons.close} className="w-3.5 h-3.5" />
              No Cover1
            </span>
          ) : (
            <span className="lg-chip">
              <Icon icon={appIcons.folder} className="w-3.5 h-3.5" />
              {entry.status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryStatusChip({ status, isDark }: { status: string; isDark: boolean }) {
  const variants: Record<string, { bg: string; text: string; label: string }> = {
    updated: {
      bg: isDark ? 'rgba(52,211,153,0.15)' : 'rgba(5,150,105,0.08)',
      text: isDark ? '#34d399' : '#059669',
      label: 'UPDATED',
    },
    no_cover1_file: {
      bg: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.06)',
      text: isDark ? '#f87171' : '#dc2626',
      label: 'NO COVER1',
    },
    error: {
      bg: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.06)',
      text: isDark ? '#f87171' : '#dc2626',
      label: 'ERROR',
    },
  };

  const v = variants[status] ?? { bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', text: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.5)', label: status };

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md"
      style={{ background: v.bg, color: v.text }}
    >
      {v.label}
    </span>
  );
}
