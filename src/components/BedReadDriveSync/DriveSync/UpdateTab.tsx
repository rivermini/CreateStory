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
import { ValidationErrorBadge, EmptyState } from './SyncTabShared';
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

  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const searchBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

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

      // Clean up inputs and last max caches for stories that are no longer updatable
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
  const invalidLabel = `Invalid (${filteredInvalid.length})`;
  const noUpdateLabel = `Up-to-Date (${filteredNoUpdate.length})`;
  const noServerLabel = `No Server Match (${filteredNoServerMatch.length})`;
  const emptyLabel = `Empty EXTENDED (${filteredEmptyExtended.length})`;
  const noDriveLabel = `No Drive Folder (${filteredNoDriveFolder.length})`;
  const isUpdatingAny = updatingIds.size > 0;
  const successCount = Array.from(updateResults.values()).filter((result) => result.success).length;
  const failedCount = Array.from(updateResults.values()).filter((result) => !result.success).length;

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
            className="w-full rounded-xl border py-2.5 pl-9 pr-10 text-sm outline-none transition"
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
            onClick={onCheckReaderFinished}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              background: loading ? mutedSurface : 'rgba(239,68,68,0.85)',
              borderColor: loading ? panelBorder : 'rgba(239,68,68,0.85)',
              color: loading ? secondaryText : '#ffffff',
              opacity: loading ? 0.65 : 1,
            }}
          >
            <Icon icon={appIcons.users} className="h-4 w-4" />
            Check Reader Finished
          </button>
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
                Check Updates
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
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
              style={{
                background: isUpdatingAny ? mutedSurface : 'linear-gradient(135deg, #f59e0b, #ea580c)',
                borderColor: isUpdatingAny ? panelBorder : 'transparent',
                color: isUpdatingAny ? secondaryText : '#ffffff',
                opacity: isUpdatingAny ? 0.65 : 1,
              }}
            >
              {isUpdatingAny ? (
                <>
                  <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
                  Updating ({isUpdatingAny})
                </>
              ) : (
                <>
                  <Icon icon={appIcons.trends} className="h-4 w-4" />
                  Update All ({updateCount})
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {data && (
        <div
          className="flex items-center gap-1 border-b px-4 py-2"
          style={{ background: mutedSurface, borderColor: panelBorder }}
        >
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
              label="No Drive Folder"
              count={filteredNoDriveFolder.length}
              active={filterSection === 'noDriveFolder'}
              variant="red"
              onClick={() => setFilterSection('noDriveFolder')}
              isDark={isDark}
            />
          )}
        </div>
      )}

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

      {data && !loading && (
        <div
          className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2 text-xs"
          style={{ background: mutedSurface, color: secondaryText }}
        >
          {data.all_extended_folders?.length ? (
            <div className="flex items-center gap-1.5">
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" style={{ color: isDark ? '#34d399' : '#059669' }} />
              {data.all_extended_folders.length} EXTENDED_
            </div>
          ) : null}
          <StatPill label="can update" value={updateCount} color="#f59e0b" isDark={isDark} />
          <StatPill label="up-to-date" value={filteredNoUpdate.length} color={isDark ? '#ff7c33' : '#ff5b00'} isDark={isDark} />
          {filteredInvalid.length > 0 && <StatPill label="invalid" value={filteredInvalid.length} color="#f87171" isDark={isDark} />}
          {filteredNoServerMatch.length > 0 && (
            <StatPill label="no server match" value={filteredNoServerMatch.length} color="#94a3b8" isDark={isDark} />
          )}
          {filteredEmptyExtended.length > 0 && (
            <StatPill label="empty EXTENDED" value={filteredEmptyExtended.length} color="#94a3b8" isDark={isDark} />
          )}
          {successCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5" style={{ color: isDark ? '#34d399' : '#059669' }}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              {successCount} updated
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
            message="Click 'Check Updates' to scan for stories with new chapters to sync."
            icon={
              <Icon
                icon={appIcons.trends}
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
              Scanning Drive for updates...
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
                />
                <div className="space-y-2">
                  {filteredInvalid.map((entry) => (
                    <InvalidEntryCard
                      key={entry.server_story.id}
                      entry={entry}
                      isDark={isDark}
                    />
                  ))}
                </div>
              </div>
            )}

            {updateCount > 0 && (
              <div className="mb-4">
                <SectionHeader
                  label={`Can Update (${updateCount})`}
                  color="#f59e0b"
                  icon={<Icon icon={appIcons.trends} className="h-4 w-4" style={{ color: '#f59e0b' }} />}
                  panelBorder={panelBorder}
                />
                <div className="space-y-2">
                  {filteredUpdatable.map((entry) => {
                    const result = updateResults.get(entry.server_story.id);
                    const isUpdating = updatingIds.has(entry.server_story.id);
                    const isSuccess = result?.success;
                    const isFailed = result && !result.success;
                    const entryError = chapterErrors.get(entry.server_story.id);
                    return (
                      <UpdatableEntryCard
                        key={entry.server_story.id}
                        entry={entry}
                        chapterCount={chapterCountInputs.get(entry.server_story.id) ?? 1}
                        onChapterCountChange={(count) => {
                          setChapterCountInputs((prev) => new Map(prev).set(entry.server_story.id, count));
                          const newErrors = new Map(chapterErrors);
                          if (count > (entry.new_chapters_count ?? 0)) {
                            newErrors.set(entry.server_story.id, `Maximum ${entry.new_chapters_count ?? 0} chapters available`);
                          } else {
                            newErrors.delete(entry.server_story.id);
                          }
                          setChapterErrors(newErrors);
                        }}
                        chapterError={entryError}
                        result={result}
                        isUpdating={isUpdating}
                        isSuccess={isSuccess}
                        isFailed={!!isFailed}
                        onUpdate={() => onUpdateSingle(entry, chapterCountInputs.get(entry.server_story.id) ?? 1)}
                        openFilePanels={openFilePanels}
                        onToggleFilePanel={toggleFilePanel}
                        isDark={isDark}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {filteredNoUpdate.length > 0 && (
              <div className="mb-4">
                <SectionHeader
                  label={noUpdateLabel}
                  color={secondaryText}
                  icon={<Icon icon={appIcons.check} className="h-4 w-4" style={{ color: secondaryText }} />}
                  panelBorder={panelBorder}
                />
                <div className="space-y-2">
                  {filteredNoUpdate.map((entry) => (
                    <UpToDateCard key={entry.server_story.id} entry={entry} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {filteredNoServerMatch.length > 0 && (
              <div className="mb-4">
                <SectionHeader
                  label={noServerLabel}
                  color="#94a3b8"
                  icon={<Icon icon={appIcons.users} className="h-4 w-4" style={{ color: '#94a3b8' }} />}
                  panelBorder={panelBorder}
                />
                <div className="space-y-2">
                  {filteredNoServerMatch.map((folder) => (
                    <FolderOnlyCard
                      key={folder.id}
                      folder={folder}
                      isDark={isDark}
                      panelBorder={panelBorder}
                      mutedSurface={mutedSurface}
                    />
                  ))}
                </div>
              </div>
            )}

            {filteredEmptyExtended.length > 0 && (
              <div className="mb-4">
                <SectionHeader
                  label={emptyLabel}
                  color="#94a3b8"
                  icon={<Icon icon={appIcons.info} className="h-4 w-4" style={{ color: '#94a3b8' }} />}
                  panelBorder={panelBorder}
                />
                <div className="space-y-2">
                  {filteredEmptyExtended.map((folder) => (
                    <FolderOnlyCard
                      key={folder.id}
                      folder={folder}
                      isDark={isDark}
                      panelBorder={panelBorder}
                      mutedSurface={mutedSurface}
                    />
                  ))}
                </div>
              </div>
            )}

            {filteredNoDriveFolder.length > 0 && (
              <div>
                <SectionHeader
                  label={noDriveLabel}
                  color="#f87171"
                  icon={<Icon icon={appIcons.folder} className="h-4 w-4" style={{ color: '#f87171' }} />}
                  panelBorder={panelBorder}
                />
                <div className="space-y-2">
                  {filteredNoDriveFolder.map((entry) => (
                    <ServerOnlyCard key={entry.server_story.id} entry={entry} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {data && filterSection === 'ready' && updateCount > 0 && (
          <div className="space-y-2">
            {filteredUpdatable.map((entry) => {
              const result = updateResults.get(entry.server_story.id);
              const isUpdating = updatingIds.has(entry.server_story.id);
              const isSuccess = result?.success;
              const entryError = chapterErrors.get(entry.server_story.id);
              return (
                <UpdatableEntryCard
                  key={entry.server_story.id}
                  entry={entry}
                  chapterCount={chapterCountInputs.get(entry.server_story.id) ?? 1}
                  onChapterCountChange={(count) => {
                    setChapterCountInputs((prev) => new Map(prev).set(entry.server_story.id, count));
                  }}
                  chapterError={entryError}
                  result={result}
                  isUpdating={isUpdating}
                  isSuccess={isSuccess}
                  isFailed={false}
                  onUpdate={() => onUpdateSingle(entry, chapterCountInputs.get(entry.server_story.id) ?? 1)}
                  openFilePanels={openFilePanels}
                  onToggleFilePanel={toggleFilePanel}
                  isDark={isDark}
                />
              );
            })}
          </div>
        )}

        {data && filterSection === 'invalid' && filteredInvalid.length > 0 && (
          <div className="space-y-2">
            {filteredInvalid.map((entry) => (
              <InvalidEntryCard key={entry.server_story.id} entry={entry} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'uptodate' && filteredNoUpdate.length > 0 && (
          <div className="space-y-2">
            {filteredNoUpdate.map((entry) => (
              <UpToDateCard key={entry.server_story.id} entry={entry} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'noServerMatch' && filteredNoServerMatch.length > 0 && (
          <div className="space-y-2">
            {filteredNoServerMatch.map((folder) => (
              <FolderOnlyCard
                key={folder.id}
                folder={folder}
                isDark={isDark}
                panelBorder={panelBorder}
                mutedSurface={mutedSurface}
              />
            ))}
          </div>
        )}

        {data && filterSection === 'emptyExtended' && filteredEmptyExtended.length > 0 && (
          <div className="space-y-2">
            {filteredEmptyExtended.map((folder) => (
              <FolderOnlyCard
                key={folder.id}
                folder={folder}
                isDark={isDark}
                panelBorder={panelBorder}
                mutedSurface={mutedSurface}
              />
            ))}
          </div>
        )}

        {data && filterSection === 'noDriveFolder' && filteredNoDriveFolder.length > 0 && (
          <div className="space-y-2">
            {filteredNoDriveFolder.map((entry) => (
              <ServerOnlyCard key={entry.server_story.id} entry={entry} isDark={isDark} />
            ))}
          </div>
        )}

        {data &&
          ((filterSection === 'ready' && updateCount === 0) ||
            (filterSection === 'invalid' && filteredInvalid.length === 0) ||
            (filterSection === 'uptodate' && filteredNoUpdate.length === 0) ||
            (filterSection === 'noServerMatch' && filteredNoServerMatch.length === 0) ||
            (filterSection === 'emptyExtended' && filteredEmptyExtended.length === 0) ||
            (filterSection === 'noDriveFolder' && filteredNoDriveFolder.length === 0)) && (
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
          activeText: isDark ? '#fcd34d' : '#b45309',
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
}: {
  readonly label: string;
  readonly color: string;
  readonly icon: React.ReactNode;
  readonly panelBorder: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 border-b pb-2 text-sm font-medium" style={{ borderColor: panelBorder, color }}>
      {icon}
      {label}
    </div>
  );
}

function StatPill({
  label,
  value,
  color,
  isDark,
}: {
  readonly label: string;
  readonly value: number;
  readonly color: string;
  readonly isDark: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color }}>{value}</span>
      <span style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)' }}>{label}</span>
    </div>
  );
}

function UpdatableEntryCard({
  entry,
  chapterCount,
  onChapterCountChange,
  chapterError,
  result,
  isUpdating,
  isSuccess,
  isFailed,
  onUpdate,
  openFilePanels,
  onToggleFilePanel,
  isDark,
}: {
  readonly entry: UpdatableStoryEntry;
  readonly chapterCount: number;
  readonly onChapterCountChange: (count: number) => void;
  readonly chapterError?: string;
  readonly result?: { success: boolean; message: string };
  readonly isUpdating: boolean;
  readonly isSuccess?: boolean;
  readonly isFailed: boolean;
  readonly onUpdate: () => void;
  readonly openFilePanels: ReadonlyMap<string, { readonly loading: boolean; readonly data: DriveFileContentResponse | null }>;
  readonly onToggleFilePanel: (entryId: string, filename: 'free.md' | 'tags.md', folderId: string) => void;
  readonly isDark: boolean;
}) {
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  const freeKey = `${entry.server_story.id}:free.md`;
  const tagsKey = `${entry.server_story.id}:tags.md`;
  const freePanel = openFilePanels.get(freeKey);
  const tagsPanel = openFilePanels.get(tagsKey);

  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: mutedSurface, borderColor: panelBorder }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="mt-1 truncate text-sm font-medium" style={{ color: pageText }}>
            {entry.folder.display_name}
          </p>
          <p className="mt-1 truncate text-xs font-mono" style={{ color: secondaryText }}>
            {entry.folder.name}
          </p>
          <div className="mt-1 flex items-center gap-3 text-xs">
            <span style={{ color: secondaryText }}>
              Server: <span className="font-semibold" style={{ color: pageText }}>{entry.server_story.maxChapter}</span>
            </span>
            <Icon icon={appIcons.external} className="h-3 w-3" style={{ color: secondaryText }} />
            <span style={{ color: secondaryText }}>
              Drive: <span className="font-semibold" style={{ color: pageText }}>{entry.folder.extended_chapter_count ?? 0}</span>
            </span>
            <span style={{ color: '#f59e0b' }}>
              +{entry.new_chapters_count ?? 0} new
            </span>
          </div>
          {chapterError && (
            <p className="mt-1 text-xs" style={{ color: '#f87171' }}>
              {chapterError}
            </p>
          )}
          {result && (
            <p
              className="mt-0.5 truncate text-xs"
              style={{ color: isSuccess ? (isDark ? '#34d399' : '#059669') : '#f87171' }}
            >
              {result.message}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex flex-col items-center gap-1">
            <label htmlFor={`chapters-${entry.server_story.id}`} className="text-xs" style={{ color: secondaryText }}>
              Chapters
            </label>
            <input
              id={`chapters-${entry.server_story.id}`}
              type="number"
              min={1}
              max={entry.new_chapters_count ?? 1}
              value={chapterCount}
              onChange={(event) => onChapterCountChange(Math.max(1, Number.parseInt(event.target.value) || 1))}
              className="w-16 rounded-md border px-2 py-1.5 text-center text-xs outline-none transition focus:border-amber-500"
              style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
            />
          </div>

          {isUpdating && <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin text-indigo-400" />}
          {isSuccess && (
            <div className="flex items-center gap-1 text-xs" style={{ color: isDark ? '#34d399' : '#059669' }}>
              <Icon icon={appIcons.check} className="h-4 w-4" />
              <span>Done</span>
            </div>
          )}
          {isFailed && (
            <div className="flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
              <Icon icon={appIcons.close} className="h-4 w-4" />
              <span>Failed</span>
            </div>
          )}
          {!isUpdating && !isSuccess && !isFailed && (
            <button
              onClick={onUpdate}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
                borderColor: 'transparent',
                color: '#ffffff',
              }}
            >
              <Icon icon={appIcons.trends} className="h-3.5 w-3.5" />
              Update
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onToggleFilePanel(entry.server_story.id, 'free.md', entry.folder.id)}
          className="rounded px-2 py-1 text-xs transition-colors"
          style={{ background: mutedSurface, color: secondaryText }}
        >
          free.md {freePanel?.loading ? '(loading...)' : freePanel ? '(close)' : ''}
        </button>
        <button
          onClick={() => onToggleFilePanel(entry.server_story.id, 'tags.md', entry.folder.id)}
          className="rounded px-2 py-1 text-xs transition-colors"
          style={{ background: mutedSurface, color: secondaryText }}
        >
          tags.md {tagsPanel?.loading ? '(loading...)' : tagsPanel ? '(close)' : ''}
        </button>
      </div>

      {freePanel && (
        <div className="mt-2 rounded-md border p-2 text-xs" style={{ borderColor: panelBorder, background: mutedSurface }}>
          <p className="mb-1 font-medium" style={{ color: secondaryText }}>
            free.md
          </p>
          {freePanel.loading ? (
            <span style={{ color: secondaryText }}>Loading...</span>
          ) : freePanel.data?.content ? (
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap break-words"
              style={{ color: pageText }}
            >
              {freePanel.data.content}
            </pre>
          ) : (
            <span style={{ color: '#f87171' }}>{freePanel.data?.error ?? 'No content'}</span>
          )}
        </div>
      )}

      {tagsPanel && (
        <div className="mt-2 rounded-md border p-2 text-xs" style={{ borderColor: panelBorder, background: mutedSurface }}>
          <p className="mb-1 font-medium" style={{ color: secondaryText }}>
            tags.md
          </p>
          {tagsPanel.loading ? (
            <span style={{ color: secondaryText }}>Loading...</span>
          ) : tagsPanel.data?.content ? (
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap break-words"
              style={{ color: pageText }}
            >
              {tagsPanel.data.content}
            </pre>
          ) : (
            <span style={{ color: '#f87171' }}>{tagsPanel.data?.error ?? 'No content'}</span>
          )}
        </div>
      )}
    </div>
  );
}

function InvalidEntryCard({
  entry,
  isDark,
}: {
  readonly entry: UpdatableStoryEntry;
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
          {entry.folder.display_name}
        </p>
        <p className="mt-1 truncate text-xs font-mono" style={{ color: secondaryText }}>
          {entry.folder.name}
        </p>
        <div className="mt-1 flex items-center gap-3 text-xs">
          <span style={{ color: secondaryText }}>
            Server: <span className="font-semibold" style={{ color: pageText }}>{entry.server_story.maxChapter}</span>
          </span>
          <Icon icon={appIcons.external} className="h-3 w-3" style={{ color: secondaryText }} />
          <span style={{ color: secondaryText }}>
            Drive: <span className="font-semibold" style={{ color: pageText }}>{entry.folder.extended_chapter_count ?? 0}</span>
          </span>
        </div>
      </div>
      {entry.server_story.title && (
        <ValidationErrorBadge error={entry.server_story.title} isDark={isDark} />
      )}
    </div>
  );
}

function UpToDateCard({
  entry,
  isDark,
}: {
  readonly entry: UpdatableStoryEntry;
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
      <Icon icon={appIcons.check} className="h-4 w-4 shrink-0" style={{ color: secondaryText }} />
      <div className="min-w-0 flex-1">
        <p className="mt-1 truncate text-sm font-medium" style={{ color: pageText }}>
          {entry.folder.display_name}
        </p>
        <p className="mt-1 truncate text-xs font-mono" style={{ color: secondaryText }}>
          {entry.folder.name}
        </p>
        <div className="mt-1 flex items-center gap-3 text-xs">
          <span style={{ color: secondaryText }}>
            Server: <span className="font-semibold" style={{ color: pageText }}>{entry.server_story.maxChapter}</span>
          </span>
          <Icon icon={appIcons.external} className="h-3 w-3" style={{ color: secondaryText }} />
          <span style={{ color: secondaryText }}>
            Drive: <span className="font-semibold" style={{ color: pageText }}>{entry.folder.extended_chapter_count ?? 0}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function FolderOnlyCard({
  folder,
  isDark,
  panelBorder,
  mutedSurface,
}: {
  readonly folder: DriveFolderEntry;
  readonly isDark: boolean;
  readonly panelBorder: string;
  readonly mutedSurface: string;
}) {
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{ background: mutedSurface, borderColor: panelBorder }}
    >
      <Icon icon={appIcons.folder} className="h-4 w-4 shrink-0" style={{ color: '#94a3b8' }} />
      <div className="min-w-0 flex-1">
        <p className="mt-1 truncate text-sm font-medium" style={{ color: pageText }}>
          {folder.display_name}
        </p>
        <p className="mt-1 truncate text-xs font-mono" style={{ color: secondaryText }}>
          {folder.name}
        </p>
      </div>
    </div>
  );
}

function ServerOnlyCard({
  entry,
  isDark,
}: {
  readonly entry: ServerOnlyStoryEntry;
  readonly isDark: boolean;
}) {
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{ background: mutedSurface, borderColor: panelBorder }}
    >
      <Icon icon={appIcons.info} className="h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" style={{ color: pageText }}>
          {entry.server_story.title}
        </p>
        <p className="truncate text-xs" style={{ color: '#f87171' }}>
          No Drive folder
        </p>
      </div>
    </div>
  );
}
