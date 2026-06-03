import { useEffect, useState, useCallback } from 'react';
import { listJobs, deleteJob, deleteJobs, type SyncJob, type JobLogEntry } from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';

const PRODUCTION_URL = 'https://api-novel.santngo.com/';
const PRODUCTION_URL_V2 = 'https://api-novel.santngo.com';

interface DriveSyncHistoryPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

type FilterStatus = 'all' | 'queued' | 'running' | 'success' | 'error' | 'cancelled';
type FilterKind = 'all' | 'upload_single' | 'update_single';

const STATUS_CONFIG_DARK: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  success:  { label: 'Success',   dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-950/40',   border: 'border-emerald-800/40'   },
  error:    { label: 'Error',     dot: 'bg-red-400',     text: 'text-red-400',     bg: 'bg-red-950/40',     border: 'border-red-800/40'     },
  running:  { label: 'Running',   dot: 'bg-blue-400',    text: 'text-blue-400',    bg: 'bg-blue-950/40',    border: 'border-blue-800/40'    },
  queued:   { label: 'Queued',    dot: 'bg-amber-400',   text: 'text-amber-400',  bg: 'bg-amber-950/40',   border: 'border-amber-800/40'   },
  cancelled:{ label: 'Cancelled', dot: 'bg-slate-500',   text: 'text-slate-400',  bg: 'bg-slate-800/40',   border: 'border-slate-700/40'   },
};

const STATUS_CONFIG_LIGHT: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  success:  { label: 'Success',   dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50',     border: 'border-emerald-200' },
  error:    { label: 'Error',     dot: 'bg-red-500',     text: 'text-red-600',     bg: 'bg-red-50',       border: 'border-red-200'   },
  running:  { label: 'Running',   dot: 'bg-blue-500',    text: 'text-blue-600',    bg: 'bg-blue-50',      border: 'border-blue-200'   },
  queued:   { label: 'Queued',    dot: 'bg-amber-500',   text: 'text-amber-600',  bg: 'bg-amber-50',     border: 'border-amber-200'  },
  cancelled:{ label: 'Cancelled', dot: 'bg-gray-400',    text: 'text-gray-500',   bg: 'bg-gray-100',     border: 'border-gray-200'   },
};

