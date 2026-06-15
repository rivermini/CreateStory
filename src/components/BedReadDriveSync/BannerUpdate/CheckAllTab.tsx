import { useState } from 'react';
import { type CheckAllResponse, type CoverUpdateEntry } from '../../../api';
import { Icon, appIcons } from '../../Shared/Icon';
import { EmptyState } from '../DriveSync/SyncTabShared';
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

interface CheckAllTabProps {
  data: CheckAllResponse | null;
  loading: boolean;
  error: string;
  uploadResults: Map<string, { success: boolean; message: string }>;
  uploadingIds: Set<string>;
  onCheck: () => void;
  onUploadBanner: (folderId: string, storyId: string) => Promise<void>;
  themeMode: ThemeMode;
}

export function CheckAllTab({
  data,
  loading,
  error,
  uploadResults,
  uploadingIds,
  onCheck,
  onUploadBanner,
  themeMode,
}: Readonly<CheckAllTabProps>) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState<'all' | 'can_update' | 'updated' | 'no_banner' | 'no_match'>('all');
  const [bulkUploading, setBulkUploading] = useState(false);

  const query = search.toLowerCase().trim();
  const filter = (entries: CoverUpdateEntry[]) =>
    entries.filter(
      (entry) =>
        !query ||
        entry.story_title.toLowerCase().includes(query) ||
        entry.folder_name.toLowerCase().includes(query),
    );

  const filteredCanUpdate = filter(data?.can_update ?? []);
  const filteredUpdated = filter(data?.updated ?? []);
  const filteredNoBanner = filter(data?.no_banner1_file ?? data?.no_cover1_file ?? []);
  const filteredNoMatch = filter(data?.no_server_match ?? []);

  const canUpdateCount = filteredCanUpdate.length;
  const updatedCount = filteredUpdated.length;
  const noBannerCount = filteredNoBanner.length;
  const noMatchCount = filteredNoMatch.length;
  const availableUpdateEntries = filteredCanUpdate.filter(
    (entry) => entry.story_id && !uploadingIds.has(entry.folder_id) && !uploadResults.get(entry.folder_id)?.success,
  );

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
        availableUpdateEntries.map((entry) => onUploadBanner(entry.folder_id, entry.story_id!)),
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
            onClick={handleUpdateAll}
            disabled={bulkUploading || loading || availableUpdateEntries.length === 0}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              background: bulkUploading || loading || availableUpdateEntries.length === 0 ? mutedSurface : '#4f46e5',
              borderColor: bulkUploading || loading || availableUpdateEntries.length === 0 ? panelBorder : '#4f46e5',
              color: bulkUploading || loading || availableUpdateEntries.length === 0 ? secondaryText : '#ffffff',
              opacity: bulkUploading || loading || availableUpdateEntries.length === 0 ? 0.65 : 1,
            }}
          >
            <Icon icon={bulkUploading ? appIcons.spinner : appIcons.uploadFile} className={`h-4 w-4 ${bulkUploading ? 'animate-spin' : ''}`} />
            Update All ({availableUpdateEntries.length})
          </button>
          <button
            onClick={onCheck}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              background: loading ? mutedSurface : '#4f46e5',
              borderColor: loading ? panelBorder : '#4f46e5',
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
                Check Banner Update
              </>
            )}
          </button>
        </div>
      </div>

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

      {data && (
        <div className="flex items-center gap-1 border-b px-4 py-2" style={{ background: mutedSurface, borderColor: panelBorder }}>
          <FilterChip label="All" count={canUpdateCount + updatedCount + noBannerCount + noMatchCount} active={filterSection === 'all'} onClick={() => setFilterSection('all')} isDark={isDark} />
          <FilterChip label="Can Update" count={canUpdateCount} active={filterSection === 'can_update'} onClick={() => setFilterSection('can_update')} variant="green" isDark={isDark} />
          <FilterChip label="Updated" count={updatedCount} active={filterSection === 'updated'} onClick={() => setFilterSection('updated')} variant="amber" isDark={isDark} />
          <FilterChip label="No Banner1" count={noBannerCount} active={filterSection === 'no_banner'} onClick={() => setFilterSection('no_banner')} variant="red" isDark={isDark} />
          <FilterChip label="No Match" count={noMatchCount} active={filterSection === 'no_match'} onClick={() => setFilterSection('no_match')} isDark={isDark} />
        </div>
      )}

      {data && !loading && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2 text-xs" style={{ background: mutedSurface, color: secondaryText }}>
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.folder} className="h-3.5 w-3.5" style={{ color: isDark ? '#818cf8' : '#4f46e5' }} />
            {(data.can_update.length ?? 0) + (data.updated.length ?? 0) + ((data.no_banner1_file ?? data.no_cover1_file ?? []).length) + (data.no_server_match.length ?? 0)} DONE_/EXTENDED_ folders
          </div>
          {canUpdateCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#34d399' : '#059669' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              {canUpdateCount} can update
            </div>
          )}
          {updatedCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: '#f59e0b' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              {updatedCount} updated
            </div>
          )}
          {noBannerCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
              <Icon icon={appIcons.close} className="h-3.5 w-3.5" />
              {noBannerCount} no banner1
            </div>
          )}
          {noMatchCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#818cf8' : '#4f46e5' }}>
              <Icon icon={appIcons.folder} className="h-3.5 w-3.5" />
              {noMatchCount} no server match
            </div>
          )}
        </div>
      )}

      <div className="flex-1 p-4">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Check Banner Update' to scan DONE_/EXTENDED_ folders and check banner status."
            icon={<Icon icon={appIcons.folder} className="h-8 w-8" style={{ color: tertiaryText }} />}
          />
        )}

        {loading && (
          <div className="flex h-full w-full flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: mutedSurface, border: `1px solid ${panelBorder}` }}>
              <Icon icon={appIcons.spinner} className="h-8 w-8 animate-spin" style={{ color: isDark ? '#818cf8' : '#4f46e5' }} />
            </div>
            <p className="text-sm" style={{ color: secondaryText }}>
              Scanning DONE_/EXTENDED_ folders for banner images...
            </p>
          </div>
        )}

        {data && filterSection === 'all' && (
          <>
            {filteredCanUpdate.length > 0 && (
              <div className="mb-4">
                <SectionHeader label={`Can Update (${filteredCanUpdate.length})`} color="#34d399" icon={<Icon icon={appIcons.check} className="h-4 w-4" style={{ color: isDark ? '#34d399' : '#059669' }} />} />
                <div className="space-y-2">
                  {filteredCanUpdate.map((entry) => (
                    <BannerEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadBanner} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
            {filteredUpdated.length > 0 && (
              <div className="mb-4">
                <SectionHeader label={`Updated (${filteredUpdated.length})`} color="#f59e0b" icon={<Icon icon={appIcons.check} className="h-4 w-4" style={{ color: '#f59e0b' }} />} />
                <div className="space-y-2">
                  {filteredUpdated.map((entry) => (
                    <BannerEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadBanner} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
            {filteredNoBanner.length > 0 && (
              <div className="mb-4">
                <SectionHeader label={`No Banner1 File (${filteredNoBanner.length})`} color="#f87171" icon={<Icon icon={appIcons.close} className="h-4 w-4" style={{ color: '#f87171' }} />} />
                <div className="space-y-2">
                  {filteredNoBanner.map((entry) => (
                    <BannerEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadBanner} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
            {filteredNoMatch.length > 0 && (
              <div>
                <SectionHeader label={`No Server Match (${filteredNoMatch.length})`} color="#818cf8" icon={<Icon icon={appIcons.folder} className="h-4 w-4" style={{ color: isDark ? '#818cf8' : '#4f46e5' }} />} />
                <div className="space-y-2">
                  {filteredNoMatch.map((entry) => (
                    <BannerEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadBanner} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {data && filterSection === 'can_update' && filteredCanUpdate.length > 0 && (
          <div className="space-y-2">
            {filteredCanUpdate.map((entry) => (
              <BannerEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadBanner} isDark={isDark} />
            ))}
          </div>
        )}
        {data && filterSection === 'can_update' && filteredCanUpdate.length === 0 && <EmptySection isDark={isDark} message="No folders can be updated." />}

        {data && filterSection === 'updated' && filteredUpdated.length > 0 && (
          <div className="space-y-2">
            {filteredUpdated.map((entry) => (
              <BannerEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadBanner} isDark={isDark} />
            ))}
          </div>
        )}
        {data && filterSection === 'updated' && filteredUpdated.length === 0 && <EmptySection isDark={isDark} message="No updated banner records found." />}

        {data && filterSection === 'no_banner' && filteredNoBanner.length > 0 && (
          <div className="space-y-2">
            {filteredNoBanner.map((entry) => (
              <BannerEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadBanner} isDark={isDark} />
            ))}
          </div>
        )}
        {data && filterSection === 'no_banner' && filteredNoBanner.length === 0 && <EmptySection isDark={isDark} message="No folders missing banner1.jpg." />}

        {data && filterSection === 'no_match' && filteredNoMatch.length > 0 && (
          <div className="space-y-2">
            {filteredNoMatch.map((entry) => (
              <BannerEntryCard key={entry.folder_id} entry={entry} result={uploadResults.get(entry.folder_id)} isUploading={uploadingIds.has(entry.folder_id)} onUpload={onUploadBanner} isDark={isDark} />
            ))}
          </div>
        )}
        {data && filterSection === 'no_match' && filteredNoMatch.length === 0 && <EmptySection isDark={isDark} message="No folders missing a server story match." />}
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick, variant, isDark }: { readonly label: string; readonly count: number; readonly active: boolean; readonly onClick: () => void; readonly variant?: 'green' | 'amber' | 'red'; readonly isDark: boolean }) {
  const colors = variant === 'green'
    ? { active: 'rgba(52,211,153,0.15)', activeText: isDark ? '#34d399' : '#059669', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }
    : variant === 'amber'
    ? { active: 'rgba(251,191,36,0.15)', activeText: isDark ? '#fbbf24' : '#d97706', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }
    : variant === 'red'
    ? { active: 'rgba(248,113,113,0.15)', activeText: isDark ? '#f87171' : '#b91c1c', inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }
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

function BannerEntryCard({
  entry,
  result,
  isUploading,
  onUpload,
  isDark,
}: {
  readonly entry: CoverUpdateEntry;
  readonly result?: { success: boolean; message: string };
  readonly isUploading: boolean;
  readonly onUpload: (folderId: string, storyId: string) => Promise<void>;
  readonly isDark: boolean;
}) {
  const isUpdated = entry.status === 'updated';
  const isNoBanner = entry.status === 'no_banner1_file' || entry.status === 'no_cover1_file';
  const isNoMatch = entry.status === 'no_server_match';
  const isCanUpdate = entry.status === 'can_update';
  const canUpload = isCanUpdate && entry.story_id && !isUploading && !result?.success;
  const isSuccess = result?.success;
  const isFailed = result ? !result.success : false;
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const borderColor = isNoBanner
    ? isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.25)'
    : isUpdated
      ? isDark ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.15)'
      : panelBorder;

  return (
    <div className="rounded-xl border p-4" style={{ background: mutedSurface, borderColor }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <StatusChip status={entry.status} isDark={isDark} />
            <h4 className="truncate text-sm font-medium" style={{ color: pageText }}>{entry.story_title || entry.folder_name}</h4>
          </div>
          <p className="mb-1 font-mono text-xs" style={{ color: secondaryText }}>{entry.folder_name}</p>
          {entry.cover_file_name && <p className="text-xs" style={{ color: tertiaryText }}>banner: {entry.cover_file_name}</p>}
          {entry.last_updated && <p className="mt-1 text-xs" style={{ color: tertiaryText }}>last updated: {formatLastUpdated(entry.last_updated)}</p>}
          {result && (
            <p className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: isSuccess ? (isDark ? '#34d399' : '#059669') : isFailed ? (isDark ? '#f87171' : '#dc2626') : tertiaryText }}>
              {isSuccess && <Icon icon={appIcons.check} className="h-3.5 w-3.5" />}
              {isFailed && <Icon icon={appIcons.close} className="h-3.5 w-3.5" />}
              {result.message}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          {canUpload ? (
            <button onClick={() => onUpload(entry.folder_id, entry.story_id!)} className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors" style={{ background: '#4f46e5', borderColor: '#4f46e5', color: '#ffffff' }}>
              <Icon icon={appIcons.uploadFile} className="h-4 w-4" />
              Update Banner
            </button>
          ) : isUploading ? (
            <button className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium opacity-65" style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}>
              <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
              Uploading...
            </button>
          ) : isSuccess ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(52,211,153,0.14)' : 'rgba(5,150,105,0.08)', borderColor: isDark ? 'rgba(52,211,153,0.24)' : 'rgba(5,150,105,0.2)', color: isDark ? '#34d399' : '#059669' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              Updated
            </span>
          ) : isUpdated ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: 'rgba(251,191,36,0.14)', borderColor: 'rgba(251,191,36,0.24)', color: '#f59e0b' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              Updated
            </span>
          ) : isNoBanner ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(239,68,68,0.14)' : 'rgba(239,68,68,0.08)', borderColor: isDark ? 'rgba(239,68,68,0.24)' : 'rgba(239,68,68,0.2)', color: isDark ? '#f87171' : '#dc2626' }}>
              <Icon icon={appIcons.close} className="h-3.5 w-3.5" />
              No Banner1
            </span>
          ) : isNoMatch ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)', borderColor: isDark ? 'rgba(99,102,241,0.24)' : 'rgba(99,102,241,0.2)', color: isDark ? '#818cf8' : '#4f46e5' }}>
              <Icon icon={appIcons.folder} className="h-3.5 w-3.5" />
              No Match
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status, isDark }: { readonly status: string; readonly isDark: boolean }) {
  const variants: Record<string, { bg: string; text: string; label: string }> = {
    can_update: { bg: isDark ? 'rgba(52,211,153,0.15)' : 'rgba(5,150,105,0.08)', text: isDark ? '#34d399' : '#059669', label: 'CAN UPDATE' },
    updated: { bg: 'rgba(251,191,36,0.15)', text: isDark ? '#fbbf24' : '#d97706', label: 'UPDATED' },
    no_banner1_file: { bg: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.06)', text: isDark ? '#f87171' : '#dc2626', label: 'NO BANNER1' },
    no_cover1_file: { bg: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.06)', text: isDark ? '#f87171' : '#dc2626', label: 'NO BANNER1' },
    no_server_match: { bg: isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.06)', text: isDark ? '#818cf8' : '#4f46e5', label: 'NO MATCH' },
    error: { bg: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.06)', text: isDark ? '#f87171' : '#dc2626', label: 'ERROR' },
  };

  const variant = variants[status] ?? { bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.06)', text: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(55,53,47,0.55)', label: status };

  return <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ background: variant.bg, color: variant.text }}>{variant.label}</span>;
}
