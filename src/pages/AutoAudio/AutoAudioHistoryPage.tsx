import { useEffect, useState, useRef } from 'react';
import {
  getAutoAudioHistory,
  getAutoAudioSession,
  removeAutoAudioSessions,
  type AutoAudioHistoryEntry,
  type AutoAudioSession,
  type AutoAudioLogEntry,
} from '../../api/AutoAudio';
import type { ThemeMode } from '../../types/theme';
import { DatePicker } from '../../components/Shared/DatePicker';
import { Icon, appIcons } from '../../components/Shared/Icon';

interface AutoAudioHistoryPageProps {
  readonly themeMode: ThemeMode;
}

type FilterStatus = 'all' | 'running' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'error';
type FilterMode = 'all' | 'test' | 'prod';

const STATUS_DOT_MAP: Record<string, (isDark: boolean) => string> = {
  completed: (d) => d ? 'bg-emerald-400' : 'bg-emerald-500',
  error: (d) => d ? 'bg-red-400' : 'bg-red-500',
  stopped: (d) => d ? 'bg-amber-400' : 'bg-amber-500',
  running: (d) => d ? 'bg-blue-400' : 'bg-blue-500',
  paused: (d) => d ? 'bg-amber-300' : 'bg-amber-500',
  stopping: (d) => d ? 'bg-amber-400 animate-pulse' : 'bg-amber-500 animate-pulse',
  idle: (d) => d ? 'bg-white/30' : 'bg-gray-400',
};