export function DriveSyncHistoryPage({ themeMode }: DriveSyncHistoryPageProps) {
  const isDark = themeMode === 'dark';
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [filterKind, setFilterKind] = useState<FilterKind>('all');
  const [search, setSearch] = useState('');
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SyncJob | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<SyncJob[] | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const statusConfig = isDark ? STATUS_CONFIG_DARK : STATUS_CONFIG_LIGHT;

  const pageBg = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)';

  const c = (key: string) => {
    const map: Record<string, [string, string]> = {
      text:      ['text-white/90',      'text-[rgba(0,0,0,0.85)]'],
      textMuted: ['text-white/40',       'text-[rgba(0,0,0,0.4)]'],
      textSub:   ['text-white/25',       'text-[rgba(0,0,0,0.25)]'],
      textBody:  ['text-white/70',       'text-[rgba(0,0,0,0.65)]'],
      textBodyStrong: ['text-white/90', 'text-[rgba(0,0,0,0.85)]'],
      glassBg:   ['bg-white/[0.03]',     'bg-white/70'],
      glassBorder: ['border-white/[0.06]','border-black/[0.06]'],
      glassHover:['hover:bg-white/[0.05]','hover:bg-white/80'],
      rowBg:     ['bg-white/[0.04]',     'bg-[rgba(0,0,0,0.04)]'],
      rowBorder:  ['border-white/[0.05]', 'border-black/[0.05]'],
      divider:   ['border-white/[0.06]', 'border-black/[0.06]'],
      glassNav:  ['bg-[#0f0f1e]/90',    'bg-white/80'],
    };
    return map[key]?.[isDark ? 0 : 1] ?? '';
  };

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

  const formatDuration = (started?: string | null, finished?: string | null): string => {
    if (!started) return '—';
    const end = finished ? new Date(finished).getTime() : Date.now();
    const secs = Math.floor((end - new Date(started).getTime()) / 1000);
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
    { label: 'Total',   value: stats.total,   color: c('textBodyStrong'), dot: isDark ? 'bg-slate-400'   : 'bg-gray-400'   },
    { label: 'Success', value: stats.success,  color: isDark ? 'text-emerald-400' : 'text-emerald-600', dot: isDark ? 'bg-emerald-400' : 'bg-emerald-500' },
    { label: 'Errors',  value: stats.error,    color: isDark ? 'text-red-400' : 'text-red-600',    dot: isDark ? 'bg-red-400'     : 'bg-red-500'     },
    { label: 'Running', value: stats.running,  color: isDark ? 'text-blue-400' : 'text-blue-600',   dot: isDark ? 'bg-blue-400'    : 'bg-blue-500'    },
  ];

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBg }}>
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />
      <main className="relative z-10 w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col flex-1 gap-5">

        {/* ── Page Header ───────────────────────────────── */}
        <div className="lg-glass-deep px-6 py-5">
          <h1 className={`text-2xl sm:text-3xl font-bold ${c('text')}`}>
            Sync History
          </h1>
          <p className={`mt-1 text-sm sm:text-base ${c('textMuted')}`}>
            View and manage your sync job history
          </p>
        </div>

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
                className={`lg-glass-card flex items-center gap-3 px-4 py-4 rounded-xl text-left group transition-all duration-200 ${isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-white/90'}`}
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot} ${label === 'Running' && value > 0 ? 'animate-pulse' : ''}`} />
                <div>
                  <div className={`text-xl font-bold ${color} tabular-nums leading-none`}>{value}</div>
                  <div className={`text-xs mt-0.5 ${c('textSub')}`}>{label}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Controls ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">

          {/* Kind filter */}
          <div className={`flex items-center gap-1 p-1 rounded-xl ${c('glassBg')} ${c('glassBorder')}`}>
            <span className={`px-2 text-xs hidden sm:inline ${c('textSub')}`}>Type:</span>
            {([
              ['all', 'All'],
              ['upload_single', 'Upload'],
              ['update_single', 'Update'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilterKind(value)}
                className={`px-3 py-1 text-xs rounded-lg transition-colors ${filterKind === value
                  ? 'bg-indigo-600 text-white'
                  : `${c('textMuted')} hover:${isDark ? '!text-white/80' : '!text-black/80'}`
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${c('textSub')}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by story name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`w-full pl-9 pr-4 py-2 border rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ${
                isDark
                  ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder:text-white/30'
                  : 'bg-[rgba(0,0,0,0.04)] border-black/[0.06] text-[rgba(0,0,0,0.85)] placeholder:text-[rgba(0,0,0,0.3)]'
              }`}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${c('textSub')} hover:${isDark ? '!text-white/80' : '!text-black/80'}`}
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
            className={`lg-glass px-3 py-2 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-white/90'}`}
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
              className={`lg-glass px-3 py-2 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${isDark
                ? 'text-red-400 hover:bg-red-900/20'
                : 'text-red-600 hover:bg-red-50'
              }`}
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
              className={`w-4 h-4 rounded cursor-pointer ${isDark
                ? 'border-white/20 bg-white/5 text-indigo-400 focus:ring-indigo-500 focus:ring-offset-0'
                : 'border-black/20 bg-black/5 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0'
              }`}
            />
            <span className={`text-xs ${c('textSub')}`}>
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : `Select all ${filtered.length}`}
            </span>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────────── */}
        {error && (
          <div className={`flex items-center justify-between gap-3 p-4 rounded-2xl text-sm ${isDark ? 'bg-red-900/20 border border-red-800/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
            <span>{error}</span>
            <button onClick={loadJobs} className="underline hover:no-underline shrink-0">Retry</button>
          </div>
        )}

        {/* ── Loading ──────────────────────────────────────────────────── */}
        {loading && jobs.length === 0 && (
          <div className={`flex items-center justify-center py-20 gap-3 ${c('textMuted')}`}>
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading sync history...</span>
          </div>
        )}

        {/* ── Empty ────────────────────────────────────────────────────── */}
        {!loading && jobs.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-24 space-y-3 ${c('textSub')}`}>
            <svg className={`w-14 h-14 ${c('textSub')}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className={c('textMuted')}>No sync jobs yet.</p>
            <p className={`text-sm ${c('textSub')}`}>Upload a story from the Drive Sync page to get started.</p>
          </div>
        )}

        {/* ── Job list ────────────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((job) => {
              const statusCfg = statusConfig[job.status] ?? {
                label: job.status,
                dot: isDark ? 'bg-slate-500' : 'bg-gray-400',
                text: isDark ? 'text-slate-400' : 'text-gray-500',
                bg: isDark ? 'bg-slate-900/40' : 'bg-gray-50',
                border: isDark ? 'border-slate-800/40' : 'border-gray-200',
              };
              const isExpanded = expandedJobId === job.id;

              return (
                <div
                  key={job.id}
                  className={`lg-glass-card rounded-2xl border transition-all duration-200 ${statusCfg.bg} ${statusCfg.border}
                    ${selectedIds.has(job.id) ? 'ring-1 ring-indigo-500/50' : ''}`}
                >
                  {/* Card header */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedIds.has(job.id)}
                      onChange={() => toggleSelect(job.id)}
                      className={`w-4 h-4 rounded shrink-0 cursor-pointer ${isDark
                        ? 'border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0'
                        : 'border-gray-300 bg-white text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0'
                      }`}
                    />

                    {/* Status dot */}
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusCfg.dot} ${job.status === 'running' ? 'animate-pulse' : ''}`} />

                    {/* Title */}
                    <div className="flex-1 min-w-0">
                      <h3 className={`text-sm font-semibold truncate pr-2 ${c('textBodyStrong')}`}>
                        {job.display_name || job.folder_name}
                      </h3>
                      {job.result_message && !job.error && (
                        <p className={`text-xs truncate mt-0.5 pr-4 ${c('textSub')}`}>{job.result_message}</p>
                      )}
                      {job.error && (
                        <p className={`text-xs truncate mt-0.5 pr-4 ${isDark ? 'text-red-400' : 'text-red-600'}`}>{job.error}</p>
                      )}
                    </div>

                    {/* Type badge */}
                    <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${
                      job.kind === 'upload_single'
                        ? isDark
                          ? 'bg-blue-900/40 text-blue-400 border-blue-800/40'
                          : 'bg-blue-50 text-blue-600 border-blue-200'
                        : isDark
                          ? 'bg-amber-900/40 text-amber-400 border-amber-800/40'
                          : 'bg-amber-50 text-amber-600 border-amber-200'
                    }`}>
                      {job.kind === 'upload_single' ? 'Upload' : 'Update'}
                    </span>

                    {/* Server badge */}
                    {job.main_be_api_base_url && (() => {
                      const normalizedUrl = job.main_be_api_base_url!.endsWith('/') ? job.main_be_api_base_url!.slice(0, -1) : job.main_be_api_base_url!;
                      const isProduction = normalizedUrl === PRODUCTION_URL_V2 || normalizedUrl === PRODUCTION_URL;
                      return (
                        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border ${
                          isProduction
                            ? isDark
                              ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800/40'
                              : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                            : isDark
                              ? 'bg-slate-800/60 text-slate-400 border-slate-700/40'
                              : 'bg-gray-100 text-gray-600 border-gray-200'
                        }`}>
                          {isProduction ? (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          {isProduction ? 'Prod' : 'Test'}
                        </span>
                      );
                    })()}

                    {/* Stats badges */}
                    {job.chapters_added > 0 && (
                      <span className={`shrink-0 text-xs font-medium hidden sm:inline ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                        +{job.chapters_added} added
                      </span>
                    )}
                    {job.chapters_skipped > 0 && (
                      <span className={`shrink-0 text-xs font-medium hidden sm:inline ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                        {job.chapters_skipped} skipped
                      </span>
                    )}

                    {/* Duration pill (completed) */}
                    {job.started_at && job.finished_at && (
                      <span className={`shrink-0 hidden md:inline-flex items-center px-2.5 py-1 rounded-lg text-xs ${
                        isDark
                          ? 'bg-indigo-900/30 text-indigo-400 border border-indigo-800/40'
                          : 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                      }`}>
                        {formatDuration(job.started_at, job.finished_at)}
                      </span>
                    )}

                    {/* Time */}
                    <span className={`shrink-0 text-xs hidden lg:inline ${c('textSub')}`}>
                      {formatTime(job.created_at)}
                    </span>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                        className={`lg-glass px-3 py-1.5 text-xs rounded-xl transition-colors flex items-center gap-1 ${isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-white/90'}`}
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
                        className={`lg-glass p-1.5 rounded-xl transition-colors ${isDark
                          ? 'text-white/40 hover:text-red-400 hover:bg-red-900/20'
                          : 'text-black/40 hover:text-red-600 hover:bg-red-50'
                        }`}
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
                    <div className={`border-t px-4 py-3 ${c('rowBg')}`}>
                      <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${c('textSub')}`}>Logs</p>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {job.logs.map((log, i) => (
                          <LogLine key={i} log={log} isDark={isDark} />
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
          <div className={`text-center py-20 space-y-3 ${c('textSub')}`}>
            <svg className={`w-12 h-12 mx-auto ${c('textSub')}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className={c('textMuted')}>No jobs match your filters or search.</p>
            <button onClick={() => { setFilter('all'); setFilterKind('all'); setSearch(''); }}
              className={`text-sm ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'}`}>
              Clear all filters
            </button>
          </div>
        )}

        {/* ── Bottom refresh ───────────────────────────────────────────── */}
        {!loading && jobs.length > 0 && (
          <div className="flex justify-center pt-2">
            <button onClick={loadJobs}
              className={`lg-glass px-4 py-2 text-sm rounded-xl transition-colors ${isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-white/90'}`}>
              Refresh
            </button>
          </div>
        )}

        {/* ── Delete modal ─────────────────────────────────────────────── */}
        {deleteTarget && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className={`lg-glass-card rounded-2xl p-6 max-w-sm w-full shadow-2xl`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-xl ${isDark ? 'bg-red-900/30' : 'bg-red-50'}`}>
                  <svg className={`w-5 h-5 ${isDark ? 'text-red-400' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h3 className={`text-base font-semibold ${c('text')}`}>Delete Job</h3>
              </div>
              <p className={`text-sm mb-5 ${c('textMuted')}`}>
                Permanently delete{' '}
                <span className={`font-medium ${c('textBodyStrong')}`}>{deleteTarget.display_name || deleteTarget.folder_name}</span>?
                This cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteTarget(null)} disabled={isDeleting}
                  className={`lg-glass px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50 ${isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-white/90'}`}>
                  Cancel
                </button>
                <button onClick={handleConfirmDelete} disabled={isDeleting}
                  className={`px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-xl transition-colors`}>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Bulk delete modal ───────────────────────────────────────── */}
        {bulkDeleteTarget && bulkDeleteTarget.length > 0 && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className={`lg-glass-card rounded-2xl p-6 max-w-sm w-full shadow-2xl`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-xl ${isDark ? 'bg-red-900/30' : 'bg-red-50'}`}>
                  <svg className={`w-5 h-5 ${isDark ? 'text-red-400' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h3 className={`text-base font-semibold ${c('text')}`}>Delete {bulkDeleteTarget.length} Jobs</h3>
              </div>
              <p className={`text-sm mb-4 ${c('textMuted')}`}>
                Permanently delete <span className={`font-medium ${c('textBodyStrong')}`}>{bulkDeleteTarget.length} selected jobs</span>?
                This cannot be undone.
              </p>
              <div className={`max-h-44 overflow-y-auto rounded-xl p-3 space-y-1 mb-5 ${c('rowBg')}`}>
                {bulkDeleteTarget.map(job => (
                  <div key={job.id} className={`flex items-center gap-2 text-xs py-1 ${c('textBody')}`}>
                    <span className={`font-mono ${c('textSub')}`}>{job.id.slice(0, 6)}</span>
                    <span className="truncate">{job.display_name || job.folder_name}</span>
                    <span className={`ml-auto shrink-0 ${c('textSub')}`}>({job.status})</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setBulkDeleteTarget(null)} disabled={isBulkDeleting}
                  className={`lg-glass px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50 ${isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-white/90'}`}>
                  Cancel
                </button>
                <button onClick={handleConfirmBulkDelete} disabled={isBulkDeleting}
                  className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-xl transition-colors">
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

function LogLine({ log, isDark }: { log: JobLogEntry; isDark: boolean }) {
  const colors = isDark
    ? { info: 'text-slate-400', warning: 'text-amber-400', error: 'text-red-400', debug: 'text-slate-600' }
    : { info: 'text-gray-500', warning: 'text-amber-600', error: 'text-red-600', debug: 'text-gray-400' };
  return (
    <div className={`text-xs font-mono ${colors[log.level] || (isDark ? 'text-slate-400' : 'text-gray-500')}`}>
      <span className={isDark ? 'text-slate-600' : 'text-gray-400'}>{new Date(log.timestamp).toLocaleTimeString()}</span>
      {' '}<span className={`uppercase text-[10px] font-bold opacity-60`}>[{log.level}]</span>{' '}{log.message}
    </div>
  );
}
