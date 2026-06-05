import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteJob, deleteJobs, listJobs, type JobLogEntry, type SyncJob } from '../api/client';
import { DatePicker } from '../components/DatePicker';
import { Icon, appIcons } from '../components/Icon';
import type { ThemeMode } from '../types/theme';

const PRODUCTION_API_BASE = 'https://api-novel.santngo.com';

interface DriveSyncHistoryPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

type FilterStatus = 'all' | 'queued' | 'running' | 'success' | 'error' | 'cancelled';
type FilterKind = 'all' | 'upload_single' | 'update_single';
type SortOrder = 'newest' | 'oldest';
type TimeRange = 'all' | 'today' | 'week' | 'month' | 'specific';

const STATUS_DOT_MAP: Record<string, (isDark: boolean) => string> = {
  queued: (d) => d ? 'bg-amber-400 animate-pulse' : 'bg-amber-500 animate-pulse',
  running: (d) => d ? 'bg-blue-400 animate-pulse' : 'bg-blue-500 animate-pulse',
  success: (d) => d ? 'bg-emerald-400' : 'bg-emerald-500',
  error: (d) => d ? 'bg-red-400' : 'bg-red-500',
  cancelled: (d) => d ? 'bg-white/30' : 'bg-gray-500',
};

const STATUS_TEXT_MAP: Record<string, (isDark: boolean) => string> = {
  queued: (d) => d ? 'text-amber-400' : 'text-amber-700',
  running: (d) => d ? 'text-blue-400' : 'text-blue-700',
  success: (d) => d ? 'text-emerald-400' : 'text-emerald-700',
  error: (d) => d ? 'text-red-400' : 'text-red-700',
  cancelled: (d) => d ? 'text-white/45' : 'text-gray-600',
};

