import { useState, useEffect } from 'react';
import {
  type CheckUpdatableResponse,
  type UpdatableStoryEntry,
  type DriveFolderEntry,
  type StoriesNeedingUpdateEntry,
  type ServerOnlyStoryEntry,
  getDriveFileContent,
  type DriveFileContentResponse,
} from '../api/client';
import { Icon, appIcons } from './Icon';
import type { ThemeMode } from '../types/theme';
import { ValidationErrorBadge, EmptyState } from './SyncTabShared';

interface UpdateTabProps {
  data: CheckUpdatableResponse | null;
  loading: boolean;
  error: string;
  updateResults: Map<string, { success: boolean; message: string }>;
  updatingIds: Set<string>;
  onCheck: () => void;
  onCheckReaderFinished: () => void;
  onUpdateSingle: (entry: UpdatableStoryEntry, chaptersCount?: number) => Promise<string>;
  onRequestUpdateAll: (entries: UpdatableStoryEntry[], chapterInputs: Map<string, number>, newErrors?: Map<string, string>) => void;
  hasChapterErrors: boolean;
  onChapterErrorsChange: (hasErrors: boolean) => void;
  invalid?: UpdatableStoryEntry[];
  noServerMatch?: DriveFolderEntry[];
  emptyExtended?: DriveFolderEntry[];
  storiesNeedingUpdate?: StoriesNeedingUpdateEntry[];
  noDriveFolder?: ServerOnlyStoryEntry[];
  themeMode: ThemeMode;
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
  const [filterSection, setFilterSection] = useState<'all' | 'ready' | 'invalid' | 'uptodate' | 'noServerMatch' | 'emptyExtended' | 'noDriveFolder'>('invalid');
  const [chapterCountInputs, setChapterCountInputs] = useState<Map<string, number>>(new Map());
  const [chapterErrors, setChapterErrors] = useState<Map<string, string>>(new Map());
  const [openFilePanels, setOpenFilePanels] = useState<Map<string, { loading: boolean; data: DriveFileContentResponse | null }>>(new Map());

  useEffect(() => {
    onChapterErrorsChange(chapterErrors.size > 0);
  }, [chapterErrors.size, onChapterErrorsChange]);

