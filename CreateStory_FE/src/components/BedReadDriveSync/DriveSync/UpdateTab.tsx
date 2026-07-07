import { useEffect, useState, useRef } from 'react';
import {
  type CheckUpdatableResponse,
  type UpdatableStoryEntry,
  type DriveFolderEntry,
  type StoriesNeedingUpdateEntry,
  type ServerOnlyStoryEntry,
  getDriveFileContent,
  type DriveFileContentResponse,
} from '../../../api';
import { Icon, appIcons } from '../../Shared/Icon';
import { ValidationErrorBadge, EmptyState, LoadingAppIcon, StatusBadge } from './SyncTabShared';
import type { ThemeMode } from '../../../types/theme';

interface UpdateTabProps {
  readonly data: CheckUpdatableResponse | null;
  readonly loading: boolean;
  readonly error: string;
  readonly updateResults: ReadonlyMap<string, { success: boolean; message: string }>;
  readonly updatingIds: ReadonlySet<string>;
  readonly onCheck: () => void;
  readonly onCheckReaderFinished: () => void;
  readonly onUpdateSingle: (entry: UpdatableStoryEntry, chaptersCount?: number) => Promise<string>;
  readonly onRequestUpdateAll: (
    entries: UpdatableStoryEntry[],
    chapterInputs: ReadonlyMap<string, number>,
    newErrors?: Map<string, string>,
  ) => void;
  readonly hasChapterErrors: boolean;
  readonly onChapterErrorsChange: (hasErrors: boolean) => void;
  readonly invalid?: readonly UpdatableStoryEntry[];
  readonly noServerMatch?: readonly DriveFolderEntry[];
  readonly emptyExtended?: readonly DriveFolderEntry[];
  readonly storiesNeedingUpdate?: readonly StoriesNeedingUpdateEntry[];
  readonly noDriveFolder?: readonly ServerOnlyStoryEntry[];
  readonly themeMode: ThemeMode;
}

interface UnifiedUpdateItem {
  id: string; // server_story.id or folder.id
  title: string;
  folderName?: string;
  folderId?: string;
  status: 'ready' | 'invalid' | 'uptodate' | 'noServerMatch' | 'emptyExtended' | 'noDriveFolder';
  entry?: UpdatableStoryEntry;
  folder?: DriveFolderEntry;
  serverOnlyEntry?: ServerOnlyStoryEntry;
}

