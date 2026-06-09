import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cancelBatchJob,
  getChapterAudioUrl,
  getBatchZipUrl,
  listAllBatchJobs,
  removeBatchJob,
  type BatchJob,
} from '../api/client';
import { DatePicker } from '../components/DatePicker';

interface BedReadJobsPageProps {
  themeMode: 'light' | 'dark';
  onThemeChange: (mode: 'light' | 'dark') => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function formatDuration(start: string | null, finish: string | null): string {
  if (!start || !finish) return '—';
  try {
    const secs = Math.floor((new Date(finish).getTime() - new Date(start).getTime()) / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  } catch { return '—'; }
}

function getGenerationStart(job: BatchJob): string | null {
  if (job.processing_started_at) return job.processing_started_at;
  if (job.status === 'queued' || job.status === 'pending') return null;
  return job.started_at;
}

function canDeleteBatchJob(job: BatchJob): boolean {
  return job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed';
}

const STATUS_DOT_MAP: Record<string, (isDark: boolean) => string> = {
  pending: (d) => d ? 'bg-white/30' : 'bg-gray-400',
  queued: (d) => d ? 'bg-amber-400' : 'bg-amber-400',
  running: (d) => d ? 'bg-blue-400' : 'bg-blue-500',
  completed: (d) => d ? 'bg-emerald-400' : 'bg-emerald-500',
  failed: (d) => d ? 'bg-red-400' : 'bg-red-500',
  cancelled: (d) => d ? 'bg-amber-400' : 'bg-amber-500',
};

const STATUS_LABEL_MAP: Record<string, string> = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const CHAPTER_STATUS_DOT_MAP: Record<string, (isDark: boolean) => string> = {
  pending: (d) => d ? 'bg-white/30' : 'bg-gray-400',
  queued: (d) => d ? 'bg-indigo-400' : 'bg-indigo-400',
  processing: (d) => d ? 'bg-blue-400' : 'bg-blue-500',
  completed: (d) => d ? 'bg-emerald-400' : 'bg-emerald-500',
  failed: (d) => d ? 'bg-red-400' : 'bg-red-500',
};

const CHAPTER_STATUS_TEXT_MAP: Record<string, (isDark: boolean) => string> = {
  pending: (d) => d ? 'text-white/40' : 'text-gray-500',
  queued: (d) => d ? 'text-indigo-400' : 'text-indigo-600',
  processing: (d) => d ? 'text-blue-400' : 'text-blue-600',
  completed: (d) => d ? 'text-emerald-400' : 'text-emerald-600',
  failed: (d) => d ? 'text-red-400' : 'text-red-600',
};

interface JobCardProps {
  job: BatchJob;
  order: number;
  isSelected: boolean;
  deleteMode: boolean;
  isDark: boolean;
  canSelectForDelete: boolean;
  panelBorder: string;
  pageText: string;
  secondaryText: string;
  tertiaryText: string;
  mutedSurface: string;
  selectedSurface: string;
  onToggleSelect: (batchId: string) => void;
  onCancel: (batchId: string, storyTitle: string) => void;
  onDownloadChapter: (batchId: string, chapterNum: number) => void;
  onDownloadZip: (batchId: string) => void;
}

function JobCard({
  job,
  order,
  isSelected,
  deleteMode,
  isDark,
  canSelectForDelete,
  panelBorder,
  pageText,
  secondaryText,
  tertiaryText,
  mutedSurface,
  selectedSurface,
  onToggleSelect,
  onCancel,
  onDownloadChapter,
  onDownloadZip,
}: JobCardProps) {
  const [expanded, setExpanded] = useState(false);

  const dotFn = STATUS_DOT_MAP[job.status] ?? STATUS_DOT_MAP.pending;
  const dot = dotFn(isDark);
  const label = STATUS_LABEL_MAP[job.status] ?? job.status;

  const completedCount = job.chapters.filter((c) => c.status === 'completed').length;
  const failedCount = job.chapters.filter((c) => c.status === 'failed').length;
  const totalCount = job.chapters.length;
  const progressPct = job.progress_pct;
  const allDone = completedCount === totalCount && totalCount > 0;
  const isAutoMode = job.from_auto_mode === true;
  const generationStartedAt = getGenerationStart(job);

  const chDotFn = (status: string) =>
    CHAPTER_STATUS_DOT_MAP[status] ?? CHAPTER_STATUS_DOT_MAP.pending;
  const chTextFn = (status: string) =>
    CHAPTER_STATUS_TEXT_MAP[status] ?? CHAPTER_STATUS_TEXT_MAP.pending;

  return (
    <article
      className={`transition-colors ${deleteMode ? (canSelectForDelete ? 'cursor-pointer select-none' : 'opacity-75') : ''}`}
      style={{ background: deleteMode && isSelected ? selectedSurface : 'transparent' }}
      onClick={deleteMode && canSelectForDelete ? () => onToggleSelect(job.batch_id) : undefined}
    >
      <div
        className="px-5 py-4 sm:px-6"
        style={{ borderTop: order === 1 ? 'none' : `1px solid ${panelBorder}` }}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium" style={{ color: tertiaryText }}>#{order}</span>
              <div className={`h-2.5 w-2.5 rounded-full ${dot}`} />
              <span
                className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                style={{ background: mutedSurface, color: secondaryText }}
              >
                {label}
              </span>
              {job.status === 'queued' && job.queue_position && job.queue_position > 0 && (
                <span
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: mutedSurface, color: secondaryText }}
                >
                  #{job.queue_position} in queue
                </span>
              )}
              <span className="font-mono text-[11px]" style={{ color: tertiaryText }}>
                {job.batch_id.slice(0, 8)}
              </span>
            </div>

            <div className="mt-2 text-sm font-semibold sm:text-[15px] truncate" style={{ color: pageText }}>
              {job.story_title}
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" style={{ color: secondaryText }}>
              <span>{totalCount} chapter{totalCount !== 1 ? 's' : ''}</span>
              {completedCount > 0 && <span>{completedCount} done</span>}
              {failedCount > 0 && <span style={{ color: isDark ? '#f87171' : '#dc2626' }}>{failedCount} failed</span>}
              {(job.status === 'running' || job.status === 'queued') && (
                <span>{generationStartedAt
                  ? `Generating since ${formatDate(generationStartedAt)}`
                  : 'Waiting to generate'}
                </span>
              )}
              {job.finished_at && <span>Finished {formatDate(job.finished_at)}</span>}
              {(job.started_at || job.finished_at) && (
                <span style={{ color: pageText }}>
                  {formatDuration(job.started_at, job.finished_at)}
                </span>
              )}
            </div>

            {job.status === 'running' && totalCount > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs" style={{ color: secondaryText }}>
                  <span>{completedCount}/{totalCount} chapters</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: mutedSurface }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progressPct}%`, background: '#6366f1' }} />
                </div>
              </div>
            )}

            {job.error && (
              <p className="mt-2 text-sm" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
                {job.error}
              </p>
            )}
          </div>

          <div className="flex items-start gap-3 lg:flex-col lg:items-end">
            <div className="flex flex-wrap gap-2">
              {allDone && !deleteMode && !isAutoMode && (
                <button
                  onClick={(event) => { event.stopPropagation(); onDownloadZip(job.batch_id); }}
                  className="rounded-md border px-3 py-2 text-sm transition-colors"
                  style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                >
                  Download ZIP
                </button>
              )}
              {isAutoMode && (
                <span
                  className="rounded-md px-3 py-2 text-sm"
                  style={{ background: mutedSurface, color: secondaryText }}
                >
                  {deleteMode && canSelectForDelete
                    ? 'Auto Mode — Deletable'
                    : deleteMode
                      ? 'Auto Mode — Cannot Delete'
                      : 'Auto Mode'}
                </span>
              )}
              {deleteMode && !canSelectForDelete && (
                <span
                  className="rounded-md px-3 py-2 text-sm"
                  style={{ background: mutedSurface, color: secondaryText }}
                >
                  Active — Cannot Delete
                </span>
              )}
              {(job.status === 'running' || job.status === 'queued') && !deleteMode && !isAutoMode && (
                <button
                  onClick={(event) => { event.stopPropagation(); onCancel(job.batch_id, job.story_title); }}
                  className="rounded-md px-3 py-2 text-sm text-white transition-opacity"
                  style={{ background: '#dc2626' }}
                >
                  {job.status === 'running' ? 'Cancel' : 'Remove'}
                </button>
              )}
              <button
                onClick={(event) => { event.stopPropagation(); setExpanded((v) => !v); }}
                className="rounded-md border px-3 py-2 text-sm transition-colors"
                style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
              >
                {expanded ? 'Hide' : `${totalCount}C`}
              </button>
            </div>
          </div>
        </div>

        {expanded && job.chapters.length > 0 && (
          <div className="mt-4 border-t pt-4" style={{ borderColor: panelBorder }}>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: tertiaryText }}>
              Chapters ({completedCount}/{totalCount} completed)
            </div>
            <div className="overflow-hidden rounded-xl border" style={{ borderColor: panelBorder }}>
              {job.chapters.map((ch) => {
                const isRunning =
                  ch.status === 'queued' ||
                  ch.status === 'processing' ||
                  (ch.progress_pct > 0 && ch.progress_pct < 100);

                return (
                  <div
                    key={ch.chapter_number}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                    style={{ borderTop: ch === job.chapters[0] ? 'none' : `1px solid ${panelBorder}` }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={`h-2 w-2 rounded-full flex-shrink-0 ${chDotFn(ch.status)(isDark)}`} />
                      <span className="font-mono text-[11px] flex-shrink-0" style={{ color: secondaryText }}>
                        #{ch.chapter_number}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className={`text-sm truncate block ${chTextFn(ch.status)(isDark)}`}>
                          {ch.title}
                        </span>
                        {isRunning && ch.progress_pct > 0 && (
                          <div className="mt-1 space-y-0.5">
                            <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: mutedSurface }}>
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${ch.progress_pct}%`, background: '#3b82f6' }}
                              />
                            </div>
                            <span className="text-[10px]" style={{ color: secondaryText }}>{ch.progress_pct}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {ch.status === 'failed' && ch.error && (
                        <span
                          className="max-w-[150px] truncate text-xs"
                          style={{ color: isDark ? '#f87171' : '#dc2626' }}
                        >
                          {ch.error}
                        </span>
                      )}
                      {ch.status === 'completed' && !deleteMode && !isAutoMode && (
                        <button
                          onClick={() => onDownloadChapter(job.batch_id, ch.chapter_number)}
                          className="rounded-md border px-2.5 py-1 text-xs transition-colors"
                          style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export default function BedReadJobsPage({ themeMode }: BedReadJobsPageProps) {
  const isDark = themeMode === 'dark';
  const PAGE_SIZE = 15;
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'queued' | 'completed' | 'failed'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [timeRange, setTimeRange] = useState<'all' | 'today' | 'week' | 'month' | 'specific'>('all');
  const [specificDate, setSpecificDate] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    open: boolean;
    ids: string[];
    hasRunning: boolean;
  }>({ open: false, ids: [], hasRunning: false });
  const [deleteMode, setDeleteMode] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState<{
    open: boolean;
    batchId: string | null;
    storyTitle: string;
  }>({ open: false, batchId: null, storyTitle: '' });
  const [_cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const fetchJobs = useCallback((): Promise<void> => {
    return listAllBatchJobs()
      .then((data) => setJobs(data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLastRefresh(new Date()));
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setError('');
    fetchJobs().finally(() => setIsLoading(false));
    const interval = setInterval(fetchJobs, 1000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const timeCutoff = (() => {
    if (timeRange === 'all') return null;
    const now = new Date();
    if (timeRange === 'today') {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (timeRange === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    if (timeRange === 'month') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return d;
    }
    if (timeRange === 'specific' && specificDate) {
      const d = new Date(`${specificDate}T00:00:00`);
      const end = new Date(`${specificDate}T23:59:59`);
      return { start: d, end };
    }
    return null;
  })();

  const filtered = jobs
    .filter((j) => {
      if (filter === 'all') return true;
      if (filter === 'running') return j.status === 'running';
      if (filter === 'queued') return j.status === 'queued';
      if (filter === 'failed') return j.status === 'failed' || j.status === 'cancelled';
      return j.status === filter;
    })
    .filter((j) => {
      if (!timeCutoff || !j.started_at) return true;
      const jobTime = new Date(j.started_at).getTime();
      if ('start' in timeCutoff && 'end' in timeCutoff) {
        return jobTime >= timeCutoff.start.getTime() && jobTime <= timeCutoff.end.getTime();
      }
      return jobTime >= (timeCutoff as Date).getTime();
    })
    .sort((a, b) => {
      const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
      const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
      return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
    });

  const visibleJobs = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const deletableVisibleJobs = visibleJobs.filter(canDeleteBatchJob);
  const allVisibleSelected =
    deletableVisibleJobs.length > 0 &&
    deletableVisibleJobs.every((j) => selectedIds.has(j.batch_id));

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter, sortOrder, timeRange, specificDate]);

  useEffect(() => {
    if (!hasMore) return;
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length));
        }
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, filtered.length]);

  const handleToggleSelect = (batchId: string) => {
    const job = jobs.find((j) => j.batch_id === batchId);
    if (!job || !canDeleteBatchJob(job)) return;
    const s = new Set(selectedIds);
    s.has(batchId) ? s.delete(batchId) : s.add(batchId);
    setSelectedIds(s);
  };

  const toggleDeleteMode = () => {
    if (deleteMode) {
      setDeleteMode(false);
      setSelectedIds(new Set());
    } else {
      setDeleteMode(true);
    }
  };

  const handleDeleteClick = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const hasRunning = ids.some((id) => {
      const job = jobs.find((j) => j.batch_id === id);
      return job?.status === 'running' || job?.status === 'queued' || job?.status === 'pending';
    });
    setDeleteConfirmation({ open: true, ids, hasRunning });
  };

  const handleConfirmDelete = async () => {
    try {
      setIsDeleting(true);
      for (const id of deleteConfirmation.ids) {
        await removeBatchJob(id);
      }
      setSelectedIds(new Set());
      setDeleteConfirmation({ open: false, ids: [], hasRunning: false });
      setDeleteMode(false);
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete jobs');
      setDeleteConfirmation({ open: false, ids: [], hasRunning: false });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = (batchId: string, storyTitle: string) => {
    setCancelConfirmation({ open: true, batchId, storyTitle });
  };

  const handleConfirmCancel = async () => {
    if (!cancelConfirmation.batchId) return;
    const batchId = cancelConfirmation.batchId;
    setCancelConfirmation({ open: false, batchId: null, storyTitle: '' });
    try {
      setCancellingIds((prev) => new Set(prev).add(batchId));
      await cancelBatchJob(batchId);
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel job');
    } finally {
      setCancellingIds((prev) => {
        const n = new Set(prev);
        n.delete(batchId);
        return n;
      });
    }
  };

  const handleDownloadChapter = (batchId: string, chapterNum: number) => {
    const a = document.createElement('a');
    a.href = getChapterAudioUrl(batchId, chapterNum);
    a.download = `chapter_${chapterNum}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadZip = (batchId: string) => {
    const a = document.createElement('a');
    a.href = getBatchZipUrl(batchId);
    a.download = `bedread_${batchId}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const runningJob = filtered.find((j) => j.status === 'running');
  const queuedJobs = filtered.filter((j) => j.status === 'queued');
  const totalQueueSize = queuedJobs.length;

  const filteredCounts = {
    all: filtered.length,
    running: filtered.filter((j) => j.status === 'running').length,
    queued: filtered.filter((j) => j.status === 'queued').length,
    completed: filtered.filter((j) => j.status === 'completed').length,
    failed: filtered.filter((j) => j.status === 'failed' || j.status === 'cancelled').length,
  };

  const pageBg = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const selectedSurface = isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.08)';
  const activeSurface = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(55,53,47,0.1)';

  const statusOptions: Array<{ value: typeof filter; label: string }> = [
    { value: 'all', label: `All (${filteredCounts.all})` },
    { value: 'running', label: `Running (${filteredCounts.running})` },
    { value: 'queued', label: `Queued (${filteredCounts.queued})` },
    { value: 'completed', label: `Done (${filteredCounts.completed})` },
    { value: 'failed', label: `Failed (${filteredCounts.failed})` },
  ];

  const timeRangeOptions: Array<{ value: typeof timeRange; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: '7d' },
    { value: 'month', label: '30d' },
  ];

  const timeRangeLabels: Record<typeof timeRange, string> = {
    all: 'All time',
    today: 'Today',
    week: 'Last 7 days',
    month: 'Last 30 days',
    specific: specificDate || 'Date',
  };

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBg }}>
      {deleteConfirmation.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className="w-full max-w-md rounded-2xl border p-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <h3 className="text-lg font-semibold" style={{ color: pageText }}>
              {deleteConfirmation.hasRunning
                ? 'Warning — active jobs included'
                : 'Confirm delete'}
            </h3>
            {deleteConfirmation.hasRunning ? (
              <div className="mt-3 space-y-2 text-sm" style={{ color: isDark ? '#fbbf24' : '#b45309' }}>
                <p>
                  You are about to delete {deleteConfirmation.ids.length} job
                  {deleteConfirmation.ids.length !== 1 ? 's' : ''}, including active
                  job(s).
                </p>
                <p className="font-medium">This action cannot be undone.</p>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6" style={{ color: secondaryText }}>
                Delete {deleteConfirmation.ids.length} job
                {deleteConfirmation.ids.length !== 1 ? 's' : ''}? This action cannot be undone.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmation({ open: false, ids: [], hasRunning: false })}
                disabled={isDeleting}
                className="rounded-md border px-3 py-2 text-sm transition-colors"
                style={{ borderColor: panelBorder, color: secondaryText, background: mutedSurface }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="rounded-md px-3 py-2 text-sm text-white transition-opacity"
                style={{ background: '#dc2626', opacity: isDeleting ? 0.6 : 1 }}
              >
                {isDeleting ? 'Removing…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelConfirmation.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className="w-full max-w-md rounded-2xl border p-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <h3 className="text-lg font-semibold" style={{ color: pageText }}>
              Cancel this TTS job?
            </h3>
            <p className="mt-3 text-sm leading-6" style={{ color: secondaryText }}>
              Are you sure you want to cancel{' '}
              <span className="font-semibold" style={{ color: pageText }}>
                {cancelConfirmation.storyTitle}
              </span>
              ? This will stop the audio generation and cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setCancelConfirmation({ open: false, batchId: null, storyTitle: '' })}
                disabled={_cancellingIds.size > 0}
                className="rounded-md border px-3 py-2 text-sm transition-colors"
                style={{ borderColor: panelBorder, color: secondaryText, background: mutedSurface }}
              >
                Keep Running
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={_cancellingIds.size > 0}
                className="rounded-md px-3 py-2 text-sm text-white transition-opacity"
                style={{ background: '#dc2626', opacity: _cancellingIds.size > 0 ? 0.6 : 1 }}
              >
                {_cancellingIds.size > 0 ? 'Cancelling…' : 'Cancel Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header
          className="rounded-2xl border px-5 py-5 sm:px-6"
          style={{ background: panelBackground, borderColor: panelBorder }}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                History
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                BedRead audio jobs
              </h1>
              <p className="max-w-3xl text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                Monitor ongoing and past TTS generation runs, download completed chapters, and clean up old jobs.
              </p>
            </div>

            <div className="space-y-1 text-right text-xs lg:text-sm" style={{ color: tertiaryText }}>
              {runningJob && (
                <div>
                  <span style={{ color: isDark ? '#60a5fa' : '#1d4ed8' }}>
                    Processing: {runningJob.story_title} ({runningJob.progress_pct}%)
                  </span>
                </div>
              )}
              {totalQueueSize > 0 && (
                <div>
                  <span style={{ color: isDark ? '#fbbf24' : '#b45309' }}>
                    {totalQueueSize} in queue
                    {queuedJobs[0] ? ` — Next: ${queuedJobs[0].story_title}` : ''}
                    {totalQueueSize > 1 ? ` (+${totalQueueSize - 1} more)` : ''}
                  </span>
                </div>
              )}
              <div>
                {filtered.length} of {jobs.length} jobs
                {filter !== 'all' && ` · ${filter}`}
                {timeRange !== 'all' && ` · ${timeRangeLabels[timeRange]}`}
              </div>
              <div>Refreshed {lastRefresh.toLocaleTimeString()}</div>
            </div>
          </div>
        </header>

        <main className="mt-5 flex-1 space-y-5">
          <section
            className="rounded-2xl border px-5 py-4 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
              <div>
                <DatePicker
                  value={specificDate}
                  onDateChange={(date) => {
                    setSpecificDate(date);
                    setTimeRange(date ? 'specific' : 'all');
                  }}
                  isDark={isDark}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setIsLoading(true);
                    fetchJobs().finally(() => setIsLoading(false));
                  }}
                  className="rounded-md border px-3 py-2 text-sm transition-colors"
                  style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                >
                  {isLoading ? 'Refreshing…' : 'Refresh'}
                </button>
                <button
                  onClick={() => navigate('/bedread')}
                  className="rounded-md border px-3 py-2 text-sm transition-colors"
                  style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                >
                  New job
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setFilter(option.value)}
                  className="rounded-md px-3 py-1.5 text-sm transition-colors"
                  style={{
                    background: filter === option.value ? activeSurface : mutedSurface,
                    color: filter === option.value ? pageText : secondaryText,
                    border: `1px solid ${filter === option.value ? panelBorder : 'transparent'}`,
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {timeRangeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => { setTimeRange(option.value); setSpecificDate(''); }}
                  className="rounded-md px-3 py-1.5 text-sm transition-colors"
                  style={{
                    background: timeRange === option.value ? activeSurface : mutedSurface,
                    color: timeRange === option.value ? pageText : secondaryText,
                    border: `1px solid ${timeRange === option.value ? panelBorder : 'transparent'}`,
                  }}
                >
                  {option.label}
                </button>
              ))}

              {([
                ['newest', 'Newest first'],
                ['oldest', 'Oldest first'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setSortOrder(value)}
                  className="rounded-md px-3 py-1.5 text-sm transition-colors"
                  style={{
                    background: sortOrder === value ? activeSurface : mutedSurface,
                    color: sortOrder === value ? pageText : secondaryText,
                    border: `1px solid ${sortOrder === value ? panelBorder : 'transparent'}`,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {deleteMode && (
              <div
                className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
                style={{ borderColor: panelBorder }}
              >
                <div className="text-sm" style={{ color: secondaryText }}>
                  {selectedIds.size} selected
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      allVisibleSelected
                        ? setSelectedIds(new Set())
                        : setSelectedIds(new Set(deletableVisibleJobs.map((j) => j.batch_id)))
                    }
                    className="rounded-md border px-3 py-2 text-sm"
                    style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                  >
                    {allVisibleSelected ? 'Unselect visible' : 'Select visible'}
                  </button>
                  <button
                    onClick={handleDeleteClick}
                    disabled={selectedIds.size === 0 || isDeleting}
                    className="rounded-md px-3 py-2 text-sm text-white transition-opacity"
                    style={{ background: '#dc2626', opacity: selectedIds.size === 0 || isDeleting ? 0.5 : 1 }}
                  >
                    {isDeleting ? 'Removing…' : `Delete (${selectedIds.size})`}
                  </button>
                  <button
                    onClick={toggleDeleteMode}
                    className="rounded-md border px-3 py-2 text-sm"
                    style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                  >
                    Exit delete
                  </button>
                </div>
              </div>
            )}

            {!deleteMode && (
              <div className="mt-4 flex justify-end border-t pt-4" style={{ borderColor: panelBorder }}>
                <button
                  onClick={toggleDeleteMode}
                  className="rounded-md border px-3 py-2 text-sm transition-colors"
                  style={{
                    borderColor: deleteMode ? '#dc2626' : panelBorder,
                    color: deleteMode ? '#dc2626' : secondaryText,
                    background: deleteMode ? selectedSurface : mutedSurface,
                  }}
                >
                  Delete mode
                </button>
              </div>
            )}
          </section>

          {isLoading && jobs.length === 0 && (
            <section
              className="rounded-2xl border px-5 py-12 text-sm sm:px-6"
              style={{ background: panelBackground, borderColor: panelBorder, color: secondaryText }}
            >
              Loading audio jobs…
            </section>
          )}

          {error && (
            <section
              className="rounded-2xl border px-5 py-4 text-sm sm:px-6"
              style={{ background: panelBackground, borderColor: '#dc2626', color: isDark ? '#f87171' : '#dc2626' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <button onClick={fetchJobs} className="underline">Retry</button>
              </div>
            </section>
          )}

          {!isLoading && filtered.length === 0 && (
            <section
              className="rounded-2xl border px-5 py-12 text-sm sm:px-6"
              style={{ background: panelBackground, borderColor: panelBorder, color: secondaryText }}
            >
              {filter === 'all' ? (
                <>
                  No BedRead jobs yet.{' '}
                  <button onClick={() => navigate('/bedread')} className="underline">
                    Start your first TTS job
                  </button>
                </>
              ) : (
                `No ${filter} jobs.`
              )}
            </section>
          )}

          {filtered.length > 0 && (
            <section
              className="overflow-hidden rounded-2xl border"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div
                className="flex items-center justify-between border-b px-5 py-3 text-xs uppercase tracking-[0.14em] sm:px-6"
                style={{ borderColor: panelBorder, color: tertiaryText }}
              >
                <span>Jobs</span>
                <span>{visibleJobs.length} shown</span>
              </div>

              <div>
                {visibleJobs.map((job, index) => (
                  <JobCard
                    key={job.batch_id}
                    job={job}
                    order={index + 1}
                    isSelected={selectedIds.has(job.batch_id)}
                    deleteMode={deleteMode}
                    isDark={isDark}
                    canSelectForDelete={canDeleteBatchJob(job)}
                    panelBorder={panelBorder}
                    pageText={pageText}
                    secondaryText={secondaryText}
                    tertiaryText={tertiaryText}
                    mutedSurface={mutedSurface}
                    selectedSurface={selectedSurface}
                    onToggleSelect={handleToggleSelect}
                    onCancel={handleCancel}
                    onDownloadChapter={handleDownloadChapter}
                    onDownloadZip={handleDownloadZip}
                  />
                ))}
              </div>

              {hasMore && (
                <div
                  ref={loadMoreRef}
                  className="border-t px-5 py-4 text-center text-sm sm:px-6"
                  style={{ borderColor: panelBorder, color: secondaryText }}
                >
                  Loading more jobs…
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
