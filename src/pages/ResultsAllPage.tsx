import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    listAllResults,
    getDownloadUrl,
    getDownloadAllSessionsUrl,
    getDownloadCombinedUrl,
    getDownloadAllUrl,
    getDownloadAllCombinedUrl,
    deleteCrawlSessions,
    type CrawlSessionSummary,
} from '../api/client';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

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

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
    completed: { label: 'Completed', dot: 'bg-emerald-400', text: 'text-emerald-400' },
    failed: { label: 'Failed', dot: 'bg-red-400', text: 'text-red-400' },
    cancelled: { label: 'Cancelled', dot: 'bg-amber-400', text: 'text-amber-400' },
    running: { label: 'Running', dot: 'bg-blue-400', text: 'text-blue-400' },
    idle: { label: 'Idle', dot: 'bg-slate-500', text: 'text-slate-400' },
};

// CHANGED: Added deleteMode prop to interface
function SessionCard({ session, onDownloadFile, order, isSelected, onToggleSelect, deleteMode }: {
    session: CrawlSessionSummary;
    onDownloadFile: (crawlId: string, filename: string) => void;
    order?: number;
    isSelected?: boolean;
    onToggleSelect?: (crawlId: string) => void;
    deleteMode?: boolean;
}) {
    const navigate = useNavigate();
    const [expanded, setExpanded] = useState(false);

    const status = STATUS_CONFIG[session.status] ?? { label: session.status, dot: 'bg-slate-500', text: 'text-slate-400' };
    const hasCombined = !!(session.combined_file || session.combined_txt_file);
    const chapterFiles = (session.output_files || []).filter(f =>
        !hasCombined || (f.filename !== (session.combined_txt_file || session.combined_file))
    );
    const totalSize = (session.output_files || []).reduce((sum, f) => sum + (f.size_bytes || 0), 0);
    const hasFiles = (session.output_files || []).length > 0;

    const displayTitle =
        session.novel_metadata?.title ||
        session.novel_name ||
        session.crawl_id;
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

    // CHANGED: Added dynamic card styling for delete mode selection
    const cardBg = deleteMode && isSelected
        ? 'bg-red-950/40 border-red-800/60'
        : 'bg-slate-800 border-slate-700';

    const rootClasses = `${cardBg} rounded-xl border overflow-hidden flex transition-colors duration-150 ${deleteMode ? 'cursor-pointer select-none' : ''}`;

    // CHANGED: Dynamic background for order column based on selection state
    const orderBg = deleteMode && isSelected
        ? 'bg-red-900/50 border-red-800/40 text-red-300'
        : 'bg-indigo-900/30 border-indigo-800/40 text-indigo-300';

    return (
        // CHANGED: Added onClick, updated className for selection tint and interaction
        <div
            className={rootClasses}
            onClick={deleteMode && onToggleSelect ? () => onToggleSelect(session.crawl_id) : undefined}
        >
            {order != null && (
                // CHANGED: Applied orderBg for left accent strip functionality
                <div className={`w-12 flex-shrink-0 border-r flex flex-col items-center justify-center rounded-l-xl transition-colors duration-150 ${orderBg}`}>
                    <span className="text-base font-bold select-none">#{order}</span>
                </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col">
                <div className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
                    <div className="flex-shrink-0 mt-1 flex items-center gap-2">
                        {/* CHANGED: Removed checkbox entirely */}
                        <div className={`w-2.5 h-2.5 rounded-full ${status.dot}`} />
                    </div>

                    <div className="flex-1 min-w-0 w-full">
                        <div className="min-w-0 w-full sm:w-auto">
                            <h3 className="text-sm sm:text-base font-semibold text-slate-100 truncate">{displayTitle}</h3>
                            {session.novel_metadata?.author && (
                                <p className="text-sm text-slate-400 truncate mt-0.5">by {session.novel_metadata.author}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                                {session.spider_name && <span>{session.spider_name}</span>}
                                <span className={status.text}>{status.label}</span>
                                {session.chapters_crawled > 0 && (
                                    <span>{session.chapters_crawled} chapter{session.chapters_crawled !== 1 ? 's' : ''}</span>
                                )}
                                {totalSize > 0 && <span>{formatBytes(totalSize)}</span>}
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap mt-2">
                            {hasFiles && (
                                <button
                                    onClick={(e) => {
                                        // CHANGED: Added stopPropagation
                                        e.stopPropagation();
                                        const a = document.createElement('a');
                                        a.href = getDownloadAllUrl(session.crawl_id);
                                        a.download = '';
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                    }}
                                    className="px-2 sm:px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
                                    title="Download all files as ZIP"
                                >
                                    Download All
                                </button>
                            )}
                            {hasCombined && (
                                <button
                                    onClick={(e) => {
                                        // CHANGED: Added stopPropagation
                                        e.stopPropagation();
                                        handleDownloadCombined();
                                    }}
                                    className="px-2 sm:px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1.5"
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
                                    // CHANGED: Added stopPropagation
                                    e.stopPropagation();
                                    navigate(`/results?session=${session.crawl_id}`);
                                }}
                                className="px-2 sm:px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                            >
                                View
                            </button>
                            <button
                                onClick={(e) => {
                                    // CHANGED: Added stopPropagation
                                    e.stopPropagation();
                                    navigate(`/crawl?session=${session.crawl_id}`);
                                }}
                                className="px-2 sm:px-3 py-1.5 text-xs font-medium text-indigo-300 border border-indigo-700 rounded-lg hover:bg-indigo-900/30 transition-colors"
                            >
                                Session
                            </button>
                            <button
                                onClick={(e) => {
                                    // CHANGED: Added stopPropagation
                                    e.stopPropagation();
                                    setExpanded(v => !v);
                                }}
                                className="px-2 sm:px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 rounded-lg border border-slate-600 hover:bg-slate-700 transition-colors"
                            >
                                {expanded ? 'Hide' : `${chapterFiles.length > 0 ? chapterFiles.length + 'F' : ''}`}
                            </button>
                        </div>

                        {session.status === 'running' && session.chapters_total > 0 && (
                            <div className="mt-3 space-y-1.5">
                                <div className="flex items-center justify-between text-xs text-slate-500">
                                    <span>
                                        {session.chapters_crawled}/{session.chapters_total} chapters
                                    </span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-indigo-500 transition-all duration-300"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 mt-2 text-xs text-slate-500">
                        <span>Started {formatDate(session.started_at)}</span>
                        {session.finished_at && (
                            <>
                                <span>Finished {formatDate(session.finished_at)}</span>
                                <span>{formatDuration(session.started_at, session.finished_at)}</span>
                            </>
                        )}
                        {session.status === 'running' && session.chapters_total > 0 && (
                            <span>
                                {session.chapters_crawled}/{session.chapters_total}
                            </span>
                        )}
                    </div>

                    {session.error_message && (
                        <p className="text-xs text-red-400 mt-2">{session.error_message}</p>
                    )}
                </div>

                {expanded && chapterFiles.length > 0 && (
                    <div className="border-t border-slate-700 px-5 py-3 bg-slate-900/50">
                        <p className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-2">
                            Individual Chapters
                        </p>
                        <div className="space-y-1.5">
                            {chapterFiles.slice(0, 5).map((file) => (
                                <div key={file.filename} className="flex items-center justify-between gap-3 py-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="inline-flex items-center justify-center w-6 h-6 bg-indigo-900/50 text-indigo-400 rounded text-[10px] font-mono flex-shrink-0">
                                            {file.chapter_number > 0 ? `#${file.chapter_number}` : '—'}
                                        </span>
                                        <span className="text-sm text-slate-300 truncate font-mono">{file.filename}</span>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className="text-xs text-slate-500">{formatBytes(file.size_bytes)}</span>
                                        <button
                                            onClick={(e) => {
                                                // CHANGED: Added stopPropagation
                                                e.stopPropagation();
                                                onDownloadFile(session.crawl_id, file.filename);
                                            }}
                                            className="px-2.5 py-1 text-xs text-slate-300 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                                        >
                                            Download
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {chapterFiles.length > 5 && (
                                <button
                                    onClick={(e) => {
                                        // CHANGED: Added stopPropagation
                                        e.stopPropagation();
                                        navigate(`/results?session=${session.crawl_id}`);
                                    }}
                                    className="flex items-center gap-2 py-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
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

export default function ResultsAllPage({ themeMode, onThemeChange }: ResultsAllPageProps) {
    const PAGE_SIZE = 15;
    const navigate = useNavigate();
    const [sessions, setSessions] = useState<CrawlSessionSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | 'completed' | 'failed' | 'running'>('all');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [timeRange, setTimeRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [downloadingAll, setDownloadingAll] = useState(false);
    const [downloadingAllCombined, setDownloadingAllCombined] = useState(false);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [selectedCrawlIds, setSelectedCrawlIds] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; crawlIds: string[]; hasRunning: boolean }>({ open: false, crawlIds: [], hasRunning: false });
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    // CHANGED: Added deleteMode state
    const [deleteMode, setDeleteMode] = useState(false);

    const fetchSessions = useCallback((): Promise<void> => {
        return listAllResults()
            .then(data => setSessions(data))
            .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
            .finally(() => setLastRefresh(new Date()));
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
            return new Date(s.started_at) >= timeCutoff;
        })
        .sort((a, b) => {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
        });

    const visibleSessions = filtered.slice(0, visibleCount);
    const hasMore = visibleCount < filtered.length;

    // CHANGED: Helper logic for Select All / Unselect All
    const allVisibleSelected = visibleSessions.length > 0 && visibleSessions.every(s => selectedCrawlIds.has(s.crawl_id));

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
        all: sessions.length,
        completed: sessions.filter(s => s.status === 'completed').length,
        failed: sessions.filter(s => s.status === 'failed' || s.status === 'cancelled').length,
        running: sessions.filter(s => s.status === 'running').length,
    };

    // Counts based on filtered sessions (respects time range)
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

    // CHANGED: Update toggleDeleteMode logic
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

    return (
        <div className="min-h-screen bg-slate-900">
            <Header
                themeMode={themeMode}
                onThemeChange={onThemeChange}
                title={'All Crawl Results'}
                subtitle={<>{filtered.length} of {counts.all} session{counts.all !== 1 ? 's' : ''}{filter !== 'all' && ` · ${filter}`}{timeRange !== 'all' && ` · ${timeRange === 'today' ? 'today' : timeRange === 'week' ? '7 days' : '30 days'}`} · refreshed {lastRefresh.toLocaleTimeString()}</>}
            />

            <main className="w-full xl:w-[70vw] mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5">
                <div className="flex flex-wrap items-center justify-start gap-2">
                    <button
                        onClick={() => {
                            setDownloadingAll(true);
                            const a = document.createElement('a');
                            a.href = getDownloadAllSessionsUrl();
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            setTimeout(() => setDownloadingAll(false), 2000);
                        }}
                        disabled={downloadingAll || sessions.length === 0}
                        className="px-3 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:text-indigo-400 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                        {downloadingAll ? 'Zipping...' : 'Download Everything'}
                    </button>
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
                        className="px-3 py-1.5 text-sm text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:text-emerald-400 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                        {downloadingAllCombined ? 'Zipping...' : 'All Combined'}
                    </button>

                    {/* CHANGED: Delete Mode Toggle Button */}
                    <button
                        onClick={toggleDeleteMode}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${deleteMode
                                ? 'text-red-300 border border-red-700 bg-red-900/20 hover:bg-red-900/40'
                                : 'text-slate-300 border border-slate-600 hover:bg-slate-700'
                            }`}
                    >
                        {deleteMode ? '✕ Exit Delete' : 'Delete Mode'}
                    </button>

                    {/* CHANGED: Select All / Unselect All Button */}
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
                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${allVisibleSelected
                                    ? 'text-amber-300 border border-amber-700 bg-amber-900/20 hover:bg-amber-900/30'
                                    : 'text-slate-300 border border-slate-600 hover:bg-slate-700'
                                }`}
                        >
                            {allVisibleSelected ? 'Unselect All' : 'Select All'}
                        </button>
                    )}

                    {/* CHANGED: Delete (N) conditionally updated to only render in deleteMode */}
                    {deleteMode && selectedCrawlIds.size > 0 && (
                        <button
                            onClick={handleDeleteClick}
                            disabled={isDeleting}
                            className="px-3 py-1.5 text-sm text-white bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:text-red-400 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                            {isDeleting ? 'Deleting...' : `Delete (${selectedCrawlIds.size})`}
                        </button>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg border border-slate-700">
                        {([
                            ['all', `All (${filteredCounts.all})`],
                            ['running', `Running (${filteredCounts.running})`],
                            ['completed', `Completed (${filteredCounts.completed})`],
                            ['failed', `Failed (${filteredCounts.failed})`],
                        ] as const).map(([value, label]) => (
                            <button
                                key={value}
                                onClick={() => setFilter(value)}
                                className={`px-3 py-1 text-xs sm:text-sm rounded-md transition-colors ${filter === value
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
                            className={`px-3 py-1 text-xs sm:text-sm rounded-md transition-colors ${sortOrder === 'newest' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            Newest
                        </button>
                        <button
                            onClick={() => setSortOrder('oldest')}
                            className={`px-3 py-1 text-xs sm:text-sm rounded-md transition-colors ${sortOrder === 'oldest' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
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
                                className={`px-3 py-1 text-xs sm:text-sm rounded-md transition-colors ${timeRange === value ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => { setIsLoading(true); fetchSessions().finally(() => setIsLoading(false)); }}
                        className="px-3 py-1 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 ml-1"
                        title="Refresh now"
                    >
                        <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>

                {isLoading && sessions.length === 0 && (
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
                        <button onClick={fetchSessions} className="text-sm underline hover:no-underline">Retry</button>
                    </div>
                )}

                {!isLoading && filtered.length === 0 && (
                    <div className="text-center py-20 text-slate-500 space-y-3">
                        <div className="flex justify-center">
                            <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <p className="text-slate-400">
                            {filter === 'all' ? 'No crawl sessions yet.' : `No ${filter} sessions.`}
                        </p>
                        <button
                            onClick={() => navigate('/')}
                            className="text-sm text-indigo-400 hover:text-indigo-300 underline"
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
                            // CHANGED: Passed deleteMode prop
                            deleteMode={deleteMode}
                        />
                    ))}

                    {hasMore && (
                        <div ref={loadMoreRef} className="py-6 text-center text-xs text-slate-500">Loading more sessions...</div>
                    )}
                </div>

                {!isLoading && filtered.length > 0 && (
                    <div className="flex justify-center pt-2">
                        <button
                            onClick={fetchSessions}
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
                                {deleteConfirmation.hasRunning ? '⚠️ Warning' : 'Confirm Delete'}
                            </h3>
                            {deleteConfirmation.hasRunning ? (
                                <div className="space-y-3">
                                    <p className="text-sm text-amber-400">
                                        You are about to delete {deleteConfirmation.crawlIds.length} session{deleteConfirmation.crawlIds.length !== 1 ? 's' : ''}, including <strong>running crawl(s)</strong>.
                                    </p>
                                    <p className="text-sm text-slate-300">
                                        Deleting a running session will:
                                    </p>
                                    <ul className="text-sm text-slate-400 space-y-1 ml-4">
                                        <li>• Stop the active crawl</li>
                                        <li>• Remove all downloaded data</li>
                                        <li>• Clear the session permanently</li>
                                    </ul>
                                    <p className="text-sm text-amber-300 font-medium">
                                        This action cannot be undone.
                                    </p>
                                </div>
                            ) : (
                                <p className="text-sm text-slate-300">
                                    Are you sure you want to delete {deleteConfirmation.crawlIds.length} session{deleteConfirmation.crawlIds.length !== 1 ? 's' : ''}? This action cannot be undone.
                                </p>
                            )}
                            <div className="flex gap-2 justify-end pt-2">
                                <button
                                    onClick={() => setDeleteConfirmation({ open: false, crawlIds: [], hasRunning: false })}
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