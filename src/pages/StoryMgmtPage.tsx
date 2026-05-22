import { useEffect, useState, useCallback } from 'react';
import { getMainBeUrl, getMainBeToken, getStoriesPage, deleteStories, type MainBeStoryFull } from '../api/client';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface StoryMgmtPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

const PAGE_SIZE = 20;

type DeleteTarget =
  | { kind: 'single'; story: MainBeStoryFull }
  | { kind: 'bulk'; stories: MainBeStoryFull[] };

export function StoryMgmtPage({ themeMode, onThemeChange }: StoryMgmtPageProps) {
  const isDark = themeMode === 'dark';

  const [stories, setStories] = useState<MainBeStoryFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number; failed: number } | null>(null);
  const [mainBeUrl, setMainBeUrl] = useState<string | null>(null);
  const [mainBeToken, setMainBeToken] = useState<string | null>(null);

  // Load Main BE config (URL + token) from local backend (set via Drive Sync Config Modal)
  const loadConfig = useCallback(async () => {
    try {
      const [urlResp, tokenResp] = await Promise.all([getMainBeUrl(), getMainBeToken()]);
      setMainBeUrl(urlResp.url);
      setMainBeToken(tokenResp.token);
    } catch {
      // Non-fatal — config may not be set yet
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const loadPage = useCallback(async (pageNum: number) => {
    if (!mainBeUrl || !mainBeToken) {
      setError('Main BE API URL or token not configured. Please set them in Drive Sync Settings.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getStoriesPage(mainBeUrl, mainBeToken, pageNum, PAGE_SIZE);
      const total = data.data.total;
      const serverPages = data.data.totalPages;
      const computed = serverPages > 0 ? serverPages : Math.ceil(total / PAGE_SIZE);
      setStories(data.data.items);
      setPage(data.data.page);
      setTotalPages(computed);
      setTotalItems(total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stories.');
    } finally {
      setLoading(false);
    }
  }, [mainBeUrl, mainBeToken]);

  useEffect(() => {
    loadPage(1);
  }, [loadPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setSelected(new Set());
    loadPage(newPage);
  };

  const filtered = stories.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.synopsis.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    );
  });

  const allSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(s => next.delete(s.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(s => next.add(s.id));
        return next;
      });
    }
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !mainBeUrl || !mainBeToken) return;
    setIsDeleting(true);
    setDeleteResult(null);
    try {
      if (deleteTarget.kind === 'single') {
        await deleteStories(mainBeUrl, mainBeToken, [deleteTarget.story.id]);
        setStories(prev => prev.filter(s => s.id !== deleteTarget.story.id));
      } else {
        const ids = deleteTarget.stories.map(s => s.id);
        const result = await deleteStories(mainBeUrl, mainBeToken, ids);
        setDeleteResult(result);
        setStories(prev => prev.filter(s => !ids.includes(s.id)));
        setSelected(new Set());
      }
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete story(ies).');
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const truncate = (s: string, len: number) =>
    s.length > len ? s.slice(0, len) + '…' : s;

  const bulkStories = deleteTarget?.kind === 'bulk' ? deleteTarget.stories : [];

  return (
    <div className={`min-h-screen flex flex-col ${isDark ? 'bg-slate-900' : 'bg-gray-50'}`}>
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title="Story Management"
        subtitle={
          <>
            {totalItems > 0 && (
              <>
                {totalItems.toLocaleString()} total &middot; {totalPages} page{totalPages !== 1 ? 's' : ''}
                {search && ` · filtered`}
              </>
            )}
          </>
        }
        rightActions={
          selected.size > 0 ? (
            <button
              onClick={() =>
                setDeleteTarget({
                  kind: 'bulk',
                  stories: stories.filter(s => selected.has(s.id)),
                })
              }
              className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Selected ({selected.size})
            </button>
          ) : null
        }
      />

      <main className="w-full xl:w-[90vw] mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col flex-1">

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          {/* Search */}
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-slate-400' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by title, synopsis, or ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:border-indigo-500 ${
                isDark
                  ? 'bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500'
                  : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'
              }`}
            />
          </div>

          {/* Refresh */}
          <button
            onClick={() => loadPage(page)}
            disabled={loading}
            className={`px-3 py-2 text-sm border rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 ${isDark
              ? 'text-slate-400 hover:text-slate-200 border-slate-700 hover:bg-slate-800'
              : 'text-gray-500 hover:text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className={`flex items-center justify-between gap-3 p-4 rounded-xl mb-5 text-sm ${isDark
            ? 'bg-red-900/30 border border-red-800 text-red-400'
            : 'bg-red-50 border border-red-200 text-red-600'
          }`}>
            <span>{error}</span>
            <button onClick={() => loadPage(page)} className="underline hover:no-underline">Retry</button>
          </div>
        )}

        {/* Delete result */}
        {deleteResult && (
          <div className={`p-4 rounded-xl mb-5 border ${isDark
            ? deleteResult.failed === 0
              ? 'bg-emerald-900/30 border-emerald-800 text-emerald-400'
              : 'bg-amber-900/30 border-amber-800 text-amber-400'
            : deleteResult.failed === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            <span className="text-sm">
              Deleted {deleteResult.deleted} story{deleteResult.deleted !== 1 ? 'ies' : ''}
              {deleteResult.failed > 0 && `; ${deleteResult.failed} failed to delete.`}
            </span>
          </div>
        )}

        {/* Loading */}
        {loading && stories.length === 0 && (
          <div className={`flex items-center justify-center py-20 gap-3 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
            <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading stories…</span>
          </div>
        )}

        {/* Empty state */}
        {!loading && stories.length === 0 && !error && (
          <div className={`flex flex-col items-center justify-center py-20 space-y-3 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
            <svg className={`w-12 h-12 ${isDark ? 'text-slate-600' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className={isDark ? 'text-slate-400' : 'text-gray-500'}>No stories found.</p>
            <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Try a different page or adjust your search.</p>
          </div>
        )}

        {/* No search results */}
        {!loading && stories.length > 0 && filtered.length === 0 && (
          <div className={`text-center py-20 space-y-3 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
            <svg className={`w-12 h-12 mx-auto ${isDark ? 'text-slate-600' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className={isDark ? 'text-slate-400' : 'text-gray-500'}>No stories match &ldquo;{search}&rdquo;.</p>
          </div>
        )}

        {/* Table */}
        {filtered.length > 0 && (
          <div className={`overflow-x-auto rounded-xl border ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={`${isDark ? 'bg-slate-800 border-b border-slate-700' : 'bg-gray-100 border-b border-gray-200'}`}>
                  <th className="px-3 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className={`w-4 h-4 rounded cursor-pointer ${isDark
                        ? 'border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-1'
                        : 'border-gray-300 bg-white text-indigo-600 focus:ring-indigo-500 focus:ring-1'
                      }`}
                    />
                  </th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Title</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider hidden md:table-cell ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Synopsis</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider hidden lg:table-cell ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Type</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Visibility</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Status</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider hidden xl:table-cell ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Tags</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider hidden xl:table-cell ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Platform</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider hidden sm:table-cell ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Chapters</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider hidden 2xl:table-cell ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Created</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider hidden 2xl:table-cell ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Updated</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider w-10 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Cover</th>
                  <th className={`px-3 py-3 text-left text-xs font-medium uppercase tracking-wider w-10 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Del</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-700/60' : 'divide-gray-200'}`}>
                {filtered.map(story => (
                  <tr
                    key={story.id}
                    className={`transition-colors ${isDark
                      ? selected.has(story.id) ? 'bg-indigo-950/40' : 'hover:bg-slate-800'
                      : selected.has(story.id) ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(story.id)}
                        onChange={() => toggleOne(story.id)}
                        className={`w-4 h-4 rounded cursor-pointer ${isDark
                          ? 'border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-1'
                          : 'border-gray-300 bg-white text-indigo-600 focus:ring-indigo-500 focus:ring-1'
                        }`}
                      />
                    </td>
                    {/* Title */}
                    <td className="px-3 py-3 max-w-[200px]">
                      <div className={`font-medium truncate ${isDark ? 'text-slate-100' : 'text-gray-900'}`} title={story.title}>{story.title}</div>
                      <div className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} title={story.id}>{truncate(story.id, 12)}</div>
                    </td>
                    {/* Synopsis */}
                    <td className="px-3 py-3 max-w-[200px] hidden md:table-cell">
                      <div className={`text-xs line-clamp-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`} title={story.synopsis}>{story.synopsis || '—'}</div>
                    </td>
                    {/* Type */}
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <span className={`text-xs ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{story.type || '—'}</span>
                    </td>
                    {/* Visibility */}
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                        story.visibility === 'public'
                          ? isDark
                            ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800/60'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : isDark
                            ? 'bg-amber-900/50 text-amber-400 border-amber-800/60'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {story.visibility}
                      </span>
                    </td>
                    {/* Status badges */}
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        {story.isCompleted && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${isDark
                            ? 'bg-indigo-900/60 text-indigo-300 border border-indigo-700/60'
                            : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          }`}>
                            Completed
                          </span>
                        )}
                        {story.isLicensed && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${isDark
                            ? 'bg-purple-900/50 text-purple-300 border border-purple-800/60'
                            : 'bg-purple-50 text-purple-700 border border-purple-200'
                          }`}>
                            Licensed
                          </span>
                        )}
                        {!story.isCompleted && !story.isLicensed && (
                          <span className={`text-xs ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>—</span>
                        )}
                      </div>
                    </td>
                    {/* Tags */}
                    <td className="px-3 py-3 hidden xl:table-cell">
                      <div className="flex flex-wrap gap-1 max-w-[160px]">
                        {story.tags && story.tags.length > 0
                          ? story.tags.slice(0, 3).map(tag => (
                              <span key={tag} className={`px-1.5 py-0.5 text-[10px] rounded truncate ${isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-gray-700'}`}>{tag}</span>
                            ))
                          : <span className={`text-xs ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>—</span>}
                        {story.tags && story.tags.length > 3 && (
                          <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>+{story.tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    {/* Platform */}
                    <td className="px-3 py-3 hidden xl:table-cell">
                      <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>{story.referencePlatform || '—'}</span>
                    </td>
                    {/* Chapters */}
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <span className={`text-xs font-mono ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{story.maxChapter}</span>
                    </td>
                    {/* Created */}
                    <td className="px-3 py-3 hidden 2xl:table-cell">
                      <span className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{formatDate(story.createdAt)}</span>
                    </td>
                    {/* Updated */}
                    <td className="px-3 py-3 hidden 2xl:table-cell">
                      <span className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{formatDate(story.updatedAt)}</span>
                    </td>
                    {/* Cover */}
                    <td className="px-3 py-3">
                      {story.coverImageUrl ? (
                        <img
                          src={story.coverImageUrl}
                          alt={story.title}
                          className={`w-10 h-14 object-cover rounded border ${isDark ? 'border-slate-600' : 'border-gray-200'}`}
                          onError={e => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className={`w-10 h-14 rounded border flex items-center justify-center ${isDark ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-100'}`}>
                          <svg className={`w-4 h-4 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </td>
                    {/* Delete */}
                    <td className="px-3 py-3">
                      <button
                        onClick={() => setDeleteTarget({ kind: 'single', story })}
                        className={`p-1.5 rounded transition-colors ${isDark
                          ? 'text-red-400 hover:text-red-300 hover:bg-red-900/30'
                          : 'text-red-500 hover:text-red-700 hover:bg-red-50'
                        }`}
                        title="Delete story"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {(totalPages > 1 || totalItems > PAGE_SIZE) && (
          <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1 || loading}
              className={`px-3 py-2 text-sm border rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isDark
                ? 'text-slate-300 bg-slate-800 border-slate-700 hover:bg-slate-700'
                : 'text-gray-600 bg-white border-gray-300 hover:bg-gray-50'
              }`}
            >
              <svg className="w-4 h-4 inline -ml-1 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Prev
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let p: number;
                if (totalPages <= 7) {
                  p = i + 1;
                } else if (page <= 4) {
                  p = i + 1;
                  if (i === 6) p = totalPages;
                } else if (page >= totalPages - 3) {
                  p = i === 0 ? 1 : totalPages - 6 + i;
                } else {
                  const pages = [1, page - 2, page - 1, page, page + 1, page + 2, totalPages];
                  p = pages[i];
                }
                return (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    disabled={loading}
                    className={`w-9 h-9 text-sm rounded-lg border transition-colors ${
                      p === page
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : `${isDark
                            ? 'text-slate-300 bg-slate-800 border-slate-700 hover:bg-slate-700'
                            : 'text-gray-600 bg-white border-gray-300 hover:bg-gray-50'
                          }`
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages || loading}
              className={`px-3 py-2 text-sm border rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isDark
                ? 'text-slate-300 bg-slate-800 border-slate-700 hover:bg-slate-700'
                : 'text-gray-600 bg-white border-gray-300 hover:bg-gray-50'
              }`}
            >
              Next
              <svg className="w-4 h-4 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <span className={`text-xs ml-2 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
              Page {page} of {totalPages} &middot; {totalItems.toLocaleString()} total
            </span>
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className={`rounded-xl p-6 max-w-lg w-full space-y-4 max-h-[80vh] overflow-y-auto ${isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200'}`}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isDark ? 'bg-red-900/30' : 'bg-red-50'}`}>
                <svg className={`w-6 h-6 ${isDark ? 'text-red-400' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className={`text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                {deleteTarget.kind === 'single' ? 'Delete Story' : `Delete ${bulkStories.length} Stories`}
              </h3>
            </div>

            <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-gray-600'}`}>
              {deleteTarget.kind === 'single'
                ? 'Are you sure you want to permanently delete this story? This action cannot be undone.'
                : `Are you sure you want to permanently delete ${bulkStories.length} stor${bulkStories.length !== 1 ? 'ies' : 'y'}? This action cannot be undone.`}
            </p>

            <div className={`rounded-lg p-3 max-h-48 overflow-y-auto space-y-1 ${isDark ? 'bg-slate-900' : 'bg-gray-50'}`}>
              {bulkStories.map(s => (
                <div key={s.id} className={`text-xs flex gap-2 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                  <span className={`font-mono shrink-0 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>{truncate(s.id, 8)}</span>
                  <span className="truncate">{s.title}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${isDark
                  ? 'text-slate-300 bg-slate-700 hover:bg-slate-600'
                  : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className={`px-4 py-2 text-sm rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${isDark
                  ? 'text-white bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:text-red-400'
                  : 'text-white bg-red-600 hover:bg-red-500'
                }`}
              >
                {isDeleting && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
