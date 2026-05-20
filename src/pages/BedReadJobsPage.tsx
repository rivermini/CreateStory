import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    cancelBatchJob,
    getChapterAudioUrl,
    getBatchZipUrl,
    listAllBatchJobs,
    removeBatchJob,
    type BatchJob,
} from '../api/client';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface BedReadJobsPageProps {
    themeMode: ThemeMode;
    onThemeChange: (mode: ThemeMode) => void;
}

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function formatDuration(start: string | null, finish: string | null): string {
    if (!start || !finish) return '—';
    try {
        const s = new Date(start).getTime();
        const f = new Date(finish).getTime();
        const secs = Math.floor((f - s) / 1000);
        if (secs < 60) return `${secs}s`;
        const m = Math.floor(secs / 60);
        const r = secs % 60;
        return `${m}m ${r}s`;
    } catch {
        return '—';
    }
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string; bg: string }> = {
    pending: { label: 'Pending', dot: 'bg-slate-400', text: 'text-slate-400', bg: 'bg-slate-700' },
    queued: { label: 'Queued', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-400', bg: 'bg-amber-900/30' },
    running: { label: 'Running', dot: 'bg-blue-400', text: 'text-blue-400', bg: 'bg-blue-900/30' },
    completed: { label: 'Completed', dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-900/30' },
    failed: { label: 'Failed', dot: 'bg-red-400', text: 'text-red-400', bg: 'bg-red-900/30' },
    cancelled: { label: 'Cancelled', dot: 'bg-amber-400', text: 'text-amber-400', bg: 'bg-amber-900/30' },
};

const CHAPTER_STATUS_CONFIG: Record<string, { dot: string; text: string }> = {
    pending: { dot: 'bg-slate-400', text: 'text-slate-400' },
    queued: { dot: 'bg-indigo-400 animate-pulse', text: 'text-indigo-400' },
    processing: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-400' },
    completed: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
    failed: { dot: 'bg-red-400', text: 'text-red-400' },
};

interface JobCardProps {
    job: BatchJob;
    order: number;
    isSelected: boolean;
    deleteMode: boolean;
    onToggleSelect: (batchId: string) => void;
    onCancel: (batchId: string, storyTitle: string) => void;
    onDownloadChapter: (batchId: string, chapterNum: number) => void;
    onDownloadZip: (batchId: string) => void;
}

function JobCard({ job, order, isSelected, deleteMode, onToggleSelect, onCancel, onDownloadChapter, onDownloadZip }: JobCardProps) {
    const [expanded, setExpanded] = useState(false);
    const status = STATUS_CONFIG[job.status] ?? { label: job.status, dot: 'bg-slate-400', text: 'text-slate-400', bg: 'bg-slate-700' };

    const completedCount = job.chapters.filter(c => c.status === 'completed').length;
    const failedCount = job.chapters.filter(c => c.status === 'failed').length;
    const totalCount = job.chapters.length;
    const progressPct = job.progress_pct;
    const allChaptersDone = completedCount === totalCount && totalCount > 0;

    const cardBg = deleteMode && isSelected
        ? 'bg-red-950/40 border-red-800/60'
        : `${status.bg} border-slate-700`;

    const orderBg = deleteMode && isSelected
        ? 'bg-red-900/50 border-red-800/40 text-red-300'
        : 'bg-indigo-900/30 border-indigo-800/40 text-indigo-300';

    const rootClasses = `${cardBg} rounded-xl overflow-hidden flex transition-colors duration-150 ${deleteMode ? 'cursor-pointer select-none' : ''}`;

    return (
        <div
            className={rootClasses}
            onClick={deleteMode ? () => onToggleSelect(job.batch_id) : undefined}
        >
            <div className={`w-12 flex-shrink-0 border-r flex flex-col items-center justify-center rounded-l-xl transition-colors duration-150 ${orderBg}`}>
                <span className="text-base font-bold select-none">#{order}</span>
            </div>

            <div className="flex-1 min-w-0 flex flex-col">
                <div className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
                    <div className="flex-shrink-0 mt-1 flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${status.dot}`} />
                    </div>

                    <div className="flex-1 min-w-0 w-full">
                        <div className="min-w-0 w-full sm:w-auto">
                            <h3 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
                                {job.story_title}
                            </h3>
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                                <span className={status.text}>{status.label}</span>
                                {job.status === 'queued' && job.queue_position && job.queue_position > 0 && (
                                    <span className="text-amber-400 font-medium">#{job.queue_position} in queue</span>
                                )}
                                <span>{totalCount} chapter{totalCount !== 1 ? 's' : ''}</span>
                                {completedCount > 0 && (
                                    <span className="text-emerald-400">{completedCount} done</span>
                                )}
                                {failedCount > 0 && (
                                    <span className="text-red-400">{failedCount} failed</span>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap mt-2">
                            {allChaptersDone && !deleteMode && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDownloadZip(job.batch_id);
                                    }}
                                    className="px-2 sm:px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors flex items-center gap-1.5"
                                    title="Download all as ZIP"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Download ZIP
                                </button>
                            )}

                            {job.status === 'running' && !deleteMode && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCancel(job.batch_id, job.story_title);
                                    }}
                                    className="px-2 sm:px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                            )}

                            {job.status === 'queued' && !deleteMode && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCancel(job.batch_id, job.story_title);
                                    }}
                                    className="px-2 sm:px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                                >
                                    Remove
                                </button>
                            )}

                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setExpanded(v => !v);
                                }}
                                className="px-2 sm:px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 rounded-lg border border-slate-600 hover:bg-slate-700 transition-colors"
                            >
                                {expanded ? 'Hide' : `${totalCount}C`}
                            </button>
                        </div>

                        {job.status === 'running' && totalCount > 0 && (
                            <div className="mt-3 space-y-1.5">
                                <div className="flex items-center justify-between text-xs text-slate-500">
                                    <span>{completedCount}/{totalCount} chapters</span>
                                    <span>{progressPct}%</span>
                                </div>
                                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-indigo-500 transition-all duration-300"
                                        style={{ width: `${progressPct}%` }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 mt-2 text-xs text-slate-500">
                        <span>Started {formatDate(job.started_at)}</span>
                        {job.finished_at && (
                            <>
                                <span>Finished {formatDate(job.finished_at)}</span>
                                <span>{formatDuration(job.started_at, job.finished_at)}</span>
                            </>
                        )}
                    </div>

                    {job.error && (
                        <p className="text-xs text-red-400 mt-2">{job.error}</p>
                    )}
                </div>

                {expanded && job.chapters.length > 0 && (
                    <div className="border-t border-slate-700 px-5 py-3 bg-slate-900/50">
                        <p className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-2">
                            Chapters ({completedCount}/{totalCount} completed)
                        </p>
                        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                            {job.chapters.map((ch) => {
                                const chStatus = CHAPTER_STATUS_CONFIG[ch.status] ?? CHAPTER_STATUS_CONFIG.pending;
                                const isRunning = ch.status === 'queued' || ch.status === 'processing' || (ch.progress_pct > 0 && ch.progress_pct < 100);

                                return (
                                    <div key={ch.chapter_number} className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <div className={`w-2 h-2 rounded-full ${chStatus.dot} flex-shrink-0`} />
                                            <span className="text-xs font-mono text-slate-400 flex-shrink-0">#{ch.chapter_number}</span>
                                            <div className="min-w-0 flex-1">
                                                <span className="text-sm text-slate-300 truncate block">{ch.title}</span>
                                                {isRunning && ch.progress_pct > 0 && (
                                                    <div className="mt-1 space-y-0.5">
                                                        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-blue-500 transition-all duration-300"
                                                                style={{ width: `${ch.progress_pct}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-[10px] text-blue-400">{ch.progress_pct}%</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {ch.status === 'failed' && ch.error && (
                                                <span className="text-xs text-red-400 max-w-[150px] truncate" title={ch.error}>
                                                    {ch.error}
                                                </span>
                                            )}
                                            {ch.status === 'completed' && !deleteMode && (
                                                <button
                                                    onClick={() => onDownloadChapter(job.batch_id, ch.chapter_number)}
                                                    className="px-2 py-1 text-xs text-slate-300 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
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
        </div>
    );
}

export default function BedReadJobsPage({ themeMode, onThemeChange }: BedReadJobsPageProps) {
    const PAGE_SIZE = 15;
    const navigate = useNavigate();
    const [jobs, setJobs] = useState<BatchJob[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | 'running' | 'queued' | 'completed' | 'failed'>('all');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [timeRange, setTimeRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; ids: string[]; hasRunning: boolean }>({ open: false, ids: [], hasRunning: false });
    const [deleteMode, setDeleteMode] = useState(false);
    const [cancelConfirmation, setCancelConfirmation] = useState<{ open: boolean; batchId: string | null; storyTitle: string }>({ open: false, batchId: null, storyTitle: '' });
    const [_cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    const fetchJobs = useCallback((): Promise<void> => {
        return listAllBatchJobs()
            .then(data => setJobs(data))
            .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
            .finally(() => setLastRefresh(new Date()));
    }, []);

    useEffect(() => {
        setIsLoading(true);
        setError('');
        fetchJobs().finally(() => setIsLoading(false));
        const interval = setInterval(fetchJobs, 1000);  // Poll every 1s for real-time progress
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
        return null;
    })();

    const filtered = jobs
        .filter(j => {
            if (filter === 'all') return true;
            if (filter === 'running') return j.status === 'running';
            if (filter === 'queued') return j.status === 'queued';
            if (filter === 'failed') return j.status === 'failed' || j.status === 'cancelled';
            return j.status === filter;
        })
        .filter(j => {
            if (!timeCutoff || !j.started_at) return true;
            return new Date(j.started_at) >= timeCutoff;
        })
        .sort((a, b) => {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
        });

    const visibleJobs = filtered.slice(0, visibleCount);
    const hasMore = visibleCount < filtered.length;

    const allVisibleSelected = visibleJobs.length > 0 && visibleJobs.every(j => selectedIds.has(j.batch_id));

    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [filter, sortOrder, timeRange]);

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
    }, [hasMore, filtered.length]);

    const counts = {
        all: jobs.filter(j => {
            if (!timeCutoff || !j.started_at) return true;
            return new Date(j.started_at) >= timeCutoff;
        }).length,
        running: jobs.filter(j => {
            if (j.status !== 'running') return false;
            if (!timeCutoff || !j.started_at) return true;
            return new Date(j.started_at) >= timeCutoff;
        }).length,
        queued: jobs.filter(j => {
            if (j.status !== 'queued') return false;
            if (!timeCutoff || !j.started_at) return true;
            return new Date(j.started_at) >= timeCutoff;
        }).length,
        completed: jobs.filter(j => {
            if (j.status !== 'completed') return false;
            if (!timeCutoff || !j.started_at) return true;
            return new Date(j.started_at) >= timeCutoff;
        }).length,
        failed: jobs.filter(j => {
            if (j.status !== 'failed' && j.status !== 'cancelled') return false;
            if (!timeCutoff || !j.started_at) return true;
            return new Date(j.started_at) >= timeCutoff;
        }).length,
    };

    // Counts based on filtered jobs (respects status filter AND time range)
    const filteredCounts = {
        all: filtered.length,
        running: filtered.filter(j => j.status === 'running').length,
        queued: filtered.filter(j => j.status === 'queued').length,
        completed: filtered.filter(j => j.status === 'completed').length,
        failed: filtered.filter(j => j.status === 'failed' || j.status === 'cancelled').length,
    };

    const handleToggleSelect = (batchId: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(batchId)) {
            newSelected.delete(batchId);
        } else {
            newSelected.add(batchId);
        }
        setSelectedIds(newSelected);
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
        const hasRunning = ids.some(id => {
            const job = jobs.find(j => j.batch_id === id);
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
            setCancellingIds(prev => new Set(prev).add(batchId));
            await cancelBatchJob(batchId);
            await fetchJobs();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to cancel job');
        } finally {
            setCancellingIds(prev => {
                const next = new Set(prev);
                next.delete(batchId);
                return next;
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

    // Get queue info for the status banner (from filtered jobs to respect time range)
    const runningJob = filtered.find(j => j.status === 'running');
    const queuedJobs = filtered.filter(j => j.status === 'queued');
    const totalQueueSize = queuedJobs.length;

    return (
        <div className="min-h-screen bg-slate-900">
            <Header
                themeMode={themeMode}
                onThemeChange={onThemeChange}
                title="BedRead Jobs"
                subtitle={<>{filtered.length} of {counts.all} job{counts.all !== 1 ? 's' : ''}{filter !== 'all' && ` · ${filter}`}{timeRange !== 'all' && ` · ${timeRange === 'today' ? 'today' : timeRange === 'week' ? '7 days' : '30 days'}`} · refreshed {lastRefresh.toLocaleTimeString()}</>}
            />

            <main className="w-full xl:w-[70vw] mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5">
                {/* Queue Status Banner */}
                {(runningJob || totalQueueSize > 0) && (
                    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div className="flex items-center gap-3">
                                {runningJob && (
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                                        <span className="text-sm text-slate-300">
                                            <span className="font-medium text-blue-400">Processing:</span>{' '}
                                            <span className="text-slate-100">{runningJob.story_title}</span>
                                            <span className="text-slate-500 ml-2">({runningJob.progress_pct}%)</span>
                                        </span>
                                    </div>
                                )}
                                {runningJob && totalQueueSize > 0 && (
                                    <div className="w-px h-6 bg-slate-600" />
                                )}
                                {totalQueueSize > 0 && (
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                                        <span className="text-sm text-slate-300">
                                            <span className="font-medium text-amber-400">{totalQueueSize} in queue</span>
                                            {queuedJobs[0] && (
                                                <span className="text-slate-400"> - Next: {queuedJobs[0].story_title}</span>
                                            )}
                                            {totalQueueSize > 1 && (
                                                <span className="text-slate-500"> (+{totalQueueSize - 1} more)</span>
                                            )}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-start gap-2">
                    <button
                        onClick={() => navigate('/bedread')}
                        className="px-3 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New Job
                    </button>

                    <button
                        onClick={toggleDeleteMode}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                            deleteMode
                                ? 'text-red-300 border border-red-700 bg-red-900/20 hover:bg-red-900/40'
                                : 'text-slate-300 border border-slate-600 hover:bg-slate-700'
                        }`}
                    >
                        {deleteMode ? '✕ Exit Delete' : 'Delete Mode'}
                    </button>

                    {deleteMode && (
                        <button
                            onClick={() => {
                                if (allVisibleSelected) {
                                    setSelectedIds(new Set());
                                } else {
                                    const newSelected = new Set(selectedIds);
                                    visibleJobs.forEach(j => newSelected.add(j.batch_id));
                                    setSelectedIds(newSelected);
                                }
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                                allVisibleSelected
                                    ? 'text-amber-300 border border-amber-700 bg-amber-900/20 hover:bg-amber-900/30'
                                    : 'text-slate-300 border border-slate-600 hover:bg-slate-700'
                            }`}
                        >
                            {allVisibleSelected ? 'Unselect All' : 'Select All'}
                        </button>
                    )}

                    {deleteMode && selectedIds.size > 0 && (
                        <button
                            onClick={handleDeleteClick}
                            disabled={isDeleting}
                            className="px-3 py-1.5 text-sm text-white bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:text-red-400 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                            {isDeleting ? 'Removing...' : `Remove (${selectedIds.size})`}
                        </button>
                    )}
                </div>

                {deleteMode && (
                    <div className="bg-red-900/40 border border-red-700/50 rounded-lg p-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span className="text-sm font-medium text-red-300">Delete Mode Active</span>
                            {selectedIds.size > 0 && (
                                <span className="text-xs text-red-400">({selectedIds.size} selected)</span>
                            )}
                        </div>
                        <button onClick={toggleDeleteMode} className="text-xs text-red-300 hover:text-white underline">
                            Exit Delete Mode
                        </button>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg border border-slate-700">
                        {([
                            ['all', `All (${filteredCounts.all})`],
                            ['running', `Running (${filteredCounts.running})`],
                            ['queued', `Queued (${filteredCounts.queued})`],
                            ['completed', `Completed (${filteredCounts.completed})`],
                            ['failed', `Failed (${filteredCounts.failed})`],
                        ] as const).map(([value, label]) => (
                            <button
                                key={value}
                                onClick={() => setFilter(value)}
                                className={`px-3 py-1 text-xs sm:text-sm rounded-md transition-colors ${
                                    filter === value
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg border border-slate-700">
                        <span className="px-2 text-xs text-slate-500 hidden sm:inline">Sort:</span>
                        <button
                            onClick={() => setSortOrder('newest')}
                            className={`px-3 py-1 text-xs sm:text-sm rounded-md transition-colors ${
                                sortOrder === 'newest' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            Newest
                        </button>
                        <button
                            onClick={() => setSortOrder('oldest')}
                            className={`px-3 py-1 text-xs sm:text-sm rounded-md transition-colors ${
                                sortOrder === 'oldest' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            Oldest
                        </button>
                    </div>

                    <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg border border-slate-700">
                        <span className="px-2 text-xs text-slate-500 hidden sm:inline">Time:</span>
                        {([
                            ['all', 'All time'],
                            ['today', 'Today'],
                            ['week', '7 days'],
                            ['month', '30 days'],
                        ] as const).map(([value, label]) => (
                            <button
                                key={value}
                                onClick={() => setTimeRange(value)}
                                className={`px-3 py-1 text-xs sm:text-sm rounded-md transition-colors ${
                                    timeRange === value ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => { setIsLoading(true); fetchJobs().finally(() => setIsLoading(false)); }}
                        className="px-3 py-1 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 ml-1"
                        title="Refresh now"
                    >
                        <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>

                {isLoading && jobs.length === 0 && (
                    <div className="flex items-center justify-center py-16 text-slate-400 gap-3">
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>Loading...</span>
                    </div>
                )}

                {error && (
                    <div className="flex items-center justify-between gap-3 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-400">
                        <span>{error}</span>
                        <button onClick={fetchJobs} className="text-sm underline hover:no-underline">Retry</button>
                    </div>
                )}

                {!isLoading && filtered.length === 0 && (
                    <div className="text-center py-20 text-slate-500 space-y-3">
                        <div className="flex justify-center">
                            <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                            </svg>
                        </div>
                        <p className="text-slate-400">
                            {filter === 'all' ? 'No BedRead jobs yet.' : `No ${filter} jobs.`}
                        </p>
                        <button
                            onClick={() => navigate('/bedread')}
                            className="text-sm text-indigo-400 hover:text-indigo-300 underline"
                        >
                            Start your first TTS job
                        </button>
                    </div>
                )}

                <div className="space-y-3">
                    {visibleJobs.map((job, index) => (
                        <JobCard
                            key={job.batch_id}
                            job={job}
                            order={index + 1}
                            isSelected={selectedIds.has(job.batch_id)}
                            deleteMode={deleteMode}
                            onToggleSelect={handleToggleSelect}
                            onCancel={handleCancel}
                            onDownloadChapter={handleDownloadChapter}
                            onDownloadZip={handleDownloadZip}
                        />
                    ))}

                    {hasMore && (
                        <div ref={loadMoreRef} className="py-6 text-center text-xs text-slate-500">Loading more jobs...</div>
                    )}
                </div>

                {!isLoading && filtered.length > 0 && (
                    <div className="flex justify-center pt-2">
                        <button
                            onClick={fetchJobs}
                            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors"
                        >
                            Refresh
                        </button>
                    </div>
                )}

                {deleteConfirmation.open && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full space-y-4">
                            <h3 className="text-lg font-semibold text-slate-100">
                                {deleteConfirmation.hasRunning ? '⚠️ Warning' : 'Confirm Remove'}
                            </h3>
                            {deleteConfirmation.hasRunning ? (
                                <div className="space-y-3">
                                    <p className="text-sm text-amber-400">
                                        You are about to remove {deleteConfirmation.ids.length} job{deleteConfirmation.ids.length !== 1 ? 's' : ''}, including running job(s).
                                    </p>
                                    <p className="text-sm text-slate-300">
                                        This will:
                                    </p>
                                    <ul className="text-sm text-slate-400 space-y-1 ml-4">
                                        <li>• Cancel any running TTS jobs</li>
                                        <li>• Remove the job from tracking</li>
                                        <li>• Keep audio files on disk</li>
                                    </ul>
                                    <p className="text-sm text-amber-300 font-medium">
                                        This action cannot be undone.
                                    </p>
                                </div>
                            ) : (
                                <p className="text-sm text-slate-300">
                                    Are you sure you want to remove {deleteConfirmation.ids.length} job{deleteConfirmation.ids.length !== 1 ? 's' : ''}? This action cannot be undone.
                                </p>
                            )}
                            <div className="flex gap-2 justify-end pt-2">
                                <button
                                    onClick={() => setDeleteConfirmation({ open: false, ids: [], hasRunning: false })}
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
                                    {isDeleting ? 'Removing...' : 'Remove'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {cancelConfirmation.open && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full space-y-4">
                            <h3 className="text-lg font-semibold text-slate-100">
                                Cancel this TTS job?
                            </h3>
                            <p className="text-sm text-slate-300">
                                Are you sure you want to cancel: <span className="font-medium text-slate-100">{cancelConfirmation.storyTitle}</span>
                            </p>
                            <p className="text-sm text-amber-400">
                                This will stop the audio generation and cannot be undone.
                            </p>
                            <div className="flex gap-2 justify-end pt-2">
                                <button
                                    onClick={() => setCancelConfirmation({ open: false, batchId: null, storyTitle: '' })}
                                    disabled={_cancellingIds.size > 0}
                                    className="px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg transition-colors"
                                >
                                    Keep Running
                                </button>
                                <button
                                    onClick={handleConfirmCancel}
                                    disabled={_cancellingIds.size > 0}
                                    className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:text-red-400 rounded-lg transition-colors"
                                >
                                    {_cancellingIds.size > 0 ? 'Cancelling...' : 'Cancel Job'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
