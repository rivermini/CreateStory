import { useEffect, useState, useCallback, useRef } from 'react';
import {
    getAutoAudioHistory,
    getAutoAudioSession,
    removeAutoAudioSessions,
    type AutoAudioHistoryEntry,
    type AutoAudioSession,
    type AutoAudioLogEntry,
} from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';
import { DatePicker } from '../components/DatePicker';

interface AutoAudioHistoryPageProps {
    themeMode: ThemeMode;
    onThemeChange: (mode: ThemeMode) => void;
}

type FilterStatus = 'all' | 'running' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'error';
type FilterMode = 'all' | 'test' | 'prod';

const STATUS_DOT_MAP: Record<string, (isDark: boolean) => string> = {
    completed: (d) => d ? 'bg-emerald-400' : 'bg-emerald-500',
    error:     (d) => d ? 'bg-red-400'    : 'bg-red-500',
    stopped:   (d) => d ? 'bg-amber-400'  : 'bg-amber-500',
    running:   (d) => d ? 'bg-blue-400'   : 'bg-blue-500',
    paused:    (d) => d ? 'bg-amber-300'  : 'bg-amber-500',
    stopping:  (d) => d ? 'bg-amber-400 animate-pulse' : 'bg-amber-500 animate-pulse',
    idle:      (d) => d ? 'bg-white/30'  : 'bg-gray-400',
};

const STATUS_LABEL_MAP: Record<string, string> = {
    completed: 'Completed',
    error:     'Error',
    stopped:   'Stopped',
    running:   'Running',
    paused:    'Paused',
    stopping:  'Stopping',
    idle:      'Idle',
};

function formatTime(iso: string | null): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
    if (!startedAt || !finishedAt) return '—';
    try {
        const totalSeconds = Math.floor((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000);
        if (totalSeconds <= 0) return '—';
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    } catch { return '—'; }
}