  useEffect(() => {
    if (!data) return;
    const updatable = data.updatable;
    setChapterCountInputs(prev => {
      const next = new Map(prev);
      let changed = false;
      for (const entry of updatable) {
        const id = entry.server_story.id;
        if (!next.has(id)) {
          next.set(id, entry.new_chapters_count ?? 1);
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
      setOpenFilePanels(prev => { const next = new Map(prev); next.delete(key); return next; });
      return;
    }
    setOpenFilePanels(prev => {
      const next = new Map(prev);
      next.set(key, { loading: true, data: null });
      return next;
    });
    try {
      const result = await getDriveFileContent(folderId, filename);
      setOpenFilePanels(prev => {
        const next = new Map(prev);
        next.set(key, { loading: false, data: result });
        return next;
      });
    } catch {
      setOpenFilePanels(prev => {
        const next = new Map(prev);
        next.set(key, { loading: false, data: { success: false, content: '', error: 'Network error' } });
        return next;
      });
    }
  }

  const q = search.toLowerCase().trim();

  const storiesNeedingUpdateIds = new Set(storiesNeedingUpdate?.map(s => s.storyId) ?? []);

  const filteredUpdatable = (data?.updatable.filter(e =>
    !q || e.folder.display_name.toLowerCase().includes(q) || e.server_story.title.toLowerCase().includes(q)
  ) ?? []).sort((a, b) => {
    const aDone = storiesNeedingUpdateIds.has(a.server_story.id) ? 1 : 0;
    const bDone = storiesNeedingUpdateIds.has(b.server_story.id) ? 1 : 0;
    return bDone - aDone;
  });

  function revalidateAllErrors() {
    const newErrors = new Map<string, string>();
    for (const entry of filteredUpdatable) {
      const count = chapterCountInputs.get(entry.server_story.id) ?? 1;
      if (count > (entry.new_chapters_count ?? 0)) {
        newErrors.set(entry.server_story.id, `Maximum ${entry.new_chapters_count ?? 0} chapters available`);
      }
    }
    setChapterErrors(newErrors);
  }
  const filteredInvalid = invalid?.filter(e =>
    !q || e.folder.display_name.toLowerCase().includes(q) || e.server_story.title.toLowerCase().includes(q)
  ) ?? [];
  const filteredNoUpdate = data?.no_update_needed.filter(e =>
    !q || e.folder.display_name.toLowerCase().includes(q) || e.server_story.title.toLowerCase().includes(q)
  ) ?? [];
  const filteredNoServerMatch = noServerMatch?.filter(e =>
    !q || e.display_name.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
  ) ?? [];
  const filteredEmptyExtended = emptyExtended?.filter(e =>
    !q || e.display_name.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
  ) ?? [];
  const filteredNoDriveFolder = noDriveFolder?.filter(e =>
    !q || e.server_story.title.toLowerCase().includes(q)
  ) ?? [];

  const updateCount = filteredUpdatable.length;
  const invalidLabel = `Invalid (${filteredInvalid.length})`;
  const noUpdateLabel = `Up-to-Date (${filteredNoUpdate.length})`;
  const noServerLabel = `No Server Match (${filteredNoServerMatch.length})`;
  const emptyLabel = `Empty EXTENDED (${filteredEmptyExtended.length})`;
  const noDriveLabel = `No Drive Folder (${filteredNoDriveFolder.length})`;
  const isUpdatingAny = updatingIds.size > 0;
  const successCount = Array.from(updateResults.values()).filter(r => r.success).length;
  const failedCount = Array.from(updateResults.values()).filter(r => !r.success).length;

  const inputBase = isDark
    ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-amber-500 focus:ring-0'
    : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-amber-500 focus:ring-0';

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
            <button onClick={() => setSearch('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${isDark ? 'text-white/50 hover:text-white/80' : 'text-black/30 hover:text-black/60'}`}>
              <Icon icon={appIcons.close} className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onCheckReaderFinished}
            disabled={loading}
            className={loading ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-danger'}
          >
            <Icon icon={appIcons.users} className="w-4 h-4" />
            Check Reader Finished
          </button>
          <button
            onClick={onCheck}
            disabled={loading}
            className={loading ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}
          >
            {loading ? (
              <>
                <Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Icon icon={appIcons.search} className="w-4 h-4" />
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
                    newErrors.set(entry.server_story.id, `Maximum ${entry.new_chapters_count ?? 0} chapters available`);
                  }
                }
                onRequestUpdateAll(filteredUpdatable, chapterCountInputs, newErrors);
              }}
              disabled={isUpdatingAny || hasChapterErrors}
              className={isUpdatingAny || hasChapterErrors ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}
              style={{ background: 'linear-gradient(135deg, #f59e0b, #ea580c)', boxShadow: '0 4px 16px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.2)' }}
            >
              {isUpdatingAny ? (
                <>
                  <Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />
                  Updating ({isUpdatingAny})
                </>
              ) : (
                <>
                  <Icon icon={appIcons.trends} className="w-4 h-4" />
                  Update All ({updateCount})
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {data && (
        <div className={`flex items-center gap-1 px-4 py-2 ${isDark ? 'bg-white/[0.04] border-b border-white/[0.06]' : 'bg-black/5 border-b border-black/6'}`}>
          <FilterChip label="All" count={filteredUpdatable.length + filteredInvalid.length + filteredNoUpdate.length + filteredNoServerMatch.length + filteredEmptyExtended.length + filteredNoDriveFolder.length} active={filterSection === 'all'} onClick={() => setFilterSection('all')} isDark={isDark} />
          <FilterChip label="Can Update" count={updateCount} active={filterSection === 'ready'} onClick={() => setFilterSection('ready')} variant="amber" isDark={isDark} />
          <FilterChip label="Invalid" count={filteredInvalid.length} active={filterSection === 'invalid'} onClick={() => setFilterSection('invalid')} variant="red" isDark={isDark} />
          <FilterChip label="Up-to-date" count={filteredNoUpdate.length} active={filterSection === 'uptodate'} onClick={() => setFilterSection('uptodate')} isDark={isDark} />
          {filteredNoServerMatch.length > 0 && <FilterChip label="No Server Match" count={filteredNoServerMatch.length} active={filterSection === 'noServerMatch'} onClick={() => setFilterSection('noServerMatch')} isDark={isDark} />}
          {filteredEmptyExtended.length > 0 && <FilterChip label="Empty EXTENDED" count={filteredEmptyExtended.length} active={filterSection === 'emptyExtended'} onClick={() => setFilterSection('emptyExtended')} isDark={isDark} />}
          {filteredNoDriveFolder.length > 0 && <FilterChip label="No Drive Folder" count={filteredNoDriveFolder.length} active={filterSection === 'noDriveFolder'} variant="red" onClick={() => setFilterSection('noDriveFolder')} isDark={isDark} />}
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-3 p-3 lg-glass" style={{ border: isDark ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(239,68,68,0.3)', background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)' }}>
          <Icon icon={appIcons.error} className="w-5 h-5 flex-shrink-0 text-red-400" />
          {error}
        </div>
      )}

      {data && !loading && (
        <div className={`mx-4 mt-3 flex flex-wrap items-center gap-3 px-4 py-2 rounded-xl text-xs ${isDark ? 'bg-white/[0.04]' : 'bg-black/5'}`}>
          {data.all_extended_folders?.length ? (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-white/60' : 'text-black/45'}`}>
            <Icon icon={appIcons.check} className="w-3.5 h-3.5 text-emerald-400" />
              {data.all_extended_folders.length} EXTENDED_
            </div>
          ) : null}
          <StatPill label="can update" value={updateCount} color="#f59e0b" isDark={isDark} />
          <StatPill label="up-to-date" value={filteredNoUpdate.length} color="#818cf8" isDark={isDark} />
          {filteredInvalid.length > 0 && <StatPill label="invalid" value={filteredInvalid.length} color="#f87171" isDark={isDark} />}
          {filteredNoServerMatch.length > 0 && <StatPill label="no server match" value={filteredNoServerMatch.length} color="#94a3b8" isDark={isDark} />}
          {filteredEmptyExtended.length > 0 && <StatPill label="empty EXTENDED" value={filteredEmptyExtended.length} color="#94a3b8" isDark={isDark} />}
          {successCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-emerald-400">
              <Icon icon={appIcons.check} className="w-3.5 h-3.5" />
              {successCount} updated
            </div>
          )}
          {failedCount > 0 && (
            <div className={`ml-auto flex items-center gap-1.5 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              <Icon icon={appIcons.close} className="w-3.5 h-3.5" />
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
              <Icon icon={appIcons.trends} className={`w-8 h-8 ${isDark ? 'text-white/40' : 'text-black/20'}`} />
            }
          />
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 w-full h-full">
            <div className="lg-glass w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <Icon icon={appIcons.spinner} className="w-8 h-8 animate-spin text-amber-400" />
            </div>
            <p className={`text-sm ${isDark ? 'text-white/65' : 'text-black/45'}`}>Checking for updates...</p>
          </div>
        )}

        {data && filterSection === 'all' && (
          <>
            {updateCount > 0 && (
              <div className="mb-4">
                <SectionHeader label={`Ready to Update (${updateCount})`} color="#f59e0b" icon={<Icon icon={appIcons.trends} className="w-4 h-4 text-amber-400" />} />
                <div className="space-y-2">
                  {filteredUpdatable.map((entry: UpdatableStoryEntry) => (
                    <UpdateCard key={entry.server_story.id} entry={entry} storiesNeedingUpdateIds={storiesNeedingUpdateIds} chapterCountInputs={chapterCountInputs} chapterErrors={chapterErrors} updateResults={updateResults} updatingIds={updatingIds} onChapterCountChange={(id: string, val: number) => { setChapterCountInputs(prev => { const next = new Map(prev); next.set(id, val); return next; }); setTimeout(revalidateAllErrors, 0); }} onUpdateSingle={onUpdateSingle} openFilePanels={openFilePanels} toggleFilePanel={toggleFilePanel} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {filteredInvalid.length > 0 && (
              <div className="mb-4">
                <SectionHeader label={invalidLabel} color="#f87171" icon={<Icon icon={appIcons.error} className="w-4 h-4 text-red-400" />} />
                <div className="space-y-2">
                  {filteredInvalid.map(entry => (
                    <InvalidCard key={entry.server_story.id} entry={entry} chapterCountInputs={chapterCountInputs} chapterErrors={chapterErrors} updateResults={updateResults} updatingIds={updatingIds} onChapterCountChange={(id: string, val: number) => { setChapterCountInputs(prev => { const next = new Map(prev); next.set(id, val); return next; }); }} onUpdateSingle={onUpdateSingle} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {filteredNoUpdate.length > 0 && (
              <div>
                <SectionHeader label={noUpdateLabel} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.25)'} icon={<Icon icon={appIcons.checkCircle} className={isDark ? "w-4 h-4 text-white/55" : "w-4 h-4 text-black/25"} />} />
                <div className="space-y-2">
                  {filteredNoUpdate.map(entry => (
                    <UpToDateCard key={entry.server_story.id} entry={entry} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {filteredNoServerMatch.length > 0 && (
              <div className="mt-4">
                <SectionHeader label={noServerLabel} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.25)'} icon={<Icon icon={appIcons.question} className={isDark ? "w-4 h-4 text-white/55" : "w-4 h-4 text-black/25"} />} />
                <div className="space-y-2">
                  {filteredNoServerMatch.map(entry => (
                    <NoMatchCard key={entry.id} entry={entry} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {filteredEmptyExtended.length > 0 && (
              <div className="mt-4">
                <SectionHeader label={emptyLabel} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.25)'} icon={<Icon icon={appIcons.download} className={isDark ? "w-4 h-4 text-white/55" : "w-4 h-4 text-black/25"} />} />
                <div className="space-y-2">
                  {filteredEmptyExtended.map(entry => (
                    <EmptyExtendedCard key={entry.id} entry={entry} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {filteredNoDriveFolder.length > 0 && (
              <div className="mt-4">
                <SectionHeader label={noDriveLabel} color="#fb7185" icon={<Icon icon={appIcons.folder} className="w-4 h-4 text-rose-400" />} />
                <div className="space-y-2">
                  {filteredNoDriveFolder.map(entry => (
                    <NoDriveFolderCard key={entry.server_story.id} entry={entry} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {data && filterSection === 'ready' && updateCount > 0 && (
          <div className="space-y-2">
            {filteredUpdatable.map((entry: UpdatableStoryEntry) => (
              <UpdateCard key={entry.server_story.id} entry={entry} storiesNeedingUpdateIds={storiesNeedingUpdateIds} chapterCountInputs={chapterCountInputs} chapterErrors={chapterErrors} updateResults={updateResults} updatingIds={updatingIds} onChapterCountChange={(id: string, val: number) => { setChapterCountInputs(prev => { const next = new Map(prev); next.set(id, val); return next; }); setTimeout(revalidateAllErrors, 0); }} onUpdateSingle={onUpdateSingle} openFilePanels={openFilePanels} toggleFilePanel={toggleFilePanel} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'invalid' && filteredInvalid.length > 0 && (
          <div className="space-y-2">
            {filteredInvalid.map(entry => (
              <InvalidCard key={entry.server_story.id} entry={entry} chapterCountInputs={chapterCountInputs} chapterErrors={chapterErrors} updateResults={updateResults} updatingIds={updatingIds} onChapterCountChange={(id: string, val: number) => { setChapterCountInputs(prev => { const next = new Map(prev); next.set(id, val); return next; }); }} onUpdateSingle={onUpdateSingle} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'uptodate' && filteredNoUpdate.length > 0 && (
          <div className="space-y-2">
            {filteredNoUpdate.map(entry => (
              <UpToDateCard key={entry.server_story.id} entry={entry} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'noServerMatch' && filteredNoServerMatch.length > 0 && (
          <div className="space-y-2">
            {filteredNoServerMatch.map(entry => (
              <NoMatchCard key={entry.id} entry={entry} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'emptyExtended' && filteredEmptyExtended.length > 0 && (
          <div className="space-y-2">
            {filteredEmptyExtended.map(entry => (
              <EmptyExtendedCard key={entry.id} entry={entry} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'noDriveFolder' && filteredNoDriveFolder.length > 0 && (
          <div className="space-y-2">
            {filteredNoDriveFolder.map(entry => (
              <NoDriveFolderCard key={entry.server_story.id} entry={entry} isDark={isDark} />
            ))}
          </div>
        )}

        {data && (
          ((filterSection === 'ready' && updateCount === 0) ||
            (filterSection === 'invalid' && filteredInvalid.length === 0) ||
            (filterSection === 'uptodate' && filteredNoUpdate.length === 0) ||
            (filterSection === 'noServerMatch' && filteredNoServerMatch.length === 0) ||
            (filterSection === 'emptyExtended' && filteredEmptyExtended.length === 0) ||
            (filterSection === 'noDriveFolder' && filteredNoDriveFolder.length === 0)) && (
            <div className={`text-center py-8 ${isDark ? 'text-white/75' : 'text-black/35'}`}>
              <Icon icon={appIcons.checkCircle} className={`w-8 h-8 mx-auto mb-2 ${isDark ? 'text-white/40' : 'text-black/15'}`} />
              <p className="text-sm">No items in this section</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function FilterChip({ label, count, active, onClick, variant, isDark = false }: { label: string; count: number; active: boolean; onClick: () => void; variant?: 'amber' | 'red'; isDark?: boolean }) {
  const colors = variant === 'amber' ? { active: 'rgba(245,158,11,0.15)', activeText: isDark ? '#fbbf24' : '#b45309', inactive: 'text-white/75' }
    : variant === 'red' ? { active: 'rgba(248,113,113,0.15)', activeText: isDark ? '#f87171' : '#b91c1c', inactive: 'text-white/75' }
    : { active: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', activeText: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)', inactive: isDark ? 'text-white/75' : 'text-black/30' };

  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200`}
      style={{
        background: active ? colors.active : 'transparent',
        color: active ? colors.activeText : colors.inactive,
        border: active ? 'none' : 'none',
      }}
    >
      {label} ({count})
    </button>
  );
}

function StatPill({ label, value, color, isDark = false }: { label: string; value: number; color: string; isDark?: boolean }) {
  return (
    <div className="flex items-center gap-1.5" style={{ color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)' }}>
      <Icon icon={appIcons.check} className="w-3.5 h-3.5" style={{ color }} />
      {value} {label}
    </div>
  );
}

function SectionHeader({ label, color, icon }: { label: string; color: string; icon: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color }}>
      {icon}
      {label}
    </h3>
  );
}

function UpdateCard({ entry, storiesNeedingUpdateIds, chapterCountInputs, chapterErrors, updateResults, updatingIds, onChapterCountChange, onUpdateSingle, openFilePanels, toggleFilePanel, isDark }: any) {
  const newCount = entry.new_chapters_count ?? 0;
  const result = updateResults.get(entry.server_story.id);
  const isUpdating = updatingIds.has(entry.server_story.id);
  const isSuccess = result?.success;
  const isFailed = result && !result.success;
  const isReadersFinished = storiesNeedingUpdateIds.has(entry.server_story.id);
  const inputVal = chapterCountInputs.get(entry.server_story.id) ?? 1;
  const errMsg = chapterErrors.get(entry.server_story.id);
  const dm = isDark ? 'text-white' : 'text-black';
  const dm60 = isDark ? 'text-white/60' : 'text-black/40';
  const dm45 = isDark ? 'text-white/45' : 'text-black/25';

  return (
    <div className="lg-glass-card p-4" style={{ border: isReadersFinished ? (isDark ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(245,158,11,0.3)') : undefined }}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-black/85'}`}>{entry.folder.display_name}</h4>
            {newCount > 0 && <span className="lg-chip lg-chip-amber">+{newCount} ch</span>}
            {isReadersFinished && <span className="lg-chip" style={{ background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)', color: '#fbbf24' }}>Readers Finished</span>}
            {entry.has_free_md && (() => {
              const key = `${entry.server_story.id}:free.md`;
              const panel = openFilePanels.get(key);
              const isOpen = !!panel;
              return (
                <button onClick={() => toggleFilePanel(entry.server_story.id, 'free.md', entry.folder.id)} className="lg-chip lg-chip-blue" style={{ cursor: 'pointer' }}>
                  Free.md {isOpen ? '▲' : '▼'}
                </button>
              );
            })()}
            {entry.has_tags_md && (() => {
              const key = `${entry.server_story.id}:tags.md`;
              const panel = openFilePanels.get(key);
              const isOpen = !!panel;
              return (
                <button onClick={() => toggleFilePanel(entry.server_story.id, 'tags.md', entry.folder.id)} className="lg-chip" style={{ background: 'rgba(139,92,246,0.15)', borderColor: 'rgba(139,92,246,0.3)', color: '#a78bfa' }}>
                  Tags.md {isOpen ? '▲' : '▼'}
                </button>
              );
            })()}
          </div>
          {entry.has_free_md && (() => {
            const key = `${entry.server_story.id}:free.md`;
            const panel = openFilePanels.get(key);
            if (!panel) return null;
            return (
              <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                {panel.loading ? <span className={`text-[10px] ${dm60}`}>Loading...</span>
                  : panel.data?.success ? panel.data.content ? <span className="lg-chip lg-chip-blue">{panel.data.content.trim()}</span> : <span className={`text-[10px] ${dm60}`}>Empty file</span>
                    : <span className="text-[10px] text-red-400">{panel.data?.error ?? 'Failed to load'}</span>}
              </div>
            );
          })()}
          {entry.has_tags_md && (() => {
            const key = `${entry.server_story.id}:tags.md`;
            const panel = openFilePanels.get(key);
            if (!panel) return null;
            const raw = panel.data?.success ? panel.data.content : '';
            const tagItems = raw ? raw.split(/[,\n]/).map((t: string) => t.trim().replace(/^["']|["']$/g, '')).filter((t: string) => t && !t.startsWith('#')) : [];
            return (
              <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                {panel.loading ? <span className={`text-[10px] ${dm60}`}>Loading...</span>
                  : tagItems.length > 0 ? tagItems.map((tag: string, i: number) => <span key={i} className="lg-chip" style={{ background: 'rgba(139,92,246,0.12)', borderColor: 'rgba(139,92,246,0.25)', color: '#a78bfa' }}>{tag}</span>)
                    : <span className={`text-[10px] ${dm60}`}>Empty file</span>}
              </div>
            );
          })()}
          <p className={`text-xs font-mono mb-2 ${dm60}`}>{entry.folder.name}</p>
          <div className="flex items-center gap-3 text-xs">
            <div className={`flex items-center gap-1.5 ${dm45}`}><span>Server:</span><span className={`font-semibold ${dm}`}>{entry.server_story.maxChapter}</span></div>
            <Icon icon={appIcons.external} className={`w-3 h-3 ${dm45}`} />
            <div className={`flex items-center gap-1.5 ${dm45}`}><span>Drive:</span><span className={`font-semibold ${dm}`}>{entry.folder.extended_chapter_count ?? 0}</span></div>
          </div>
          <div className="text-xs mt-1">
            {entry.last_updated ? <span className={dm60}>{formatDate(entry.last_updated!)}</span> : <span className={dm60}>Never updated</span>}
          </div>
          {result && <p className={`text-xs mt-1.5 flex items-center gap-1 ${isSuccess ? 'text-emerald-400' : isFailed ? 'text-red-400' : ''}`}>{isSuccess && <Icon icon={appIcons.check} className="w-3.5 h-3.5" />}{isFailed && <Icon icon={appIcons.close} className="w-3.5 h-3.5" />}{result.message}</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs ${dm45}`}>Chapters:</span>
            <input
              type="number"
              min={newCount}
              value={inputVal}
              onChange={e => onChapterCountChange(entry.server_story.id, parseInt(e.target.value) || 1)}
              className={`w-16 px-2 py-1.5 text-xs rounded-lg border text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${isDark ? 'bg-white/[0.06] border-white/20 text-white' : 'bg-black/4 border-black/10 text-black/80'}`}
            />
          </div>
          {errMsg && <p className="text-[10px] text-red-400 text-right">{errMsg}</p>}
          <button
            onClick={() => {
              const count = inputVal;
              onUpdateSingle(entry, count);
            }}
            disabled={isUpdating || isSuccess}
            className={isUpdating ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : isSuccess ? 'lg-chip lg-chip-green' : 'lg-btn-primary'}
            style={!isUpdating && !isSuccess ? { background: 'linear-gradient(135deg, #f59e0b, #ea580c)', boxShadow: '0 4px 16px rgba(245,158,11,0.35)', color: 'white' } : undefined}
          >
            {isUpdating ? <><Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />Updating...</> : isSuccess ? <><Icon icon={appIcons.check} className="w-4 h-4" />Updated</> : <><Icon icon={appIcons.trends} className="w-4 h-4" />Update</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function InvalidCard({ entry, isDark }: any) {
  const dm45 = isDark ? 'text-white/45' : 'text-black/25';
  const dm60 = isDark ? 'text-white/60' : 'text-black/40';
  return (
    <div className="lg-glass-card p-4" style={{ border: isDark ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(239,68,68,0.25)', background: isDark ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.03)' }}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-red-300' : 'text-red-700'}`}>{entry.folder.display_name}</h4>
          </div>
          <p className={`text-xs font-mono mb-2 ${dm60}`}>{entry.folder.name}</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {entry.folder.validation_errors.map((err: string, i: number) => <ValidationErrorBadge key={i} error={err} isDark={isDark} />)}
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className={`flex items-center gap-1.5 ${dm45}`}><span>Server:</span><span className={`font-semibold ${isDark ? 'text-white' : 'text-black/65'}`}>{entry.server_story.maxChapter}</span></div>
            <Icon icon={appIcons.external} className={`w-3 h-3 ${dm45}`} />
            <div className={`flex items-center gap-1.5 ${dm45}`}><span>Drive:</span><span className={`font-semibold ${isDark ? 'text-white' : 'text-black/65'}`}>{entry.folder.extended_chapter_count ?? 0}</span></div>
          </div>
        </div>
        <span className="lg-chip lg-chip-red self-start">Cannot Update</span>
      </div>
    </div>
  );
}

function UpToDateCard({ entry, isDark }: any) {
  const dm = isDark ? 'text-white' : 'text-black';
  const dm45 = isDark ? 'text-white/45' : 'text-black/25';
  const dm60 = isDark ? 'text-white/60' : 'text-black/40';
  return (
    <div className="lg-glass-card p-4" style={{ opacity: 0.85 }}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-medium truncate mb-1 ${dm}`}>{entry.folder.display_name}</h4>
          <p className={`text-xs font-mono ${dm60}`}>{entry.folder.name}</p>
          <div className="flex items-center gap-3 text-xs mt-1.5">
            <div className={`flex items-center gap-1.5 ${dm45}`}><span>Server:</span><span className={`font-semibold ${dm}`}>{entry.server_story.maxChapter}</span></div>
            <Icon icon={appIcons.external} className={`w-3 h-3 ${dm45}`} />
            <div className={`flex items-center gap-1.5 ${dm45}`}><span>Drive:</span><span className={`font-semibold ${dm}`}>{entry.folder.extended_chapter_count ?? 0}</span></div>
          </div>
        </div>
        <span className="lg-chip" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)' }}>Up-to-date</span>
      </div>
    </div>
  );
}

function NoMatchCard({ entry, isDark }: any) {
  const dm = isDark ? 'text-white' : 'text-black';
  const dm45 = isDark ? 'text-white/45' : 'text-black/25';
  const dm60 = isDark ? 'text-white/60' : 'text-black/40';
  return (
    <div className="lg-glass-card p-4" style={{ opacity: 0.85 }}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-medium truncate mb-1 ${dm}`}>{entry.display_name}</h4>
          <p className={`text-xs font-mono ${dm60}`}>{entry.name}</p>
          <div className={`text-xs mt-1.5 ${dm45}`}>No matching story found on the server</div>
        </div>
        <span className="lg-chip" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)' }}>No Server Match</span>
      </div>
    </div>
  );
}

function EmptyExtendedCard({ entry, isDark }: any) {
  const dm = isDark ? 'text-white' : 'text-black';
  const dm45 = isDark ? 'text-white/45' : 'text-black/25';
  const dm60 = isDark ? 'text-white/60' : 'text-black/40';
  return (
    <div className="lg-glass-card p-4" style={{ opacity: 0.85 }}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-medium truncate mb-1 ${dm}`}>{entry.display_name}</h4>
          <p className={`text-xs font-mono ${dm60}`}>{entry.name}</p>
          <div className={`text-xs mt-1.5 ${dm45}`}>EXTENDED subfolder is empty</div>
        </div>
        <span className="lg-chip" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)' }}>Empty EXTENDED</span>
      </div>
    </div>
  );
}

function NoDriveFolderCard({ entry, isDark }: any) {
  const dm60 = isDark ? 'text-white/60' : 'text-black/40';
  return (
    <div className="lg-glass-card p-4" style={{ border: isDark ? '1px solid rgba(251,113,133,0.2)' : '1px solid rgba(251,113,133,0.25)', background: isDark ? 'rgba(251,113,133,0.05)' : 'rgba(251,113,133,0.03)' }}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>{entry.server_story.title}</h4>
            <span className="lg-chip" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)' }}>Server: ch {entry.server_story.maxChapter}</span>
          </div>
          <div className={`text-xs ${dm60}`}>
            {entry.last_updated ? <span>Last updated: {formatDate(entry.last_updated!)} · </span> : <span>Never updated · </span>}No matching EXTENDED_ folder found on Drive
          </div>
        </div>
        <span className="lg-chip lg-chip-red self-start">No Drive Folder</span>
      </div>
    </div>
  );
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// Needed for setChapterErrors reference
