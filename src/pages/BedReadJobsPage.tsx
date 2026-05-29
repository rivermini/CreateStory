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

const STATUS_DOT_MAP: Record<string, (isDark: boolean) => string> = {
    pending:   (d) => d ? 'bg-slate-400' : 'bg-gray-400',
    queued:    (d) => d ? 'bg-amber-400 animate-pulse' : 'bg-amber-400 animate-pulse',
    running:   (d) => d ? 'bg-blue-400' : 'bg-blue-500',
    completed: (d) => d ? 'bg-emerald-400' : 'bg-emerald-500',
    failed:    (d) => d ? 'bg-red-400' : 'bg-red-500',
    cancelled: (d) => d ? 'bg-amber-400' : 'bg-amber-500',
};

const STATUS_TEXT_MAP: Record<string, (isDark: boolean) => string> = {
    pending:   (d) => d ? 'text-slate-400' : 'text-gray-500',
    queued:    (d) => d ? 'text-amber-400' : 'text-amber-600',
    running:   (d) => d ? 'text-blue-400' : 'text-blue-600',
    completed: (d) => d ? 'text-emerald-400' : 'text-emerald-600',
    failed:    (d) => d ? 'text-red-400' : 'text-red-600',
    cancelled: (d) => d ? 'text-amber-400' : 'text-amber-600',
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
    pending:    (d) => d ? 'bg-slate-400' : 'bg-gray-400',
    queued:     (d) => d ? 'bg-indigo-400 animate-pulse' : 'bg-indigo-400 animate-pulse',
    processing: (d) => d ? 'bg-blue-400 animate-pulse' : 'bg-blue-500 animate-pulse',
    completed:  (d) => d ? 'bg-emerald-400' : 'bg-emerald-500',
    failed:     (d) => d ? 'bg-red-400' : 'bg-red-500',
};

const CHAPTER_STATUS_TEXT_MAP: Record<string, (isDark: boolean) => string> = {
    pending:    (d) => d ? 'text-slate-400' : 'text-gray-500',
    queued:     (d) => d ? 'text-indigo-400' : 'text-indigo-600',
    processing: (d) => d ? 'text-blue-400' : 'text-blue-600',
    completed:  (d) => d ? 'text-emerald-400' : 'text-emerald-600',
    failed:     (d) => d ? 'text-red-400' : 'text-red-600',
};

interface JobCardProps {
    job: BatchJob;
    order: number;
    isSelected: boolean;
    deleteMode: boolean;
    isDark: boolean;
    onToggleSelect: (batchId: string) => void;
    onCancel: (batchId: string, storyTitle: string) => void;
    onDownloadChapter: (batchId: string, chapterNum: number) => void;
    onDownloadZip: (batchId: string) => void;
}

