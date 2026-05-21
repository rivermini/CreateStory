import { useEffect, useState, useCallback } from 'react';
import { listJobs, deleteJob, deleteJobs, type SyncJob, type JobLogEntry } from '../api/client';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface DriveSyncHistoryPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

type FilterStatus = 'all' | 'queued' | 'running' | 'success' | 'error' | 'cancelled';
type FilterKind = 'all' | 'upload_single' | 'update_single';

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  success:  { label: 'Success',   dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-950/40',   border: 'border-emerald-800/40'   },
  error:    { label: 'Error',     dot: 'bg-red-400',     text: 'text-red-400',     bg: 'bg-red-950/40',     border: 'border-red-800/40'     },
  running:  { label: 'Running',   dot: 'bg-blue-400',    text: 'text-blue-400',    bg: 'bg-blue-950/40',    border: 'border-blue-800/40'    },
  queued:   { label: 'Queued',    dot: 'bg-amber-400',   text: 'text-amber-400',  bg: 'bg-amber-950/40',   border: 'border-amber-800/40'   },
  cancelled:{ label: 'Cancelled', dot: 'bg-slate-500',   text: 'text-slate-400',  bg: 'bg-slate-800/40',   border: 'border-slate-700/40'   },
};

export function DriveSyncHistoryPage({ themeMode, onThemeChange }: DriveSyncHistoryPageProps) {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [filterKind, setFilterKind] = useState<FilterKind>('all');
  const [search, setSearch] = useState('');
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [deleteTarget, setDeleteTarget] = useState<SyncJob | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<SyncJob[] | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listJobs(200, 0);
      setJobs(data.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history.');
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, [jobs, loadJobs]);

  useEffect(() => {
    setSelectedIds(prev => {
      const liveIds = new Set(jobs.map(j => j.id));
      const next = new Set(prev);
      let changed = false;
      next.forEach(id => { if (!liveIds.has(id)) { next.delete(id); changed = true; } });
      return changed ? next : prev;
    });
  }, [jobs]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteJob(deleteTarget.id);
      setJobs(prev => prev.filter(j => j.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (!bulkDeleteTarget || bulkDeleteTarget.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const ids = bulkDeleteTarget.map(j => j.id);
      await deleteJobs(ids);
      const deletedSet = new Set(ids);
      setJobs(prev => prev.filter(j => !deletedSet.has(j.id)));
      setSelectedIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      setBulkDeleteTarget(null);
    } catch {
      // ignore
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(j => j.id)));
    }
  };

  const filtered = jobs.filter(job => {
    if (filter !== 'all' && job.status !== filter) return false;
    if (filterKind !== 'all' && job.kind !== filterKind) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!job.display_name.toLowerCase().includes(q) && !job.folder_name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  useEffect(() => { setSelectedIds(new Set()); }, [filter, filterKind, search]);

  const formatTime = (iso: string | null): string => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  const formatDuration = (started?: string | null, _finished?: string | null): string => {
    if (!started) return '—';
    const secs = Math.floor((Date.now() - new Date(started).getTime()) / 1000);
    if (secs < 0) return '—';
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  };

  const stats = {
    total: jobs.length,
    success:  jobs.filter(j => j.status === 'success').length,
    error:    jobs.filter(j => j.status === 'error').length,
    running:  jobs.filter(j => j.status === 'queued' || j.status === 'running').length,
  };

  const statCards: { label: string; value: number; color: string; dot: string }[] = [
    { label: 'Total',   value: stats.total,   color: 'text-slate-100', dot: 'bg-slate-400'   },
    { label: 'Success', value: stats.success,  color: 'text-emerald-400', dot: 'bg-emerald-400' },
    { label: 'Errors',  value: stats.error,    color: 'text-red-400',    dot: 'bg-red-400'     },
    { label: 'Running', value: stats.running,  color: 'text-blue-400',   dot: 'bg-blue-400'    },
  ];

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title="Sync History"
        subtitle={<>
          <span className="text-slate-400">{filtered.length}</span>
          {filter !== 'all' || filterKind !== 'all' || search ? (
            <span className="text-slate-500"> of {jobs.length}</span>
          ) : null}
          <span className="text-slate-500"> job{jobs.length !== 1 ? 's' : ''}</span>
          {filter !== 'all' && <span className="text-slate-600"> · {filter}</span>}
          {filterKind !== 'all' && <span className="text-slate-600"> · {filterKind === 'upload_single' ? 'Upload' : 'Update'}</span>}
          <span className="text-slate-600"> · refreshed {lastRefresh.toLocaleTimeString()}</span>
        </>}
      />

      <main className="w-full xl:w-[70vw] mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col flex-1 gap-5">

        {/* ── Stats bar ─────────────────────────────────────────────────── */}
        {!loading && jobs.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {statCards.map(({ label, value, color, dot }) => (
              <button
                key={label}
                onClick={() => {
                  if (label === 'Total')   setFilter('all');
                  if (label === 'Success') setFilter('success');
                  if (label === 'Errors')  setFilter('error');
                  if (label === 'Running') setFilter('running');
                }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-slate-800/60 border-slate-700/50
                  hover:bg-slate-800 hover:border-slate-600 transition-colors text-left group`}
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot} ${label === 'Running' && value > 0 ? 'animate-pulse' : ''}`} />
                <div>
                  <div className={`text-xl font-bold ${color} tabular-nums leading-none`}>{value}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{label}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Controls ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">

          {/* Kind filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg border border-slate-700">
            <span className="px-2 text-xs text-slate-500 hidden sm:inline">Type:</span>
            {([
              ['all', 'All'],
              ['upload_single', 'Upload'],
              ['update_single', 'Update'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilterKind(value)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${filterKind === value
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by story name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-800 border border-slate-700 text-slate-200
                         rounded-lg text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Refresh */}
          <button
            onClick={() => { setLoading(true); loadJobs(); }}
            className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>

          {/* Bulk delete */}
          {selectedIds.size > 0 && (
            <button
              onClick={() => setBulkDeleteTarget(filtered.filter(j => selectedIds.has(j.id)))}
              className="px-3 py-2 text-sm text-red-400 border border-red-800/60 rounded-lg hover:bg-red-900/50 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete ({selectedIds.size})
            </button>
          )}
        </div>

        {/* ── Select All ───────────────────────────────────────────────── */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              checked={selectedIds.size === filtered.length && filtered.length > 0}
              ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length; }}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-xs text-slate-400">
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : `Select all ${filtered.length}`}
            </span>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center justify-between gap-3 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-400">
            <span className="text-sm">{error}</span>
            <button onClick={loadJobs} className="text-sm underline hover:no-underline shrink-0">Retry</button>
          </div>
        )}

        {/* ── Loading ──────────────────────────────────────────────────── */}
        {loading && jobs.length === 0 && (
          <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading sync history...</span>
          </div>
        )}

        {/* ── Empty ────────────────────────────────────────────────────── */}
        {!loading && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500 space-y-3">
            <svg className="w-14 h-14 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-slate-400">No sync jobs yet.</p>
            <p className="text-sm text-slate-500">Upload a story from the Drive Sync page to get started.</p>
          </div>
        )}

        {/* ── Job list ────────────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((job) => {
              const statusCfg = STATUS_CONFIG[job.status] ?? { label: job.status, dot: 'bg-slate-500', text: 'text-slate-400', bg: 'bg-slate-800/40', border: 'border-slate-700/40' };
              const isExpanded = expandedJobId === job.id;

              return (
                <div
                  key={job.id}
                  className={`rounded-xl border transition-colors ${statusCfg.bg} ${statusCfg.border}
                    ${selectedIds.has(job.id) ? 'ring-1 ring-indigo-500/50' : ''}`}
                >
                  {/* Card header */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedIds.has(job.id)}
                      onChange={() => toggleSelect(job.id)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer shrink-0"
                    />

                    {/* Status dot */}
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusCfg.dot} ${job.status === 'running' ? 'animate-pulse' : ''}`} />

                    {/* Title */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-slate-100 truncate pr-2">
                        {job.display_name || job.folder_name}
                      </h3>
                      {job.result_message && !job.error && (
                        <p className="text-xs text-slate-500 truncate mt-0.5 pr-4">{job.result_message}</p>
                      )}
                      {job.error && (
                        <p className="text-xs text-red-400 truncate mt-0.5 pr-4">{job.error}</p>
                      )}
                    </div>

                    {/* Type badge */}
                    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                      job.kind === 'upload_single'
                        ? 'bg-blue-900/40 text-blue-400 border-blue-800/40'
                        : 'bg-amber-900/40 text-amber-400 border-amber-800/40'
                    }`}>
                      {job.kind === 'upload_single' ? 'Upload' : 'Update'}
                    </span>

                    {/* Stats badges */}
                    {job.chapters_added > 0 && (
                      <span className="shrink-0 text-xs text-emerald-400 font-medium hidden sm:inline">
                        +{job.chapters_added} added
                      </span>
                    )}
                    {job.chapters_skipped > 0 && (
                      <span className="shrink-0 text-xs text-amber-400 font-medium hidden sm:inline">
                        {job.chapters_skipped} skipped
                      </span>
                    )}

                    {/* Duration pill (completed) */}
                    {job.started_at && job.finished_at && (
                      <span className="shrink-0 hidden md:inline-flex items-center px-2 py-0.5 rounded-full bg-indigo-900/30 text-indigo-400 text-xs border border-indigo-800/40">
                        {formatDuration(job.started_at, job.finished_at)}
                      </span>
                    )}

                    {/* Time */}
                    <span className="shrink-0 text-xs text-slate-500 hidden lg:inline">
                      {formatTime(job.created_at)}
                    </span>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                        className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-700/60 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1"
                        title={isExpanded ? 'Hide logs' : 'Show logs'}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d={isExpanded
                              ? "M9 5l7 7-7 7"
                              : "M19 9l-7 7-7-7"} />
                        </svg>
                        {job.logs.length}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(job)}
                        className="p-1.5 text-slate-600 hover:text-red-400 bg-slate-700/40 hover:bg-red-900/40 rounded-lg transition-colors"
                        title="Delete job"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Expanded logs */}
                  {isExpanded && job.logs.length > 0 && (
                    <div className="border-t border-slate-700/40 px-4 py-3 bg-black/20">
                      <p className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-2">Logs</p>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {job.logs.map((log, i) => (
                          <LogLine key={i} log={log} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── No results ─────────────────────────────────────────────── */}
        {!loading && jobs.length > 0 && filtered.length === 0 && (
          <div className="text-center py-20 text-slate-500 space-y-3">
            <svg className="w-12 h-12 text-slate-700 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-slate-400">No jobs match your filters or search.</p>
            <button onClick={() => { setFilter('all'); setFilterKind('all'); setSearch(''); }}
              className="text-sm text-indigo-400 hover:text-indigo-300">
              Clear all filters
            </button>
          </div>
        )}

        {/* ── Bottom refresh ───────────────────────────────────────────── */}
        {!loading && jobs.length > 0 && (
          <div className="flex justify-center pt-2">
            <button onClick={loadJobs}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">
              Refresh
            </button>
          </div>
        )}

        {/* ── Delete modal ─────────────────────────────────────────────── */}
        {deleteTarget && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-red-900/30 rounded-lg">
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-100">Delete Job</h3>
              </div>
              <p className="text-sm text-slate-400 mb-5">
                Permanently delete{' '}
                <span className="text-slate-200 font-medium">{deleteTarget.display_name || deleteTarget.folder_name}</span>?
                This cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteTarget(null)} disabled={isDeleting}
                  className="px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg transition-colors">
                  Cancel
                </button>
                <button onClick={handleConfirmDelete} disabled={isDeleting}
                  className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg transition-colors">
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Bulk delete modal ───────────────────────────────────────── */}
        {bulkDeleteTarget && bulkDeleteTarget.length > 0 && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-red-900/30 rounded-lg">
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-100">Delete {bulkDeleteTarget.length} Jobs</h3>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                Permanently delete <span className="text-slate-200 font-medium">{bulkDeleteTarget.length} selected jobs</span>?
                This cannot be undone.
              </p>
              <div className="max-h-44 overflow-y-auto bg-slate-900/60 rounded-xl p-3 space-y-1 mb-5">
                {bulkDeleteTarget.map(job => (
                  <div key={job.id} className="flex items-center gap-2 text-xs py-1">
                    <span className="text-slate-500 font-mono">{job.id.slice(0, 6)}</span>
                    <span className="text-slate-300 truncate">{job.display_name || job.folder_name}</span>
                    <span className="ml-auto shrink-0 text-slate-600">({job.status})</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setBulkDeleteTarget(null)} disabled={isBulkDeleting}
                  className="px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg transition-colors">
                  Cancel
                </button>
                <button onClick={handleConfirmBulkDelete} disabled={isBulkDeleting}
                  className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg transition-colors">
                  {isBulkDeleting ? 'Deleting...' : `Delete ${bulkDeleteTarget.length} Jobs`}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function LogLine({ log }: { log: JobLogEntry }) {
  const colors = { info: 'text-slate-400', warning: 'text-amber-400', error: 'text-red-400', debug: 'text-slate-600' };
  return (
    <div className={`text-xs font-mono ${colors[log.level] || 'text-slate-400'}`}>
      <span className="text-slate-600">{new Date(log.timestamp).toLocaleTimeString()}</span>
      {' '}<span className="uppercase text-[10px] font-bold opacity-60">[{log.level}]</span>{' '}{log.message}
    </div>
  );
}