const STATUS_LABEL_MAP: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Success',
  error: 'Error',
  cancelled: 'Cancelled',
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  try {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return '-';
  try {
    const endMs = finishedAt ? new Date(finishedAt).getTime() : Date.now();
    const startMs = new Date(startedAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '-';
    const secs = Math.max(0, Math.floor((endMs - startMs) / 1000));
    if (secs < 60) return `${secs}s`;
    const minutes = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${minutes}m ${seconds}s`;
  } catch {
    return '-';
  }
}

function getTimestampMs(iso: string | null): number | null {
  if (!iso) return null;
  const direct = new Date(iso).getTime();
  if (Number.isFinite(direct)) return direct;
  const normalized = new Date(iso.replace(' ', 'T')).getTime();
  return Number.isFinite(normalized) ? normalized : null;
}

function isProductionApi(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  return baseUrl.replace(/\/+$/, '') === PRODUCTION_API_BASE;
}

function getDisplayName(job: SyncJob): string {
  return job.display_name || job.folder_name || job.id;
}

interface JobCardProps {
  job: SyncJob;
  order: number;
  isSelected: boolean;
  isExpanded: boolean;
  deleteMode: boolean;
  isDark: boolean;
  c: (key: string) => string;
  onToggleExpand: (jobId: string) => void;
  onToggleSelect: (jobId: string) => void;
}

function JobCard({ job, order, isSelected, isExpanded, deleteMode, isDark, c, onToggleExpand, onToggleSelect }: JobCardProps) {
  const dotFn = STATUS_DOT_MAP[job.status] ?? STATUS_DOT_MAP.cancelled;
  const textFn = STATUS_TEXT_MAP[job.status] ?? STATUS_TEXT_MAP.cancelled;
  const dot = dotFn(isDark);
  const text = textFn(isDark);
  const label = STATUS_LABEL_MAP[job.status] ?? job.status;
  const displayName = getDisplayName(job);
  const production = isProductionApi(job.main_be_api_base_url);
  const hasChapterStats = job.chapters_added > 0 || job.chapters_skipped > 0 || !!job.chapters_count;

  const cardBg = deleteMode && isSelected
    ? isDark ? 'bg-red-500/10 border border-red-500/30' : 'bg-red-50 border border-red-200'
    : isDark ? 'lg-glass-card border border-white/[0.05]' : 'lg-glass-card border border-black/5';

  const orderBg = deleteMode && isSelected
    ? isDark ? 'bg-red-500/10 border-r border-r-red-500/30 text-red-300' : 'bg-red-100 border-r border-r-red-200 text-red-700'
    : isDark ? 'bg-indigo-500/10 border-r border-r-white/5 text-indigo-300' : 'bg-indigo-50 border-r border-r-indigo-100 text-indigo-700';

  return (
    <div
      className={`rounded-2xl overflow-hidden flex transition-all duration-200 ${cardBg} ${deleteMode ? 'cursor-pointer select-none' : ''}`}
      onClick={deleteMode ? () => onToggleSelect(job.id) : undefined}
    >
      <div className={`w-12 flex-shrink-0 border-r flex flex-col items-center justify-center rounded-l-2xl transition-colors duration-200 ${orderBg}`}>
        <span className="text-base font-bold select-none">#{order}</span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div
          className={`px-5 py-4 flex flex-col sm:flex-row items-start gap-4 ${!deleteMode ? 'cursor-pointer' : ''}`}
          onClick={(e) => { if (deleteMode) { e.stopPropagation(); onToggleSelect(job.id); } else { onToggleExpand(job.id); } }}
        >
          <div className="flex-shrink-0 mt-1 flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${dot}`} />
          </div>

          <div className="flex-1 min-w-0 w-full">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${isDark
                ? 'bg-white/[0.06] text-white/70'
                : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                {label}
              </span>
              <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${job.kind === 'upload_single'
                ? isDark ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-100 text-blue-700 border border-blue-200'
                : isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-100 text-amber-800 border border-amber-200'}`}>
                {job.kind === 'upload_single' ? 'Upload' : 'Update'}
              </span>
              {job.main_be_api_base_url && (
                <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${production
                  ? isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                  : isDark ? 'bg-white/[0.04] text-white/45' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                  {production ? 'Production' : 'Test'}
                </span>
              )}
              <span className={`text-xs font-mono ${isDark ? 'text-white/20' : 'text-slate-400'}`}>{job.id.slice(0, 8)}</span>
            </div>

            <h3 className={`mt-1.5 text-sm sm:text-base font-semibold truncate ${c('textBodyStrong')}`}>
              {displayName}
            </h3>

            <div className={`flex items-center gap-3 mt-1.5 text-xs flex-wrap ${c('textMuted')}`}>
              <span className={text}>{label}</span>
              <span>{job.folder_name}</span>
              {hasChapterStats && (
                <>
                  {job.chapters_added > 0 && <span className={isDark ? 'text-emerald-400' : 'text-emerald-700'}>+{job.chapters_added} added</span>}
                  {job.chapters_skipped > 0 && <span className={isDark ? 'text-amber-400' : 'text-amber-700'}>{job.chapters_skipped} skipped</span>}
                  {job.chapters_count ? <span>{job.chapters_count} chapter limit</span> : null}
                </>
              )}
            </div>

            {job.result_message && !job.error && (
              <p className={`text-xs truncate mt-2 ${c('textSub')}`}>{job.result_message}</p>
            )}
            {job.error && (
              <p className={`text-xs truncate mt-2 ${isDark ? 'text-red-400' : 'text-red-700'}`}>{job.error}</p>
            )}
          </div>

          <div className={`flex flex-col sm:items-end gap-1 text-xs ${c('textSub')}`}>
            <div className="flex items-center gap-2">
              {!deleteMode && (
                <Icon
                  icon={appIcons.chevronDown}
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''} ${c('textSub')}`}
                />
              )}
              <span>Created {formatDate(job.created_at)}</span>
            </div>
            {job.started_at && <span>Started {formatDate(job.started_at)}</span>}
            {job.finished_at && <span>Finished {formatDate(job.finished_at)}</span>}
            {(job.started_at || job.finished_at) && (
              <span className={`font-medium ${job.status === 'running'
                ? isDark ? 'text-blue-400' : 'text-blue-700'
                : isDark ? 'text-indigo-400' : 'text-indigo-700'}`}>
                {formatDuration(job.started_at, job.finished_at)}
              </span>
            )}
            {job.logs.length > 0 && (
              <span className={c('textMuted')}>{job.logs.length} log{job.logs.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        {isExpanded && !deleteMode && (
          <div className={`border-t px-5 py-4 ${isDark ? 'border-white/[0.05] bg-white/[0.01]' : 'border-black/5 bg-[rgba(0,0,0,0.02)]'}`}>
            <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${c('textSub')}`}>
              Job Log
            </p>
            {job.logs.length > 0 ? (
              <div className="lg-log-container max-h-[260px]">
                {job.logs.map((log, index) => (
                  <LogLine key={`${log.timestamp}-${index}`} log={log} isDark={isDark} />
                ))}
              </div>
            ) : (
              <div className={`text-sm ${c('textMuted')}`}>No log entries for this job.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function DriveSyncHistoryPage({ themeMode }: DriveSyncHistoryPageProps) {
  const isDark = themeMode === 'dark';
  const PAGE_SIZE = 15;
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [filterKind, setFilterKind] = useState<FilterKind>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [specificDate, setSpecificDate] = useState('');
  const [search, setSearch] = useState('');
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; ids: string[]; hasRunning: boolean }>({ open: false, ids: [], hasRunning: false });
  const [isDeleting, setIsDeleting] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const pageBg = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #e9f1ff 0%, #eaf7f1 38%, #fff1e5 72%, #f2ecff 100%)';

  const c = (key: string) => {
    const map: Record<string, [string, string]> = {
      text: ['text-white/90', 'text-slate-950'],
      textMuted: ['text-white/40', 'text-slate-600'],
      textSub: ['text-white/30', 'text-slate-500'],
      textBody: ['text-white/70', 'text-slate-700'],
      textBodyStrong: ['text-white/85', 'text-slate-900'],
      divider: ['bg-white/6', 'bg-slate-300'],
    };
    return map[key]?.[isDark ? 0 : 1] ?? '';
  };

  const loadJobs = useCallback(async (): Promise<void> => {
    setError('');
    try {
      const data = await listJobs(200, 0);
      setJobs(data.jobs);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sync history.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadJobs().finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadJobs]);

  useEffect(() => {
    const hasActiveJobs = jobs.some(job => job.status === 'queued' || job.status === 'running');
    if (!hasActiveJobs) return;
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, [jobs, loadJobs]);

  const timeCutoff = (() => {
    if (timeRange === 'all') return null;
    const now = new Date();
    if (timeRange === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    if (timeRange === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return start;
    }
    if (timeRange === 'month') {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      return start;
    }
    if (timeRange === 'specific' && specificDate) {
      return {
        start: new Date(`${specificDate}T00:00:00`),
        end: new Date(`${specificDate}T23:59:59`),
      };
    }
    return null;
  })();

  const searchText = search.trim().toLowerCase();
  const baseFiltered = jobs
    .filter(job => {
      if (filterKind !== 'all' && job.kind !== filterKind) return false;
      if (searchText) {
        const haystack = `${job.display_name} ${job.folder_name} ${job.id} ${job.result_message ?? ''} ${job.error ?? ''}`.toLowerCase();
        if (!haystack.includes(searchText)) return false;
      }
      if (timeCutoff) {
        const time = getTimestampMs(job.created_at);
        if (time === null) return false;
        if (timeCutoff instanceof Date) return time >= timeCutoff.getTime();
        return time >= timeCutoff.start.getTime() && time <= timeCutoff.end.getTime();
      }
      return true;
    });

  const filtered = baseFiltered
    .filter(job => filter === 'all' || job.status === filter)
    .sort((a, b) => {
      const aTime = getTimestampMs(a.created_at) ?? 0;
      const bTime = getTimestampMs(b.created_at) ?? 0;
      return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
    });

  const visibleJobs = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const liveJobIds = new Set(jobs.map(job => job.id));
  const liveSelectedIds = new Set(Array.from(selectedIds).filter(id => liveJobIds.has(id)));
  const allVisibleSelected = visibleJobs.length > 0 && visibleJobs.every(job => liveSelectedIds.has(job.id));
  const activeJobs = jobs.filter(job => job.status === 'queued' || job.status === 'running');
  const primaryActiveJob = jobs.find(job => job.status === 'running') ?? jobs.find(job => job.status === 'queued') ?? null;

  const filteredCounts = {
    all: baseFiltered.length,
    running: baseFiltered.filter(job => job.status === 'running').length,
    queued: baseFiltered.filter(job => job.status === 'queued').length,
    success: baseFiltered.filter(job => job.status === 'success').length,
    error: baseFiltered.filter(job => job.status === 'error').length,
    cancelled: baseFiltered.filter(job => job.status === 'cancelled').length,
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setVisibleCount(PAGE_SIZE), 0);
    return () => window.clearTimeout(timer);
  }, [PAGE_SIZE, filter, filterKind, sortOrder, timeRange, specificDate, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSelectedIds(new Set()), 0);
    return () => window.clearTimeout(timer);
  }, [filter, filterKind, timeRange, specificDate, search]);

  useEffect(() => {
    if (!hasMore) return;
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filtered.length));
        }
      },
      { rootMargin: '300px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [PAGE_SIZE, filtered.length, hasMore]);

  const toggleDeleteMode = () => {
    if (deleteMode) {
      setDeleteMode(false);
      setSelectedIds(new Set());
    } else {
      setDeleteMode(true);
      setExpandedJobId(null);
    }
  };

  const handleToggleSelect = (jobId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const handleDeleteClick = () => {
    if (liveSelectedIds.size === 0) return;
    const ids = Array.from(liveSelectedIds);
    const hasRunning = ids.some(id => {
      const job = jobs.find(item => item.id === id);
      return job?.status === 'queued' || job?.status === 'running';
    });
    setDeleteConfirmation({ open: true, ids, hasRunning });
  };

  const handleConfirmDelete = async () => {
    if (deleteConfirmation.ids.length === 0) return;
    try {
      setIsDeleting(true);
      if (deleteConfirmation.ids.length === 1) {
        await deleteJob(deleteConfirmation.ids[0]);
      } else {
        await deleteJobs(deleteConfirmation.ids);
      }
      const deletedIds = new Set(deleteConfirmation.ids);
      setJobs(prev => prev.filter(job => !deletedIds.has(job.id)));
      setSelectedIds(new Set());
      setDeleteMode(false);
      setDeleteConfirmation({ open: false, ids: [], hasRunning: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete sync jobs.');
      setDeleteConfirmation({ open: false, ids: [], hasRunning: false });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleExpand = (jobId: string) => {
    setExpandedJobId(prev => prev === jobId ? null : jobId);
  };

  const handleRefresh = () => {
    setLoading(true);
    loadJobs().finally(() => setLoading(false));
  };

  const selectedJobs = deleteConfirmation.ids
    .map(id => jobs.find(job => job.id === id))
    .filter((job): job is SyncJob => !!job);

  const filterBarBase = 'lg-glass-nav p-1.5';
  const filterBtnActive = 'bg-indigo-600 text-white';
  const filterBtnInactive = isDark ? 'text-white/40 hover:text-white/70' : 'text-slate-500 hover:text-slate-800';

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBg }}>
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />

      {deleteConfirmation.open && (
        <div className="lg-modal-overlay">
          <div className="lg-glass-deep p-6 max-w-md w-full space-y-4">
            <h3 className={`text-lg font-semibold ${c('text')}`}>
              {deleteConfirmation.hasRunning ? 'Warning' : 'Confirm Delete'}
            </h3>
            {deleteConfirmation.hasRunning ? (
              <div className="space-y-3">
                <p className={`text-sm ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
                  You are about to delete {deleteConfirmation.ids.length} sync job{deleteConfirmation.ids.length !== 1 ? 's' : ''}, including active job(s).
                </p>
                <p className={`text-sm font-medium ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
                  This action cannot be undone.
                </p>
              </div>
            ) : (
              <p className={`text-sm ${c('textBody')}`}>
                Are you sure you want to delete {deleteConfirmation.ids.length} sync job{deleteConfirmation.ids.length !== 1 ? 's' : ''}? This action cannot be undone.
              </p>
            )}
            {selectedJobs.length > 0 && (
              <div className={`max-h-40 overflow-y-auto rounded-xl p-3 space-y-1 ${isDark ? 'bg-white/[0.04]' : 'bg-slate-100/80'}`}>
                {selectedJobs.slice(0, 6).map(job => (
                  <div key={job.id} className={`flex items-center gap-2 text-xs ${c('textBody')}`}>
                    <span className={`font-mono ${c('textSub')}`}>{job.id.slice(0, 6)}</span>
                    <span className="truncate">{getDisplayName(job)}</span>
                    <span className={`ml-auto shrink-0 ${STATUS_TEXT_MAP[job.status]?.(isDark) ?? c('textMuted')}`}>{STATUS_LABEL_MAP[job.status] ?? job.status}</span>
                  </div>
                ))}
                {selectedJobs.length > 6 && (
                  <div className={`text-xs ${c('textSub')}`}>+{selectedJobs.length - 6} more</div>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setDeleteConfirmation({ open: false, ids: [], hasRunning: false })}
                disabled={isDeleting}
                className="lg-btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="lg-btn-danger"
                style={{ opacity: isDeleting ? 0.4 : 1 }}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <main className="w-full xl:max-w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
          <div className="lg-glass-deep px-6 py-5 flex items-start justify-between gap-4">
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold tracking-tight ${c('text')}`}>Sync History</h1>
              <p className={`text-sm mt-1 ${c('textMuted')}`}>
                {filtered.length} of {jobs.length} jobs
                {filter !== 'all' && ` | ${filter}`}
                {filterKind !== 'all' && ` | ${filterKind === 'upload_single' ? 'upload' : 'update'}`}
                {timeRange !== 'all' && ` | ${timeRange === 'today' ? 'today' : timeRange === 'week' ? '7 days' : timeRange === 'month' ? '30 days' : specificDate || 'date'}`}
                {` | refreshed ${lastRefresh.toLocaleTimeString()}`}
              </p>
            </div>
          </div>

          {activeJobs.length > 0 && (
            <div className="lg-glass p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                  <span className={`text-sm ${c('textBody')}`}>
                    <span className={`font-medium ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>
                      {activeJobs.length} active sync job{activeJobs.length !== 1 ? 's' : ''}
                    </span>
                    {primaryActiveJob && (
                      <span className={`${c('textMuted')} ml-2`}>
                        - {primaryActiveJob.status === 'running' ? 'Processing' : 'Queued'}: {getDisplayName(primaryActiveJob)}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-start gap-2">
            <button onClick={() => navigate('/drive-sync')} className="lg-btn-primary shadow-lg shadow-indigo-600/30">
              <Icon icon={appIcons.uploadFile} className="w-3.5 h-3.5" />
              New Sync
            </button>
            <button
              onClick={toggleDeleteMode}
              className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${deleteMode
                ? isDark ? 'text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20' : 'text-red-700 border border-red-300 bg-red-50 hover:bg-red-100'
                : isDark ? 'text-white/50 border border-white/5 hover:text-white/70 hover:bg-white/[0.04]' : 'text-slate-500 border border-slate-300 hover:text-slate-800 hover:bg-slate-100/70'}`}
            >
              {deleteMode ? 'Cancel Delete' : 'Delete Mode'}
            </button>
            {deleteMode && (
              <button
                onClick={() => allVisibleSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(visibleJobs.map(job => job.id)))}
                className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${isDark ? 'text-white/50 border border-white/5 hover:text-white/70 hover:bg-white/[0.04]' : 'text-slate-500 border border-slate-300 hover:text-slate-800 hover:bg-slate-100/70'}`}
              >
                {allVisibleSelected ? 'Unselect All' : 'Select All'}
              </button>
            )}
            {deleteMode && liveSelectedIds.size > 0 && (
              <button
                onClick={handleDeleteClick}
                disabled={isDeleting}
                className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 shadow-lg ${isDeleting
                  ? isDark ? 'text-red-400 bg-red-500/20 cursor-not-allowed shadow-none' : 'text-red-500 bg-red-100 cursor-not-allowed shadow-none'
                  : 'text-white bg-red-600 hover:bg-red-500 shadow-red-600/30'}`}
              >
                {isDeleting ? 'Deleting...' : `Delete (${liveSelectedIds.size})`}
              </button>
            )}
          </div>

          {deleteMode && (
            <div className={`rounded-2xl p-3 flex items-center justify-between gap-3 ${isDark
              ? 'bg-red-500/10 border border-red-500/20'
              : 'bg-red-50 border border-red-200'}`}>
              <div className="flex items-center gap-2">
                <Icon icon={appIcons.delete} className={`w-5 h-5 ${isDark ? 'text-red-400' : 'text-red-600'}`} />
                <span className={`text-sm font-medium ${isDark ? 'text-red-300' : 'text-red-800'}`}>Delete Mode Active</span>
                {liveSelectedIds.size > 0 && <span className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>({liveSelectedIds.size} selected)</span>}
              </div>
              <button onClick={toggleDeleteMode} className={`text-xs underline ${isDark ? 'text-red-300 hover:text-white' : 'text-red-600 hover:text-red-800'}`}>
                Exit Delete Mode
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
            <div className={`flex items-center gap-1 rounded-xl ${filterBarBase}`}>
              {([
                ['all', `All (${filteredCounts.all})`],
                ['running', `Running (${filteredCounts.running})`],
                ['queued', `Queued (${filteredCounts.queued})`],
                ['success', `Done (${filteredCounts.success})`],
                ['error', `Error (${filteredCounts.error})`],
                ['cancelled', `Cancelled (${filteredCounts.cancelled})`],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${filter === value ? filterBtnActive : filterBtnInactive}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className={`flex items-center gap-1 rounded-xl ${filterBarBase}`}>
              <span className={`px-2 text-xs hidden sm:inline ${c('textSub')}`}>Type:</span>
              {([
                ['all', 'All'],
                ['upload_single', 'Upload'],
                ['update_single', 'Update'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilterKind(value)}
                  className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${filterKind === value ? filterBtnActive : filterBtnInactive}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className={`flex items-center gap-1 rounded-xl ${filterBarBase}`}>
              <span className={`px-2 text-xs hidden sm:inline ${c('textSub')}`}>Sort:</span>
              <button onClick={() => setSortOrder('newest')} className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${sortOrder === 'newest' ? filterBtnActive : filterBtnInactive}`}>Newest</button>
              <button onClick={() => setSortOrder('oldest')} className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${sortOrder === 'oldest' ? filterBtnActive : filterBtnInactive}`}>Oldest</button>
            </div>

            <div className={`flex items-center gap-1 rounded-xl ${filterBarBase}`}>
              <span className={`px-2 text-xs hidden sm:inline ${c('textSub')}`}>Time:</span>
              {(['all', 'today', 'week', 'month'] as const).map(value => (
                <button
                  key={value}
                  onClick={() => { setTimeRange(value); setSpecificDate(''); }}
                  className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${timeRange === value ? filterBtnActive : filterBtnInactive}`}
                >
                  {value === 'all' ? 'All' : value === 'today' ? 'Today' : value === 'week' ? '7d' : '30d'}
                </button>
              ))}
            </div>

            <DatePicker
              value={specificDate}
              onDateChange={(date) => {
                setSpecificDate(date);
                setTimeRange(date ? 'specific' : 'all');
              }}
              isDark={isDark}
            />

            <button onClick={handleRefresh} className="lg-icon-btn" title="Refresh now">
              <Icon icon={appIcons.refresh} className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="relative">
            <Icon icon={appIcons.search} className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${c('textMuted')}`} />
            <input
              type="text"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search by story, folder, job ID, or message..."
              className={`w-full pl-10 pr-10 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${isDark
                ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder-white/30'
                : 'bg-white/70 border-slate-300 text-slate-900 placeholder:text-slate-400'}`}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-white/30 hover:text-white/70' : 'text-slate-400 hover:text-slate-700'}`}
                title="Clear search"
              >
                <Icon icon={appIcons.close} className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

            {loading && jobs.length === 0 && (
            <div className={`flex items-center justify-center py-16 gap-3 ${c('textMuted')}`}>
              <Icon icon={appIcons.spinner} className="animate-spin h-5 w-5" />
              <span>Loading sync history...</span>
            </div>
          )}

          {error && (
            <div className={`flex items-center justify-between gap-3 p-4 rounded-2xl text-sm ${isDark
              ? 'bg-red-500/10 border border-red-500/20 text-red-400'
              : 'bg-red-50 border border-red-200 text-red-700'}`}>
              <span>{error}</span>
              <button onClick={handleRefresh} className="underline hover:no-underline shrink-0">Retry</button>
            </div>
          )}

          {!loading && jobs.length === 0 && (
            <div className={`text-center py-20 space-y-3 ${c('textMuted')}`}>
              <div className="flex justify-center">
                <Icon icon={appIcons.uploadFile} className={`w-12 h-12 ${isDark ? 'text-white/10' : 'text-slate-300'}`} />
              </div>
              <p className={c('textMuted')}>No sync jobs yet.</p>
              <button onClick={() => navigate('/drive-sync')} className={`text-sm underline ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-700 hover:text-indigo-900'}`}>
                Start your first sync
              </button>
            </div>
          )}

          {!loading && jobs.length > 0 && filtered.length === 0 && (
            <div className={`text-center py-20 space-y-3 ${c('textMuted')}`}>
              <div className="flex justify-center">
                <Icon icon={appIcons.search} className={`w-12 h-12 ${isDark ? 'text-white/10' : 'text-slate-300'}`} />
              </div>
              <p className={c('textMuted')}>No jobs match your filters.</p>
              <button
                onClick={() => { setFilter('all'); setFilterKind('all'); setSortOrder('newest'); setTimeRange('all'); setSpecificDate(''); setSearch(''); }}
                className={`text-sm underline ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-700 hover:text-indigo-900'}`}
              >
                Clear all filters
              </button>
            </div>
          )}

          <div className="space-y-3">
            {visibleJobs.map((job, index) => (
              <JobCard
                key={job.id}
                job={job}
                order={index + 1}
                isSelected={liveSelectedIds.has(job.id)}
                isExpanded={expandedJobId === job.id}
                deleteMode={deleteMode}
                isDark={isDark}
                c={c}
                onToggleExpand={handleToggleExpand}
                onToggleSelect={handleToggleSelect}
              />
            ))}
            {hasMore && <div ref={loadMoreRef} className={`py-6 text-center text-xs ${c('textSub')}`}>Loading more jobs...</div>}
          </div>

          {!loading && filtered.length > 0 && (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleRefresh}
                className={`px-4 py-2 text-sm border rounded-xl transition-colors ${isDark
                  ? 'text-white/40 hover:text-white/70 border-white/5 hover:bg-white/[0.04]'
                  : 'text-slate-500 hover:text-slate-800 border-slate-300 hover:bg-slate-100/70'}`}
              >
                Refresh
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function LogLine({ log, isDark }: { log: JobLogEntry; isDark: boolean }) {
  const colors: Record<JobLogEntry['level'], string> = isDark
    ? { info: 'text-slate-300', warning: 'text-amber-400', error: 'text-red-400', debug: 'text-slate-500' }
    : { info: 'text-slate-700', warning: 'text-amber-700', error: 'text-red-700', debug: 'text-slate-500' };

  return (
    <div className={`text-xs font-mono ${colors[log.level]}`}>
      <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>{new Date(log.timestamp).toLocaleTimeString()}</span>
      {' '}<span className="uppercase text-[10px] font-bold opacity-70">[{log.level}]</span>{' '}
      {log.message}
    </div>
  );
}
