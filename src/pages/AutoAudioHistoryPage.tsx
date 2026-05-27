import { useEffect, useState, useCallback } from 'react';
import {
  getAutoAudioHistory,
  getAutoAudioSession,
  type AutoAudioHistoryEntry,
  type AutoAudioSession,
  type AutoAudioLogEntry,
} from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';

interface AutoAudioHistoryPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

type FilterStatus = 'all' | 'running' | 'stopping' | 'stopped' | 'completed' | 'error';
type FilterMode = 'all' | 'test' | 'prod';

const STATUS_CONFIG_DARK: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  completed: { label: 'Completed', dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-950/40', border: 'border-emerald-800/40' },
  error:     { label: 'Error', dot: 'bg-red-400', text: 'text-red-400', bg: 'bg-red-950/40', border: 'border-red-800/40' },
  stopped:   { label: 'Stopped', dot: 'bg-amber-400', text: 'text-amber-400', bg: 'bg-amber-950/40', border: 'border-amber-800/40' },
  running:   { label: 'Running', dot: 'bg-blue-400', text: 'text-blue-400', bg: 'bg-blue-950/40', border: 'border-blue-800/40' },
  stopping:  { label: 'Stopping', dot: 'bg-amber-400', text: 'text-amber-400', bg: 'bg-amber-950/40', border: 'border-amber-800/40' },
  idle:      { label: 'Idle', dot: 'bg-slate-500', text: 'text-slate-400', bg: 'bg-slate-800/40', border: 'border-slate-700/40' },
};

