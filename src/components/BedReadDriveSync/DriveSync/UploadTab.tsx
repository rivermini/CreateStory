import { useState } from 'react';
import {
  type CheckUploadableResponse,
  type DriveFolderEntry,
} from '../../../api';
import { Icon, appIcons } from '../../Shared/Icon';
import { StatusBadge, EmptyState } from './SyncTabShared';
import type { ThemeMode } from '../../../types/theme';

interface UploadTabProps {
  readonly data: CheckUploadableResponse | null;
  readonly loading: boolean;
  readonly error: string;
  readonly uploadResults: Map<string, { success: boolean; message: string }>;
  readonly uploadingIds: Set<string>;
  readonly onCheck: () => void;
  readonly onUploadSingle: (folder: DriveFolderEntry) => Promise<string>;
  readonly onRequestUploadAll: () => void;
  readonly themeMode: ThemeMode;
}

export function UploadTab({
  data,
  loading,
  error,
  uploadResults,
  uploadingIds,
  onCheck,
  onUploadSingle,
  onRequestUploadAll,
  themeMode,
}: UploadTabProps) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState<'all' | 'ready' | 'invalid' | 'uploaded'>('all');

  const query = search.toLowerCase().trim();

  const filteredInvalid =
    data?.invalid.filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? [];
  const filteredUploadable =
    data?.uploadable.filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? [];
  const filteredAlready =
    data?.already_on_server.filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? [];

  const validCount = filteredUploadable.length;
  const allDone =
    validCount > 0 && filteredUploadable.every((folder) => uploadResults.get(folder.id)?.success);
  const isUploadingAny = uploadingIds.size > 0;
  const successCount = Array.from(uploadResults.values()).filter((result) => result.success).length;
  const failedCount = Array.from(uploadResults.values()).filter((result) => !result.success).length;
  const invalidLabel = `Invalid (${filteredInvalid.length})`;
  const readyLabel = `Ready to Upload (${validCount})`;
  const alreadyLabel = `Already on Server (${filteredAlready.length})`;

  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const searchBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  return (
    <div className="flex h-full min-h-[400px] flex-col">
      <div
        className="sticky top-0 z-10 flex flex-col gap-3 p-4 sm:flex-row"
        style={{ background: panelBackground, borderBottom: `1px solid ${panelBorder}` }}
      >
        <div className="relative min-w-0 flex-1">
          <Icon
            icon={appIcons.search}
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: tertiaryText }}
          />
          <input
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-xl border py-2.5 pl-9 pr-4 text-sm outline-none transition"
            style={{
              background: searchBg,
              borderColor: panelBorder,
              color: pageText,
              boxShadow: 'none',
            }}
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
            onClick={onCheck}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              background: loading ? mutedSurface : '#d97706',
              borderColor: loading ? panelBorder : '#d97706',
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
                Scan Drive
              </>
            )}
          </button>

          {data && validCount > 0 && (
            <button
              onClick={onRequestUploadAll}
              disabled={isUploadingAny || allDone}
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
              style={{
                background: allDone ? mutedSurface : '#d97706',
                borderColor: allDone ? panelBorder : '#d97706',
                color: allDone ? secondaryText : '#ffffff',
                opacity: isUploadingAny ? 0.65 : 1,
              }}
            >
              {isUploadingAny ? (
                <>
                  <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
                  Uploading ({isUploadingAny})
                </>
              ) : allDone ? (
                <>
                  <Icon icon={appIcons.check} className="h-4 w-4" />
                  All Uploaded
                </>
              ) : (
                <>
                  <Icon icon={appIcons.uploadFile} className="h-4 w-4" />
                  Upload All ({validCount})
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="mx-4 mt-3 flex items-center gap-3 rounded-xl border p-3"
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
        <div
          className="flex items-center gap-1 border-b px-4 py-2"
          style={{
            background: mutedSurface,
            borderColor: panelBorder,
          }}
        >
          <FilterChip
            label="All"
            count={filteredUploadable.length + filteredInvalid.length + filteredAlready.length}
            active={filterSection === 'all'}
            onClick={() => setFilterSection('all')}
            isDark={isDark}
            panelBorder={panelBorder}
          />
          <FilterChip
            label="Ready"
            count={validCount}
            active={filterSection === 'ready'}
            onClick={() => setFilterSection('ready')}
            variant="green"
            isDark={isDark}
            panelBorder={panelBorder}
          />
          <FilterChip
            label="Invalid"
            count={filteredInvalid.length}
            active={filterSection === 'invalid'}
            onClick={() => setFilterSection('invalid')}
            variant="red"
            isDark={isDark}
            panelBorder={panelBorder}
          />
          <FilterChip
            label="Already on Server"
            count={filteredAlready.length}
            active={filterSection === 'uploaded'}
            onClick={() => setFilterSection('uploaded')}
            isDark={isDark}
            panelBorder={panelBorder}
          />
        </div>
      )}

      {data && !loading && (
        <div
          className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2 text-xs"
          style={{ background: mutedSurface, color: secondaryText }}
        >
          {data.drive_folders.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" style={{ color: isDark ? '#34d399' : '#059669' }} />
              {data.drive_folders.length} DONE_
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.add} className="h-3.5 w-3.5" style={{ color: '#d97706' }} />
            {validCount} ready to upload
          </div>
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.trends} className="h-3.5 w-3.5" style={{ color: '#f59e0b' }} />
            {filteredAlready.length} already on server
          </div>
          {filteredInvalid.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Icon icon={appIcons.close} className="h-3.5 w-3.5" style={{ color: '#f87171' }} />
              {filteredInvalid.length} invalid
            </div>
          )}
          {successCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5" style={{ color: isDark ? '#34d399' : '#059669' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              {successCount} successful
            </div>
          )}
          {failedCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
              <Icon icon={appIcons.close} className="h-3.5 w-3.5" />
              {failedCount} failed
            </div>
          )}
        </div>
      )}

      <div className="flex-1 p-4">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Scan Drive' to check for stories ready to upload to your Google Drive."
            icon={
              <Icon
                icon={appIcons.shield}
                className="h-8 w-8"
                style={{ color: tertiaryText }}
              />
            }
          />
        )}

        {loading && (
          <div className="flex h-full w-full flex-col items-center justify-center py-16">
            <div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: mutedSurface, border: `1px solid ${panelBorder}` }}
            >
              <Icon icon={appIcons.spinner} className="h-8 w-8 animate-spin" style={{ color: '#d97706' }} />
            </div>
            <p className="text-sm" style={{ color: secondaryText }}>
              Scanning your Drive folders...
            </p>
          </div>
        )}

        {data && filterSection === 'all' && (
          <>
            {filteredInvalid.length > 0 && (
              <div className="mb-4">
                <SectionHeader
                  label={invalidLabel}
                  color="#f87171"
                  icon={<Icon icon={appIcons.error} className="h-4 w-4" style={{ color: '#f87171' }} />}
                  panelBorder={panelBorder}
                  secondaryText={secondaryText}
                />
                <div className="space-y-2">
                  {filteredInvalid.map((folder) => (
                    <InvalidUploadCard key={folder.id} folder={folder} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {validCount > 0 && (
              <div className="mb-4">
                <SectionHeader
                  label={readyLabel}
                  color={isDark ? '#34d399' : '#059669'}
                  icon={<Icon icon={appIcons.cloud} className="h-4 w-4" style={{ color: isDark ? '#34d399' : '#059669' }} />}
                  panelBorder={panelBorder}
                  secondaryText={secondaryText}
                />
                <div className="space-y-2">
                  {filteredUploadable.map((folder) => {
                    const result = uploadResults.get(folder.id);
                    const isUploading = uploadingIds.has(folder.id);
                    const isSuccess = result?.success;
                    const isFailed = result && !result.success;
                    return (
                      <UploadCard
                        key={folder.id}
                        folder={folder}
                        result={result}
                        isUploading={isUploading}
                        isSuccess={isSuccess}
                        isFailed={!!isFailed}
                        onUpload={() => onUploadSingle(folder)}
                        isDark={isDark}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {filteredAlready.length > 0 && (
              <div>
                <SectionHeader
                  label={alreadyLabel}
                  color={secondaryText}
                  icon={<Icon icon={appIcons.check} className="h-4 w-4" style={{ color: secondaryText }} />}
                  panelBorder={panelBorder}
                  secondaryText={secondaryText}
                />
                <div className="space-y-2">
                  {filteredAlready.map((folder) => (
                    <AlreadyCard key={folder.id} folder={folder} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {data && filterSection === 'ready' && validCount > 0 && (
          <div className="space-y-2">
            {filteredUploadable.map((folder) => {
              const result = uploadResults.get(folder.id);
              const isUploading = uploadingIds.has(folder.id);
              const isSuccess = result?.success;
              return (
                <UploadCard
                  key={folder.id}
                  folder={folder}
                  result={result}
                  isUploading={isUploading}
                  isSuccess={isSuccess}
                  isFailed={false}
                  onUpload={() => onUploadSingle(folder)}
                  isDark={isDark}
                />
              );
            })}
          </div>
        )}

        {data && filterSection === 'invalid' && filteredInvalid.length > 0 && (
          <div className="space-y-2">
            {filteredInvalid.map((folder) => (
              <InvalidUploadCard key={folder.id} folder={folder} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'uploaded' && filteredAlready.length > 0 && (
          <div className="space-y-2">
            {filteredAlready.map((folder) => (
              <AlreadyCard key={folder.id} folder={folder} isDark={isDark} />
            ))}
          </div>
        )}

        {data &&
          ((filterSection === 'ready' && validCount === 0) ||
            (filterSection === 'invalid' && filteredInvalid.length === 0) ||
            (filterSection === 'uploaded' && filteredAlready.length === 0)) && (
            <div className="py-8 text-center" style={{ color: secondaryText }}>
              <Icon icon={appIcons.checkCircle} className="mx-auto mb-2 h-8 w-8" style={{ color: tertiaryText }} />
              <p className="text-sm">No items in this section</p>
            </div>
          )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  variant,
  isDark,
  panelBorder: _panelBorder,
}: {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly variant?: 'green' | 'amber' | 'red';
  readonly isDark: boolean;
  readonly panelBorder: string;
}) {
  const colors =
    variant === 'green'
      ? {
          active: 'rgba(52,211,153,0.15)',
          activeText: isDark ? '#34d399' : '#059669',
          inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)',
        }
      : variant === 'red'
        ? {
            active: 'rgba(248,113,113,0.15)',
            activeText: isDark ? '#f87171' : '#b91c1c',
            inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)',
          }
        : {
            active: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.06)',
            activeText: isDark ? 'rgba(255,255,255,0.85)' : '#37352f',
            inactive: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)',
          };

  return (
    <button
      onClick={onClick}
      className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
      style={{
        background: active ? colors.active : 'transparent',
        color: active ? colors.activeText : colors.inactive,
      }}
    >
      {label} ({count})
    </button>
  );
}

function SectionHeader({
  label,
  color,
  icon,
  panelBorder,
  secondaryText: _secondaryText,
}: {
  readonly label: string;
  readonly color: string;
  readonly icon: React.ReactNode;
  readonly panelBorder: string;
  readonly secondaryText: string;
}) {
  return (
    <div
      className="mb-2 flex items-center gap-2 border-b pb-2 text-sm font-medium"
      style={{ borderColor: panelBorder, color }}
    >
      {icon}
      {label}
    </div>
  );
}

function UploadCard({
  folder,
  result,
  isUploading,
  isSuccess,
  isFailed,
  onUpload,
  isDark,
}: {
  readonly folder: DriveFolderEntry;
  readonly result?: { success: boolean; message: string };
  readonly isUploading: boolean;
  readonly isSuccess?: boolean;
  readonly isFailed: boolean;
  readonly onUpload: () => void;
  readonly isDark: boolean;
}) {
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const hasPreUploadError = folder.validation_errors.length > 0 && !isSuccess;
  const displayErrors = hasPreUploadError ? folder.validation_errors : (result && !result.success ? [result.message] : []);

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{
        background: mutedSurface,
        borderColor: hasPreUploadError ? '#f87171' : panelBorder,
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="mt-1 truncate text-sm font-medium" style={{ color: pageText }}>
          {folder.display_name}
        </p>
        <p className="mt-1 truncate text-xs font-mono" style={{ color: secondaryText }}>
          {folder.name}
        </p>
        {!hasPreUploadError && (
          <p className="mt-1 text-xs" style={{ color: secondaryText }}>
            Chapters: <span className="font-semibold" style={{ color: pageText }}>{folder.extended_chapter_count ?? 0}</span>
          </p>
        )}
        {displayErrors.map((err, i) => (
          <p key={i} className="mt-1 truncate text-xs" style={{ color: '#f87171' }}>
            {err}
          </p>
        ))}
        {result && result.success && (
          <p className="mt-1 truncate text-xs" style={{ color: isDark ? '#34d399' : '#059669' }}>
            {result.message}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isUploading && <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" style={{ color: '#d97706' }} />}
        {isSuccess && (
          <div className="flex items-center gap-1 text-xs" style={{ color: isDark ? '#34d399' : '#059669' }}>
            <Icon icon={appIcons.check} className="h-4 w-4" />
            <span>Done</span>
          </div>
        )}
        {isFailed && !hasPreUploadError && (
          <div className="flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
            <Icon icon={appIcons.close} className="h-4 w-4" />
            <span>Failed</span>
          </div>
        )}
        {!isUploading && !isSuccess && !hasPreUploadError && (
          <button
            onClick={onUpload}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: '#d97706',
              borderColor: '#d97706',
              color: '#ffffff',
            }}
          >
            <Icon icon={appIcons.uploadFile} className="h-3.5 w-3.5" />
            Upload
          </button>
        )}
      </div>
    </div>
  );
}

function InvalidUploadCard({
  folder,
  isDark,
}: {
  readonly folder: DriveFolderEntry;
  readonly isDark: boolean;
}) {
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{ background: mutedSurface, borderColor: panelBorder }}
    >
      <Icon icon={appIcons.error} className="h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
      <div className="min-w-0 flex-1">
        <p className="mt-1 truncate text-sm font-medium" style={{ color: pageText }}>
          {folder.display_name}
        </p>
        <p className="mt-1 truncate text-xs font-mono" style={{ color: secondaryText }}>
          {folder.name}
        </p>
        {folder.validation_errors.map((err, i) => (
          <p key={i} className={`mt-${i === 0 ? '1' : '0.5'} truncate text-xs`} style={{ color: '#f87171' }}>
            {err}
          </p>
        ))}
      </div>
      <StatusBadge prefix="ERROR" isDark={isDark} />
    </div>
  );
}

function AlreadyCard({
  folder,
  isDark,
}: {
  readonly folder: DriveFolderEntry;
  readonly isDark: boolean;
}) {
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{ background: mutedSurface, borderColor: panelBorder }}
    >
      <Icon icon={appIcons.check} className="h-4 w-4 shrink-0" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }} />
      <div className="min-w-0 flex-1">
        <p className="mt-1 truncate text-sm font-medium" style={{ color: pageText }}>
          {folder.display_name}
        </p>
        <p className="mt-1 truncate text-xs font-mono" style={{ color: secondaryText }}>
          {folder.name}
        </p>
      </div>
      <StatusBadge prefix="DONE" isDark={isDark} />
    </div>
  );
}
