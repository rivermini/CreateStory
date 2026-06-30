import { useState } from 'react';
import {
  type MetadataCheckAllResponse,
  type MetadataFieldDetail,
  type MetadataUpdateEntry,
  type MetadataFieldDifference,
} from '../../../api';
import { getMetadataDifferenceDetail } from '../../../api/BedReadDriveSync';
import { Icon, appIcons } from '../../Shared/Icon';
import { EmptyState } from '../DriveSync/SyncTabShared';
import type { ThemeMode } from '../../../types/theme';

interface MetadataUpdateTabContentProps {
  data: MetadataCheckAllResponse | null;
  loading: boolean;
  error: string;
  updateResults: Map<string, { success: boolean; message: string }>;
  updatingIds: Set<string>;
  onCheckAll: () => void;
  onUpdateMetadata: (folderId: string, storyId: string, differences: MetadataFieldDifference[]) => Promise<void>;
  themeMode: ThemeMode;
}

export function MetadataUpdateTabContent({
  data,
  loading,
  error,
  updateResults,
  updatingIds,
  onCheckAll,
  onUpdateMetadata,
  themeMode,
}: Readonly<MetadataUpdateTabContentProps>) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState<'all' | 'can_update' | 'all_match' | 'no_match'>('all');
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const query = search.toLowerCase().trim();
  const filter = (entries: MetadataUpdateEntry[]) =>
    entries.filter(
      (entry) =>
        !query ||
        entry.story_title.toLowerCase().includes(query) ||
        entry.folder_name.toLowerCase().includes(query),
    );

  const filteredCanUpdate = filter(data?.can_update ?? []);
  const filteredAllMatch = filter(data?.all_match ?? []);
  const filteredNoMatch = filter(data?.no_server_match ?? []);

  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const searchBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const availableUpdateEntries = filteredCanUpdate.filter(
    (entry) =>
      entry.story_id &&
      !updatingIds.has(entry.folder_id) &&
      !updateResults.get(entry.folder_id)?.success,
  );

  const handleUpdateAll = async () => {
    if (bulkUpdating || availableUpdateEntries.length === 0) return;
    setBulkUpdating(true);
    try {
      const batchSize = 20;
      for (let i = 0; i < availableUpdateEntries.length; i += batchSize) {
        const batch = availableUpdateEntries.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map((entry) => onUpdateMetadata(entry.folder_id, entry.story_id!, entry.differences)),
        );
      }
    } finally {
      setBulkUpdating(false);
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
            onClick={handleUpdateAll}
            disabled={bulkUpdating || loading || availableUpdateEntries.length === 0}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              background: bulkUpdating || loading || availableUpdateEntries.length === 0 ? mutedSurface : '#ff5b00',
              borderColor: bulkUpdating || loading || availableUpdateEntries.length === 0 ? panelBorder : '#ff5b00',
              color: bulkUpdating || loading || availableUpdateEntries.length === 0 ? secondaryText : '#ffffff',
              opacity: bulkUpdating || loading || availableUpdateEntries.length === 0 ? 0.65 : 1,
            }}
          >
            <Icon icon={bulkUpdating ? appIcons.spinner : appIcons.uploadFile} className={`h-4 w-4 ${bulkUpdating ? 'animate-spin' : ''}`} />
            Update All ({availableUpdateEntries.length})
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
                Check Metadata Update
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
          <FilterChip label="All" count={filteredCanUpdate.length + filteredAllMatch.length + filteredNoMatch.length} active={filterSection === 'all'} onClick={() => setFilterSection('all')} isDark={isDark} />
          <FilterChip label="Can Update" count={filteredCanUpdate.length} active={filterSection === 'can_update'} onClick={() => setFilterSection('can_update')} variant="green" isDark={isDark} />
          <FilterChip label="All Match" count={filteredAllMatch.length} active={filterSection === 'all_match'} onClick={() => setFilterSection('all_match')} variant="indigo" isDark={isDark} />
          <FilterChip label="No Match" count={filteredNoMatch.length} active={filterSection === 'no_match'} onClick={() => setFilterSection('no_match')} isDark={isDark} />
        </div>
      )}

      {/* Stats row */}
      {data && !loading && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2 text-xs" style={{ background: mutedSurface, color: secondaryText }}>
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.folder} className="h-3.5 w-3.5" style={{ color: isDark ? '#ff7c33' : '#ff5b00' }} />
            {(data.can_update.length ?? 0) + (data.all_match.length ?? 0) + (data.no_server_match.length ?? 0)} folders
          </div>
          {filteredCanUpdate.length > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#34d399' : '#059669' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              {filteredCanUpdate.length} can update
            </div>
          )}
          {filteredAllMatch.length > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#ff7c33' : '#ff5b00' }}>
              <Icon icon={appIcons.checkCircle} className="h-3.5 w-3.5" />
              {filteredAllMatch.length} all match
            </div>
          )}
          {filteredNoMatch.length > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: isDark ? '#fbbf24' : '#d97706' }}>
              <Icon icon={appIcons.folder} className="h-3.5 w-3.5" />
              {filteredNoMatch.length} no match
            </div>
          )}
        </div>
      )}

      {/* Main scrollable content */}
      <div className="flex-1 p-4">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Check Metadata Update' to scan DONE_/EXTENDED_ folders and compare metadata."
            icon={<Icon icon={appIcons.folder} className="h-8 w-8" style={{ color: tertiaryText }} />}
          />
        )}

        {loading && (
          <div className="flex h-full w-full flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: mutedSurface, border: `1px solid ${panelBorder}` }}>
              <Icon icon={appIcons.spinner} className="h-8 w-8 animate-spin" style={{ color: isDark ? '#ff7c33' : '#ff5b00' }} />
            </div>
            <p className="text-sm" style={{ color: secondaryText }}>
              Scanning folders and comparing metadata...
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
                    <MetadataEntryCard key={entry.folder_id} entry={entry} result={updateResults.get(entry.folder_id)} isUpdating={updatingIds.has(entry.folder_id)} onUpdate={onUpdateMetadata} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
            {filteredAllMatch.length > 0 && (
              <div className="mb-4">
                <SectionHeader label={`All Match (${filteredAllMatch.length})`} color="#ff7c33" icon={<Icon icon={appIcons.checkCircle} className="h-4 w-4" style={{ color: '#ff7c33' }} />} />
                <div className="space-y-3">
                  {filteredAllMatch.map((entry) => (
                    <MetadataEntryCard key={entry.folder_id} entry={entry} result={updateResults.get(entry.folder_id)} isUpdating={updatingIds.has(entry.folder_id)} onUpdate={onUpdateMetadata} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
            {filteredNoMatch.length > 0 && (
              <div>
                <SectionHeader label={`No Server Match (${filteredNoMatch.length})`} color="#fbbf24" icon={<Icon icon={appIcons.folder} className="h-4 w-4" style={{ color: '#fbbf24' }} />} />
                <div className="space-y-3">
                  {filteredNoMatch.map((entry) => (
                    <MetadataEntryCard key={entry.folder_id} entry={entry} result={updateResults.get(entry.folder_id)} isUpdating={updatingIds.has(entry.folder_id)} onUpdate={onUpdateMetadata} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {data && filterSection === 'can_update' && filteredCanUpdate.length > 0 && (
          <div className="space-y-3">
            {filteredCanUpdate.map((entry) => (
              <MetadataEntryCard key={entry.folder_id} entry={entry} result={updateResults.get(entry.folder_id)} isUpdating={updatingIds.has(entry.folder_id)} onUpdate={onUpdateMetadata} isDark={isDark} />
            ))}
          </div>
        )}
        {data && filterSection === 'can_update' && filteredCanUpdate.length === 0 && <EmptySection isDark={isDark} message="No folders can be updated." />}

        {data && filterSection === 'all_match' && filteredAllMatch.length > 0 && (
          <div className="space-y-3">
            {filteredAllMatch.map((entry) => (
              <MetadataEntryCard key={entry.folder_id} entry={entry} result={updateResults.get(entry.folder_id)} isUpdating={updatingIds.has(entry.folder_id)} onUpdate={onUpdateMetadata} isDark={isDark} />
            ))}
          </div>
        )}
        {data && filterSection === 'all_match' && filteredAllMatch.length === 0 && <EmptySection isDark={isDark} message="No folders have all matching metadata." />}

        {data && filterSection === 'no_match' && filteredNoMatch.length > 0 && (
          <div className="space-y-3">
            {filteredNoMatch.map((entry) => (
              <MetadataEntryCard key={entry.folder_id} entry={entry} result={updateResults.get(entry.folder_id)} isUpdating={updatingIds.has(entry.folder_id)} onUpdate={onUpdateMetadata} isDark={isDark} />
            ))}
          </div>
        )}
        {data && filterSection === 'no_match' && filteredNoMatch.length === 0 && <EmptySection isDark={isDark} message="No folders without a server match." />}
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

// ---------------------------------------------------------------------------
// MetadataEntryCard: card component with lazy field-level details
// ---------------------------------------------------------------------------

interface MetadataEntryCardProps {
  entry: MetadataUpdateEntry;
  result?: { success: boolean; message: string };
  isUpdating: boolean;
  onUpdate: (folderId: string, storyId: string, differences: MetadataFieldDifference[]) => Promise<void>;
  isDark: boolean;
}

function MetadataEntryCard({ entry, result, isUpdating, onUpdate, isDark }: MetadataEntryCardProps) {
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const [openField, setOpenField] = useState<MetadataFieldDifference['field'] | null>(null);
  const [fieldDetails, setFieldDetails] = useState<Partial<Record<MetadataFieldDifference['field'], MetadataFieldDetail>>>({});
  const [loadingField, setLoadingField] = useState<MetadataFieldDifference['field'] | null>(null);
  const [detailError, setDetailError] = useState('');

  const isCanUpdate = entry.status === 'can_update';
  const isAllMatch = entry.status === 'all_match';
  const isNoMatch = entry.status === 'no_server_match';
  const hasDifferences = entry.differences.length > 0;
  const canUpdate = isCanUpdate && entry.story_id && !isUpdating && !result?.success && hasDifferences;
  const isSuccess = result?.success;
  const isFailed = result ? !result.success : false;

  const borderColor = isNoMatch
    ? isDark ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.25)'
    : isAllMatch
    ? isDark ? 'rgba(255,91,0,0.2)' : 'rgba(255,91,0,0.15)'
    : panelBorder;

  const loadFieldDetail = async (field: MetadataFieldDifference['field']) => {
    if (!entry.story_id) return;
    if (openField === field) {
      setOpenField(null);
      return;
    }

    setOpenField(field);
    setDetailError('');
    if (fieldDetails[field]) return;

    setLoadingField(field);
    try {
      const detail = await getMetadataDifferenceDetail(entry.folder_id, entry.story_id, field);
      setFieldDetails((previous) => ({ ...previous, [field]: detail }));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Failed to load field detail.');
    } finally {
      setLoadingField(null);
    }
  };

  return (
    <div className="rounded-xl border p-4" style={{ background: mutedSurface, borderColor }}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <StatusChip status={entry.status} isDark={isDark} />
            <h4 className="truncate text-sm font-medium" style={{ color: pageText }}>{entry.story_title || entry.folder_name}</h4>
          </div>
          <p className="mb-1 font-mono text-xs" style={{ color: secondaryText }}>{entry.folder_name}</p>
          {hasDifferences && (
            <p className="text-xs" style={{ color: isDark ? '#fbbf24' : '#d97706' }}>
              {entry.differences.length} field{entry.differences.length !== 1 ? 's' : ''} differ. Open a field to inspect values.
            </p>
          )}
          {!hasDifferences && !isNoMatch && (
            <p className="text-xs" style={{ color: isDark ? '#ff7c33' : '#ff5b00' }}>All metadata matches</p>
          )}
          {result && (
            <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: isSuccess ? (isDark ? '#34d399' : '#059669') : isFailed ? (isDark ? '#f87171' : '#dc2626') : secondaryText }}>
              {isSuccess && <Icon icon={appIcons.check} className="h-3.5 w-3.5" />}
              {isFailed && <Icon icon={appIcons.close} className="h-3.5 w-3.5" />}
              {result.message}
            </p>
          )}
        </div>
        <div>
          {canUpdate ? (
            <button
              onClick={() => onUpdate(entry.folder_id, entry.story_id!, entry.differences)}
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
              style={{ background: '#ff5b00', borderColor: '#ff5b00', color: '#ffffff' }}
            >
              <Icon icon={appIcons.uploadFile} className="h-4 w-4" />
              Update
            </button>
          ) : isUpdating ? (
            <button className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium opacity-65" style={{ background: mutedSurface, borderColor, color: secondaryText }}>
              <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
              Updating...
            </button>
          ) : isSuccess ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(52,211,153,0.14)' : 'rgba(5,150,105,0.08)', borderColor: isDark ? 'rgba(52,211,153,0.24)' : 'rgba(5,150,105,0.2)', color: isDark ? '#34d399' : '#059669' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              Updated
            </span>
          ) : isNoMatch ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(251,191,36,0.08)', borderColor: isDark ? 'rgba(251,191,36,0.24)' : 'rgba(251,191,36,0.2)', color: isDark ? '#fbbf24' : '#d97706' }}>
              <Icon icon={appIcons.folder} className="h-3.5 w-3.5" />
              No Match
            </span>
          ) : isAllMatch ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(255,91,0,0.14)' : 'rgba(255,91,0,0.08)', borderColor: isDark ? 'rgba(255,91,0,0.24)' : 'rgba(255,91,0,0.2)', color: isDark ? '#ff7c33' : '#ff5b00' }}>
              <Icon icon={appIcons.checkCircle} className="h-3.5 w-3.5" />
              All Match
            </span>
          ) : null}
        </div>
      </div>

      {!isNoMatch && hasDifferences && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {entry.differences.map((diff) => (
              <button
                key={diff.field}
                onClick={() => loadFieldDetail(diff.field)}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: openField === diff.field ? (isDark ? 'rgba(251,191,36,0.16)' : 'rgba(251,191,36,0.1)') : mutedSurface,
                  borderColor: openField === diff.field ? (isDark ? 'rgba(251,191,36,0.35)' : 'rgba(217,119,6,0.25)') : panelBorder,
                  color: openField === diff.field ? (isDark ? '#fbbf24' : '#d97706') : pageText,
                }}
              >
                <Icon
                  icon={loadingField === diff.field ? appIcons.spinner : appIcons.eye}
                  className={`h-3.5 w-3.5 ${loadingField === diff.field ? 'animate-spin' : ''}`}
                />
                {fieldLabel(diff.field)}
              </button>
            ))}
          </div>

          {detailError && (
            <p className="text-xs" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
              {detailError}
            </p>
          )}

          {openField && fieldDetails[openField] && (
            <FieldDetailPanel detail={fieldDetails[openField]} isDark={isDark} />
          )}
        </div>
      )}
    </div>
  );
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    category: 'Category',
    free_chapters_count: 'Free Chapters',
    push: 'Push',
    synopsis: 'Synopsis',
    tags: 'Tags',
  };
  return labels[field] ?? field;
}

function formatDetailValue(field: string, value: unknown): string {
  if (value == null) return '-';

  if (field === 'category' && typeof value === 'object') {
    return categoryLabel(value as { main_category?: string | null; sub_category?: string | null; sub_categories?: string[] });
  }

  if (field === 'push' && typeof value === 'object') {
    const push = value as { title?: string | null; content?: string | null };
    const rows = [
      push.title ? `Title: ${push.title}` : null,
      push.content ? `Content: ${push.content}` : null,
    ].filter(Boolean);
    return rows.join('\n') || '-';
  }

  if (Array.isArray(value)) return value.length ? value.join(', ') : '-';
  if (typeof value === 'string') return value.trim() || '-';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function FieldDetailPanel({ detail, isDark }: { readonly detail: MetadataFieldDetail; readonly isDark: boolean }) {
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const labelColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const folderBg = isDark ? 'rgba(59,130,246,0.12)' : 'rgba(37,99,235,0.08)';
  const folderText = isDark ? '#93c5fd' : '#1d4ed8';
  const serverBg = isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.06)';
  const serverText = isDark ? '#fbbf24' : '#d97706';
  const folderValue = formatDetailValue(detail.field, detail.folder_value);
  const serverValue = formatDetailValue(detail.field, detail.server_value);

  return (
    <div className="rounded-md border p-3" style={{ borderColor: panelBorder }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: labelColor }}>
          {fieldLabel(detail.field)}
        </p>
        {detail.file_name && (
          <p className="font-mono text-[11px]" style={{ color: labelColor }}>
            {detail.file_name}
          </p>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <ValueBox label="Folder" value={folderValue} bg={folderBg} color={folderText} />
        <ValueBox label="Server" value={serverValue} bg={serverBg} color={serverText} />
      </div>
    </div>
  );
}

function ValueBox({ label, value, bg, color }: { readonly label: string; readonly value: string; readonly bg: string; readonly color: string }) {
  return (
    <div className="min-w-0 rounded-md px-2.5 py-2" style={{ background: bg }}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
        {label}
      </p>
      <p className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color, wordBreak: 'break-word' }}>
        {value}
      </p>
    </div>
  );
}

function categoryLabel(values: { main_category?: string | null; sub_category?: string | null; sub_categories?: string[] }): string {
  const parts: string[] = [];
  if (values.main_category) parts.push(values.main_category);
  const subs = values.sub_category
    ? [values.sub_category]
    : (values.sub_categories ?? []);
  parts.push(...subs);
  return parts.join(' / ') || '-';
}

function StatusChip({ status, isDark }: { readonly status: string; readonly isDark: boolean }) {
  const variants: Record<string, { bg: string; text: string; label: string }> = {
    can_update: { bg: isDark ? 'rgba(52,211,153,0.15)' : 'rgba(5,150,105,0.08)', text: isDark ? '#34d399' : '#059669', label: 'CAN UPDATE' },
    all_match: { bg: isDark ? 'rgba(255,91,0,0.15)' : 'rgba(255,91,0,0.06)', text: isDark ? '#ff7c33' : '#ff5b00', label: 'ALL MATCH' },
    no_server_match: { bg: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.06)', text: isDark ? '#fbbf24' : '#d97706', label: 'NO MATCH' },
  };
  const variant = variants[status] ?? { bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.06)', text: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(55,53,47,0.55)', label: status };
  return <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ background: variant.bg, color: variant.text }}>{variant.label}</span>;
}
