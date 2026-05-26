import { useState, useEffect } from 'react';
import {
  type CheckUpdatableResponse,
  type UpdatableStoryEntry,
  type DriveFolderEntry,
  getDriveFileContent,
  type DriveFileContentResponse,
} from '../api/client';
import { type ThemeMode } from './ThemeToggle';
import { ValidationErrorBadge, EmptyState } from './SyncTabShared';

interface UpdateTabProps {
  data: CheckUpdatableResponse | null;
  loading: boolean;
  error: string;
  updateResults: Map<string, { success: boolean; message: string }>;
  updatingIds: Set<string>;
  onCheck: () => void;
  onUpdateSingle: (entry: UpdatableStoryEntry, chaptersCount?: number) => Promise<string>;
  onRequestUpdateAll: (entries: UpdatableStoryEntry[], chapterInputs: Map<string, number>, newErrors?: Map<string, string>) => void;
  hasChapterErrors: boolean;
  onChapterErrorsChange: (hasErrors: boolean) => void;
  invalid?: UpdatableStoryEntry[];
  noServerMatch?: DriveFolderEntry[];
  emptyExtended?: DriveFolderEntry[];
  themeMode: ThemeMode;
}

export function UpdateTab({
  data,
  loading,
  error,
  updateResults,
  updatingIds,
  onCheck,
  onUpdateSingle,
  onRequestUpdateAll,
  hasChapterErrors,
  onChapterErrorsChange,
  invalid,
  noServerMatch,
  emptyExtended,
  themeMode,
}: UpdateTabProps) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState<'all' | 'ready' | 'invalid' | 'uptodate' | 'noServerMatch' | 'emptyExtended'>('invalid');
  const [chapterCountInputs, setChapterCountInputs] = useState<Map<string, number>>(new Map());
  const [chapterErrors, setChapterErrors] = useState<Map<string, string>>(new Map());
  const [openFilePanels, setOpenFilePanels] = useState<Map<string, { loading: boolean; data: DriveFileContentResponse | null }>>(new Map());

  useEffect(() => {
    onChapterErrorsChange(chapterErrors.size > 0);
  }, [chapterErrors.size, onChapterErrorsChange]);

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

  const filteredUpdatable = data?.updatable.filter(e =>
    !q || e.folder.display_name.toLowerCase().includes(q) || e.server_story.title.toLowerCase().includes(q)
  ) ?? [];

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

  const updateCount = filteredUpdatable.length;
  const isUpdatingAny = updatingIds.size > 0;
  const successCount = Array.from(updateResults.values()).filter(r => r.success).length;
  const failedCount = Array.from(updateResults.values()).filter(r => !r.success).length;

  return (
    <div className="flex flex-col min-h-[400px]">
      <div className={`flex flex-col sm:flex-row gap-3 p-4 sticky top-0 z-10 ${isDark ? 'bg-slate-900/95 backdrop-blur-sm border-b border-slate-800/60' : 'bg-white/95 backdrop-blur-sm border-b border-gray-200'}`}>
        <div className="relative flex-1 min-w-0">
          <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition-colors
              ${isDark
                ? 'bg-slate-800/60 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'
                : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'
              }`}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-400 hover:text-gray-600'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onCheck}
            disabled={loading}
            className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${loading
                ? isDark
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : isDark
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
              }`}
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin-ccw" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Scanning...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
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
              className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${isUpdatingAny || hasChapterErrors
                  ? isDark
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : isDark
                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                    : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                }`}
            >
              {isUpdatingAny ? (
                <>
                  <svg className="w-4 h-4 animate-spin-ccw" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Updating ({isUpdatingAny})
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Update All ({updateCount})
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {data && (
        <div className={`flex items-center gap-1 px-4 py-2 ${isDark ? 'bg-slate-900/60 border-b border-slate-800/60' : 'bg-gray-50/50 border-b border-gray-200'}`}>
          <button
            onClick={() => setFilterSection('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterSection === 'all'
                ? isDark ? 'bg-slate-800 text-slate-200' : 'bg-white text-gray-700 shadow-sm'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            All ({filteredUpdatable.length + filteredInvalid.length + filteredNoUpdate.length + filteredNoServerMatch.length + filteredEmptyExtended.length})
          </button>
          <button
            onClick={() => setFilterSection('ready')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterSection === 'ready'
                ? isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-50 text-amber-700'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            Can Update ({updateCount})
          </button>
          <button
            onClick={() => setFilterSection('invalid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterSection === 'invalid'
                ? isDark ? 'bg-red-900/40 text-red-400' : 'bg-red-50 text-red-700'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            Invalid ({filteredInvalid.length})
          </button>
          <button
            onClick={() => setFilterSection('uptodate')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterSection === 'uptodate'
                ? isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-700'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            Up-to-date ({filteredNoUpdate.length})
          </button>
          {filteredNoServerMatch.length > 0 && (
            <button
              onClick={() => setFilterSection('noServerMatch')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterSection === 'noServerMatch'
                  ? isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-700'
                  : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              No Server Match ({filteredNoServerMatch.length})
            </button>
          )}
          {filteredEmptyExtended.length > 0 && (
            <button
              onClick={() => setFilterSection('emptyExtended')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterSection === 'emptyExtended'
                  ? isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-700'
                  : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              Empty EXTENDED ({filteredEmptyExtended.length})
            </button>
          )}
        </div>
      )}

      {error && (
        <div className={`mx-4 mt-3 flex items-center gap-3 p-3 rounded-xl text-sm ${isDark ? 'bg-red-900/20 border border-red-800/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {error}
        </div>
      )}

      {data && !loading && (
        <div className={`mx-4 mt-3 flex flex-wrap items-center gap-3 px-4 py-2 rounded-xl text-xs ${isDark ? 'bg-slate-900/60' : 'bg-white border border-gray-200'}`}>
          {data.all_extended_folders?.length ? (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {data.all_extended_folders.length} EXTENDED_
            </div>
          ) : null}
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
            <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            {updateCount} can update
          </div>
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
            <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {filteredNoUpdate.length} up-to-date
          </div>
          {filteredInvalid.length > 0 && (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {filteredInvalid.length} invalid
            </div>
          )}
          {filteredNoServerMatch.length > 0 && (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {filteredNoServerMatch.length} no server match
            </div>
          )}
          {filteredEmptyExtended.length > 0 && (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15v4c0 1.1.896 2 2 2h14a2 2 0 002-2v-4M17 9l-5 5-5-5M12 12.8V2.5" />
              </svg>
              {filteredEmptyExtended.length} empty EXTENDED
            </div>
          )}
          {successCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-emerald-500">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {successCount} updated
            </div>
          )}
          {failedCount > 0 && (
            <div className={`ml-auto flex items-center gap-1.5 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {failedCount} failed
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Check Updates' to scan for stories with new chapters to sync."
            icon={
              <svg className={`w-8 h-8 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
          />
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-slate-900/60' : 'bg-gray-100'}`}>
              <svg className="w-8 h-8 animate-spin-ccw text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Checking for updates...</p>
          </div>
        )}

        {data && filterSection === 'all' && (
          <>
            {updateCount > 0 && (
              <div className="mb-4">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Ready to Update ({updateCount})
                </h3>
                <div className="space-y-2">
                  {filteredUpdatable.map((entry: UpdatableStoryEntry) => {
                    const newCount = entry.new_chapters_count ?? 0;
                    const result = updateResults.get(entry.server_story.id);
                    const isUpdating = updatingIds.has(entry.server_story.id);
                    const isSuccess = result?.success;
                    const isFailed = result && !result.success;

                    return (
                      <div key={entry.server_story.id} className={`p-4 rounded-xl border ${isDark ? 'bg-slate-900/40 border-slate-800/60' : 'bg-white border-gray-200'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h4 className={`text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>{entry.folder.display_name}</h4>
                              {newCount > 0 && (
                                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>
                                  +{newCount} ch
                                </span>
                              )}
                              {entry.has_free_md && (() => {
                                const key = `${entry.server_story.id}:free.md`;
                                const panel = openFilePanels.get(key);
                                const isOpen = !!panel;
                                return (
                                  <button
                                    onClick={() => toggleFilePanel(entry.server_story.id, 'free.md', entry.folder.id)}
                                    className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${isOpen
                                        ? isDark ? 'bg-cyan-600 text-white' : 'bg-cyan-500 text-white'
                                        : isDark ? 'bg-cyan-900/40 text-cyan-400 hover:bg-cyan-800/50' : 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200'
                                      }`}
                                  >
                                    Free.md {isOpen ? '▲' : '▼'}
                                  </button>
                                );
                              })()}
                              {entry.has_tags_md && (() => {
                                const key = `${entry.server_story.id}:tags.md`;
                                const panel = openFilePanels.get(key);
                                const isOpen = !!panel;
                                return (
                                  <button
                                    onClick={() => toggleFilePanel(entry.server_story.id, 'tags.md', entry.folder.id)}
                                    className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${isOpen
                                        ? isDark ? 'bg-purple-600 text-white' : 'bg-purple-500 text-white'
                                        : isDark ? 'bg-purple-900/40 text-purple-400 hover:bg-purple-800/50' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                      }`}
                                  >
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
                                  {panel.loading ? (
                                    <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Loading...</span>
                                  ) : panel.data?.success ? (
                                    panel.data.content ? (
                                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${isDark ? 'bg-cyan-900/50 border-cyan-700/50 text-cyan-300' : 'bg-cyan-50 border-cyan-200 text-cyan-700'}`}>
                                        Free chapters: {panel.data.content.trim()}
                                      </span>
                                    ) : (
                                      <span className={`text-[10px] ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>Empty file</span>
                                    )
                                  ) : (
                                    <span className="text-[10px] text-red-500">{panel.data?.error ?? 'Failed to load'}</span>
                                  )}
                                </div>
                              );
                            })()}
                            {entry.has_tags_md && (() => {
                              const key = `${entry.server_story.id}:tags.md`;
                              const panel = openFilePanels.get(key);
                              if (!panel) return null;
                              const raw = panel.data?.success ? panel.data.content : '';
                              const tagItems = raw
                                ? raw.split(/[,\n]/)
                                    .map(t => t.trim().replace(/^["']|["']$/g, ''))
                                    .filter(t => t && !t.startsWith('#'))
                                : [];
                              return (
                                <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                                  {panel.loading ? (
                                    <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Loading...</span>
                                  ) : tagItems.length > 0 ? (
                                    tagItems.map((tag, i) => (
                                      <span key={i} className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${isDark ? 'bg-purple-900/50 border-purple-700/50 text-purple-300' : 'bg-purple-50 border-purple-200 text-purple-700'}`}>
                                        {tag}
                                      </span>
                                    ))
                                  ) : (
                                    <span className={`text-[10px] ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>Empty file</span>
                                  )}
                                </div>
                              );
                            })()}
                            <p className={`text-xs font-mono mb-2 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.folder.name}</p>
                            <div className="flex items-center gap-3 text-xs">
                              <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                                <span>Server:</span>
                                <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                              </div>
                              <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                              </svg>
                              <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                                <span>Drive:</span>
                                <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                              </div>
                            </div>
                            {result && (
                              <p className={`text-xs mt-1.5 flex items-center gap-1 ${isSuccess ? 'text-emerald-500' : isFailed ? 'text-red-500' : ''}`}>
                                {isSuccess && (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    {result.message}
                                  </>
                                )}
                                {isFailed && (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    {result.message}
                                  </>
                                )}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Chapters:</span>
                              <input
                                type="number"
                                min={1}
                                defaultValue={1}
                                onChange={e => {
                                  const val = parseInt(e.target.value, 10);
                              setChapterCountInputs(prev => {
                                const next = new Map(prev);
                                next.set(entry.server_story.id, isNaN(val) || val < 1 ? 1 : val);
                                return next;
                              });
                              setTimeout(revalidateAllErrors, 0);
                            }}
                                className={`w-16 px-2 py-1.5 text-xs rounded-lg border text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${isDark
                                    ? 'bg-slate-800 border-slate-700 text-slate-200 focus:outline-none focus:border-amber-500'
                                    : 'bg-white border-gray-300 text-gray-800 focus:outline-none focus:border-amber-500'
                                  }`}
                              />
                            </div>
                            {(() => {
                              const err = chapterErrors.get(entry.server_story.id);
                              if (!err) return null;
                              return (
                                <p className="text-[10px] text-red-400 text-right">{err}</p>
                              );
                            })()}
                            <button
                              onClick={() => {
                                const count = chapterCountInputs.get(entry.server_story.id) ?? 1;
                                if (count > (entry.new_chapters_count ?? 0)) {
                                  setChapterErrors(prev => {
                                    const next = new Map(prev);
                                    next.set(entry.server_story.id, `Maximum ${entry.new_chapters_count ?? 0} chapters available`);
                                    return next;
                                  });
                                  return;
                                }
                                setChapterErrors(prev => {
                                  const next = new Map(prev);
                                  next.delete(entry.server_story.id);
                                  return next;
                                });
                                onUpdateSingle(entry, count);
                              }}
                              disabled={isUpdating || isSuccess}
                            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${isUpdating
                                ? isDark
                                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                : isSuccess
                                  ? isDark
                                    ? 'bg-emerald-900/40 text-emerald-400 cursor-default'
                                    : 'bg-emerald-50 text-emerald-600 cursor-default'
                                  : isDark
                                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                                    : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                              }`}
                          >
                            {isUpdating ? (
                              <>
                                <svg className="w-4 h-4 animate-spin-ccw" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Updating...
                              </>
                            ) : isSuccess ? (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Updated
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                                Update
                              </>
                            )}
                          </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {filteredInvalid.length > 0 && (
              <div className="mb-4">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Invalid ({filteredInvalid.length})
                </h3>
                <div className="space-y-2">
                  {filteredInvalid.map(entry => (
                    <div key={entry.server_story.id} className={`p-4 rounded-xl border ${isDark ? 'bg-red-950/20 border-red-800/30' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-red-300' : 'text-red-700'}`}>{entry.folder.display_name}</h4>
                          </div>
                          <p className={`text-xs font-mono mb-2 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>{entry.folder.name}</p>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {entry.folder.validation_errors.map((err, i) => (
                              <ValidationErrorBadge key={i} error={err} isDark={isDark} />
                            ))}
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                              <span>Server:</span>
                              <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                            </div>
                            <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                            </svg>
                            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                              <span>Drive:</span>
                              <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-lg self-start ${isDark ? 'text-red-400 bg-red-900/40 border border-red-800/40' : 'text-red-600 bg-red-100 border border-red-200'}`}>
                          Cannot Update
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filteredNoUpdate.length > 0 && (
              <div>
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Up-to-Date ({filteredNoUpdate.length})
                </h3>
                <div className="space-y-2">
                  {filteredNoUpdate.map(entry => (
                    <div key={entry.server_story.id} className={`p-4 rounded-xl ${isDark ? 'bg-slate-900/20 border border-slate-800/40' : 'bg-gray-50 border border-gray-200'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-sm font-medium truncate mb-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.folder.display_name}</h4>
                          <p className={`text-xs font-mono ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>{entry.folder.name}</p>
                          <div className="flex items-center gap-3 text-xs mt-1.5">
                            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-500' : 'text-gray-600'}`}>
                              <span>Server:</span>
                              <span className={`font-semibold ${isDark ? 'text-slate-400' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                            </div>
                            <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                            </svg>
                            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-500' : 'text-gray-600'}`}>
                              <span>Drive:</span>
                              <span className={`font-semibold ${isDark ? 'text-slate-400' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`px-3 py-1 text-xs font-medium rounded-lg ${isDark ? 'text-slate-500 bg-slate-800/60' : 'text-gray-500 bg-gray-200'}`}>
                          Up-to-date
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {data && filterSection === 'ready' && updateCount > 0 && (
          <div className="space-y-2">
            {filteredUpdatable.map((entry: UpdatableStoryEntry) => {
              const newCount = entry.new_chapters_count ?? 0;
              const result = updateResults.get(entry.server_story.id);
              const isUpdating = updatingIds.has(entry.server_story.id);
              const isSuccess = result?.success;

              return (
                <div key={entry.server_story.id} className={`p-4 rounded-xl border ${isDark ? 'bg-slate-900/40 border-slate-800/60' : 'bg-white border-gray-200'}`}>
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h4 className={`text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>{entry.folder.display_name}</h4>
                        {newCount > 0 && (
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>
                            +{newCount} ch
                          </span>
                        )}
                        {entry.has_free_md && (() => {
                          const key = `${entry.server_story.id}:free.md`;
                          const panel = openFilePanels.get(key);
                          const isOpen = !!panel;
                          return (
                            <button
                              onClick={() => toggleFilePanel(entry.server_story.id, 'free.md', entry.folder.id)}
                              className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${isOpen
                                  ? isDark ? 'bg-cyan-600 text-white' : 'bg-cyan-500 text-white'
                                  : isDark ? 'bg-cyan-900/40 text-cyan-400 hover:bg-cyan-800/50' : 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200'
                                }`}
                            >
                              Free.md {isOpen ? '▲' : '▼'}
                            </button>
                          );
                        })()}
                        {entry.has_tags_md && (() => {
                          const key = `${entry.server_story.id}:tags.md`;
                          const panel = openFilePanels.get(key);
                          const isOpen = !!panel;
                          return (
                            <button
                              onClick={() => toggleFilePanel(entry.server_story.id, 'tags.md', entry.folder.id)}
                              className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${isOpen
                                  ? isDark ? 'bg-purple-600 text-white' : 'bg-purple-500 text-white'
                                  : isDark ? 'bg-purple-900/40 text-purple-400 hover:bg-purple-800/50' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                }`}
                            >
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
                            {panel.loading ? (
                              <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Loading...</span>
                            ) : panel.data?.success ? (
                              panel.data.content ? (
                                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${isDark ? 'bg-cyan-900/50 border-cyan-700/50 text-cyan-300' : 'bg-cyan-50 border-cyan-200 text-cyan-700'}`}>
                                  Free chapters: {panel.data.content.trim()}
                                </span>
                              ) : (
                                <span className={`text-[10px] ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>Empty file</span>
                              )
                            ) : (
                              <span className="text-[10px] text-red-500">{panel.data?.error ?? 'Failed to load'}</span>
                            )}
                          </div>
                        );
                      })()}
                      {entry.has_tags_md && (() => {
                        const key = `${entry.server_story.id}:tags.md`;
                        const panel = openFilePanels.get(key);
                        if (!panel) return null;
                        const raw = panel.data?.success ? panel.data.content : '';
                        const tagItems = raw
                          ? raw.split(/[,\n]/)
                              .map(t => t.trim().replace(/^["']|["']$/g, ''))
                              .filter(t => t && !t.startsWith('#'))
                          : [];
                        return (
                          <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                            {panel.loading ? (
                              <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Loading...</span>
                            ) : tagItems.length > 0 ? (
                              tagItems.map((tag, i) => (
                                <span key={i} className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${isDark ? 'bg-purple-900/50 border-purple-700/50 text-purple-300' : 'bg-purple-50 border-purple-200 text-purple-700'}`}>
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className={`text-[10px] ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>Empty file</span>
                            )}
                          </div>
                        );
                      })()}
                      <p className={`text-xs font-mono mb-2 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.folder.name}</p>
                      <div className="flex items-center gap-3 text-xs">
                        <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                          <span>Server:</span>
                          <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                        </div>
                        <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                        <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                          <span>Drive:</span>
                          <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                        </div>
                      </div>
                      {result && (
                        <p className={`text-xs mt-1.5 ${isSuccess ? 'text-emerald-500' : 'text-red-500'}`}>
                          {result.message}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Chapters:</span>
                        <input
                          type="number"
                          min={1}
                          defaultValue={1}
                          onChange={e => {
                            const val = parseInt(e.target.value, 10);
                              setChapterCountInputs(prev => {
                                const next = new Map(prev);
                                next.set(entry.server_story.id, isNaN(val) || val < 1 ? 1 : val);
                                return next;
                              });
                              setTimeout(revalidateAllErrors, 0);
                            }}
                                className={`w-16 px-2 py-1.5 text-xs rounded-lg border text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${isDark
                                    ? 'bg-slate-800 border-slate-700 text-slate-200 focus:outline-none focus:border-amber-500'
                                    : 'bg-white border-gray-300 text-gray-800 focus:outline-none focus:border-amber-500'
                                  }`}
                        />
                      </div>
                      {(() => {
                        const err = chapterErrors.get(entry.server_story.id);
                        if (!err) return null;
                        return (
                          <p className="text-[10px] text-red-400 text-right">{err}</p>
                        );
                      })()}
                      <button
                              onClick={() => {
                                const count = chapterCountInputs.get(entry.server_story.id) ?? 1;
                                if (count > (entry.new_chapters_count ?? 0)) {
                                  setChapterErrors(prev => {
                                    const next = new Map(prev);
                                    next.set(entry.server_story.id, `Maximum ${entry.new_chapters_count ?? 0} chapters available`);
                                    return next;
                                  });
                                  return;
                                }
                                setChapterErrors(prev => {
                                  const next = new Map(prev);
                                  next.delete(entry.server_story.id);
                                  return next;
                                });
                                onUpdateSingle(entry, count);
                              }}
                              disabled={isUpdating || isSuccess}
                        className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${isUpdating
                            ? isDark
                              ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                            : isSuccess
                              ? isDark
                                ? 'bg-emerald-900/40 text-emerald-400 cursor-default'
                                : 'bg-emerald-50 text-emerald-600 cursor-default'
                              : isDark
                                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                                : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                          }`}
                      >
                      {isUpdating ? (
                        <>
                          <svg className="w-4 h-4 animate-spin-ccw" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Updating...
                        </>
                      ) : isSuccess ? (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Updated
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                          </svg>
                          Update
                        </>
                      )}
                    </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data && filterSection === 'invalid' && filteredInvalid.length > 0 && (
          <div className="space-y-2">
            {filteredInvalid.map(entry => (
              <div key={entry.server_story.id} className={`p-4 rounded-xl border ${isDark ? 'bg-red-950/20 border-red-800/30' : 'bg-red-50 border-red-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {entry.folder.validation_errors.map((err, i) => (
                        <ValidationErrorBadge key={i} error={err} isDark={isDark} />
                      ))}
                    </div>
                    <h4 className={`text-sm font-medium truncate mb-1 ${isDark ? 'text-red-300' : 'text-red-700'}`}>{entry.folder.display_name}</h4>
                    <p className={`text-xs font-mono ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>{entry.folder.name}</p>
                    <div className="flex items-center gap-3 text-xs mt-1.5">
                      <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                        <span>Server:</span>
                        <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                      </div>
                      <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                      <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                        <span>Drive:</span>
                        <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                      </div>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-lg self-start ${isDark ? 'text-red-400 bg-red-900/40 border border-red-800/40' : 'text-red-600 bg-red-100 border border-red-200'}`}>
                    Cannot Update
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && filterSection === 'uptodate' && filteredNoUpdate.length > 0 && (
          <div className="space-y-2">
            {filteredNoUpdate.map(entry => (
              <div key={entry.server_story.id} className={`p-4 rounded-xl ${isDark ? 'bg-slate-900/20 border border-slate-800/40' : 'bg-gray-50 border border-gray-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className={`text-sm font-medium truncate mb-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.folder.display_name}</h4>
                    <p className={`text-xs font-mono ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>{entry.folder.name}</p>
                    <div className="flex items-center gap-3 text-xs mt-1.5">
                      <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-500' : 'text-gray-600'}`}>
                        <span>Server:</span>
                        <span className={`font-semibold ${isDark ? 'text-slate-400' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                      </div>
                      <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                      <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-500' : 'text-gray-600'}`}>
                        <span>Drive:</span>
                        <span className={`font-semibold ${isDark ? 'text-slate-400' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                      </div>
                    </div>
                  </div>
                  <span className={`px-3 py-1 text-xs font-medium rounded-lg ${isDark ? 'text-slate-500 bg-slate-800/60' : 'text-gray-500 bg-gray-200'}`}>
                    Up-to-date
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && filterSection === 'noServerMatch' && filteredNoServerMatch.length > 0 && (
          <div className="space-y-2">
            {filteredNoServerMatch.map(entry => (
              <div key={entry.id} className={`p-4 rounded-xl ${isDark ? 'bg-slate-900/20 border border-slate-800/40' : 'bg-gray-50 border border-gray-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className={`text-sm font-medium truncate mb-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.display_name}</h4>
                    <p className={`text-xs font-mono ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>{entry.name}</p>
                    <div className={`flex items-center gap-1.5 text-xs mt-1.5 ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>
                      No matching story found on the server
                    </div>
                  </div>
                  <span className={`px-3 py-1 text-xs font-medium rounded-lg ${isDark ? 'text-slate-500 bg-slate-800/60' : 'text-gray-500 bg-gray-200'}`}>
                    No Server Match
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && filterSection === 'emptyExtended' && filteredEmptyExtended.length > 0 && (
          <div className="space-y-2">
            {filteredEmptyExtended.map(entry => (
              <div key={entry.id} className={`p-4 rounded-xl ${isDark ? 'bg-slate-900/20 border border-slate-800/40' : 'bg-gray-50 border border-gray-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className={`text-sm font-medium truncate mb-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.display_name}</h4>
                    <p className={`text-xs font-mono ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>{entry.name}</p>
                    <div className={`flex items-center gap-1.5 text-xs mt-1.5 ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>
                      EXTENDED subfolder is empty
                    </div>
                  </div>
                  <span className={`px-3 py-1 text-xs font-medium rounded-lg ${isDark ? 'text-slate-500 bg-slate-800/60' : 'text-gray-500 bg-gray-200'}`}>
                    Empty EXTENDED
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && (
          ((filterSection === 'ready' && updateCount === 0) ||
            (filterSection === 'invalid' && filteredInvalid.length === 0) ||
            (filterSection === 'uptodate' && filteredNoUpdate.length === 0) ||
            (filterSection === 'noServerMatch' && filteredNoServerMatch.length === 0) ||
            (filterSection === 'emptyExtended' && filteredEmptyExtended.length === 0)) && (
            <div className={`text-center py-8 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
              <svg className={`w-8 h-8 mx-auto mb-2 ${isDark ? 'text-slate-700' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">No items in this section</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
