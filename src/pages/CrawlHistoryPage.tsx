import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    listAllResults,
    getDownloadUrl,
    getDownloadCombinedUrl,
    getDownloadAllUrl,
    getDownloadAllCombinedUrl,
    deleteCrawlSessions,
    type CrawlSessionSummary,
} from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';
import { DatePicker } from '../components/DatePicker';

interface ResultsAllPageProps {
    themeMode: ThemeMode;
    onThemeChange: (mode: ThemeMode) => void;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

function SessionCard({ session, onDownloadFile, order, isSelected, onToggleSelect, deleteMode, isDark }: {
    session: CrawlSessionSummary;
    onDownloadFile: (crawlId: string, filename: string) => void;
    order?: number;
    isSelected?: boolean;
    onToggleSelect?: (crawlId: string) => void;
    deleteMode?: boolean;
    isDark: boolean;
}) {
    const navigate = useNavigate();
    const [expanded, setExpanded] = useState(false);

    const statusDotMap: Record<string, string> = {
        completed: isDark ? 'bg-emerald-400' : 'bg-emerald-500',
        failed:    isDark ? 'bg-red-400'    : 'bg-red-500',
        cancelled: isDark ? 'bg-amber-400'  : 'bg-amber-500',
        running:   isDark ? 'bg-blue-400'   : 'bg-blue-500',
        idle:      isDark ? 'bg-slate-500'  : 'bg-gray-400',
    };
    const statusTextMap: Record<string, string> = {
        completed: isDark ? 'text-emerald-400' : 'text-emerald-600',
        failed:    isDark ? 'text-red-400'    : 'text-red-600',
        cancelled: isDark ? 'text-amber-400'  : 'text-amber-600',
        running:   isDark ? 'text-blue-400'   : 'text-blue-600',
        idle:      isDark ? 'text-slate-400'  : 'text-gray-500',
    };

    const dot = statusDotMap[session.status] ?? (isDark ? 'bg-slate-500' : 'bg-gray-400');
    const text = statusTextMap[session.status] ?? (isDark ? 'text-slate-400' : 'text-gray-500');
    const label = session.status.charAt(0).toUpperCase() + session.status.slice(1);
    const hasCombined = !!(session.combined_file || session.combined_txt_file);
    const chapterFiles = (session.output_files || []).filter(f =>
        !hasCombined || (f.filename !== (session.combined_txt_file || session.combined_file))
    );
    const totalSize = (session.output_files || []).reduce((sum, f) => sum + (f.size_bytes || 0), 0);
    const hasFiles = (session.output_files || []).length > 0;
    const displayTitle = session.novel_metadata?.title || session.novel_name || session.crawl_id;
    const progress = session.chapters_total > 0
        ? Math.min(100, (session.chapters_crawled / session.chapters_total) * 100)
        : 0;

    const handleDownloadCombined = () => {
        const filename = session.combined_txt_file || session.combined_file || '';
        if (!filename) return;
        const a = document.createElement('a');
        a.href = getDownloadCombinedUrl(session.crawl_id, filename);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const cardBg = deleteMode && isSelected
        ? isDark ? 'bg-red-950/30 border-red-800/50' : 'bg-red-50 border-red-200'
        : isDark ? 'bg-slate-900/60 border-slate-800/60' : 'bg-white border-gray-200';

    const rootClasses = `${cardBg} rounded-2xl border overflow-hidden flex transition-all duration-200 ${deleteMode ? 'cursor-pointer select-none' : ''}`;

    const orderBg = deleteMode && isSelected
        ? isDark ? 'bg-red-900/40 border-red-800/40 text-red-300' : 'bg-red-100 border-red-200 text-red-700'
        : isDark ? 'bg-indigo-900/20 border-indigo-800/40 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700';

    const isRetryable = session.status === 'failed' || session.status === 'cancelled';

    const handleRetry = () => {
        const params = new URLSearchParams();
        if (session.source_url) {
            params.set('retryUrl', session.source_url);
        }
        // Pass existing chapter range if available from output files count
        if (session.chapters_crawled > 0) {
            params.set('retryLimit', String(session.chapters_crawled));
        }
        const queryString = params.toString();
        navigate(`/${queryString ? `?${queryString}` : ''}`);
    };

    return (
        <div
            className={rootClasses}
            onClick={deleteMode && onToggleSelect ? () => onToggleSelect(session.crawl_id) : undefined}
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
                            <h3 className={`text-sm sm:text-base font-semibold truncate ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>{displayTitle}</h3>
                            {session.novel_metadata?.author && (
                                <p className={`text-sm truncate mt-0.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>by {session.novel_metadata.author}</p>
                            )}
                            <div className={`flex items-center gap-3 mt-1.5 text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                                {session.spider_name && <span>{session.spider_name}</span>}
                                <span className={text}>{label}</span>
                                {session.chapters_crawled > 0 && (
                                    <span>{session.chapters_crawled} chapter{session.chapters_crawled !== 1 ? 's' : ''}</span>
                                )}
                                {totalSize > 0 && <span>{formatBytes(totalSize)}</span>}
                            </div>
                            {session.source_url && (
                                <div className={`mt-1 text-xs truncate max-w-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                                    <a
                                        href={session.source_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`underline hover:no-underline ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'}`}
                                        title={session.source_url}
                                    >
                                        {session.source_url}
                                    </a>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap mt-3">
                            {hasFiles && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const a = document.createElement('a');
                                        a.href = getDownloadAllUrl(session.crawl_id);
                                        a.download = '';
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                    }}
                                    className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors shadow-lg shadow-indigo-600/30"
                                    title="Download all files as ZIP"
                                >
                                    Download All
                                </button>
                            )}
                            {hasCombined && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownloadCombined();
                                    }}
                                    className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors flex items-center gap-1.5 shadow-lg shadow-emerald-600/30"
                                    title="Download combined file"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Combined
                                </button>
                            )}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/results?session=${session.crawl_id}`);
                                }}
                                className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-colors ${isDark
                                    ? 'text-slate-300 bg-slate-800 hover:bg-slate-700'
                                    : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                                }`}
                            >
                                View
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/crawl?session=${session.crawl_id}`);
                                }}
                                className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors ${isDark
                                    ? 'text-indigo-300 border-indigo-800/60 hover:bg-indigo-900/30'
                                    : 'text-indigo-600 border-indigo-200 hover:bg-indigo-50'
                                }`}
                            >
                                Session
                            </button>
                            {chapterFiles.length > 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setExpanded(v => !v);
                                    }}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors ${isDark
                                        ? 'text-slate-400 hover:text-slate-200 border-slate-700 hover:bg-slate-800'
                                        : 'text-gray-500 hover:text-gray-700 border-gray-300 hover:bg-gray-100'
                                    }`}
                                >
                                    {expanded ? 'Hide' : `${chapterFiles.length}F`}
                                </button>
                            )}
                        </div>

                        {session.status === 'running' && session.chapters_total > 0 && (
                            <div className="mt-3 space-y-1.5">
                                <div className={`flex items-center justify-between text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                                    <span>{session.chapters_crawled}/{session.chapters_total} chapters</span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                                <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-gray-200'}`}>
                                    <div
                                        className="h-full bg-indigo-500 transition-all duration-300"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={`flex flex-col sm:flex-row sm:items-center gap-2 text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        <span>Started {formatDate(session.started_at)}</span>
                        {session.finished_at && (
                            <>
                                <span>Finished {formatDate(session.finished_at)}</span>
                                <span>{formatDuration(session.started_at, session.finished_at)}</span>
                            </>
                        )}
                        {session.status === 'running' && session.chapters_total > 0 && (
                            <span>{session.chapters_crawled}/{session.chapters_total}</span>
                        )}
                    </div>

                    {isRetryable && (
                        <div className="flex justify-end">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleRetry();
                                }}
                                className="px-4 py-2 text-sm font-medium rounded-xl transition-colors flex items-center gap-2 shadow-lg bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30"
                                title="Retry this crawl with the same URL"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                Retry Crawl
                            </button>
                        </div>
                    )}

                    {session.error_message && (
                        <p className={`text-xs mt-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>{session.error_message}</p>
                    )}
                </div>

                {expanded && chapterFiles.length > 0 && (
                    <div className={`border-t px-5 py-3 ${isDark
                        ? 'border-slate-800/60 bg-slate-900/40'
                        : 'border-gray-200 bg-gray-50/50'
                    }`}>
                        <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>
                            Individual Chapters
                        </p>
                        <div className="space-y-1.5">
                            {chapterFiles.slice(0, 5).map((file) => (
                                <div key={file.filename} className="flex items-center justify-between gap-3 py-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-mono flex-shrink-0 ${isDark
                                            ? 'bg-indigo-900/40 text-indigo-400'
                                            : 'bg-indigo-100 text-indigo-600'
                                        }`}>
                                            {file.chapter_number > 0 ? `#${file.chapter_number}` : '—'}
                                        </span>
                                        <span className={`text-sm truncate font-mono ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{file.filename}</span>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{formatBytes(file.size_bytes)}</span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDownloadFile(session.crawl_id, file.filename);
                                            }}
                                            className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${isDark
                                                ? 'text-slate-300 bg-slate-800 hover:bg-slate-700'
                                                : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                                            }`}
                                        >
                                            Download
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {chapterFiles.length > 5 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/results?session=${session.crawl_id}`);
                                    }}
                                    className={`flex items-center gap-2 py-1 text-xs transition-colors ${isDark
                                        ? 'text-indigo-400 hover:text-indigo-300'
                                        : 'text-indigo-600 hover:text-indigo-700'
                                    }`}
                                >
                                    <span>+{chapterFiles.length - 5} more files — view all in session</span>
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function ResultsAllPage({ themeMode }: ResultsAllPageProps) {
    const isDark = themeMode === 'dark';
    const PAGE_SIZE = 15;
    const navigate = useNavigate();
    const [sessions, setSessions] = useState<CrawlSessionSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | 'completed' | 'failed' | 'running'>('all');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [timeRange, setTimeRange] = useState<'all' | 'today' | 'week' | 'month' | 'specific'>('all');
    const [specificDate, setSpecificDate] = useState('');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [downloadingAllCombined, setDownloadingAllCombined] = useState(false);
    const [selectedCrawlIds, setSelectedCrawlIds] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; crawlIds: string[]; hasRunning: boolean }>({ open: false, crawlIds: [], hasRunning: false });
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const [deleteMode, setDeleteMode] = useState(false);

    const fetchSessions = useCallback((): Promise<void> => {
        return listAllResults()
            .then(data => setSessions(data))
            .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
            .finally(() => {});
    }, []);

    useEffect(() => {
        setIsLoading(true);
        setError('');
        fetchSessions().finally(() => setIsLoading(false));
        const interval = setInterval(fetchSessions, 3000);
        return () => clearInterval(interval);
    }, [fetchSessions]);

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
            const start = new Date(specificDate + 'T00:00:00');
            const end = new Date(specificDate + 'T23:59:59');
            return { start, end };
        }
        return null;
    })();

    const filtered = sessions
        .filter(s => {
            if (filter === 'all') return true;
            if (filter === 'running') return s.status === 'running';
            return s.status === filter;
        })
        .filter(s => {
            if (!timeCutoff || !s.started_at) return true;
            const sessionTime = new Date(s.started_at).getTime();
            if ('start' in timeCutoff && 'end' in timeCutoff) {
                return sessionTime >= timeCutoff.start.getTime() && sessionTime <= timeCutoff.end.getTime();
            }
            return sessionTime >= (timeCutoff as Date).getTime();
        })
        .sort((a, b) => {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
        });

    const visibleSessions = filtered.slice(0, visibleCount);
    const hasMore = visibleCount < filtered.length;
    const allVisibleSelected = visibleSessions.length > 0 && visibleSessions.every(s => selectedCrawlIds.has(s.crawl_id));

    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [filter, sortOrder, timeRange, specificDate]);

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

    const filteredCounts = {
        all: filtered.length,
        completed: filtered.filter(s => s.status === 'completed').length,
        failed: filtered.filter(s => s.status === 'failed' || s.status === 'cancelled').length,
        running: filtered.filter(s => s.status === 'running').length,
    };

    const handleDownloadFile = (crawlId: string, filename: string) => {
        const url = getDownloadUrl(crawlId, filename);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleToggleSelect = (crawlId: string) => {
        const newSelected = new Set(selectedCrawlIds);
        if (newSelected.has(crawlId)) {
            newSelected.delete(crawlId);
        } else {
            newSelected.add(crawlId);
        }
        setSelectedCrawlIds(newSelected);
    };

    const toggleDeleteMode = () => {
        if (deleteMode) {
            setDeleteMode(false);
            setSelectedCrawlIds(new Set());
        } else {
            setDeleteMode(true);
        }
    };

    const handleDeleteClick = () => {
        if (selectedCrawlIds.size === 0) return;
        const crawlIds = Array.from(selectedCrawlIds);
        const hasRunning = crawlIds.some(id => {
            const session = sessions.find(s => s.crawl_id === id);
            return session?.status === 'running';
        });
        setDeleteConfirmation({ open: true, crawlIds, hasRunning });
    };

    const handleConfirmDelete = async () => {
        try {
            setIsDeleting(true);
            await deleteCrawlSessions(deleteConfirmation.crawlIds);
            setSelectedCrawlIds(new Set());
            setDeleteConfirmation({ open: false, crawlIds: [], hasRunning: false });
            await fetchSessions();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete sessions');
            setDeleteConfirmation({ open: false, crawlIds: [], hasRunning: false });
        } finally {
            setIsDeleting(false);
        }
    };

    const filterBarBase = isDark ? 'bg-slate-900/60 border border-slate-800/60' : 'bg-white border border-gray-200';
    const filterBtnActive = 'bg-indigo-600 text-white';
    const filterBtnInactive = isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-700';

    return (
        <div className={`min-h-screen ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
            <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">

                {/* Page Header */}
                <div className="mb-2">
                    <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                        All Results
                    </h1>
                    <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        {filtered.length} of {sessions.length} sessions
                        {filter !== 'all' && ` · ${filter}`}
                        {timeRange === 'specific' && specificDate && ` · ${specificDate}`}
                        {timeRange !== 'all' && timeRange !== 'specific' && ` · ${timeRange === 'today' ? 'today' : timeRange === 'week' ? '7 days' : '30 days'}`}
                    </p>
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2">
                    <button
                        onClick={() => {
                            setDownloadingAllCombined(true);
                            const a = document.createElement('a');
                            a.href = getDownloadAllCombinedUrl();
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            setTimeout(() => setDownloadingAllCombined(false), 2000);
                        }}
                        disabled={downloadingAllCombined || !sessions.some(s => s.combined_file || s.combined_txt_file)}
                        className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 shadow-lg ${downloadingAllCombined || !sessions.some(s => s.combined_file || s.combined_txt_file)
                            ? isDark ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none' : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                            : 'text-white bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                        }`}
                    >
                        {downloadingAllCombined ? 'Zipping...' : 'All Combined'}
                    </button>

                    <button
                        onClick={toggleDeleteMode}
                        className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${deleteMode
                            ? isDark ? 'text-red-300 border border-red-700 bg-red-900/20 hover:bg-red-900/40' : 'text-red-600 border border-red-300 bg-red-50 hover:bg-red-100'
                            : isDark ? 'text-slate-300 border border-slate-700 hover:bg-slate-800' : 'text-gray-600 border border-gray-300 hover:bg-gray-100'
                        }`}
                    >
                        {deleteMode ? 'Cancel Delete' : 'Delete Mode'}
                    </button>

                    {deleteMode && (
                        <button
                            onClick={() => {
                                if (allVisibleSelected) {
                                    setSelectedCrawlIds(new Set());
                                } else {
                                    const newSelected = new Set(selectedCrawlIds);
                                    visibleSessions.forEach(s => newSelected.add(s.crawl_id));
                                    setSelectedCrawlIds(newSelected);
                                }
                            }}
                            className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${allVisibleSelected
                                ? isDark ? 'text-amber-300 border border-amber-700 bg-amber-900/20 hover:bg-amber-900/30' : 'text-amber-600 border border-amber-300 bg-amber-50 hover:bg-amber-100'
                                : isDark ? 'text-slate-300 border border-slate-700 hover:bg-slate-800' : 'text-gray-600 border border-gray-300 hover:bg-gray-100'
                            }`}
                        >
                            {allVisibleSelected ? 'Unselect All' : 'Select All'}
                        </button>
                    )}

                    {deleteMode && selectedCrawlIds.size > 0 && (
                        <button
                            onClick={handleDeleteClick}
                            disabled={isDeleting}
                            className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 shadow-lg ${isDeleting
                                ? isDark ? 'bg-red-900/50 text-red-400 cursor-not-allowed shadow-none' : 'bg-red-100 text-red-400 cursor-not-allowed shadow-none'
                                : 'text-white bg-red-600 hover:bg-red-500 shadow-red-600/30'
                            }`}
                        >
                            {isDeleting ? 'Deleting...' : `Delete (${selectedCrawlIds.size})`}
                        </button>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
                    <div className={`flex items-center gap-1 p-1 rounded-xl ${filterBarBase}`}>
                        {([
                            ['all', `All (${filteredCounts.all})`],
                            ['running', `Running (${filteredCounts.running})`],
                            ['completed', `Completed (${filteredCounts.completed})`],
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

                    <div className={`flex items-center gap-1 p-1 rounded-xl ${filterBarBase}`}>
                        <span className={`px-2 text-xs hidden sm:inline ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Time:</span>
                        {(['all', 'today', 'week', 'month'] as const).map(val => (
                            <button
                                key={val}
                                onClick={() => { setTimeRange(val); setSpecificDate(''); }}
                                className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${timeRange === val ? filterBtnActive : filterBtnInactive}`}
                            >
                                {val === 'all' ? 'All' : val === 'today' ? 'Today' : val === 'week' ? '7d' : '30d'}
                            </button>
                        ))}
                    </div>

                    <DatePicker
                        value={specificDate}
                        onDateChange={setSpecificDate}
                        isDark={isDark}
                    />

                    <button
                        onClick={() => { setIsLoading(true); fetchSessions().finally(() => setIsLoading(false)); }}
                        className={`px-3 py-1 text-xs border rounded-xl transition-colors flex items-center gap-1.5 ${isDark
                            ? 'text-slate-400 hover:text-slate-200 border-slate-800 hover:bg-slate-900'
                            : 'text-gray-500 hover:text-gray-700 border-gray-300 hover:bg-gray-100'
                        }`}
                        title="Refresh now"
                    >
                        <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>

                {isLoading && sessions.length === 0 && (
                    <div className={`flex items-center justify-center py-16 gap-3 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>Loading...</span>
                    </div>
                )}

                {error && (
                    <div className={`flex items-center justify-between gap-3 p-4 rounded-2xl text-sm ${isDark
                        ? 'bg-red-900/20 border border-red-800/30 text-red-400'
                        : 'bg-red-50 border border-red-200 text-red-600'
                    }`}>
                        <span>{error}</span>
                        <button onClick={fetchSessions} className="underline hover:no-underline">Retry</button>
                    </div>
                )}

                {!isLoading && filtered.length === 0 && (
                    <div className={`text-center py-20 space-y-3 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        <div className="flex justify-center">
                            <svg className={`w-12 h-12 ${isDark ? 'text-slate-700' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <p className={isDark ? 'text-slate-400' : 'text-gray-500'}>
                            {filter === 'all' ? 'No crawl sessions yet.' : `No ${filter} sessions.`}
                        </p>
                        <button
                            onClick={() => navigate('/')}
                            className={`text-sm underline ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'}`}
                        >
                            Start your first crawl
                        </button>
                    </div>
                )}

                <div className="space-y-3">
                    {visibleSessions.map((session, index) => (
                        <SessionCard
                            key={session.crawl_id}
                            session={session}
                            onDownloadFile={handleDownloadFile}
                            order={index + 1}
                            isSelected={selectedCrawlIds.has(session.crawl_id)}
                            onToggleSelect={handleToggleSelect}
                            deleteMode={deleteMode}
                            isDark={isDark}
                        />
                    ))}

                    {hasMore && (
                        <div ref={loadMoreRef} className={`py-6 text-center text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Loading more sessions...</div>
                    )}
                </div>

                {!isLoading && filtered.length > 0 && (
                    <div className="flex justify-center pt-2">
                        <button
                            onClick={fetchSessions}
                            className={`px-4 py-2 text-sm border rounded-xl transition-colors ${isDark
                                ? 'text-slate-400 hover:text-slate-200 border-slate-800 hover:bg-slate-900'
                                : 'text-gray-500 hover:text-gray-700 border-gray-300 hover:bg-gray-100'
                            }`}
                        >
                            Refresh
                        </button>
                    </div>
                )}

                {deleteConfirmation.open && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                        <div className={`rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-gray-200'}`}>
                            <h3 className={`text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                                {deleteConfirmation.hasRunning ? 'Warning' : 'Confirm Delete'}
                            </h3>
                            {deleteConfirmation.hasRunning ? (
                                <div className="space-y-3">
                                    <p className={`text-sm ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                                        You are about to delete {deleteConfirmation.crawlIds.length} session{deleteConfirmation.crawlIds.length !== 1 ? 's' : ''}, including <strong>running crawl(s)</strong>.
                                    </p>
                                    <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>Deleting a running session will:</p>
                                    <ul className={`text-sm space-y-1 ml-4 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                                        <li>• Stop the active crawl</li>
                                        <li>• Remove all downloaded data</li>
                                        <li>• Clear the session permanently</li>
                                    </ul>
                                    <p className={`text-sm font-medium ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>This action cannot be undone.</p>
                                </div>
                            ) : (
                                <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                                    Are you sure you want to delete {deleteConfirmation.crawlIds.length} session{deleteConfirmation.crawlIds.length !== 1 ? 's' : ''}? This action cannot be undone.
                                </p>
                            )}
                            <div className="flex gap-2 justify-end pt-2">
                                <button
                                    onClick={() => setDeleteConfirmation({ open: false, crawlIds: [], hasRunning: false })}
                                    disabled={isDeleting}
                                    className={`px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50 ${isDark
                                        ? 'text-slate-300 bg-slate-800 hover:bg-slate-700'
                                        : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                                    }`}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmDelete}
                                    disabled={isDeleting}
                                    className={`px-4 py-2 text-sm text-white rounded-xl transition-colors disabled:opacity-50 shadow-lg ${isDark
                                        ? 'bg-red-600 hover:bg-red-500 disabled:bg-red-900/50 disabled:text-red-400 shadow-red-600/30'
                                        : 'bg-red-600 hover:bg-red-500'
                                    }`}
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