export function UpdateTab({
  data,
  loading,
  error,
  updateResults,
  updatingIds,
  onCheck,
  onCheckReaderFinished,
  onUpdateSingle,
  onRequestUpdateAll,
  hasChapterErrors,
  onChapterErrorsChange,
  invalid,
  noServerMatch,
  emptyExtended,
  storiesNeedingUpdate,
  noDriveFolder,
  themeMode,
}: UpdateTabProps) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState<
    'all' | 'ready' | 'invalid' | 'uptodate' | 'noServerMatch' | 'emptyExtended' | 'noDriveFolder'
  >('invalid');
  const [chapterCountInputs, setChapterCountInputs] = useState<Map<string, number>>(new Map());
  const [chapterErrors, setChapterErrors] = useState<Map<string, string>>(new Map());
  const [openFilePanels, setOpenFilePanels] = useState<
    Map<string, { loading: boolean; data: DriveFileContentResponse | null }>
  >(new Map());

  useEffect(() => {
    onChapterErrorsChange(chapterErrors.size > 0);
  }, [chapterErrors.size, onChapterErrorsChange]);

  const lastMaxChapters = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!data) return;
    const updatable = data.updatable;
    setChapterCountInputs((prev) => {
      const next = new Map(prev);
      let changed = false;
      const currentIds = new Set<string>();

      for (const entry of updatable) {
        const id = entry.server_story.id;
        currentIds.add(id);
        const newMax = entry.new_chapters_count ?? 1;
        const lastMax = lastMaxChapters.current.get(id);
        const currentInput = next.get(id);

        if (
          currentInput === undefined ||
          lastMax !== newMax ||
          currentInput > newMax
        ) {
          next.set(id, newMax);
          lastMaxChapters.current.set(id, newMax);
          changed = true;
        }
      }

      for (const id of next.keys()) {
        if (!currentIds.has(id)) {
          next.delete(id);
          lastMaxChapters.current.delete(id);
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [data]);

  async function toggleFilePanel(entryId: string, filename: 'free.md' | 'tags.md', folderId: string) {
    const key = `${entryId}:${filename}`;
    const current = openFilePanels.get(key);
    if (current) {
      setOpenFilePanels((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    setOpenFilePanels((prev) => {
      const next = new Map(prev);
      next.set(key, { loading: true, data: null });
      return next;
    });
    try {
      const result = await getDriveFileContent(folderId, filename);
      setOpenFilePanels((prev) => {
        const next = new Map(prev);
        next.set(key, { loading: false, data: result });
        return next;
      });
    } catch {
      setOpenFilePanels((prev) => {
        const next = new Map(prev);
        next.set(key, { loading: false, data: { success: false, content: '', error: 'Network error' } });
        return next;
      });
    }
  }

  const query = search.toLowerCase().trim();
  const storiesNeedingUpdateIds = new Set(storiesNeedingUpdate?.map((s) => s.storyId) ?? []);

  const filteredUpdatable = (data?.updatable.filter(
    (entry) =>
      !query ||
      entry.folder.display_name.toLowerCase().includes(query) ||
      entry.server_story.title.toLowerCase().includes(query),
  ) ?? []).sort((a, b) => {
    const aDone = storiesNeedingUpdateIds.has(a.server_story.id) ? 1 : 0;
    const bDone = storiesNeedingUpdateIds.has(b.server_story.id) ? 1 : 0;
    return bDone - aDone;
  });

  const filteredInvalid =
    invalid?.filter(
      (entry) =>
        !query ||
        entry.folder.display_name.toLowerCase().includes(query) ||
        entry.server_story.title.toLowerCase().includes(query),
    ) ?? [];
  const filteredNoUpdate =
    data?.no_update_needed.filter(
      (entry) =>
        !query ||
        entry.folder.display_name.toLowerCase().includes(query) ||
        entry.server_story.title.toLowerCase().includes(query),
    ) ?? [];
  const filteredNoServerMatch =
    noServerMatch?.filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? [];
  const filteredEmptyExtended =
    emptyExtended?.filter(
      (folder) =>
        !query ||
        folder.display_name.toLowerCase().includes(query) ||
        folder.name.toLowerCase().includes(query),
    ) ?? [];
  const filteredNoDriveFolder =
    noDriveFolder?.filter(
      (entry) => !query || entry.server_story.title.toLowerCase().includes(query),
    ) ?? [];

  const updateCount = filteredUpdatable.length;
  const updatingCount = updatingIds.size;
  const isUpdatingAny = updatingCount > 0;
  const successCount = Array.from(updateResults.values()).filter((result) => result.success).length;
  const failedCount = Array.from(updateResults.values()).filter((result) => !result.success).length;

  // Build lists for separate rendering
  const listInvalid: UnifiedUpdateItem[] = filteredInvalid.map((entry) => ({
    id: entry.server_story.id,
    title: entry.server_story.title,
    folderName: entry.folder.name,
    folderId: entry.folder.id,
    status: 'invalid' as const,
    entry,
  })).sort((a, b) => a.title.localeCompare(b.title));

  const listMissingDrive: UnifiedUpdateItem[] = filteredNoDriveFolder.map((entry) => ({
    id: entry.server_story.id,
    title: entry.server_story.title,
    status: 'noDriveFolder' as const,
    serverOnlyEntry: entry,
  })).sort((a, b) => a.title.localeCompare(b.title));

  const listReady: UnifiedUpdateItem[] = filteredUpdatable.map((entry) => ({
    id: entry.server_story.id,
    title: entry.server_story.title,
    folderName: entry.folder.name,
    folderId: entry.folder.id,
    status: 'ready' as const,
    entry,
  })).sort((a, b) => a.title.localeCompare(b.title));

  const listUptodate: UnifiedUpdateItem[] = filteredNoUpdate.map((entry) => ({
    id: entry.server_story.id,
    title: entry.server_story.title,
    folderName: entry.folder.name,
    folderId: entry.folder.id,
    status: 'uptodate' as const,
    entry,
  })).sort((a, b) => a.title.localeCompare(b.title));

  const listNoServerMatch: UnifiedUpdateItem[] = filteredNoServerMatch.map((folder) => ({
    id: folder.id,
    title: folder.display_name,
    folderName: folder.name,
    folderId: folder.id,
    status: 'noServerMatch' as const,
    folder,
  })).sort((a, b) => a.title.localeCompare(b.title));

  const listEmptyExtended: UnifiedUpdateItem[] = filteredEmptyExtended.map((folder) => ({
    id: folder.id,
    title: folder.display_name,
    folderName: folder.name,
    folderId: folder.id,
    status: 'emptyExtended' as const,
    folder,
  })).sort((a, b) => a.title.localeCompare(b.title));

  const totalFilteredCount =
    listInvalid.length +
    listMissingDrive.length +
    listReady.length +
    listUptodate.length +
    listNoServerMatch.length +
    listEmptyExtended.length;

  function renderTableBlock(
    title: string,
    badgeColor: string,
    bgBadge: string,
    items: UnifiedUpdateItem[],
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
          <table className="w-full text-left border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr className="border-b border-[var(--cs-border)] text-xs font-bold uppercase tracking-wider text-[var(--cs-text-muted)] bg-[var(--cs-surface-muted)]/40">
                <th className="pl-6 pr-2 py-4 text-center" style={{ width: 48, minWidth: 48 }}>#</th>
                <th className="px-6 py-4" style={{ width: 220, minWidth: 220 }}>Story Name</th>
                <th className="px-6 py-4" style={{ width: 450, minWidth: 450 }}>Drive Folder Name</th>
                <th className="px-6 py-4" style={{ width: 120, minWidth: 120 }}>Status</th>
                <th className="px-6 py-4" style={{ width: 220, minWidth: 220 }}>Sync Volume</th>
                <th className="px-6 py-4" style={{ width: 350, minWidth: 350 }}>Validation Logs / MD Files</th>
                <th className="px-6 py-4 text-right" style={{ width: 140, minWidth: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cs-border)]">
              {items.map((item, index) => {
                const entry = item.entry;
                const folder = item.folder;
                const serverOnlyEntry = item.id && !entry ? item.serverOnlyEntry : undefined;

                const result = entry ? updateResults.get(entry.server_story.id) : undefined;
                const isUpdating = entry ? updatingIds.has(entry.server_story.id) : false;
                const isSuccess = result?.success;
                const isFailed = result && !result.success;

                const chapterCount = entry ? (chapterCountInputs.get(entry.server_story.id) ?? 1) : 1;
                const chapterError = entry ? chapterErrors.get(entry.server_story.id) : undefined;

                const folderValidationErrors = entry?.folder.validation_errors ?? [];
                const validationErrors = folderValidationErrors.length > 0
                  ? folderValidationErrors
                  : (entry ? [inferInvalidUpdateReason(entry)] : []);

                // Retrieve free and tags panel states
                const freeKey = `${item.id}:free.md`;
                const tagsKey = `${item.id}:tags.md`;
                const freePanel = openFilePanels.get(freeKey);
                const tagsPanel = openFilePanels.get(tagsKey);

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-[var(--cs-surface-muted)]/50 transition-colors group"
                  >
                    {/* Row index number starting from 1 */}
                    <td className="pl-6 pr-2 py-5 text-center text-xs font-medium text-[var(--cs-text-faint)] whitespace-nowrap" style={{ width: 48, minWidth: 48 }}>
                      {index + 1}
                    </td>

                    {/* Story Name */}
                    <td className="px-6 py-5" style={{ width: 220, minWidth: 220 }}>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[13px] text-[var(--cs-text)] group-hover:text-[var(--cs-primary)] transition-colors">
                          {item.title}
                        </span>
                      </div>
                    </td>

                    {/* Drive Folder Name */}
                    <td className="px-6 py-5 text-[11px] font-mono text-[var(--cs-text-faint)] truncate" style={{ width: 450, minWidth: 450, maxWidth: 450 }} title={item.folderName || ''}>
                      {item.folderName || <span className="text-xs text-[var(--cs-text-faint)]">—</span>}
                    </td>

                    {/* Status */}
                    <td className="px-6 py-5 whitespace-nowrap" style={{ width: 120, minWidth: 120 }}>
                      {item.status === 'ready' && <StatusBadge prefix="CAN UPDATE" isDark={isDark} />}
                      {item.status === 'invalid' && <StatusBadge prefix="ERROR" isDark={isDark} />}
                      {item.status === 'uptodate' && <StatusBadge prefix="UP-TO-DATE" isDark={isDark} />}
                      {item.status === 'noServerMatch' && <StatusBadge prefix="NO SERVER" isDark={isDark} />}
                      {item.status === 'emptyExtended' && <StatusBadge prefix="EMPTY" isDark={isDark} />}
                      {item.status === 'noDriveFolder' && <StatusBadge prefix="MISSING" isDark={isDark} />}
                    </td>

                    {/* Sync Volume */}
                    <td className="px-6 py-5 whitespace-nowrap" style={{ width: 220, minWidth: 220 }}>
                      {item.status === 'ready' && entry ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={entry.new_chapters_count ?? 1}
                            value={chapterCount}
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value) || 1);
                              setChapterCountInputs((prev) => new Map(prev).set(entry.server_story.id, val));
                              
                              const newErrors = new Map(chapterErrors);
                              if (val > (entry.new_chapters_count ?? 0)) {
                                  newErrors.set(entry.server_story.id, `Max ${entry.new_chapters_count ?? 0} Chapters`);
                              } else {
                                  newErrors.delete(entry.server_story.id);
                              }
                              setChapterErrors(newErrors);
                            }}
                            className="w-14 rounded-full border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] px-1.5 py-1 text-center text-xs font-semibold focus:border-[var(--cs-primary)] outline-none transition"
                          />
                          <span className="text-[11px] font-semibold text-[var(--cs-warning)] bg-[var(--cs-warning)]/5 border border-[var(--cs-warning)]/20 px-2 py-0.5 rounded-full tracking-wider uppercase whitespace-nowrap">
                            +{entry.new_chapters_count} new Chapters
                          </span>
                        </div>
                      ) : entry ? (
                        <div className="text-[11px] text-[var(--cs-text-soft)]">
                          Server: <span className="font-semibold text-[var(--cs-text)]">{entry.server_story.maxChapter}</span> | Drive: <span className="font-semibold text-[var(--cs-text)]">{entry.folder.extended_chapter_count}</span>
                        </div>
                      ) : folder ? (
                        <div className="text-[11px] text-[var(--cs-text-soft)]">
                          Drive: <span className="font-semibold text-[var(--cs-text)]">{folder.extended_chapter_count}</span>
                        </div>
                      ) : serverOnlyEntry ? (
                        <div className="text-[11px] text-[var(--cs-text-soft)]">
                          Server: <span className="font-semibold text-[var(--cs-text)]">{serverOnlyEntry.server_story.maxChapter}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--cs-text-faint)]">—</span>
                      )}
                    </td>

                    {/* Validation Logs & MD files preview */}
                    <td className="px-6 py-5 text-xs" style={{ width: 350, minWidth: 350 }}>
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-1.5">
                          {item.status === 'invalid' && entry && (
                            <div className="flex flex-wrap gap-1">
                              {validationErrors.map((err, index) => (
                                <ValidationErrorBadge key={`${err}-${index}`} error={err} isDark={isDark} />
                              ))}
                            </div>
                          )}
                          {item.status === 'ready' && entry && (
                            <div className="flex flex-col gap-1">
                              {chapterError && (
                                <span className="text-[var(--cs-danger)] font-medium">{chapterError}</span>
                              )}
                              {result && (
                                <span className={isSuccess ? "text-[var(--cs-success)] font-medium" : "text-[var(--cs-danger)] font-medium"}>
                                  {result.message}
                                </span>
                              )}
                              {!chapterError && !result && (
                                <span className="text-[var(--cs-text-faint)]">Validated and ready to sync</span>
                              )}
                            </div>
                          )}
                          {item.status === 'uptodate' && (
                            <span className="text-[var(--cs-text-faint)]">Fully synchronized</span>
                          )}
                          {item.status === 'noServerMatch' && (
                            <span className="text-[var(--cs-text-soft)]">Folder name does not match any story in database</span>
                          )}
                          {item.status === 'emptyExtended' && (
                            <span className="text-[var(--cs-text-faint)]">No chapters in chapters-extended directory</span>
                          )}
                          {item.status === 'noDriveFolder' && (
                            <span className="text-[var(--cs-danger)] font-medium">Missing matching EXTENDED_ folder on Drive</span>
                          )}
                        </div>

                        {/* MD File preview toggles */}
                        {item.status === 'ready' && item.folderId && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => toggleFilePanel(item.id, 'free.md', item.folderId!)}
                              className="rounded-md bg-[var(--cs-surface-muted)] hover:bg-[var(--cs-border-strong)] px-3 py-0.5 text-[10px] text-[var(--cs-text-soft)] hover:text-[var(--cs-text)] transition-colors"
                            >
                              free.md {freePanel?.loading ? '...' : freePanel ? '▲' : '▼'}
                            </button>
                            <button
                              onClick={() => toggleFilePanel(item.id, 'tags.md', item.folderId!)}
                              className="rounded-md bg-[var(--cs-surface-muted)] hover:bg-[var(--cs-border-strong)] px-3 py-0.5 text-[10px] text-[var(--cs-text-soft)] hover:text-[var(--cs-text)] transition-colors"
                            >
                              tags.md {tagsPanel?.loading ? '...' : tagsPanel ? '▲' : '▼'}
                            </button>
                          </div>
                        )}

                        {/* Expandable File Contents inside td for clean nesting */}
                        {(freePanel || tagsPanel) && (
                          <div className="mt-2 flex flex-col gap-2 border-t border-[var(--cs-border)] pt-2">
                            {freePanel && (
                              <div className="rounded border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] p-2">
                                <p className="font-bold text-[var(--cs-primary)] text-[10px] mb-1">free.md</p>
                                {freePanel.loading ? (
                                  <span className="text-[var(--cs-text-faint)] text-[10px]">Loading...</span>
                                ) : freePanel.data?.content ? (
                                  <pre className="max-h-20 overflow-auto font-mono text-[10px] whitespace-pre-wrap leading-relaxed">
                                    {freePanel.data.content}
                                  </pre>
                                ) : (
                                  <span className="text-[var(--cs-danger)] text-[10px]">{freePanel.data?.error ?? 'No content'}</span>
                                )}
                              </div>
                            )}

                            {tagsPanel && (
                              <div className="rounded border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] p-2">
                                <p className="font-bold text-[var(--cs-primary)] text-[10px] mb-1">tags.md</p>
                                {tagsPanel.loading ? (
                                  <span className="text-[var(--cs-text-faint)] text-[10px]">Loading...</span>
                                ) : tagsPanel.data?.content ? (
                                  <pre className="max-h-20 overflow-auto font-mono text-[10px] whitespace-pre-wrap leading-relaxed">
                                    {tagsPanel.data.content}
                                  </pre>
                                ) : (
                                  <span className="text-[var(--cs-danger)] text-[10px]">{tagsPanel.data?.error ?? 'No content'}</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Row Actions */}
                    <td className="px-6 py-5 text-right whitespace-nowrap">
                      {isUpdating && (
                        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--cs-warning)] font-semibold">
                          <LoadingAppIcon isDark={isDark} color="var(--cs-warning)" />
                          <span>Updating...</span>
                        </div>
                      )}
                      {isSuccess && (
                        <div className="inline-flex items-center gap-1 text-xs text-[var(--cs-success)] font-semibold">
                          <Icon icon={appIcons.check} className="h-4 w-4" />
                          <span>Done</span>
                        </div>
                      )}
                      {isFailed && (
                        <div className="inline-flex items-center gap-1 text-xs text-[var(--cs-danger)] font-semibold">
                          <Icon icon={appIcons.close} className="h-4 w-4" />
                          <span>Failed</span>
                        </div>
                      )}
                      {item.status === 'ready' && entry && !isUpdating && !isSuccess && !isFailed && (
                        <button
                          onClick={() => onUpdateSingle(entry, chapterCount)}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--cs-primary-soft)] hover:bg-[var(--cs-primary)] border border-[var(--cs-primary-soft)] px-4 py-1.5 text-xs font-semibold text-[var(--cs-primary)] hover:text-[var(--cs-active-text)] transition-all"
                        >
                          <Icon icon={appIcons.trends} className="h-3.5 w-3.5" />
                          <span>Update</span>
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
            onClick={onCheckReaderFinished}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cs-danger)]/30 hover:border-[var(--cs-danger)] bg-[var(--cs-surface-muted)] px-4 py-1.5 text-xs font-semibold text-[var(--cs-danger)] hover:bg-[var(--cs-danger)]/5 transition-all"
          >
            <Icon icon={appIcons.users} className="h-3.5 w-3.5" />
            <span>Check Reader Finished</span>
          </button>

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
                <span>Check Updates</span>
              </>
            )}
          </button>

          {data && updateCount > 0 && (
            <button
              onClick={() => {
                const newErrors = new Map<string, string>();
                for (const entry of filteredUpdatable) {
                  const count = chapterCountInputs.get(entry.server_story.id) ?? 1;
                  if (count > (entry.new_chapters_count ?? 0)) {
                    newErrors.set(
                      entry.server_story.id,
                      `Maximum ${entry.new_chapters_count ?? 0} chapters available`,
                    );
                  }
                }
                onRequestUpdateAll(filteredUpdatable, chapterCountInputs, newErrors);
              }}
              disabled={isUpdatingAny || hasChapterErrors}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--cs-primary)] hover:bg-[var(--cs-primary)]/90 px-4 py-1.5 text-xs font-semibold text-[var(--cs-active-text)] transition-all disabled:opacity-50"
            >
              {isUpdatingAny ? (
                <>
                  <LoadingAppIcon isDark={isDark} color="currentColor" />
                  <span>Updating ({updatingCount})</span>
                </>
              ) : (
                <>
                  <Icon icon={appIcons.trends} className="h-3.5 w-3.5" />
                  <span>Update All ({updateCount})</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-[var(--cs-danger)]/20 bg-[var(--cs-danger)]/5 text-[var(--cs-danger)] p-3 text-sm">
          <Icon icon={appIcons.error} className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {/* Filter Segment Selector */}
      {data && (
        <div className="flex flex-wrap items-center gap-1.5 py-2 border-b border-[var(--cs-border)] bg-transparent overflow-x-auto">
          <FilterChip
            label="All"
            count={
              filteredUpdatable.length +
              filteredInvalid.length +
              filteredNoUpdate.length +
              filteredNoServerMatch.length +
              filteredEmptyExtended.length +
              filteredNoDriveFolder.length
            }
            active={filterSection === 'all'}
            onClick={() => setFilterSection('all')}
            isDark={isDark}
          />
          <FilterChip
            label="Can Update"
            count={updateCount}
            active={filterSection === 'ready'}
            onClick={() => setFilterSection('ready')}
            variant="amber"
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
            label="Up-to-date"
            count={filteredNoUpdate.length}
            active={filterSection === 'uptodate'}
            onClick={() => setFilterSection('uptodate')}
            isDark={isDark}
          />
          {filteredNoServerMatch.length > 0 && (
            <FilterChip
              label="No Server Match"
              count={filteredNoServerMatch.length}
              active={filterSection === 'noServerMatch'}
              onClick={() => setFilterSection('noServerMatch')}
              isDark={isDark}
            />
          )}
          {filteredEmptyExtended.length > 0 && (
            <FilterChip
              label="Empty EXTENDED"
              count={filteredEmptyExtended.length}
              active={filterSection === 'emptyExtended'}
              onClick={() => setFilterSection('emptyExtended')}
              isDark={isDark}
            />
          )}
          {filteredNoDriveFolder.length > 0 && (
            <FilterChip
              label="Missing EXTENDED_"
              count={filteredNoDriveFolder.length}
              active={filterSection === 'noDriveFolder'}
              variant="red"
              onClick={() => setFilterSection('noDriveFolder')}
              isDark={isDark}
            />
          )}
        </div>
      )}

      {/* Summary Statistics Bar */}
      {data && !loading && (
        <div className="mt-3 flex flex-wrap items-center gap-3 py-2 text-xs text-[var(--cs-text-soft)] bg-transparent">
          {data.all_extended_folders?.length ? (
            <div className="flex items-center gap-1.5">
              <Icon icon={appIcons.check} className="h-3.5 w-3.5 text-[var(--cs-success)]" />
              {data.all_extended_folders.length} EXTENDED_ folders scanned
            </div>
          ) : null}
          <StatPill label="can update" value={updateCount} color="var(--cs-warning)" isDark={isDark} />
          <StatPill label="up-to-date" value={filteredNoUpdate.length} color="var(--cs-primary)" isDark={isDark} />
          {filteredInvalid.length > 0 && (
            <StatPill label="invalid" value={filteredInvalid.length} color="var(--cs-danger)" isDark={isDark} />
          )}
          {successCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-[var(--cs-success)] font-semibold">
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              {successCount} updated
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
            message="Click 'Check Updates' to scan for stories with new chapters to sync."
            icon={<Icon icon={appIcons.trends} className="h-8 w-8 text-[var(--cs-text-faint)]" />}
          />
        )}

        {loading && (
          <div className="flex h-full w-full flex-col items-center justify-center py-20">
            <LoadingAppIcon isDark={isDark} color="var(--cs-primary)" size="lg" />
            <p className="text-sm text-[var(--cs-text-soft)]">
              Scanning Drive for updates...
            </p>
          </div>
        )}

        {data && !loading && (
          <div className="flex flex-col">
            {/* Priority 1: Invalid & Missing folder errors */}
            {(filterSection === 'all' || filterSection === 'invalid') &&
              renderTableBlock(
                'Invalid Folders',
                'var(--cs-danger)',
                'rgba(220,38,38,0.15)',
                listInvalid,
              )}

            {(filterSection === 'all' || filterSection === 'noDriveFolder') &&
              renderTableBlock(
                'Missing EXTENDED_ Drive Folders',
                'var(--cs-danger)',
                'rgba(220,38,38,0.15)',
                listMissingDrive,
              )}

            {/* Priority 2: Can Update */}
            {(filterSection === 'all' || filterSection === 'ready') &&
              renderTableBlock(
                'Can Update Chapters',
                'var(--cs-warning)',
                'rgba(245,158,11,0.15)',
                listReady,
              )}

            {/* Priority 3: Up to date, no match, empty */}
            {(filterSection === 'all' || filterSection === 'uptodate') &&
              renderTableBlock(
                'Up-To-Date Stories',
                'var(--cs-primary)',
                'var(--cs-primary-soft)',
                listUptodate,
              )}

            {(filterSection === 'all' || filterSection === 'noServerMatch') &&
              renderTableBlock(
                'No Server Match (Database Missing)',
                'var(--cs-text-soft)',
                'var(--cs-surface-muted)',
                listNoServerMatch,
              )}

            {(filterSection === 'all' || filterSection === 'emptyExtended') &&
              renderTableBlock(
                'Empty Extended Folders',
                'var(--cs-text-soft)',
                'var(--cs-surface-muted)',
                listEmptyExtended,
              )}

            {/* Empty check */}
            {((filterSection === 'all' && totalFilteredCount === 0) ||
              (filterSection === 'ready' && listReady.length === 0) ||
              (filterSection === 'invalid' && listInvalid.length === 0) ||
              (filterSection === 'uptodate' && listUptodate.length === 0) ||
              (filterSection === 'noServerMatch' && listNoServerMatch.length === 0) ||
              (filterSection === 'emptyExtended' && listEmptyExtended.length === 0) ||
              (filterSection === 'noDriveFolder' && listMissingDrive.length === 0)) && (
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
    variant === 'amber'
      ? {
          active: 'rgba(245,158,11,0.15)',
          activeText: 'var(--cs-warning)',
          inactive: 'var(--cs-text-soft)',
        }
      : variant === 'red'
        ? {
            active: 'rgba(220,38,38,0.15)',
            activeText: 'var(--cs-danger)',
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

function StatPill({
  label,
  value,
  color,
  isDark: _isDark,
}: {
  readonly label: string;
  readonly value: number;
  readonly color: string;
  readonly isDark: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 font-semibold text-xs">
      <span style={{ color }}>{value}</span>
      <span className="text-[var(--cs-text-soft)]">{label}</span>
    </div>
  );
}

function inferInvalidUpdateReason(entry: UpdatableStoryEntry): string {
  const serverChapter = entry.server_story.maxChapter ?? 0;
  const driveChapter = entry.folder.extended_chapter_count ?? 0;

  if (driveChapter < serverChapter) {
    return `DRIVE_BEHIND_SERVER: Drive has ${driveChapter} chapter${driveChapter === 1 ? '' : 's'}, but server has ${serverChapter}.`;
  }
  if (driveChapter === serverChapter) {
    return `NO_NEW_CHAPTERS: Drive and server both have ${serverChapter} chapter${serverChapter === 1 ? '' : 's'}.`;
  }
  if (driveChapter > serverChapter) {
    return `INVALID_UPDATE: Drive has ${driveChapter} chapters and server has ${serverChapter}, but this folder did not pass update validation.`;
  }
  return 'INVALID_UPDATE: This folder did not pass update validation.';
}