const STATUS_LABEL_MAP: Record<string, string> = {
  completed: 'Completed',
  error: 'Error',
  stopped: 'Stopped',
  running: 'Running',
  paused: 'Paused',
  stopping: 'Stopping',
  idle: 'Idle',
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

function getTimestampMs(iso: string | null): number | null {
  if (!iso) return null;
  const direct = new Date(iso).getTime();
  if (Number.isFinite(direct)) return direct;
  const normalized = new Date(iso.replace(' ', 'T')).getTime();
  return Number.isFinite(normalized) ? normalized : null;
}

function formatDurationSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return '-';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isActiveSessionStatus(status: string): boolean {
  return status === 'running' || status === 'paused' || status === 'stopping';
}

function getActiveDurationLabel(status: string): string {
  if (status === 'paused') return 'Paused';
  if (status === 'stopping') return 'Stopping';
  return 'Running';
}

function formatSessionDuration(startedAt: string | null, finishedAt: string | null, nowMs: number, isActive: boolean): string {
  if (finishedAt) return formatDuration(startedAt, finishedAt);
  if (!isActive) return '-';
  const startMs = getTimestampMs(startedAt);
  if (startMs === null) return '-';
  return formatDurationSeconds(Math.floor((nowMs - startMs) / 1000));
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
  readonly session: AutoAudioHistoryEntry;
  readonly order: number;
  readonly isExpanded: boolean;
  readonly expandedSession: AutoAudioSession | null;
  readonly loadingDetail: boolean;
  readonly isDark: boolean;
  readonly deleteMode: boolean;
  readonly isSelected: boolean;
  readonly nowMs: number;
  readonly panelBorder: string;
  readonly pageText: string;
  readonly secondaryText: string;
  readonly tertiaryText: string;
  readonly mutedSurface: string;
  readonly selectedSurface: string;
  readonly onToggleExpand: (sessionId: string) => void;
  readonly onToggleSelect: (sessionId: string) => void;
}

function SessionCard({
  session,
  order,
  isExpanded,
  expandedSession,
  loadingDetail,
  isDark,
  deleteMode,
  isSelected,
  nowMs,
  panelBorder,
  pageText,
  secondaryText,
  tertiaryText,
  mutedSurface,
  selectedSurface,
  onToggleExpand,
  onToggleSelect,
}: SessionCardProps) {
  const dotFn = STATUS_DOT_MAP[session.status] ?? STATUS_DOT_MAP.idle;
  const dot = dotFn(isDark);
  const label = STATUS_LABEL_MAP[session.status] ?? session.status;
  const isActive = isActiveSessionStatus(session.status);
  const duration = formatSessionDuration(session.started_at, session.finished_at, nowMs, isActive);

  const logLevelColor = (level: string) => {
    if (level === 'error') return isDark ? 'text-red-400' : 'text-red-600';
    if (level === 'warning') return isDark ? 'text-amber-400' : 'text-amber-600';
    return isDark ? 'text-white/72' : 'text-[rgba(55,53,47,0.76)]';
  };

  return (
    <article
      className={`transition-colors ${deleteMode ? 'cursor-pointer select-none' : ''}`}
      style={{ background: deleteMode && isSelected ? selectedSurface : 'transparent' }}
    >
      <div
        className="px-5 py-4 sm:px-6"
        style={{ borderTop: order === 1 ? 'none' : `1px solid ${panelBorder}` }}
      >
        {deleteMode ? (
          <button
            type="button"
            className="flex w-full flex-col gap-4 cursor-pointer text-left"
            onClick={() => onToggleSelect(session.session_id)}
          >
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
                <span
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: mutedSurface, color: secondaryText }}
                >
                  {session.test_mode ? 'Test' : 'Production'}
                </span>
                <span className="font-mono text-[11px]" style={{ color: tertiaryText }}>
                  {session.session_id}
                </span>
              </div>

              <div className="mt-2 text-sm font-semibold sm:text-[15px]" style={{ color: pageText }}>
                Step {session.current_step}: {session.current_step_desc || '—'}
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" style={{ color: secondaryText }}>
                <span>{session.total_stories} stories</span>
                <span>{session.total_chapters} chapters</span>
                {(session.finished_at || isActive) && (
                  <span style={{ color: pageText }}>
                    {isActive ? `${getActiveDurationLabel(session.status)} ${duration}` : duration}
                  </span>
                )}
              </div>
            </div>
          </button>
        ) : (
          <button
            type="button"
            className="flex w-full flex-col gap-4 cursor-pointer text-left"
            onClick={() => onToggleExpand(session.session_id)}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
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
                  <span
                    className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: mutedSurface, color: secondaryText }}
                  >
                    {session.test_mode ? 'Test' : 'Production'}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: tertiaryText }}>
                    {session.session_id}
                  </span>
                </div>

                <div className="mt-2 text-sm font-semibold sm:text-[15px]" style={{ color: pageText }}>
                  Step {session.current_step}: {session.current_step_desc || '—'}
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" style={{ color: secondaryText }}>
                  <span>{session.total_stories} stories</span>
                  <span>{session.total_chapters} chapters</span>
                  {(session.finished_at || isActive) && (
                    <span style={{ color: pageText }}>
                      {isActive ? `${getActiveDurationLabel(session.status)} ${duration}` : duration}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 lg:justify-end">
                <div className="text-xs leading-5 text-left lg:text-right" style={{ color: secondaryText }}>
                  <div>Started {formatTime(session.started_at)}</div>
                  {session.finished_at && <div>Finished {formatTime(session.finished_at)}</div>}
                </div>
                <Icon
                  icon={appIcons.chevronDown}
                  className={`mt-0.5 h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  style={{ color: tertiaryText }}
                />
              </div>
            </div>
          </button>
        )}

        {session.error && (
          <div className="text-sm" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
            {session.error}
          </div>
        )}

        {isExpanded && (
          <div className="mt-4 border-t pt-4" style={{ borderColor: panelBorder }}>
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: secondaryText }}>
                <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
                Loading session detail…
              </div>
            ) : expandedSession ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {([
                    ['Session ID', expandedSession.session_id, true],
                    ['Started', formatTime(expandedSession.started_at), false],
                    ['Finished', formatTime(expandedSession.finished_at), false],
                    [
                      'Duration',
                      formatSessionDuration(
                        expandedSession.started_at,
                        expandedSession.finished_at,
                        nowMs,
                        isActiveSessionStatus(expandedSession.status),
                      ),
                      false,
                    ],
                  ] as [string, string, boolean][]).map(([detailLabel, value, mono]) => (
                    <div
                      key={detailLabel}
                      className="rounded-xl border px-3 py-3"
                      style={{ background: mutedSurface, borderColor: panelBorder }}
                    >
                      <div className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: tertiaryText }}>
                        {detailLabel}
                      </div>
                      <div className={`mt-1 text-sm ${mono ? 'font-mono' : ''}`} style={{ color: pageText }}>
                        {value || '—'}
                      </div>
                    </div>
                  ))}
                </div>

                {expandedSession.stories_missing_audio.length > 0 && (
                  <section className="space-y-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: tertiaryText }}>
                      Stories with missing audio
                    </div>
                    <div className="overflow-hidden rounded-xl border" style={{ borderColor: panelBorder }}>
                      {expandedSession.stories_missing_audio.map((story, index) => (
                        <div
                          key={`${story.storyId}-${index}`}
                          className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                          style={{
                            borderTop: index === 0 ? 'none' : `1px solid ${panelBorder}`,
                            color: secondaryText,
                          }}
                        >
                          <span className="truncate">{story.title}</span>
                          <span>{story.missingCount} missing</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {expandedSession.story_results.length > 0 && (
                  <section className="space-y-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: tertiaryText }}>
                      Story results
                    </div>
                    <div className="overflow-hidden rounded-xl border" style={{ borderColor: panelBorder }}>
                      {expandedSession.story_results.map((result, index) => {
                        const expected = result.chapters_expected
                          ?? expandedSession.stories_missing_audio.find((story) => story.storyId === result.story_id)?.missingCount
                          ?? result.chapters_generated;

                        return (
                          <div
                            key={`${result.story_id}-${index}`}
                            className="px-3 py-3"
                            style={{ borderTop: index === 0 ? 'none' : `1px solid ${panelBorder}` }}
                          >
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="truncate font-medium" style={{ color: pageText }}>{result.story_title}</span>
                              <span style={{ color: secondaryText }}>{result.chapters_uploaded}/{expected} uploaded</span>
                            </div>
                            {result.upload_errors.length > 0 && (
                              <p className="mt-1 text-xs" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
                                {result.upload_errors.slice(0, 2).join(', ')}
                              </p>
                            )}
                            {result.error && (
                              <p className="mt-1 text-xs" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
                                {result.error}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {expandedSession.logs.length > 0 && (
                  <section className="space-y-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: tertiaryText }}>
                      Session log
                    </div>
                    <div
                      className="max-h-[320px] overflow-y-auto rounded-xl border px-3 py-3 font-mono text-[11px] leading-6"
                      style={{ background: mutedSurface, borderColor: panelBorder }}
                    >
                      {expandedSession.logs.map((log: AutoAudioLogEntry, index: number) => (
                        <div key={`${log.timestamp}_${index}`} className="flex gap-2">
                          <span style={{ color: tertiaryText }}>[{log.timestamp}]</span>
                          <span style={{ color: pageText }}>S{log.step}</span>
                          <span className={logLevelColor(log.level)}>{log.message}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <div className="text-sm" style={{ color: secondaryText }}>Session detail unavailable.</div>
            )}
          </div>
        )}
      </div>
    </article>
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const pollingCancelledRef = useRef(false);

  const loadHistory = async () => {
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
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getAutoAudioHistory();
        if (!cancelled) setSessions(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const hasRunning = sessions.some((session) => session.status === 'running' || session.status === 'paused' || session.status === 'stopping');
    if (!hasRunning) return;
    const interval = setInterval(async () => {
      try {
        const data = await getAutoAudioHistory();
        if (!pollingCancelledRef.current) setSessions(data);
      } catch {
        // ignore polling errors
      }
    }, 10000);
    return () => { pollingCancelledRef.current = true; clearInterval(interval); };
  }, [sessions]);

  const dateCutoff = specificDate ? (() => {
    const start = new Date(`${specificDate}T00:00:00`);
    const end = new Date(`${specificDate}T23:59:59`);
    return { start, end };
  })() : null;

  const filtered = sessions
    .filter((session) => {
      if (filterStatus === 'running' && !['running', 'paused', 'stopping'].includes(session.status)) return false;
      if (filterStatus !== 'all' && filterStatus !== 'running' && session.status !== filterStatus) return false;
      if (filterMode === 'test' && !session.test_mode) return false;
      if (filterMode === 'prod' && session.test_mode) return false;
      if (search) {
        const query = search.toLowerCase();
        if (!session.session_id.toLowerCase().includes(query) && !session.error?.toLowerCase().includes(query)) return false;
      }
      return true;
    })
    .filter((session) => {
      if (!dateCutoff || !session.started_at) return true;
      const sessionTime = new Date(session.started_at).getTime();
      return sessionTime >= dateCutoff.start.getTime() && sessionTime <= dateCutoff.end.getTime();
    })
    .sort((a, b) => {
      const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
      const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
      return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
    });

  const visibleSessions = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const allVisibleSelected = visibleSessions.length > 0 && visibleSessions.every((session) => selectedIds.has(session.session_id));

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
    const next = new Set(selectedIds);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    setSelectedIds(next);
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
    running: filtered.filter((session) => session.status === 'running' || session.status === 'paused' || session.status === 'stopping').length,
    completed: filtered.filter((session) => session.status === 'completed').length,
    error: filtered.filter((session) => session.status === 'error').length,
    stopped: filtered.filter((session) => session.status === 'stopped').length,
  };

  const activeSessions = filtered.filter((session) => isActiveSessionStatus(session.status));
  const primaryActiveSession = activeSessions[0];
  const totalChapters = filtered.reduce((sum, session) => sum + (session.total_chapters || 0), 0);
  const totalSeconds = filtered.reduce((sum, session) => {
    if (!session.started_at || !session.finished_at) return sum;
    try {
      return sum + Math.floor((new Date(session.finished_at).getTime() - new Date(session.started_at).getTime()) / 1000);
    } catch {
      return sum;
    }
  }, 0);

  const pageBg = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const inputBackground = isDark ? '#232323' : '#ffffff';
  const inputBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.16)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const selectedSurface = 'rgba(239,68,68,0.08)';
  const activeSurface = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(55,53,47,0.1)';

  const statusOptions: Array<{ value: FilterStatus; label: string }> = [
    { value: 'all', label: `All (${filteredCounts.all})` },
    { value: 'running', label: `Active (${filteredCounts.running})` },
    { value: 'stopped', label: `Stopped (${filteredCounts.stopped})` },
    { value: 'completed', label: `Done (${filteredCounts.completed})` },
    { value: 'error', label: `Error (${filteredCounts.error})` },
  ];

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBg }}>
      {deleteConfirmation.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className="w-full max-w-sm rounded-2xl border p-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <h3 className="text-lg font-semibold" style={{ color: pageText }}>Confirm delete</h3>
            <p className="mt-2 text-sm leading-6" style={{ color: secondaryText }}>
              Delete {deleteConfirmation.ids.length} session{deleteConfirmation.ids.length > 1 ? 's' : ''}? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmation({ open: false, ids: [] })}
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

      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header
          className="rounded-2xl border px-5 py-5 sm:px-6"
          style={{ background: panelBackground, borderColor: panelBorder }}
        >
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
              History
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
              Auto audio history
            </h1>
            <p className="max-w-3xl text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
              Review previous auto audio sessions, inspect story-level results, and remove old runs when needed.
            </p>
          </div>
        </header>

        <main className="mt-5 flex-1 space-y-5">
          <section
            className="rounded-2xl border px-5 py-4 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Visible sessions', `${filtered.length}`],
                ['All sessions', `${sessions.length}`],
                ['Total chapters', totalChapters.toLocaleString()],
                ['Total duration', formatTotalDuration(totalSeconds)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: tertiaryText }}>
                    {label}
                  </div>
                  <div className="mt-1 text-lg font-semibold" style={{ color: pageText }}>{value}</div>
                </div>
              ))}
            </div>
            {activeSessions.length > 0 && primaryActiveSession && (
              <div className="mt-4 border-t pt-4 text-sm" style={{ borderColor: panelBorder, color: secondaryText }}>
                {activeSessions.length} active session{activeSessions.length > 1 ? 's' : ''} · {getActiveDurationLabel(primaryActiveSession.status)} {formatSessionDuration(primaryActiveSession.started_at, primaryActiveSession.finished_at, nowMs, true)}
              </div>
            )}
          </section>

          <section
            className="rounded-2xl border px-5 py-4 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="mb-4 flex justify-between lg:grid-cols-[minmax(0,1fr)_220px_220px]">
              <div className="relative">
                <Icon icon={appIcons.search} className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: tertiaryText }} />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setVisibleCount(PAGE_SIZE); }}
                  placeholder="Search by session ID or error"
                  className="w-full rounded-md border py-2.5 pl-10 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  style={{ background: inputBackground, borderColor: inputBorder, color: pageText }}
                />
                {search && (
                  <button
                    onClick={() => { setSearch(''); setVisibleCount(PAGE_SIZE); }}
                    className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2"
                    style={{ color: tertiaryText }}
                    title="Clear search"
                  >
                    <Icon icon={appIcons.close} />
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={loadHistory}
                  className="rounded-md border px-3 py-2 text-sm transition-colors"
                  style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                >
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>

            <div>
              <DatePicker value={specificDate} onDateChange={(date) => { setSpecificDate(date); setVisibleCount(PAGE_SIZE); }} isDark={isDark} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => { setFilterStatus(option.value); setVisibleCount(PAGE_SIZE); }}
                  className="rounded-md px-3 py-1.5 text-sm transition-colors"
                  style={{
                    background: filterStatus === option.value ? activeSurface : mutedSurface,
                    color: filterStatus === option.value ? pageText : secondaryText,
                    border: `1px solid ${filterStatus === option.value ? panelBorder : 'transparent'}`,
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {([
                ['all', 'All modes'],
                ['test', 'Test only'],
                ['prod', 'Production only'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => { setFilterMode(value); setVisibleCount(PAGE_SIZE); }}
                  className="rounded-md px-3 py-1.5 text-sm transition-colors"
                  style={{
                    background: filterMode === value ? activeSurface : mutedSurface,
                    color: filterMode === value ? pageText : secondaryText,
                    border: `1px solid ${filterMode === value ? panelBorder : 'transparent'}`,
                  }}
                >
                  {label}
                </button>
              ))}

              {([
                ['newest', 'Newest first'],
                ['oldest', 'Oldest first'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => { setSortOrder(value); setVisibleCount(PAGE_SIZE); }}
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
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: panelBorder }}>
                <div className="text-sm" style={{ color: secondaryText }}>
                  {selectedIds.size} selected
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => allVisibleSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(visibleSessions.map((session) => session.session_id)))}
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
                  style={{ borderColor: deleteMode ? '#dc2626' : panelBorder, color: deleteMode ? '#dc2626' : secondaryText, background: deleteMode ? selectedSurface : mutedSurface }}
                >
                  Delete mode
                </button>
              </div>
            )}
          </section>

          {loading && sessions.length === 0 && (
            <section
              className="rounded-2xl border px-5 py-12 text-sm sm:px-6"
              style={{ background: panelBackground, borderColor: panelBorder, color: secondaryText }}
            >
              Loading history…
            </section>
          )}

          {error && (
            <section
              className="rounded-2xl border px-5 py-4 text-sm sm:px-6"
              style={{ background: panelBackground, borderColor: '#dc2626', color: isDark ? '#f87171' : '#dc2626' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <button onClick={loadHistory} className="underline">Retry</button>
              </div>
            </section>
          )}

          {!loading && filtered.length === 0 && (
            <section
              className="rounded-2xl border px-5 py-12 text-sm sm:px-6"
              style={{ background: panelBackground, borderColor: panelBorder, color: secondaryText }}
            >
              {filterStatus === 'all' && filterMode === 'all' && !search ? 'No sessions yet.' : 'No matching sessions.'}
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
                <span>Sessions</span>
                <span>{visibleSessions.length} shown</span>
              </div>

              <div>
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
                    nowMs={nowMs}
                    panelBorder={panelBorder}
                    pageText={pageText}
                    secondaryText={secondaryText}
                    tertiaryText={tertiaryText}
                    mutedSurface={mutedSurface}
                    selectedSurface={selectedSurface}
                    onToggleExpand={handleToggleExpand}
                    onToggleSelect={handleToggleSelect}
                  />
                ))}
              </div>

              {hasMore && (
                <div ref={loadMoreRef} className="border-t px-5 py-4 text-center text-sm sm:px-6" style={{ borderColor: panelBorder, color: secondaryText }}>
                  Loading more sessions…
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default AutoAudioHistoryPage;