const STATUS_CONFIG_LIGHT: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  completed: { label: 'Completed', dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  error:     { label: 'Error', dot: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  stopped:   { label: 'Stopped', dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  running:   { label: 'Running', dot: 'bg-blue-500', text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  stopping:  { label: 'Stopping', dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  idle:      { label: 'Idle', dot: 'bg-gray-400', text: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' },
};

function formatTime(ts: string | null): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

export function AutoAudioHistoryPage({ themeMode }: AutoAudioHistoryPageProps) {
  const isDark = themeMode === 'dark';
  const [sessions, setSessions] = useState<AutoAudioHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<AutoAudioSession | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const statusConfig = isDark ? STATUS_CONFIG_DARK : STATUS_CONFIG_LIGHT;

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

  useEffect(() => { loadHistory(); }, [loadHistory]); // eslint-disable-line react-hooks/set-state-in-effect -- matches pre-existing DriveSyncHistoryPage pattern

  useEffect(() => {
    const hasRunning = sessions.some(s => s.status === 'running' || s.status === 'stopping');
    if (!hasRunning) return;
    const interval = setInterval(loadHistory, 10000);
    return () => clearInterval(interval);
  }, [sessions, loadHistory]);

  const handleExpand = async (sessionId: string) => {
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

  const filteredSessions = sessions.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false;
    if (filterMode === 'test' && !s.test_mode) return false;
    if (filterMode === 'prod' && s.test_mode) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.session_id.toLowerCase().includes(q) && !s.error.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const cardClass = isDark
    ? 'rounded-2xl bg-slate-900/60 border border-slate-800/60'
    : 'rounded-2xl bg-white border border-gray-200';
  const inputClass = isDark
    ? 'bg-slate-800/60 border-slate-700 text-slate-100 placeholder-slate-500'
    : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400';
  const selectClass = isDark
    ? 'bg-slate-800/60 border-slate-700 text-slate-100'
    : 'bg-gray-50 border-gray-300 text-gray-900';
  const labelClass = isDark ? 'text-slate-400' : 'text-gray-700';
  const valueClass = isDark ? 'text-slate-100' : 'text-gray-900';
  const mutedClass = isDark ? 'text-slate-500' : 'text-gray-500';
  const mutedSmClass = isDark ? 'text-slate-500' : 'text-gray-400';
  const subtleClass = isDark ? 'text-slate-600' : 'text-gray-300';
  const borderClass = isDark ? 'border-slate-800' : 'border-gray-200';
  const subtleBgClass = isDark ? 'bg-slate-800/60' : 'bg-gray-100';
  const subtleBg2Class = isDark ? 'bg-slate-800/40' : 'bg-gray-50';

  const logLevelColor = (level: string) => {
    switch (level) {
      case 'error': return isDark ? 'text-red-400' : 'text-red-600';
      case 'warning': return isDark ? 'text-amber-400' : 'text-amber-600';
      default: return isDark ? 'text-slate-300' : 'text-gray-700';
    }
  };

  return (
    <div className={`min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0 ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
      <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Page Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className={`text-2xl sm:text-3xl font-bold ${valueClass}`}>Audio History</h1>
            <p className={`mt-1 text-sm sm:text-base ${mutedClass}`}>Past auto audio sessions</p>
          </div>
          <button
            onClick={() => loadHistory()}
            disabled={loading}
            className={`p-2 rounded-xl transition-colors ${subtleBgClass} hover:${isDark ? 'bg-slate-700/60' : 'bg-gray-200'} disabled:opacity-50`}
            title="Refresh"
          >
            <svg className={`w-5 h-5 ${mutedClass}${loading ? ' animate-spin-ccw' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {error && (
          <div className={`mb-4 p-3 rounded-xl text-sm ${isDark
            ? 'bg-red-900/20 border border-red-800/30 text-red-400'
            : 'bg-red-50 border border-red-200 text-red-600'}`}>
            {error}
          </div>
        )}

        {/* Filters */}
        <section className={`${cardClass} px-5 py-4 mb-4`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${mutedSmClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by session ID..."
                  className={`w-full pl-10 pr-4 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${inputClass}`}
                />
              </div>
            </div>

            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as FilterStatus)}
              className={`px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer ${selectClass}`}
            >
              <option value="all">All Status</option>
              <option value="running">Running</option>
              <option value="stopped">Stopped</option>
              <option value="stopping">Stopping</option>
              <option value="completed">Completed</option>
              <option value="error">Error</option>
            </select>

            <select
              value={filterMode}
              onChange={e => setFilterMode(e.target.value as FilterMode)}
              className={`px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer ${selectClass}`}
            >
              <option value="all">All Modes</option>
              <option value="test">Test Mode</option>
              <option value="prod">Production</option>
            </select>

            <span className={`text-xs ${mutedSmClass}`}>
              {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
            </span>
          </div>
        </section>

        {/* Session List */}
        {loading && (
          <div className={`flex flex-col items-center justify-center py-16 ${mutedClass} text-sm`}>
            <svg className={`w-8 h-8 mb-3 animate-spin-ccw ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Loading sessions...
          </div>
        )}

        {!loading && !error && filteredSessions.length === 0 && (
          <section className={cardClass + ' p-8 text-center'}>
            <svg className={`w-12 h-12 mx-auto mb-4 ${subtleClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className={`text-sm ${mutedClass}`}>No sessions found.</p>
          </section>
        )}

        <div className="space-y-3">
          {filteredSessions.map(session => {
            const status = session.status;
            const cfg = statusConfig[status] ?? statusConfig['idle'];
            const isExpanded = expandedId === session.session_id;

            return (
              <div key={session.session_id} className={cardClass + ' overflow-hidden'}>
                {/* Session Card Header */}
                <button
                  className={`w-full px-5 py-4 text-left transition-colors ${isDark ? 'hover:bg-slate-800/20' : 'hover:bg-gray-50'}`}
                  onClick={() => handleExpand(session.session_id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Status badge */}
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold rounded-full ${cfg.bg} ${cfg.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>

                        {/* Mode badge */}
                        <span className={`px-2 py-0.5 text-xs rounded-full ${session.test_mode
                          ? (isDark ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-100 text-amber-700')
                          : (isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-gray-100 text-gray-600')}`}>
                          {session.test_mode ? 'Test' : 'Production'}
                        </span>

                        {/* Session ID */}
                        <span className={`text-xs font-mono ${mutedSmClass}`}>{session.session_id}</span>
                      </div>

                      <div className={`mt-1 text-sm ${valueClass}`}>
                        Step {session.current_step}: {session.current_step_desc || '—'}
                      </div>

                      <div className={`mt-1 flex items-center gap-4 text-xs ${mutedSmClass}`}>
                        <span>Voice: {session.voice}</span>
                        <span>{session.total_stories} stories</span>
                        <span>{session.total_chapters} chapters</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <svg
                        className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''} ${mutedClass}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      <div className={`text-xs ${mutedSmClass}`}>
                        {formatTime(session.started_at)}
                      </div>
                    </div>
                  </div>

                  {session.error && (
                    <div className={`mt-2 text-xs ${isDark ? 'text-red-400' : 'text-red-600'} truncate`}>
                      Error: {session.error}
                    </div>
                  )}
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className={`border-t ${borderClass}`}>
                    {loadingDetail ? (
                      <div className={`p-5 flex items-center gap-2 text-sm ${mutedSmClass}`}>
                        <svg className={`w-4 h-4 animate-spin-ccw ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Loading session detail...
                      </div>
                    ) : expandedSession ? (
                      <div className="p-5 space-y-4">
                        {/* Session meta */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <p className={`text-xs ${mutedSmClass}`}>Session ID</p>
                            <p className={`text-sm font-mono ${valueClass}`}>{expandedSession.session_id}</p>
                          </div>
                          <div>
                            <p className={`text-xs ${mutedSmClass}`}>Voice</p>
                            <p className={`text-sm ${valueClass}`}>{expandedSession.voice}</p>
                          </div>
                          <div>
                            <p className={`text-xs ${mutedSmClass}`}>Started</p>
                            <p className={`text-sm ${valueClass}`}>{formatTime(expandedSession.started_at)}</p>
                          </div>
                          <div>
                            <p className={`text-xs ${mutedSmClass}`}>Finished</p>
                            <p className={`text-sm ${valueClass}`}>{formatTime(expandedSession.finished_at)}</p>
                          </div>
                        </div>

                        {/* Stories preview */}
                        {expandedSession.stories_missing_audio.length > 0 && (
                          <div>
                            <p className={`text-xs font-medium ${labelClass} mb-2`}>Stories with missing audio:</p>
                            <div className="space-y-1 max-h-[200px] overflow-y-auto">
                              {expandedSession.stories_missing_audio.map((s, i) => (
                                <div key={i} className={`p-2 rounded-lg text-xs flex justify-between ${subtleBg2Class}`}>
                                  <span className={valueClass}>{s.title}</span>
                                  <span className={mutedSmClass}>{s.missingCount} missing</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Story Results */}
                        {expandedSession.story_results.length > 0 && (
                          <div>
                            <p className={`text-xs font-medium ${labelClass} mb-2`}>Story Results:</p>
                            <div className="space-y-1">
                              {expandedSession.story_results.map((r, i) => (
                                <div key={i} className={`p-2 rounded-lg text-xs ${subtleBg2Class}`}>
                                  <div className="flex justify-between">
                                    <span className={`font-medium ${valueClass}`}>{r.story_title}</span>
                                    <span className={mutedSmClass}>
                                      {r.chapters_uploaded}/{r.chapters_generated} uploaded
                                    </span>
                                  </div>
                                  {r.upload_errors.length > 0 && (
                                    <p className={`text-xs mt-0.5 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                                      {r.upload_errors.slice(0, 2).join(', ')}
                                    </p>
                                  )}
                                  {r.error && (
                                    <p className={`text-xs mt-0.5 ${isDark ? 'text-red-400' : 'text-red-600'}`}>{r.error}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Logs */}
                        {expandedSession.logs.length > 0 && (
                          <div>
                            <p className={`text-xs font-medium ${labelClass} mb-2`}>Session Log:</p>
                            <div className={`rounded-xl p-3 font-mono max-h-[400px] overflow-y-auto ${isDark ? 'bg-slate-950/60' : 'bg-gray-50'}`}
                              style={{ fontSize: '0.7rem', lineHeight: '1.5' }}>
                              {expandedSession.logs.map((log: AutoAudioLogEntry, i: number) => (
                                <div key={i} className="flex gap-2">
                                  <span className={`flex-shrink-0 ${mutedSmClass}`}>[{log.timestamp}]</span>
                                  <span className={`flex-shrink-0 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>S{log.step}</span>
                                  <span className={logLevelColor(log.level)}>{log.message}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={`p-5 text-sm ${mutedSmClass}`}>Session detail unavailable.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </main>
    </div>
  );
}

export default AutoAudioHistoryPage;