function JobCard({ job, order, isSelected, deleteMode, isDark, onToggleSelect, onCancel, onDownloadChapter, onDownloadZip }: JobCardProps) {
    const [expanded, setExpanded] = useState(false);

    const dotFn = STATUS_DOT_MAP[job.status] ?? ((d: boolean) => d ? 'bg-slate-400' : 'bg-gray-400');
    const textFn = STATUS_TEXT_MAP[job.status] ?? ((d: boolean) => d ? 'text-slate-400' : 'text-gray-500');
    const dot = dotFn(isDark);
    const text = textFn(isDark);
    const label = STATUS_LABEL_MAP[job.status] ?? job.status;

    const completedCount = job.chapters.filter(c => c.status === 'completed').length;
    const failedCount = job.chapters.filter(c => c.status === 'failed').length;
    const totalCount = job.chapters.length;
    const progressPct = job.progress_pct;
    const allDone = completedCount === totalCount && totalCount > 0;
    const isAutoMode = job.from_auto_mode === true;

    const cardBg = deleteMode && isSelected
        ? (isDark ? 'bg-red-950/30 border-red-800/50' : 'bg-red-50 border-red-200')
        : (isDark ? 'bg-slate-900/60 border-slate-800/60' : 'bg-white border-gray-200');

    const rootClasses = `${cardBg} rounded-2xl border overflow-hidden flex transition-all duration-200 ${deleteMode ? 'cursor-pointer select-none' : ''}`;

    const orderBg = deleteMode && isSelected
        ? (isDark ? 'bg-red-900/40 border-red-800/40 text-red-300' : 'bg-red-100 border-red-200 text-red-700')
        : (isDark ? 'bg-indigo-900/20 border-indigo-800/40 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700');

    const chDotFn = (status: string) => CHAPTER_STATUS_DOT_MAP[status] ?? CHAPTER_STATUS_DOT_MAP.pending;
    const chTextFn = (status: string) => CHAPTER_STATUS_TEXT_MAP[status] ?? CHAPTER_STATUS_TEXT_MAP.pending;

    return (
        <div
            className={rootClasses}
            onClick={deleteMode ? () => onToggleSelect(job.batch_id) : undefined}
        >
            {order != null && (
                <div className={`w-12 flex-shrink-0 border-r flex flex-col items-center justify-center rounded-l-2xl transition-colors duration-200 ${orderBg}`}>
                    <span className="text-base font-bold select-none">#{order}</span>
                </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col">
                <div className="px-5 py-4 flex flex-col sm:flex-row items-start gap-4">
                    <div className="flex-shrink-0 mt-1 flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                    </div>

                    <div className="flex-1 min-w-0 w-full">
                        <div className="min-w-0 w-full sm:w-auto">
                            <h3 className={`text-sm sm:text-base font-semibold truncate ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>{job.story_title}</h3>
                            <div className={`flex items-center gap-3 mt-1.5 text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                                <span className={text}>{label}</span>
                                {job.status === 'queued' && job.queue_position && job.queue_position > 0 && (
                                    <span className={isDark ? 'text-amber-400 font-medium' : 'text-amber-600 font-medium'}>#{job.queue_position} in queue</span>
                                )}
                                <span>{totalCount} chapter{totalCount !== 1 ? 's' : ''}</span>
                                {completedCount > 0 && <span className={isDark ? 'text-emerald-400' : 'text-emerald-600'}>{completedCount} done</span>}
                                {failedCount > 0 && <span className="text-red-400">{failedCount} failed</span>}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap mt-3">
                            {allDone && !deleteMode && !isAutoMode && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onDownloadZip(job.batch_id); }}
                                    className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors shadow-lg shadow-indigo-600/30 flex items-center gap-1.5"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Download ZIP
                                </button>
                            )}
                            {isAutoMode && (
                                <span className={`px-3 py-1.5 text-xs font-medium rounded-xl ${isDark
                                    ? 'text-amber-300 bg-amber-900/30 border border-amber-700/40'
                                    : 'text-amber-700 bg-amber-50 border border-amber-200'
                                }`}>
                                    Auto Mode — Files Deleted
                                </span>
                            )}
                            {(job.status === 'running' || job.status === 'queued') && !deleteMode && !isAutoMode && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onCancel(job.batch_id, job.story_title); }}
                                    className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-xl transition-colors shadow-lg shadow-red-600/30"
                                >
                                    {job.status === 'running' ? 'Cancel' : 'Remove'}
                                </button>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                                className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors ${isDark
                                    ? 'text-slate-400 hover:text-slate-200 border-slate-700 hover:bg-slate-800'
                                    : 'text-gray-500 hover:text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                            >
                                {expanded ? 'Hide' : `${totalCount}C`}
                            </button>
                        </div>

                        {job.status === 'running' && totalCount > 0 && (
                            <div className="mt-3 space-y-1.5">
                                <div className={`flex items-center justify-between text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                                    <span>{completedCount}/{totalCount} chapters</span>
                                    <span>{progressPct}%</span>
                                </div>
                                <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-gray-200'}`}>
                                    <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={`flex flex-col sm:flex-row sm:items-center gap-2 text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        <span>Started {formatDate(job.started_at)}</span>
                        {job.finished_at && (
                            <>
                                <span>Finished {formatDate(job.finished_at)}</span>
                                <span>{formatDuration(job.started_at, job.finished_at)}</span>
                            </>
                        )}
                    </div>

                    {job.error && <p className={`text-xs mt-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>{job.error}</p>}
                </div>

                {expanded && job.chapters.length > 0 && (
                    <div className={`border-t px-5 py-3 ${isDark
                        ? 'border-slate-800/60 bg-slate-900/40'
                        : 'border-gray-200 bg-gray-50/50'}`}>
                        <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>
                            Chapters ({completedCount}/{totalCount} completed)
                        </p>
                        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                            {job.chapters.map((ch) => {
                                const isRunning = ch.status === 'queued' || ch.status === 'processing' || (ch.progress_pct > 0 && ch.progress_pct < 100);
                                return (
                                    <div key={ch.chapter_number} className={`flex items-center justify-between gap-3 py-1.5 px-2 rounded-lg transition-colors ${isDark ? 'bg-slate-800/50 hover:bg-slate-800' : 'bg-white/50 hover:bg-white'}`}>
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <div className={`w-2 h-2 rounded-full ${chDotFn(ch.status)(isDark)} flex-shrink-0`} />
                                            <span className={`text-xs font-mono flex-shrink-0 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}> #{ch.chapter_number}</span>
                                            <div className="min-w-0 flex-1">
                                                <span className={`text-sm truncate block ${chTextFn(ch.status)(isDark)}`}>{ch.title}</span>
                                                {isRunning && ch.progress_pct > 0 && (
                                                    <div className="mt-1 space-y-0.5">
                                                        <div className={`h-1 rounded-full overflow-hidden ${isDark ? 'bg-slate-700' : 'bg-gray-200'}`}>
                                                            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${ch.progress_pct}%` }} />
                                                        </div>
                                                        <span className={`text-[10px] ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{ch.progress_pct}%</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {ch.status === 'failed' && ch.error && (
                                                <span className={`text-xs max-w-[150px] truncate ${isDark ? 'text-red-400' : 'text-red-600'}`}>{ch.error}</span>
                                            )}
                                            {ch.status === 'completed' && !deleteMode && !isAutoMode && (
                                                <button onClick={() => onDownloadChapter(job.batch_id, ch.chapter_number)}
                                                    className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${isDark ? 'text-slate-300 bg-slate-800 hover:bg-slate-700' : 'text-gray-700 bg-gray-100 hover:bg-gray-200'}`}>
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

export default function BedReadJobsPage({ themeMode }: BedReadJobsPageProps) {
    const isDark = themeMode === 'dark';
    const PAGE_SIZE = 15;
    const navigate = useNavigate();
    const [jobs, setJobs] = useState<BatchJob[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | 'running' | 'queued' | 'completed' | 'failed'>('all');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [timeRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
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
        const interval = setInterval(fetchJobs, 1000);
        return () => clearInterval(interval);
    }, [fetchJobs]);

    const timeCutoff = (() => {
        if (timeRange === 'all') return null;
        const now = new Date();
        if (timeRange === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
        if (timeRange === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
        if (timeRange === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; }
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
        .filter(j => { if (!timeCutoff || !j.started_at) return true; return new Date(j.started_at) >= timeCutoff; })
        .sort((a, b) => {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
        });

    const visibleJobs = filtered.slice(0, visibleCount);
    const hasMore = visibleCount < filtered.length;
    const allVisibleSelected = visibleJobs.length > 0 && visibleJobs.every(j => selectedIds.has(j.batch_id));

    useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filter, sortOrder, timeRange]);

    useEffect(() => {
        if (!hasMore) return;
        const node = loadMoreRef.current;
        if (!node) return;
        const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filtered.length)); }, { rootMargin: '300px 0px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, filtered.length]);

    const handleToggleSelect = (batchId: string) => { const s = new Set(selectedIds); s.has(batchId) ? s.delete(batchId) : s.add(batchId); setSelectedIds(s); };
    const toggleDeleteMode = () => { if (deleteMode) { setDeleteMode(false); setSelectedIds(new Set()); } else { setDeleteMode(true); } };
    const handleDeleteClick = () => { if (selectedIds.size === 0) return; const ids = Array.from(selectedIds); const hasRunning = ids.some(id => { const job = jobs.find(j => j.batch_id === id); return job?.status === 'running' || job?.status === 'queued' || job?.status === 'pending'; }); setDeleteConfirmation({ open: true, ids, hasRunning }); };
    const handleConfirmDelete = async () => { try { setIsDeleting(true); for (const id of deleteConfirmation.ids) { await removeBatchJob(id); } setSelectedIds(new Set()); setDeleteConfirmation({ open: false, ids: [], hasRunning: false }); await fetchJobs(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to delete jobs'); setDeleteConfirmation({ open: false, ids: [], hasRunning: false }); } finally { setIsDeleting(false); } };
    const handleCancel = (batchId: string, storyTitle: string) => { setCancelConfirmation({ open: true, batchId, storyTitle }); };
    const handleConfirmCancel = async () => { if (!cancelConfirmation.batchId) return; const batchId = cancelConfirmation.batchId; setCancelConfirmation({ open: false, batchId: null, storyTitle: '' }); try { setCancellingIds(prev => new Set(prev).add(batchId)); await cancelBatchJob(batchId); await fetchJobs(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to cancel job'); } finally { setCancellingIds(prev => { const n = new Set(prev); n.delete(batchId); return n; }); } };
    const handleDownloadChapter = (batchId: string, chapterNum: number) => { const a = document.createElement('a'); a.href = getChapterAudioUrl(batchId, chapterNum); a.download = `chapter_${chapterNum}.wav`; document.body.appendChild(a); a.click(); document.body.removeChild(a); };
    const handleDownloadZip = (batchId: string) => { const a = document.createElement('a'); a.href = getBatchZipUrl(batchId); a.download = `bedread_${batchId}.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a); };

    const runningJob = filtered.find(j => j.status === 'running');
    const queuedJobs = filtered.filter(j => j.status === 'queued');
    const totalQueueSize = queuedJobs.length;

    const filterBarBase = isDark ? 'bg-slate-900/60 border border-slate-800/60' : 'bg-white border border-gray-200';
    const filterBtnActive = 'bg-indigo-600 text-white';
    const filterBtnInactive = isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-700';

    const filteredCounts = {
        all: filtered.length,
        running: filtered.filter(j => j.status === 'running').length,
        queued: filtered.filter(j => j.status === 'queued').length,
        completed: filtered.filter(j => j.status === 'completed').length,
        failed: filtered.filter(j => j.status === 'failed' || j.status === 'cancelled').length,
    };

    return (
        <div className={`min-h-screen ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
            <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">

                {/* Page Header */}
                <div className="mb-2">
                    <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                        Audio Jobs
                    </h1>
                    <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        {filtered.length} of {jobs.length} jobs
                        {filter !== 'all' && ` · ${filter}`}
                        {timeRange !== 'all' && ` · ${timeRange === 'today' ? 'today' : timeRange === 'week' ? '7 days' : '30 days'}`}
                        {` · refreshed ${lastRefresh.toLocaleTimeString()}`}
                    </p>
                </div>

                {/* Running/Queue Banner */}
                {(runningJob || totalQueueSize > 0) && (
                    <div className={`rounded-2xl p-4 ${isDark
                        ? 'bg-slate-900/60 border border-slate-800/60'
                        : 'bg-white border border-gray-200'}`}>
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div className="flex items-center gap-3">
                                {runningJob && (
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                                        <span className={`text-sm ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                                            <span className={`font-medium ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Processing:</span>{' '}
                                            <span className={isDark ? 'text-slate-100' : 'text-gray-900'}>{runningJob.story_title}</span>
                                            <span className={isDark ? 'text-slate-500' : 'text-gray-400 ml-2'}>({runningJob.progress_pct}%)</span>
                                        </span>
                                    </div>
                                )}
                                {runningJob && totalQueueSize > 0 && <div className={`w-px h-6 ${isDark ? 'bg-slate-700' : 'bg-gray-300'}`} />}
                                {totalQueueSize > 0 && (
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                                        <span className={`text-sm ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                                            <span className={`font-medium ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>{totalQueueSize} in queue</span>
                                            {queuedJobs[0] && <span className={isDark ? 'text-slate-500' : 'text-gray-400 ml-2'}> - Next: {queuedJobs[0].story_title}</span>}
                                            {totalQueueSize > 1 && <span className={isDark ? 'text-slate-500' : 'text-gray-400'}> (+{totalQueueSize - 1} more)</span>}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center justify-start gap-2">
                    <button
                        onClick={() => navigate('/bedread')}
                        className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 shadow-lg ${isDark
                            ? 'text-white bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
                            : 'text-white bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'} `}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New Job
                    </button>
                    <button
                        onClick={toggleDeleteMode}
                        className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${deleteMode
                            ? (isDark ? 'text-red-300 border border-red-700 bg-red-900/20 hover:bg-red-900/40' : 'text-red-600 border border-red-300 bg-red-50 hover:bg-red-100')
                            : (isDark ? 'text-slate-300 border border-slate-700 hover:bg-slate-800' : 'text-gray-600 border border-gray-300 hover:bg-gray-100')}`}
                    >
                        {deleteMode ? 'Cancel Delete' : 'Delete Mode'}
                    </button>
                    {deleteMode && (
                        <button
                            onClick={() => allVisibleSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(visibleJobs.map(j => j.batch_id)))}
                            className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${isDark ? 'text-slate-300 border border-slate-700 hover:bg-slate-800' : 'text-gray-600 border border-gray-300 hover:bg-gray-100'}`}
                        >
                            {allVisibleSelected ? 'Unselect All' : 'Select All'}
                        </button>
                    )}
                    {deleteMode && selectedIds.size > 0 && (
                        <button
                            onClick={handleDeleteClick}
                            disabled={isDeleting}
                            className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 shadow-lg ${isDeleting
                                ? (isDark ? 'bg-red-900/50 text-red-400 cursor-not-allowed shadow-none' : 'bg-red-100 text-red-400 cursor-not-allowed shadow-none')
                                : 'text-white bg-red-600 hover:bg-red-500 shadow-red-600/30'} `}
                        >
                            {isDeleting ? 'Removing...' : `Delete (${selectedIds.size})`}
                        </button>
                    )}
                </div>

                {/* Delete Mode Banner */}
                {deleteMode && (
                    <div className={`rounded-2xl p-3 flex items-center justify-between gap-3 ${isDark
                        ? 'bg-red-900/20 border border-red-800/30'
                        : 'bg-red-50 border border-red-200'}`}>
                        <div className="flex items-center gap-2">
                            <svg className={`w-5 h-5 ${isDark ? 'text-red-400' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span className={`text-sm font-medium ${isDark ? 'text-red-300' : 'text-red-700'}`}>Delete Mode Active</span>
                            {selectedIds.size > 0 && <span className={`text-xs ${isDark ? 'text-red-400' : 'text-red-500'}`}>({selectedIds.size} selected)</span>}
                        </div>
                        <button onClick={toggleDeleteMode} className={`text-xs underline ${isDark ? 'text-red-300 hover:text-white' : 'text-red-500 hover:text-red-700'}`}>Exit Delete Mode</button>
                    </div>
                )}

                {/* Filter Bar */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
                    <div className={`flex items-center gap-1 p-1 rounded-xl ${filterBarBase}`}>
                        {([
                            ['all', `All (${filteredCounts.all})`],
                            ['running', `Running (${filteredCounts.running})`],
                            ['queued', `Queued (${filteredCounts.queued})`],
                            ['completed', `Done (${filteredCounts.completed})`],
                            ['failed', `Failed (${filteredCounts.failed})`],
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

                    <div className={`flex items-center gap-1 p-1 rounded-xl ${filterBarBase}`}>
                        <span className={`px-2 text-xs hidden sm:inline ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Sort:</span>
                        <button
                            onClick={() => setSortOrder('newest')}
                            className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${sortOrder === 'newest' ? filterBtnActive : filterBtnInactive}`}
                        >
                            Newest
                        </button>
                        <button
                            onClick={() => setSortOrder('oldest')}
                            className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${sortOrder === 'oldest' ? filterBtnActive : filterBtnInactive}`}
                        >
                            Oldest
                        </button>
                    </div>

                    <button
                        onClick={() => { setIsLoading(true); fetchJobs().finally(() => setIsLoading(false)); }}
                        className={`px-3 py-1 text-xs border rounded-xl transition-colors flex items-center gap-1.5 ${isDark
                            ? 'text-slate-400 hover:text-slate-200 border-slate-800 hover:bg-slate-900'
                            : 'text-gray-500 hover:text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                        title="Refresh now"
                    >
                        <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>

                {/* Loading */}
                {isLoading && jobs.length === 0 && (
                    <div className={`flex items-center justify-center py-16 gap-3 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>Loading...</span>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className={`flex items-center justify-between gap-3 p-4 rounded-2xl text-sm ${isDark
                        ? 'bg-red-900/20 border border-red-800/30 text-red-400'
                        : 'bg-red-50 border border-red-200 text-red-600'}`}>
                        <span>{error}</span>
                        <button onClick={fetchJobs} className="underline hover:no-underline">Retry</button>
                    </div>
                )}

                {/* Empty State */}
                {!isLoading && filtered.length === 0 && (
                    <div className={`text-center py-20 space-y-3 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        <div className="flex justify-center">
                            <svg className={`w-12 h-12 ${isDark ? 'text-slate-700' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                            </svg>
                        </div>
                        <p className={isDark ? 'text-slate-400' : 'text-gray-500'}>{filter === 'all' ? 'No BedRead jobs yet.' : `No ${filter} jobs.`}</p>
                        <button onClick={() => navigate('/bedread')} className={`text-sm underline ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'}`}>
                            Start your first TTS job
                        </button>
                    </div>
                )}

                {/* Job List */}
                <div className="space-y-3">
                    {visibleJobs.map((job, index) => (
                        <JobCard
                            key={job.batch_id}
                            job={job}
                            order={index + 1}
                            isSelected={selectedIds.has(job.batch_id)}
                            deleteMode={deleteMode}
                            isDark={isDark}
                            onToggleSelect={handleToggleSelect}
                            onCancel={handleCancel}
                            onDownloadChapter={handleDownloadChapter}
                            onDownloadZip={handleDownloadZip}
                        />
                    ))}
                    {hasMore && <div ref={loadMoreRef} className={`py-6 text-center text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Loading more jobs...</div>}
                </div>

                {/* Bottom Refresh */}
                {!isLoading && filtered.length > 0 && (
                    <div className="flex justify-center pt-2">
                        <button
                            onClick={fetchJobs}
                            className={`px-4 py-2 text-sm border rounded-xl transition-colors ${isDark
                                ? 'text-slate-400 hover:text-slate-200 border-slate-800 hover:bg-slate-900'
                                : 'text-gray-500 hover:text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                        >
                            Refresh
                        </button>
                    </div>
                )}

                {/* Delete Confirmation Modal */}
                {deleteConfirmation.open && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                        <div className={`rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-gray-200'}`}>
                            <h3 className={`text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                                {deleteConfirmation.hasRunning ? 'Warning' : 'Confirm Delete'}
                            </h3>
                            {deleteConfirmation.hasRunning ? (
                                <div className="space-y-3">
                                    <p className={`text-sm ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                                        You are about to delete {deleteConfirmation.ids.length} job{deleteConfirmation.ids.length !== 1 ? 's' : ''}, including running job(s).
                                    </p>
                                    <p className={`text-sm font-medium ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>This action cannot be undone.</p>
                                </div>
                            ) : (
                                <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                                    Are you sure you want to delete {deleteConfirmation.ids.length} job{deleteConfirmation.ids.length !== 1 ? 's' : ''}? This action cannot be undone.
                                </p>
                            )}
                            <div className="flex gap-2 justify-end pt-2">
                                <button
                                    onClick={() => setDeleteConfirmation({ open: false, ids: [], hasRunning: false })}
                                    disabled={isDeleting}
                                    className={`px-4 py-2 text-sm rounded-xl transition-colors ${isDark
                                        ? 'text-slate-300 bg-slate-800 hover:bg-slate-700'
                                        : 'text-gray-700 bg-gray-100 hover:bg-gray-200'}`}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmDelete}
                                    disabled={isDeleting}
                                    className={`px-4 py-2 text-sm text-white rounded-xl transition-colors shadow-lg ${isDark
                                        ? 'bg-red-600 hover:bg-red-500 disabled:bg-red-900/50 disabled:text-red-400 shadow-red-600/30'
                                        : 'bg-red-600 hover:bg-red-500'}`}
                                >
                                    {isDeleting ? 'Removing...' : 'Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Cancel Confirmation Modal */}
                {cancelConfirmation.open && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                        <div className={`rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-gray-200'}`}>
                            <h3 className={`text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>Cancel this TTS job?</h3>
                            <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                                Are you sure you want to cancel: <span className={`font-medium ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>{cancelConfirmation.storyTitle}</span>
                            </p>
                            <p className={`text-sm ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>This will stop the audio generation and cannot be undone.</p>
                            <div className="flex gap-2 justify-end pt-2">
                                <button
                                    onClick={() => setCancelConfirmation({ open: false, batchId: null, storyTitle: '' })}
                                    disabled={_cancellingIds.size > 0}
                                    className={`px-4 py-2 text-sm rounded-xl transition-colors ${isDark
                                        ? 'text-slate-300 bg-slate-800 hover:bg-slate-700'
                                        : 'text-gray-700 bg-gray-100 hover:bg-gray-200'}`}
                                >
                                    Keep Running
                                </button>
                                <button
                                    onClick={handleConfirmCancel}
                                    disabled={_cancellingIds.size > 0}
                                    className={`px-4 py-2 text-sm text-white rounded-xl transition-colors shadow-lg ${isDark
                                        ? 'bg-red-600 hover:bg-red-500 disabled:bg-red-900/50 disabled:text-red-400 shadow-red-600/30'
                                        : 'bg-red-600 hover:bg-red-500'}`}
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
