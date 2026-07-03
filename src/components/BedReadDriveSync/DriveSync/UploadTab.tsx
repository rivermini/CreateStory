import { useState } from 'react';
import {
  type CheckUploadableResponse,
  type DriveFolderEntry,
} from '../../../api';
import { Icon, appIcons } from '../../Shared/Icon';
import { StatusBadge, EmptyState, LoadingAppIcon } from './SyncTabShared';
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
  const [filterSection, setFilterSection] = useState<'all' | 'ready' | 'invalid' | 'uploaded' | 'notReady'>('all');

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
  const filteredNotReady =
    (data?.not_ready ?? []).filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? [];
  const filteredTotal = filteredUploadable.length + filteredInvalid.length + filteredAlready.length + filteredNotReady.length;
  const hasSearch = search.trim().length > 0;

  const validCount = filteredUploadable.length;
  const allDone =
    validCount > 0 && filteredUploadable.every((folder) => uploadResults.get(folder.id)?.success);
  const uploadingCount = uploadingIds.size;
  const isUploadingAny = uploadingCount > 0;
  const successCount = Array.from(uploadResults.values()).filter((result) => result.success).length;
  const failedCount = Array.from(uploadResults.values()).filter((result) => !result.success).length;
  const invalidLabel = `Invalid (${filteredInvalid.length})`;
  const readyLabel = `Ready to Upload (${validCount})`;
  const alreadyLabel = `Already on Server (${filteredAlready.length})`;
  const notReadyLabel = `Not DONE_ (${filteredNotReady.length})`;

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
                <LoadingAppIcon isDark={isDark} color="currentColor" />
                Scanning...
              </>
            ) : (
              <>
                <Icon icon={appIcons.search} className="h-4 w-4" />
                Check Upload
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
                  <LoadingAppIcon isDark={isDark} color="currentColor" />
                  Uploading ({uploadingCount})
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
            count={filteredTotal}
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
            label="Not DONE_"
            count={filteredNotReady.length}
            active={filterSection === 'notReady'}
            onClick={() => setFilterSection('notReady')}
            variant="amber"
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
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.check} className="h-3.5 w-3.5" style={{ color: isDark ? '#34d399' : '#059669' }} />
            {data.drive_folders.length} DONE_ folders scanned
          </div>
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
          {filteredNotReady.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Icon icon={appIcons.info} className="h-3.5 w-3.5" style={{ color: '#f59e0b' }} />
              {filteredNotReady.length} not DONE_
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
            message="Click 'Check Upload' to scan DONE_ folders that are ready to upload."
            icon={
              <Icon
                icon={appIcons.shield}
                className="h-8 w-8"
                style={{ color: tertiaryText }}
              />
            }
          />
        )}

        {data && !loading && data.drive_folders.length === 0 && (
          <div
            className="mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-xs"
            style={{
              background: isDark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.05)',
              borderColor: isDark ? 'rgba(245,158,11,0.22)' : 'rgba(245,158,11,0.18)',
              color: secondaryText,
            }}
          >
            <Icon icon={appIcons.info} className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#d97706' }} />
            <p className="leading-5">
              Check Upload only scans Drive folders whose name starts with <span className="font-mono">DONE_</span>.
              Rename completed story folders to <span className="font-mono">DONE_status_source - Story Title</span>, using
              <span className="font-mono"> _nw</span>, <span className="font-mono">_gd</span>,
              <span className="font-mono"> _wp</span>, or <span className="font-mono">_ink</span> before uploading.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex h-full w-full flex-col items-center justify-center py-16">
            <LoadingAppIcon
              isDark={isDark}
              color="#d97706"
              size="lg"
            />
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

            {filteredNotReady.length > 0 && (
              <div className="mb-4">
                <SectionHeader
                  label={notReadyLabel}
                  color="#f59e0b"
                  icon={<Icon icon={appIcons.info} className="h-4 w-4" style={{ color: '#f59e0b' }} />}
                  panelBorder={panelBorder}
                  secondaryText={secondaryText}
                />
                <div className="space-y-2">
                  {filteredNotReady.map((folder) => (
                    <NotReadyUploadCard key={folder.id} folder={folder} isDark={isDark} />
                  ))}
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

        {data && filterSection === 'all' && filteredTotal === 0 && (
          <EmptyState
            isDark={isDark}
            message={
              hasSearch
                ? `No DONE_ upload folder matches "${search.trim()}". Check Upload only scans DONE_ folders; rename ING_ or INCOMPLETE_ folders to DONE_ when they are ready.`
                : 'No DONE_ upload folders found.'
            }
            icon={
              <Icon
                icon={appIcons.search}
                className="h-8 w-8"
                style={{ color: tertiaryText }}
              />
            }
          />
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

        {data && filterSection === 'notReady' && filteredNotReady.length > 0 && (
          <div className="space-y-2">
            {filteredNotReady.map((folder) => (
              <NotReadyUploadCard key={folder.id} folder={folder} isDark={isDark} />
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
            (filterSection === 'notReady' && filteredNotReady.length === 0) ||
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
        {isUploading && <LoadingAppIcon isDark={isDark} color="#d97706" />}
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
  const validationMessages = getUploadValidationMessages(folder);

  return (
    <div
      className="flex items-start gap-3 rounded-xl border px-4 py-3"
      style={{ background: mutedSurface, borderColor: panelBorder }}
    >
      <Icon icon={appIcons.error} className="mt-1 h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
      <div className="min-w-0 flex-1">
        <p className="mt-1 truncate text-sm font-medium" style={{ color: pageText }}>
          {folder.display_name}
        </p>
        <p className="mt-1 truncate text-xs font-mono" style={{ color: secondaryText }}>
          {folder.name}
        </p>
        {validationMessages.map((message, i) => (
          <p key={i} className={`${i === 0 ? 'mt-1' : 'mt-0.5'} text-xs leading-5`} style={{ color: '#f87171' }}>
            {message}
          </p>
        ))}
      </div>
      <StatusBadge prefix="ERROR" isDark={isDark} />
    </div>
  );
}

function getUploadValidationMessages(folder: DriveFolderEntry): string[] {
  if (!folder.validation_errors.length) {
    return [
      'Invalid DONE_ upload folder. Expected format: DONE_status_source - Story Title, with source _nw, _gd, _wp, or _ink.',
    ];
  }

  return folder.validation_errors.map(formatUploadValidationMessage);
}

function formatUploadValidationMessage(message: string): string {
  const unrecognizedSource = message.match(/UNRECOGNIZED SOURCE:\s*'([^']+)'/i);
  if (unrecognizedSource) {
    return `Unrecognized source token '${unrecognizedSource[1]}'. Upload folders must be named DONE_status_source - Story Title, using _nw, _gd, _wp, or _ink.`;
  }

  if (/MISSING SOURCE/i.test(message)) {
    return 'Missing source token. Upload folders must be named DONE_status_source - Story Title, using _nw, _gd, _wp, or _ink.';
  }

  return message;
}

function NotReadyUploadCard({
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
  const prefix = folder.prefix || 'UNKNOWN';

  return (
    <div
      className="flex items-start gap-3 rounded-xl border px-4 py-3"
      style={{ background: mutedSurface, borderColor: panelBorder }}
    >
      <Icon icon={appIcons.info} className="mt-1 h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} />
      <div className="min-w-0 flex-1">
        <p className="mt-1 truncate text-sm font-medium" style={{ color: pageText }}>
          {folder.display_name}
        </p>
        <p className="mt-1 truncate text-xs font-mono" style={{ color: secondaryText }}>
          {folder.name}
        </p>
        <p className="mt-1 text-xs leading-5" style={{ color: '#b45309' }}>
          Not ready for upload. Check Upload only uploads <span className="font-mono">DONE_</span> folders; rename this
          <span className="font-mono"> {prefix}_</span> folder to <span className="font-mono">DONE_</span> when ready.
        </p>
      </div>
      <StatusBadge prefix={prefix} isDark={isDark} />
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
