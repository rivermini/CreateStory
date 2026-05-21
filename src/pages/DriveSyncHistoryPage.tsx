import { useEffect, useState, useCallback } from 'react';
import { listJobs, deleteJob, type SyncJob, type JobLogEntry } from '../api/client';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface DriveSyncHistoryPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

type FilterStatus = 'all' | 'queued' | 'running' | 'success' | 'error' | 'cancelled';
type FilterKind = 'all' | 'upload_single' | 'update_single';

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  success: { label: 'Success', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  error: { label: 'Error', dot: 'bg-red-400', text: 'text-red-400' },
  running: { label: 'Running', dot: 'bg-blue-400', text: 'text-blue-400' },
  queued: { label: 'Queued', dot: 'bg-amber-400', text: 'text-amber-400' },
  cancelled: { label: 'Cancelled', dot: 'bg-slate-500', text: 'text-slate-400' },
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

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, [jobs, loadJobs]);

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

  const filtered = jobs.filter(job => {
    if (filter !== 'all' && job.status !== filter) return false;
    if (filterKind !== 'all' && job.kind !== filterKind) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!job.display_name.toLowerCase().includes(q) && !job.folder_name.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const formatTime = (iso: string | null): string => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const formatDuration = (started?: string | null, finished?: string | null): string => {
    if (!started) return '—';
    const s = new Date(started).getTime();
    const f = finished ? new Date(finished).getTime() : Date.now();
    const secs = Math.floor((f - s) / 1000);
    if (secs < 0) return '—';
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const r = secs % 60;
    return `${m}m ${r}s`;
  };

  const counts = {
    all: jobs.length,
    success: jobs.filter(j => j.status === 'success').length,
    error: jobs.filter(j => j.status === 'error').length,
    running: jobs.filter(j => j.status === 'running').length,
    queued: jobs.filter(j => j.status === 'queued').length,
  };

  const filteredCounts = {
    all: filtered.length,
    success: filtered.filter(j => j.status === 'success').length,
    error: filtered.filter(j => j.status === 'error').length,
    running: filtered.filter(j => j.status === 'running').length,
    queued: filtered.filter(j => j.status === 'queued').length,
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title="Sync History"
        subtitle={<>{filtered.length} of {counts.all} job{counts.all !== 1 ? 's' : ''}{filter !== 'all' && ` · ${filter}`}{filterKind !== 'all' && ` · ${filterKind === 'upload_single' ? 'Upload' : 'Update'}`} · refreshed {lastRefresh.toLocaleTimeString()}</>}
      />

      <main className="w-full xl:w-[70vw] mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col flex-1">

        {/* ── Controls ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-start gap-2 mb-5">

          {/* Status filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg border border-slate-700">
            {([
              ['all', `All (${filteredCounts.all})`],
              ['running', `Running (${filteredCounts.running})`],
              ['success', `Success (${filteredCounts.success})`],
              ['error', `Error (${filteredCounts.error})`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${filter === value
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

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
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          </div>

          {/* Refresh */}
          <button
            onClick={() => { setLoading(true); loadJobs(); }}
            className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
            title="Refresh now"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* ── Error ────────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center justify-between gap-3 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-400 mb-5">
            <span className="text-sm">{error}</span>
            <button onClick={loadJobs} className="text-sm underline hover:no-underline">Retry</button>
          </div>
        )}

        {/* ── Loading ─────────────────────────────────────────────── */}
        {loading && jobs.length === 0 && (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-3">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading...</span>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────────────── */}
        {!loading && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-3">
            <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-slate-400">No sync jobs yet.</p>
            <p className="text-sm text-slate-500">Upload a story from the Drive Sync page to get started.</p>
          </div>
        )}

        {/* ── Job list ────────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((job, index) => {
              const statusCfg = STATUS_CONFIG[job.status] ?? { label: job.status, dot: 'bg-slate-500', text: 'text-slate-400' };

              return (
                <div key={job.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden flex transition-colors duration-150">
                  {/* Left accent strip */}
                  <div className="w-12 flex-shrink-0 flex flex-col items-center justify-center rounded-l-xl border-r border-slate-700 bg-indigo-900/20">
                    <span className="text-base font-bold text-indigo-300 select-none">#{index + 1}</span>
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col">
                    {/* Main card body */}
                    <div className="px-5 py-4 flex flex-col sm:flex-row items-start gap-4">

                      {/* Status dot */}
                      <div className="flex-shrink-0 mt-1">
                        <div className={`w-2.5 h-2.5 rounded-full ${statusCfg.dot}`} />
                      </div>

                      {/* Title + meta + actions */}
                      <div className="flex-1 min-w-0 w-full">
                        <h3 className="text-sm sm:text-base font-semibold text-slate-100 truncate">{job.display_name || job.folder_name}</h3>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                          <span className={statusCfg.text}>{statusCfg.label}</span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            job.kind === 'upload_single'
                              ? 'bg-blue-900/50 text-blue-400 border-blue-800/60'
                              : 'bg-amber-900/50 text-amber-400 border-amber-800/60'
                          }`}>
                            {job.kind === 'upload_single' ? 'Upload' : 'Update'}
                          </span>
                          {job.chapters_added > 0 && (
                            <span className="text-emerald-400 font-medium">+{job.chapters_added} added</span>
                          )}
                          {job.chapters_skipped > 0 && (
                            <span className="text-amber-400 font-medium">{job.chapters_skipped} skipped</span>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          <button
                            onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                          >
                            {expandedJobId === job.id ? 'Hide Logs' : `${job.logs.length} Logs`}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(job)}
                            className="px-3 py-1.5 text-xs font-medium text-red-400 bg-slate-700 hover:bg-red-900/50 rounded-lg transition-colors"
                          >
                            Delete
                          </button>
                        </div>

                        {/* Error */}
                        {job.error && (
                          <p className="text-xs text-red-400 mt-2">{job.error}</p>
                        )}

                        {/* Result message */}
                        {job.result_message && !job.error && (
                          <p className="text-xs text-slate-400 mt-2 truncate">{job.result_message}</p>
                        )}
                      </div>

                      {/* Timestamps */}
                      <div className="flex flex-col sm:items-end gap-3 flex-shrink-0">
                        <span className="text-xs text-slate-500"><span className="text-slate-300 font-medium">Created</span> {formatTime(job.created_at)}</span>
                        {job.started_at && <span className="text-xs text-slate-500"><span className="text-blue-400 font-medium">Started</span> {formatTime(job.started_at)}</span>}
                        {job.finished_at && (
                          <>
                            <span className="text-xs text-slate-500"><span className="text-emerald-400 font-medium">Finished</span> {formatTime(job.finished_at)}</span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-400 text-xs font-medium border border-indigo-800/60">
                              {formatDuration(job.started_at, job.finished_at)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Expanded logs */}
                    {expandedJobId === job.id && job.logs.length > 0 && (
                      <div className="border-t border-slate-700 px-5 py-3 bg-slate-900/50">
                        <p className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-2">Logs</p>
                        <div className="space-y-1 max-h-60 overflow-y-auto">
                          {job.logs.map((log, i) => (
                            <LogLine key={i} log={log} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── No results ─────────────────────────────────────────── */}
        {!loading && jobs.length > 0 && filtered.length === 0 && (
          <div className="text-center py-20 text-slate-500 space-y-3">
            <svg className="w-12 h-12 text-slate-600 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-slate-400">No jobs match the current filter or search.</p>
          </div>
        )}

        {/* ── Bottom refresh ───────────────────────────────────────── */}
        {!loading && jobs.length > 0 && (
          <div className="flex justify-center pt-4">
            <button
              onClick={loadJobs}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors"
            >
              Refresh
            </button>
          </div>
        )}

        {/* ── Delete confirmation modal ──────────────────────────── */}
        {deleteTarget && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full space-y-4">
              <h3 className="text-lg font-semibold text-slate-100">Confirm Delete</h3>
              <p className="text-sm text-slate-300">
                Are you sure you want to delete{' '}
                <span className="font-medium text-slate-100">{deleteTarget.display_name || deleteTarget.folder_name}</span>?
                This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                  className="px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:text-red-400 rounded-lg transition-colors"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
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
  const levelColor = {
    info: 'text-slate-400',
    warning: 'text-amber-400',
    error: 'text-red-400',
    debug: 'text-slate-600',
  }[log.level] || 'text-slate-400';

  return (
    <div className={`text-xs font-mono ${levelColor}`}>
      <span className="text-slate-600">{new Date(log.timestamp).toLocaleTimeString()}</span>
      {' '}
      <span className="uppercase text-[10px] font-bold opacity-60">[{log.level}]</span>
      {' '}
      {log.message}
    </div>
  );
}