function formatTotalDuration(totalSeconds: number): string {
    if (totalSeconds <= 0) return '—';
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

interface SessionCardProps {
    session: AutoAudioHistoryEntry;
    order: number;
    isExpanded: boolean;
    expandedSession: AutoAudioSession | null;
    loadingDetail: boolean;
    isDark: boolean;
    deleteMode: boolean;
    isSelected: boolean;
    onToggleExpand: (sessionId: string) => void;
    onToggleSelect: (sessionId: string) => void;
}

function SessionCard({
    session, order, isExpanded, expandedSession, loadingDetail,
    isDark, deleteMode, isSelected, onToggleExpand, onToggleSelect,
}: SessionCardProps) {
    const dotFn = STATUS_DOT_MAP[session.status] ?? STATUS_DOT_MAP.idle;
    const dot = dotFn(isDark);
    const label = STATUS_LABEL_MAP[session.status] ?? session.status;

    const cardBg = deleteMode && isSelected
        ? (isDark ? 'bg-red-500/10 border border-red-500/30' : 'bg-red-50 border border-red-200')
        : (isDark ? 'lg-glass-card border border-white/[0.05]' : 'lg-glass-card border border-black/5');

    const orderBg = deleteMode && isSelected
        ? (isDark ? 'bg-red-500/10 border-r border-r-red-500/30 text-red-300' : 'bg-red-100 border-r border-r-red-200 text-red-700')
        : (isDark ? 'bg-indigo-500/10 border-r border-r-white/5 text-indigo-300' : 'bg-indigo-50 border-r border-r-indigo-100 text-indigo-700');

    const logLevelColor = (level: string) => {
        if (level === 'error') return isDark ? 'text-red-400' : 'text-red-600';
        if (level === 'warning') return isDark ? 'text-amber-400' : 'text-amber-600';
        return isDark ? 'text-white/70' : 'text-gray-700';
    };

    return (
        <div
            className={`rounded-2xl overflow-hidden flex transition-all duration-200 ${cardBg} ${deleteMode ? 'cursor-pointer select-none' : ''}`}
            onClick={deleteMode ? () => onToggleSelect(session.session_id) : undefined}
        >
            {order != null && (
                <div className={`w-12 flex-shrink-0 border-r flex flex-col items-center justify-center rounded-l-2xl transition-colors duration-200 ${orderBg}`}>
                    <span className="text-base font-bold select-none">#{order}</span>
                </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col">
                <div
                    className={`px-5 py-4 flex flex-col sm:flex-row items-start gap-4 ${!deleteMode ? 'cursor-pointer' : ''}`}
                    onClick={() => deleteMode ? onToggleSelect(session.session_id) : onToggleExpand(session.session_id)}
                >
                    <div className="flex-shrink-0 mt-1 flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                    </div>

                    <div className="flex-1 min-w-0 w-full">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${isDark
                                ? 'bg-white/[0.06] text-white/70'
                                : 'bg-[rgba(0,0,0,0.04)] text-[rgba(0,0,0,0.7)]'}`}>
                                {label}
                            </span>
                            <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${session.test_mode
                                ? (isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-100 text-amber-700')
                                : (isDark ? 'bg-white/[0.04] text-white/40' : 'bg-[rgba(0,0,0,0.04)] text-[rgba(0,0,0,0.4)]')}`}>
                                {session.test_mode ? 'Test' : 'Production'}
                            </span>
                            <span className={`text-xs font-mono ${isDark ? 'text-white/20' : 'text-[rgba(0,0,0,0.25)]'}`}>{session.session_id}</span>
                        </div>

                        <div className={`mt-1.5 text-sm font-medium ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>
                            Step {session.current_step}: {session.current_step_desc || '—'}
                        </div>

                        <div className="mt-1.5 flex items-center gap-3">
                            <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700'}`}>
                                {session.total_stories} stories
                            </span>
                            <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-700'}`}>
                                {session.total_chapters} chapters
                            </span>
                        </div>
                    </div>

                    <div className={`flex flex-col sm:items-end gap-1 text-xs ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                        <div className="flex items-center gap-2">
                            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''} ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            <span>Started {formatTime(session.started_at)}</span>
                        </div>
                        {session.finished_at && (
                            <>
                                <span>Finished {formatTime(session.finished_at)}</span>
                                <span className={`text-xs font-medium ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>
                                    {formatDuration(session.started_at, session.finished_at)}
                                </span>
                            </>
                        )}
                    </div>
                </div>

                {session.error && (
                    <div className={`px-5 pb-3 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                        Error: {session.error}
                    </div>
                )}

                {/* Expanded Detail */}
                {isExpanded && (
                    <div className={`border-t px-5 py-4 ${isDark
                        ? 'border-white/[0.05] bg-white/[0.01]'
                        : 'border-black/5 bg-[rgba(0,0,0,0.01)]'}`}>
                        {loadingDetail ? (
                            <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Loading session detail...
                            </div>
                        ) : expandedSession ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {([
                                        ['Session ID', expandedSession.session_id, true],
                                        ['Started', formatTime(expandedSession.started_at), false],
                                        ['Finished', formatTime(expandedSession.finished_at), false],
                                        ['Duration', formatDuration(expandedSession.started_at, expandedSession.finished_at), false],
                                    ] as [string, string, boolean][]).map(([label, value, mono]) => (
                                        <div key={String(label)}>
                                            <p className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-white/20' : 'text-[rgba(0,0,0,0.2)]'}`}>{label}</p>
                                            <p className={`text-sm mt-0.5 ${mono ? 'font-mono' : ''} ${isDark ? 'text-white/85' : 'text-[rgba(0,0,0,0.8)]'}`}>{value || '—'}</p>
                                        </div>
                                    ))}
                                </div>

                                {expandedSession.stories_missing_audio.length > 0 && (
                                    <div>
                                        <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDark ? 'text-white/20' : 'text-[rgba(0,0,0,0.2)]'}`}>
                                            Stories with Missing Audio
                                        </p>
                                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                                            {expandedSession.stories_missing_audio.map((s, i) => (
                                                <div key={i} className={`flex items-center justify-between gap-3 py-1.5 px-2 rounded-lg ${isDark ? 'bg-white/[0.02]' : 'bg-[rgba(0,0,0,0.02)]'}`}>
                                                    <span className={`text-sm truncate ${isDark ? 'text-white/70' : 'text-[rgba(0,0,0,0.7)]'}`}>{s.title}</span>
                                                    <span className={`text-xs flex-shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>{s.missingCount} missing</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {expandedSession.story_results.length > 0 && (
                                    <div>
                                        <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDark ? 'text-white/20' : 'text-[rgba(0,0,0,0.2)]'}`}>
                                            Story Results
                                        </p>
                                        <div className="space-y-1 max-h-[250px] overflow-y-auto">
                                            {expandedSession.story_results.map((r, i) => (
                                                <div key={i} className={`py-2 px-2 rounded-lg ${isDark ? 'bg-white/[0.02]' : 'bg-[rgba(0,0,0,0.02)]'}`}>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className={`text-sm font-medium truncate ${isDark ? 'text-white/70' : 'text-[rgba(0,0,0,0.7)]'}`}>{r.story_title}</span>
                                                        <span className={`text-xs flex-shrink-0 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                                                            {r.chapters_uploaded}/{r.chapters_generated} uploaded
                                                        </span>
                                                    </div>
                                                    {r.upload_errors.length > 0 && (
                                                        <p className={`text-xs mt-1 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                                                            {r.upload_errors.slice(0, 2).join(', ')}
                                                        </p>
                                                    )}
                                                    {r.error && (
                                                        <p className={`text-xs mt-1 ${isDark ? 'text-red-400' : 'text-red-600'}`}>{r.error}</p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {expandedSession.logs.length > 0 && (
                                    <div>
                                        <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDark ? 'text-white/20' : 'text-[rgba(0,0,0,0.2)]'}`}>
                                            Session Log
                                        </p>
                                        <div className={`rounded-xl p-3 font-mono max-h-[300px] overflow-y-auto ${isDark ? 'bg-black/30' : 'bg-black/4'}`}
                                            style={{ fontSize: '0.7rem', lineHeight: '1.6' }}>
                                            {expandedSession.logs.map((log: AutoAudioLogEntry, i: number) => (
                                                <div key={i} className="flex gap-2">
                                                    <span className={`flex-shrink-0 ${isDark ? 'text-white/15' : 'text-[rgba(0,0,0,0.15)]'}`}>[{log.timestamp}]</span>
                                                    <span className={`flex-shrink-0 font-bold ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>S{log.step}</span>
                                                    <span className={logLevelColor(log.level)}>{log.message}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className={`text-sm ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>Session detail unavailable.</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export function AutoAudioHistoryPage({ themeMode }: AutoAudioHistoryPageProps) {
    const isDark = themeMode === 'dark';
    const PAGE_SIZE = 15;
    const [sessions, setSessions] = useState<AutoAudioHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [specificDate, setSpecificDate] = useState('');
    const [search, setSearch] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [expandedSession, setExpandedSession] = useState<AutoAudioSession | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteMode, setDeleteMode] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; ids: string[] }>({ open: false, ids: [] });

    const loadHistory = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await getAutoAudioHistory();
            setSessions(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load history.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadHistory(); }, [loadHistory]);

    useEffect(() => {
        const hasRunning = sessions.some(s => s.status === 'running' || s.status === 'paused' || s.status === 'stopping');
        if (!hasRunning) return;
        const interval = setInterval(loadHistory, 10000);
        return () => clearInterval(interval);
    }, [sessions, loadHistory]);

    const dateCutoff = specificDate ? (() => {
        const start = new Date(specificDate + 'T00:00:00');
        const end = new Date(specificDate + 'T23:59:59');
        return { start, end };
    })() : null;

    const filtered = sessions
        .filter(s => {
            if (filterStatus === 'running' && !['running', 'paused', 'stopping'].includes(s.status)) return false;
            if (filterStatus !== 'all' && filterStatus !== 'running' && s.status !== filterStatus) return false;
            if (filterMode === 'test' && !s.test_mode) return false;
            if (filterMode === 'prod' && s.test_mode) return false;
            if (search) {
                const q = search.toLowerCase();
                if (!s.session_id.toLowerCase().includes(q) && !s.error?.toLowerCase().includes(q)) return false;
            }
            return true;
        })
        .filter(s => {
            if (!dateCutoff || !s.started_at) return true;
            const sessionTime = new Date(s.started_at).getTime();
            return sessionTime >= dateCutoff.start.getTime() && sessionTime <= dateCutoff.end.getTime();
        })
        .sort((a, b) => {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
        });

    const visibleSessions = filtered.slice(0, visibleCount);
    const hasMore = visibleCount < filtered.length;
    const allVisibleSelected = visibleSessions.length > 0 && visibleSessions.every(s => selectedIds.has(s.session_id));

    useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filterStatus, filterMode, sortOrder, specificDate, search]);

    useEffect(() => {
        if (!hasMore) return;
        const node = loadMoreRef.current;
        if (!node) return;
        const observer = new IntersectionObserver(
            entries => { if (entries[0]?.isIntersecting) setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filtered.length)); },
            { rootMargin: '300px 0px' }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, filtered.length]);

    const handleToggleExpand = async (sessionId: string) => {
        if (expandedId === sessionId) {
            setExpandedId(null);
            setExpandedSession(null);
            return;
        }
        setExpandedId(sessionId);
        setLoadingDetail(true);
        try {
            const data = await getAutoAudioSession(sessionId);
            setExpandedSession(data);
        } catch {
            setExpandedSession(null);
        } finally {
            setLoadingDetail(false);
        }
    };

    const handleToggleSelect = (sessionId: string) => {
        const s = new Set(selectedIds);
        s.has(sessionId) ? s.delete(sessionId) : s.add(sessionId);
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
        setDeleteConfirmation({ open: true, ids: Array.from(selectedIds) });
    };

    const handleConfirmDelete = async () => {
        try {
            setIsDeleting(true);
            await removeAutoAudioSessions(deleteConfirmation.ids);
            setSelectedIds(new Set());
            setDeleteConfirmation({ open: false, ids: [] });
            setDeleteMode(false);
            await loadHistory();
        } catch {
            setError('Failed to delete sessions.');
            setDeleteConfirmation({ open: false, ids: [] });
        } finally {
            setIsDeleting(false);
        }
    };

    const filteredCounts = {
        all: filtered.length,
        running: filtered.filter(s => s.status === 'running' || s.status === 'paused' || s.status === 'stopping').length,
        completed: filtered.filter(s => s.status === 'completed').length,
        error: filtered.filter(s => s.status === 'error').length,
        stopped: filtered.filter(s => s.status === 'stopped').length,
    };

    const totalChapters = filtered.reduce((sum, s) => sum + (s.total_chapters || 0), 0);
    const totalSeconds = filtered.reduce((sum, s) => {
        if (!s.started_at || !s.finished_at) return sum;
        try {
            return sum + Math.floor((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000);
        } catch { return sum; }
    }, 0);

    const filterBarBase = isDark ? 'lg-glass-nav p-1.5' : 'lg-glass-nav p-1.5';
    const filterBtnActive = 'bg-indigo-600 text-white';
    const filterBtnInactive = isDark ? 'text-white/40 hover:text-white/70' : 'text-[rgba(0,0,0,0.4)] hover:text-[rgba(0,0,0,0.7)]';

    const c = (key: string) => {
        const map: Record<string, [string, string]> = {
            text: ['text-white/90', 'text-[rgba(0,0,0,0.85)]'],
            textMuted: ['text-white/40', 'text-[rgba(0,0,0,0.4)]'],
            textSub: ['text-white/30', 'text-[rgba(0,0,0,0.3)]'],
            textBody: ['text-white/70', 'text-[rgba(0,0,0,0.7)]'],
            textBodyStrong: ['text-white/85', 'text-[rgba(0,0,0,0.8)]'],
            divider: ['bg-white/6', 'bg-black/6'],
        };
        return isDark ? map[key][0] : map[key][1];
    };

    const pageBg = isDark
        ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
        : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)';

    return (
        <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBg }}>
            <div className="lg-orb lg-orb-1" />
            <div className="lg-orb lg-orb-2" />
            <div className="lg-orb lg-orb-3" />

            <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
                <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">

                    {/* Page Header */}
                    <div className="lg-glass-deep px-6 py-5 flex items-start justify-between gap-4">
                        <div>
                            <h1 className={`text-2xl font-bold tracking-tight ${c('text')}`}>Audio History</h1>
                            <p className={`text-sm mt-1 ${c('textMuted')}`}>
                                {filtered.length} of {sessions.length} sessions
                                {filterStatus !== 'all' && ` · ${filterStatus}`}
                                {filterMode !== 'all' && ` · ${filterMode}`}
                                {specificDate && ` · ${specificDate}`}
                            </p>
                        </div>
                    </div>

                    {/* Totals Banner */}
                    {totalChapters > 0 && (
                        <div className={`rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 ${isDark
                            ? 'bg-indigo-500/10 border border-indigo-500/20'
                            : 'bg-indigo-50 border border-indigo-200'}`}>
                            <div className="flex items-center gap-3 flex-1">
                                <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${isDark ? 'bg-indigo-500/10' : 'bg-indigo-100'}`}>
                                    <svg className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                </div>
                                <div>
                                    <div className={`text-xs font-medium uppercase tracking-wide ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>Filtered Totals</div>
                                    <div className={`text-2xl font-bold ${isDark ? 'text-indigo-200' : 'text-indigo-800'}`}>
                                        {totalChapters.toLocaleString()} <span className={`text-sm font-normal ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>chapters</span>
                                    </div>
                                </div>
                            </div>
                            <div className={`h-10 w-px hidden sm:block ${isDark ? 'bg-indigo-500/20' : 'bg-indigo-200'}`} />
                            <div className="flex items-center gap-3">
                                <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${isDark ? 'bg-indigo-500/10' : 'bg-indigo-100'}`}>
                                    <svg className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div>
                                    <div className={`text-xs font-medium uppercase tracking-wide ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>Total Time</div>
                                    <div className={`text-2xl font-bold ${isDark ? 'text-indigo-200' : 'text-indigo-800'}`}>
                                        {formatTotalDuration(totalSeconds)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Running Banner */}
                    {filtered.filter(s => s.status === 'running' || s.status === 'paused').length > 0 && (
                        <div className={`rounded-2xl p-4 flex items-center gap-3 ${isDark
                            ? 'bg-blue-500/10 border border-blue-500/20'
                            : 'bg-blue-50 border border-blue-200'}`}>
                            <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                            <span className={`text-sm ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                                <span className="font-medium">{filtered.filter(s => s.status === 'running' || s.status === 'paused').length} session(s)</span>
                                {' '}currently active
                            </span>
                        </div>
                    )}

                    {/* Filter Bar */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
                        <div className={`flex items-center gap-1 rounded-xl ${filterBarBase}`}>
                            {([
                                ['all', `All (${filteredCounts.all})`],
                                ['running', `Active (${filteredCounts.running})`],
                                ['stopped', `Stopped (${filteredCounts.stopped})`],
                                ['completed', `Done (${filteredCounts.completed})`],
                                ['error', `Error (${filteredCounts.error})`],
                            ] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    onClick={() => setFilterStatus(value)}
                                    className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${filterStatus === value ? filterBtnActive : filterBtnInactive}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        <div className={`flex items-center gap-1 rounded-xl ${filterBarBase}`}>
                            <span className={`px-2 text-xs hidden sm:inline ${c('textSub')}`}>Mode:</span>
                            {([['all', 'All'], ['test', 'Test'], ['prod', 'Prod']] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    onClick={() => setFilterMode(value)}
                                    className={`px-3 py-1 text-xs sm:text-sm rounded-lg transition-colors ${filterMode === value ? filterBtnActive : filterBtnInactive}`}
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

                        <DatePicker value={specificDate} onDateChange={setSpecificDate} isDark={isDark} />

                        <button
                            onClick={() => loadHistory()}
                            className={`lg-icon-btn`}
                            title="Refresh now"
                        >
                            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center justify-start gap-2">
                        <button
                            onClick={toggleDeleteMode}
                            className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${deleteMode
                                ? (isDark ? 'text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20' : 'text-red-600 border border-red-300 bg-red-50 hover:bg-red-100')
                                : (isDark ? 'text-white/50 border border-white/5 hover:text-white/70 hover:bg-white/[0.04]' : 'text-[rgba(0,0,0,0.4)] border border-black/5 hover:text-[rgba(0,0,0,0.7)] hover:bg-[rgba(0,0,0,0.04)]')}`}
                        >
                            {deleteMode ? 'Cancel Delete' : 'Delete Mode'}
                        </button>
                        {deleteMode && (
                            <button
                                onClick={() => allVisibleSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(visibleSessions.map(s => s.session_id)))}
                                className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 ${isDark ? 'text-white/50 border border-white/5 hover:text-white/70 hover:bg-white/[0.04]' : 'text-[rgba(0,0,0,0.4)] border border-black/5 hover:text-[rgba(0,0,0,0.7)] hover:bg-[rgba(0,0,0,0.04)]'}`}
                            >
                                {allVisibleSelected ? 'Unselect All' : 'Select All'}
                            </button>
                        )}
                        {deleteMode && selectedIds.size > 0 && (
                            <button
                                onClick={handleDeleteClick}
                                disabled={isDeleting}
                                className={`px-3 py-1.5 text-sm rounded-xl transition-colors flex items-center gap-1.5 shadow-lg ${isDeleting
                                    ? (isDark ? 'bg-red-500/20 text-red-400 cursor-not-allowed shadow-none' : 'bg-red-100 text-red-400 cursor-not-allowed shadow-none')
                                    : 'text-white bg-red-600 hover:bg-red-500 shadow-red-500/30'} `}
                            >
                                {isDeleting ? 'Removing...' : `Delete (${selectedIds.size})`}
                            </button>
                        )}
                    </div>

                    {/* Delete Mode Banner */}
                    {deleteMode && (
                        <div className={`rounded-2xl p-3 flex items-center justify-between gap-3 ${isDark
                            ? 'bg-red-500/10 border border-red-500/20'
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

                    {/* Search */}
                    <div className="relative">
                        <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${c('textMuted')}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by session ID..."
                            className={`w-full pl-10 pr-4 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${isDark
                                ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder-white/30'
                                : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)] placeholder-[rgba(0,0,0,0.3)]'}`}
                        />
                    </div>

                    {/* Loading */}
                    {loading && sessions.length === 0 && (
                        <div className={`flex items-center justify-center py-16 gap-3 ${c('textMuted')}`}>
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
                            ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                            : 'bg-red-50 border border-red-200 text-red-600'}`}>
                            <span>{error}</span>
                            <button onClick={loadHistory} className="underline hover:no-underline">Retry</button>
                        </div>
                    )}

                    {/* Empty State */}
                    {!loading && filtered.length === 0 && (
                        <div className={`text-center py-20 space-y-3 ${c('textMuted')}`}>
                            <div className="flex justify-center">
                                <svg className={`w-12 h-12 ${isDark ? 'text-white/10' : 'text-[rgba(0,0,0,0.1)]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                </svg>
                            </div>
                            <p className={c('textMuted')}>
                                {filterStatus === 'all' && filterMode === 'all' && !search ? 'No sessions yet.' : 'No matching sessions.'}
                            </p>
                        </div>
                    )}

                    {/* Session List */}
                    <div className="space-y-3">
                        {visibleSessions.map((session, index) => (
                            <SessionCard
                                key={session.session_id}
                                session={session}
                                order={index + 1}
                                isExpanded={expandedId === session.session_id}
                                expandedSession={expandedId === session.session_id ? expandedSession : null}
                                loadingDetail={expandedId === session.session_id && loadingDetail}
                                isDark={isDark}
                                deleteMode={deleteMode}
                                isSelected={selectedIds.has(session.session_id)}
                                onToggleExpand={handleToggleExpand}
                                onToggleSelect={handleToggleSelect}
                            />
                        ))}
                        {hasMore && <div ref={loadMoreRef} className={`py-6 text-center text-xs ${c('textSub')}`}>Loading more sessions...</div>}
                    </div>

                    {/* Bottom Refresh */}
                    {!loading && filtered.length > 0 && (
                        <div className="flex justify-center pt-2">
                            <button
                                onClick={loadHistory}
                                className={`px-4 py-2 text-sm border rounded-xl transition-colors ${isDark
                                    ? 'text-white/40 hover:text-white/70 border-white/5 hover:bg-white/[0.04]'
                                    : 'text-[rgba(0,0,0,0.4)] hover:text-[rgba(0,0,0,0.7)] border-black/5 hover:bg-[rgba(0,0,0,0.04)]'}`}
                            >
                                Refresh
                            </button>
                        </div>
                    )}

                    {/* Delete Confirmation Modal */}
                    {deleteConfirmation.open && (
                        <div className="lg-modal-overlay">
                            <div className="lg-glass-deep p-6 w-full max-w-sm space-y-4">
                                <h3 className={`text-lg font-semibold ${c('text')}`}>Confirm Delete</h3>
                                <p className={`text-sm ${c('textBody')}`}>
                                    Are you sure you want to delete {deleteConfirmation.ids.length} session{deleteConfirmation.ids.length !== 1 ? 's' : ''}? This action cannot be undone.
                                </p>
                                <div className="flex gap-2 justify-end pt-2">
                                    <button
                                        onClick={() => setDeleteConfirmation({ open: false, ids: [] })}
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
                                        {isDeleting ? 'Removing...' : 'Delete'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

export default AutoAudioHistoryPage;
