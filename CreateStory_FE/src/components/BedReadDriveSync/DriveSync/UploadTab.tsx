import { useState } from 'react';
import {
  type CheckUploadableResponse,
  type DriveSyncUploadProgress,
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
  readonly uploadProgress: DriveSyncUploadProgress | null;
  readonly uploadPollingError: string;
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
  uploadProgress,
  uploadPollingError,
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
    (data?.invalid.filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? []).sort((a, b) => a.display_name.localeCompare(b.display_name));

  const filteredUploadable =
    (data?.uploadable.filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? []).sort((a, b) => a.display_name.localeCompare(b.display_name));

  const filteredAlready =
    (data?.already_on_server.filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? []).sort((a, b) => a.display_name.localeCompare(b.display_name));

  const filteredNotReady =
    ((data?.not_ready ?? []).filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? []).sort((a, b) => a.display_name.localeCompare(b.display_name));
  
  const filteredTotal = filteredUploadable.length + filteredInvalid.length + filteredAlready.length + filteredNotReady.length;

  const validCount = filteredUploadable.length;
  const allDone =
    validCount > 0 && filteredUploadable.every((folder) => uploadResults.get(folder.id)?.success);
  const uploadingCount = uploadingIds.size;
  const isUploadingAny = uploadingCount > 0;
  const successCount = Array.from(uploadResults.values()).filter((result) => result.success).length;
  const failedCount = Array.from(uploadResults.values()).filter((result) => !result.success).length;
  const processedCount = uploadProgress
    ? uploadProgress.completed + uploadProgress.failed
    : 0;
  const progressPercent = uploadProgress && uploadProgress.total > 0
    ? Math.min(100, Math.round((processedCount / uploadProgress.total) * 100))
    : 0;

  function renderTableBlock(
    title: string,
    badgeColor: string,
    bgBadge: string,
    items: DriveFolderEntry[],
    status: 'ready' | 'invalid' | 'notReady' | 'already'
  ) {
    if (items.length === 0) return null;

    return (
      <div className="space-y-3 mb-8">
        <div className="flex items-center gap-2 px-1">
          <span className="font-bold text-sm text-[var(--cs-text)]">{title}</span>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-bold"
            style={{ color: badgeColor, background: bgBadge }}
          >
            {items.length}
          </span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)] mt-2 shadow-sm">
          <table className="min-w-[1050px] w-full table-fixed text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--cs-border)] text-xs font-bold uppercase tracking-wider text-[var(--cs-text-muted)] bg-[var(--cs-surface-muted)]/40">
                <th className="w-12 py-4 pl-4 pr-2 text-center">#</th>
                <th className="w-[15%] px-4 py-4">Story Name</th>
                <th className="w-[25%] px-4 py-4">Drive Folder Name</th>
                <th className="w-24 px-4 py-4">Status</th>
                <th className="w-28 px-4 py-4">Chapters</th>
                <th className="px-4 py-4">Validation Logs / Errors</th>
                <th className="sticky right-0 w-32 border-l border-[var(--cs-border)] bg-[var(--cs-surface-muted)] px-4 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cs-border)]">
              {items.map((folder, index) => {
                const result = uploadResults.get(folder.id);
                const isUploading = uploadingIds.has(folder.id);
                const isSuccess = result?.success;
                const isFailed = result && !result.success;

                const hasPreUploadError = folder.validation_errors.length > 0 && !isSuccess;
                const displayErrors = hasPreUploadError
                  ? folder.validation_errors
                  : (result && !result.success ? [result.message] : []);

                return (
                  <tr
                    key={folder.id}
                    className="hover:bg-[var(--cs-surface-muted)]/50 transition-colors group"
                  >
                    {/* Row index number starting from 1 */}
                    <td className="py-5 pl-4 pr-2 text-center text-xs font-medium text-[var(--cs-text-faint)] whitespace-nowrap">
                      {index + 1}
                    </td>

                    {/* Story Name */}
                    <td className="px-4 py-5 font-semibold text-[13px] text-[var(--cs-text)] group-hover:text-[var(--cs-primary)] transition-colors">
                      <span className="block break-words">{folder.display_name}</span>
                    </td>

                    {/* Drive Folder Name */}
                    <td className="px-4 py-5 text-[11px] font-mono text-[var(--cs-text-faint)]" title={folder.name}>
                      <span className="block truncate">{folder.name}</span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-5 whitespace-nowrap">
                      {isFailed ? <StatusBadge prefix="ERROR" isDark={isDark} /> : null}
                      {!isFailed && isSuccess ? <StatusBadge prefix="DONE" isDark={isDark} /> : null}
                      {!isFailed && !isSuccess && status === 'ready' && <StatusBadge prefix={isUploading ? 'UPLOADING' : 'READY'} isDark={isDark} />}
                      {!isFailed && !isSuccess && status === 'invalid' && <StatusBadge prefix="ERROR" isDark={isDark} />}
                      {!isFailed && !isSuccess && status === 'notReady' && <StatusBadge prefix={folder.prefix || 'ING'} isDark={isDark} />}
                      {!isFailed && !isSuccess && status === 'already' && <StatusBadge prefix="DONE" isDark={isDark} />}
                    </td>

                    {/* Chapters */}
                    <td className="px-4 py-5 whitespace-nowrap">
                      {status !== 'invalid' ? (
                        <span className="text-[10px] font-bold text-[var(--cs-text-soft)] bg-[var(--cs-surface-muted)] px-2.5 py-0.5 rounded-full border border-[var(--cs-border)] uppercase tracking-wider whitespace-nowrap">
                          {folder.extended_chapter_count ?? 0} Chapters
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--cs-text-faint)]">—</span>
                      )}
                    </td>

                    {/* Validation Logs / Errors */}
                    <td className="px-4 py-5 text-xs">
                      {displayErrors.length > 0 ? (
                        <div className="flex items-start gap-1.5 text-[var(--cs-danger)] font-medium leading-relaxed max-w-md">
                          <Icon icon={appIcons.error} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span className="break-words">{displayErrors.map(formatUploadValidationMessage).join(', ')}</span>
                        </div>
                      ) : result?.success ? (
                        <div className="flex items-center gap-1.5 text-[var(--cs-success)] font-medium">
                          <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
                          <span>{result.message}</span>
                        </div>
                      ) : status === 'notReady' ? (
                        <span className="text-[var(--cs-text-faint)]">
                          Skipped: folder prefix {folder.prefix || 'ING'}
                        </span>
                      ) : status === 'already' ? (
                        <span className="text-[var(--cs-text-muted)]">Already indexed on backend database</span>
                      ) : (
                        <span className="text-[var(--cs-text-faint)]">Story structure validated & clean</span>
                      )}
                    </td>

                    {/* Inline Actions */}
                    <td className="sticky right-0 border-l border-[var(--cs-border)] bg-[var(--cs-surface)] px-4 py-5 text-right whitespace-nowrap group-hover:bg-[var(--cs-surface-muted)]">
                      {isUploading && (
                        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--cs-warning)] font-semibold">
                          <LoadingAppIcon isDark={isDark} color="var(--cs-warning)" />
                          <span>Uploading...</span>
                        </div>
                      )}
                      {isSuccess && (
                        <div className="inline-flex items-center gap-1 text-xs text-[var(--cs-success)] font-semibold">
                          <Icon icon={appIcons.check} className="h-4 w-4" />
                          <span>Done</span>
                        </div>
                      )}
                      {status === 'ready' && !isUploading && !isSuccess && !hasPreUploadError && (
                        <button
                          onClick={() => onUploadSingle(folder)}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--cs-primary-soft)] hover:bg-[var(--cs-primary)] border border-[var(--cs-primary-soft)] px-4 py-1.5 text-xs font-semibold text-[var(--cs-primary)] hover:text-[var(--cs-active-text)] transition-all"
                        >
                          <Icon icon={appIcons.uploadFile} className="h-3.5 w-3.5" />
                          <span>{isFailed ? 'Retry' : 'Upload'}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col text-[var(--cs-text)]">
      {/* Table Toolbar */}
      <div className="flex flex-col gap-4 py-3 sm:flex-row sm:items-center sm:justify-between border-b border-[var(--cs-border)] bg-transparent">
        <div className="relative min-w-0 flex-1 max-w-md">
          <Icon
            icon={appIcons.search}
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cs-text-faint)]"
          />
          <input
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-full border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] py-1.5 pl-9 pr-9 text-xs outline-none focus:border-[var(--cs-primary)] transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="cs-search-clear absolute right-3 top-1/2 -translate-y-1/2 text-[var(--cs-text-soft)] hover:text-[var(--cs-text)] rounded-full p-0.5 transition-colors"
            >
              <Icon icon={appIcons.close} className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={onCheck}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--cs-surface-muted)] hover:bg-[var(--cs-border-strong)] border border-[var(--cs-border)] px-4 py-1.5 text-xs font-semibold text-[var(--cs-text-soft)] hover:text-[var(--cs-text)] transition-all disabled:opacity-50"
          >
            {loading ? (
              <>
                <LoadingAppIcon isDark={isDark} color="currentColor" />
                <span>Scanning...</span>
              </>
            ) : (
              <>
                <Icon icon={appIcons.refresh} className="h-3.5 w-3.5" />
                <span>Check Upload</span>
              </>
            )}
          </button>

          {data && validCount > 0 && (
            <button
              onClick={onRequestUploadAll}
              disabled={isUploadingAny || allDone}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--cs-primary)] hover:bg-[var(--cs-primary)]/90 px-4 py-1.5 text-xs font-semibold text-[var(--cs-active-text)] transition-all disabled:opacity-50"
            >
              {isUploadingAny ? (
                <>
                  <LoadingAppIcon isDark={isDark} color="currentColor" />
                  <span>Uploading ({uploadingCount})</span>
                </>
              ) : allDone ? (
                <>
                  <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
                  <span>All Uploaded</span>
                </>
              ) : (
                <>
                  <Icon icon={appIcons.uploadFile} className="h-3.5 w-3.5" />
                  <span>Upload All ({validCount})</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {(uploadProgress || uploadPollingError) && (
        <div className="mt-3 rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4 shadow-sm">
          {uploadProgress && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--cs-text-muted)]">
                    Upload queue
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[var(--cs-text)]">
                    {processedCount} of {uploadProgress.total} processed
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <ProgressPill label="Queued" value={uploadProgress.queued} color="var(--cs-warning)" />
                  <ProgressPill label="Running" value={uploadProgress.running} color="var(--cs-primary)" />
                  <ProgressPill label="Completed" value={uploadProgress.completed} color="var(--cs-success)" />
                  <ProgressPill label="Failed" value={uploadProgress.failed} color="var(--cs-danger)" />
                </div>
              </div>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--cs-surface-muted)]"
                role="progressbar"
                aria-label="Story upload progress"
                aria-valuemin={0}
                aria-valuemax={uploadProgress.total}
                aria-valuenow={processedCount}
              >
                <div
                  className="h-full rounded-full bg-[var(--cs-primary)] transition-[width] duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </>
          )}
          {uploadPollingError && (
            <div
              className={`${uploadProgress ? 'mt-3 border-t border-[var(--cs-border)] pt-3' : ''} flex items-start gap-2 text-xs text-[var(--cs-warning)]`}
            >
              <Icon icon={appIcons.info} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{uploadPollingError}</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-[var(--cs-danger)]/20 bg-[var(--cs-danger)]/5 text-[var(--cs-danger)] p-3 text-sm">
          <Icon icon={appIcons.error} className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {/* Filter Segment Selector */}
      {data && (
        <div className="flex flex-wrap items-center gap-1.5 py-2 border-b border-[var(--cs-border)] bg-transparent">
          <FilterChip
            label="All"
            count={filteredTotal}
            active={filterSection === 'all'}
            onClick={() => setFilterSection('all')}
            isDark={isDark}
          />
          <FilterChip
            label="Ready"
            count={validCount}
            active={filterSection === 'ready'}
            onClick={() => setFilterSection('ready')}
            variant="green"
            isDark={isDark}
          />
          <FilterChip
            label="Invalid"
            count={filteredInvalid.length}
            active={filterSection === 'invalid'}
            onClick={() => setFilterSection('invalid')}
            variant="red"
            isDark={isDark}
          />
          <FilterChip
            label="Not DONE_"
            count={filteredNotReady.length}
            active={filterSection === 'notReady'}
            onClick={() => setFilterSection('notReady')}
            variant="amber"
            isDark={isDark}
          />
          <FilterChip
            label="Already on Server"
            count={filteredAlready.length}
            active={filterSection === 'uploaded'}
            onClick={() => setFilterSection('uploaded')}
            isDark={isDark}
          />
        </div>
      )}

      {/* Status summary banner */}
      {data && !loading && (
        <div className="mt-3 flex flex-wrap items-center gap-3 py-2 text-xs text-[var(--cs-text-soft)] bg-transparent">
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.check} className="h-3.5 w-3.5 text-[var(--cs-success)]" />
            {data.drive_folders.length} DONE_ folders scanned
          </div>
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.add} className="h-3.5 w-3.5 text-[var(--cs-warning)]" />
            {validCount} ready to upload
          </div>
          <div className="flex items-center gap-1.5">
            <Icon icon={appIcons.trends} className="h-3.5 w-3.5 text-[var(--cs-text-soft)]" />
            {filteredAlready.length} already on server
          </div>
          {filteredInvalid.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Icon icon={appIcons.close} className="h-3.5 w-3.5 text-[var(--cs-danger)]" />
              {filteredInvalid.length} invalid
            </div>
          )}
          {successCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-[var(--cs-success)] font-semibold">
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              {successCount} successful
            </div>
          )}
          {failedCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-[var(--cs-danger)] font-semibold">
              <Icon icon={appIcons.close} className="h-3.5 w-3.5" />
              {failedCount} failed
            </div>
          )}
        </div>
      )}

      {/* Main Table Content */}
      <div className="flex-1 py-4">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Check Upload' to scan DONE_ folders that are ready to upload."
            icon={<Icon icon={appIcons.shield} className="h-8 w-8 text-[var(--cs-text-faint)]" />}
          />
        )}

        {data && !loading && data.drive_folders.length === 0 && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--cs-warning)]/20 bg-[var(--cs-warning)]/5 text-[var(--cs-text-soft)] px-4 py-3 text-xs leading-5">
            <Icon icon={appIcons.info} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cs-warning)]" />
            <p>
              Check Upload only scans Drive folders whose name starts with <span className="font-mono font-semibold">DONE_</span>.
              Rename completed story folders to <span className="font-mono font-semibold text-[var(--cs-primary)]">DONE_status_source - Story Title</span>, using
              <span className="font-mono"> _nw</span>, <span className="font-mono"> _gd</span>,
              <span className="font-mono"> _wp</span>, or <span className="font-mono"> _ink</span> before uploading.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex h-full w-full flex-col items-center justify-center py-20">
            <LoadingAppIcon isDark={isDark} color="var(--cs-primary)" size="lg" />
            <p className="text-sm text-[var(--cs-text-soft)]">
              Scanning your Drive folders...
            </p>
          </div>
        )}

        {data && !loading && (
          <div className="flex flex-col">
            {/* Priority 1: Invalid */}
            {(filterSection === 'all' || filterSection === 'invalid') &&
              renderTableBlock(
                'Invalid Folders',
                'var(--cs-danger)',
                'rgba(220,38,38,0.15)',
                filteredInvalid,
                'invalid'
              )}

            {/* Priority 2: Ready */}
            {(filterSection === 'all' || filterSection === 'ready') &&
              renderTableBlock(
                'Ready to Upload',
                'var(--cs-success)',
                'rgba(22,163,74,0.15)',
                filteredUploadable,
                'ready'
              )}

            {/* Priority 3: Not DONE_ */}
            {(filterSection === 'all' || filterSection === 'notReady') &&
              renderTableBlock(
                'Not DONE_ Folders',
                'var(--cs-warning)',
                'rgba(245,158,11,0.15)',
                filteredNotReady,
                'notReady'
              )}

            {/* Priority 4: Already on Server */}
            {(filterSection === 'all' || filterSection === 'uploaded') &&
              renderTableBlock(
                'Already on Server',
                'var(--cs-primary)',
                'var(--cs-primary-soft)',
                filteredAlready,
                'already'
              )}

            {/* Empty check */}
            {((filterSection === 'all' && filteredTotal === 0) ||
              (filterSection === 'ready' && filteredUploadable.length === 0) ||
              (filterSection === 'invalid' && filteredInvalid.length === 0) ||
              (filterSection === 'notReady' && filteredNotReady.length === 0) ||
              (filterSection === 'uploaded' && filteredAlready.length === 0)) && (
              <div className="py-16 text-center text-[var(--cs-text-soft)] border border-dashed border-[var(--cs-border)] rounded-xl">
                <Icon icon={appIcons.checkCircle} className="mx-auto mb-2 h-8 w-8 text-[var(--cs-text-faint)]" />
                <p className="text-sm">No items matching current filters</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressPill({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}) {
  return (
    <span
      className="rounded-full border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] px-2.5 py-1"
      style={{ color }}
    >
      {label}: {value}
    </span>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  variant,
  isDark: _isDark,
}: {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly variant?: 'green' | 'amber' | 'red';
  readonly isDark: boolean;
}) {
  const colors =
    variant === 'green'
      ? {
          active: 'rgba(22,163,74,0.15)',
          activeText: 'var(--cs-success)',
          inactive: 'var(--cs-text-soft)',
        }
      : variant === 'red'
        ? {
            active: 'rgba(220,38,38,0.15)',
            activeText: 'var(--cs-danger)',
            inactive: 'var(--cs-text-soft)',
          }
        : variant === 'amber'
          ? {
              active: 'rgba(245,158,11,0.15)',
              activeText: 'var(--cs-warning)',
              inactive: 'var(--cs-text-soft)',
            }
          : {
              active: 'var(--cs-primary-soft)',
              activeText: 'var(--cs-primary)',
              inactive: 'var(--cs-text-soft)',
            };

  return (
    <button
      onClick={onClick}
      className="rounded-full px-4 py-1.5 text-xs font-semibold transition-colors hover:text-[var(--cs-text)]"
      style={{
        background: active ? colors.active : 'transparent',
        color: active ? colors.activeText : colors.inactive,
      }}
    >
      {label} ({count})
    </button>
  );
}

function formatUploadValidationMessage(message: string): string {
  const unrecognizedSource = message.match(/UNRECOGNIZED SOURCE:\s*'([^']+)'/i);
  if (unrecognizedSource) {
    return `Unrecognized source token '${unrecognizedSource[1]}'. Expected _nw, _gd, _wp, or _ink.`;
  }

  if (/MISSING SOURCE/i.test(message)) {
    return 'Missing source token in folder name.';
  }

  return message;
}
