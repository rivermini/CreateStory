import { useEffect, useState, useCallback } from 'react';
import { listJobs, deleteJob, type SyncJob, type JobLogEntry } from '../api/client';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface DriveSyncHistoryPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

type FilterStatus = 'all' | 'queued' | 'running' | 'success' | 'error' | 'cancelled';

export function DriveSyncHistoryPage({ themeMode, onThemeChange }: DriveSyncHistoryPageProps) {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

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
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Auto-refresh every 10 seconds to pick up running jobs
  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, [jobs, loadJobs]);

  const handleDelete = async (jobId: string) => {
    try {
      await deleteJob(jobId);
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch {
      // ignore
    }
  };

  const filtered = jobs.filter(job => {
    if (filter !== 'all' && job.status !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!job.display_name.toLowerCase().includes(q) && !job.folder_name.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const statusColor = (status: string) => {
    switch (status) {
      case 'success': return 'bg-emerald-900/60 text-emerald-400 border-emerald-700';
      case 'error':   return 'bg-red-900/60 text-red-400 border-red-700';
      case 'running': return 'bg-blue-900/60 text-blue-400 border-blue-700';
      case 'queued':  return 'bg-amber-900/60 text-amber-400 border-amber-700';
      case 'cancelled': return 'bg-slate-700/60 text-slate-400 border-slate-600';
      default: return 'bg-slate-700/60 text-slate-400 border-slate-600';
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'success') return (
      <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
    if (status === 'error') return (
      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
    if (status === 'running') return (
      <svg className="w-4 h-4 text-blue-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    );
    if (status === 'queued') return (
      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
    return null;
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const formatDuration = (started?: string | null, finished?: string | null) => {
    if (!started) return '-';
    const start = new Date(started).getTime();
    const end = finished ? new Date(finished).getTime() : Date.now();
    const ms = end - start;
    if (ms < 0) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title="Sync History"
        subtitle="Past and active Drive sync jobs"
      />

      <main className="xl:w-[70vw] px-4 sm:px-6 py-6 sm:py-8 flex flex-col flex-1 mx-auto w-full">
        {/* ── Controls ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button
            onClick={loadJobs}
            disabled={loading}
            className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500
                       disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg
                       transition-colors flex items-center gap-2"
          >
            {loading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>

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

          {/* Filter pills */}
          <div className="flex gap-1 flex-wrap">
            {(['all', 'queued', 'running', 'success', 'error'] as FilterStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  filter === s
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
                }`}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Stats bar ────────────────────────────────────────────── */}
        {jobs.length > 0 && (
          <div className="flex gap-4 mb-4 text-xs text-slate-400">
            <span>{jobs.filter(j => j.status === 'success').length} success</span>
            <span>{jobs.filter(j => j.status === 'error').length} errors</span>
            <span>{jobs.filter(j => j.status === 'running').length} running</span>
            <span>{jobs.filter(j => j.status === 'queued').length} queued</span>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────── */}
        {error && (
          <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm mb-4">
            {error}
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────────────── */}
        {!loading && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <svg className="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">No sync jobs yet. Upload a story from the Drive Sync page.</p>
          </div>
        )}

        {/* ── Job list ────────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map(job => (
              <div key={job.id} className="bg-slate-800/70 border border-slate-700/50 rounded-xl overflow-hidden">
                {/* Job row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Status icon */}
                  <div className="flex-shrink-0">{statusIcon(job.status)}</div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-slate-200 truncate">{job.display_name || job.folder_name}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(job.status)}`}>
                        {job.status}
                      </span>
                      <span className="text-xs text-slate-500">
                        {job.kind === 'upload_single' ? 'Upload' : 'Update'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
                      <span>Created {formatTime(job.created_at)}</span>
                      {job.started_at && <span>Started {formatTime(job.started_at)}</span>}
                      {job.finished_at && <span>Finished {formatTime(job.finished_at)}</span>}
                      {job.started_at && (
                        <span className="text-slate-600">Duration: {formatDuration(job.started_at, job.finished_at)}</span>
                      )}
                    </div>
                    {job.result_message && (
                      <p className="text-xs text-slate-400 mt-1 truncate">{job.result_message}</p>
                    )}
                    {job.error && (
                      <p className="text-xs text-red-400 mt-1 truncate">Error: {job.error}</p>
                    )}
                  </div>

                  {/* Chapter stats */}
                  <div className="flex items-center gap-3 text-xs text-slate-400 flex-shrink-0">
                    {job.chapters_added > 0 && (
                      <span className="text-emerald-400 font-medium">+{job.chapters_added} added</span>
                    )}
                    {job.chapters_skipped > 0 && (
                      <span className="text-slate-500">{job.chapters_skipped} skipped</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {job.logs.length > 0 && (
                      <button
                        onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                        className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"
                      >
                        {expandedJobId === job.id ? 'Hide logs' : 'Logs'}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(job.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Expanded logs */}
                {expandedJobId === job.id && job.logs.length > 0 && (
                  <div className="border-t border-slate-700/50 px-4 py-3 bg-slate-900/50">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Logs</p>
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {job.logs.map((log, i) => (
                        <LogLine key={i} log={log} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && jobs.length > 0 && filtered.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm">
            No jobs match the current filter or search.
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
