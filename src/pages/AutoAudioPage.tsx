import { useEffect, useState, useRef } from 'react';
import {
  getAutoAudioStatus,
  startAutoAudio,
  stopAutoAudio,
  getDriveSyncConfig,
  type AutoAudioSession,
  type DriveSyncConfig,
} from '../api/client';
import { ServerModeBanner } from '../components/ServerModeBanner';
import { type ThemeMode } from '../components/ThemeToggle';

interface AutoAudioPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  autoAudioSession: AutoAudioSession | null;
  onAutoAudioSessionUpdate: (session: AutoAudioSession | null) => void;
}

function formatTime(ts: string | null): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

const PHASES = [
  { id: 'phase1', label: 'Phase 1', subtitle: 'Needing Update', desc: 'Stories marked as needing update in the dashboard.', badge: 'Recommended' },
  { id: 'phase2', label: 'Phase 2', subtitle: 'Recently Updated', desc: 'Most recently updated stories. Select how many to scan.', badge: 'Recent' },
  { id: 'phase3', label: 'Phase 3', subtitle: 'Test Story', desc: 'Hardcoded test IDs. Verifies pipeline without touching real stories.', badge: 'Test' },
];

export function AutoAudioPage({ themeMode, onThemeChange: _onThemeChange, autoAudioSession, onAutoAudioSessionUpdate }: AutoAudioPageProps) {
  const isDark = themeMode === 'dark';

  // Shared session state — initialized from Shell's polling so navigating back
  // preserves the last known session without refetching.
  const [session, setSession] = useState<AutoAudioSession | null>(() => autoAudioSession);
  const [selectedPhase, setSelectedPhase] = useState('phase1');
  const [phase2Limit, setPhase2Limit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [stopConfirmText, setStopConfirmText] = useState('');
  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  const logEndRef = useRef<HTMLDivElement>(null);
  const prevLogLenRef = useRef(0);

  const isRunning = session?.status === 'running';
  const isStopping = session?.status === 'stopping';
  const isDone = session?.status === 'completed' || session?.status === 'error' || session?.status === 'stopped';
  const currentPhaseInfo = PHASES.find(p => p.id === selectedPhase)!;

  // Sync incoming session from Shell's polling.
  useEffect(() => { setSession(autoAudioSession); }, [autoAudioSession]);
  // Also poll independently so this page stays fresh even if Shell's interval lags.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await getAutoAudioStatus();
        if (!cancelled) {
          setSession(data);
          onAutoAudioSessionUpdate(data);
        }
      } catch { /* ignore polling errors */ }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(t); };
  }, [onAutoAudioSessionUpdate]);
  useEffect(() => { getDriveSyncConfig().then(cfg => setConfig(cfg)).catch(() => {}).finally(() => setConfigLoading(false)); }, []);
  // Sync the selected phase tab to the running session's phase so navigating back
  // shows the correct panel instead of always defaulting to phase 1.
  useEffect(() => {
    if (session?.phase && session.status === 'running') {
      setSelectedPhase(session.phase);
    }
  }, [session?.phase, session?.status]);
  useEffect(() => {
    if (logEndRef.current && session?.logs && session.logs.length > prevLogLenRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
      prevLogLenRef.current = session.logs.length;
    }
  }, [session?.logs]);

  const handleStart = async () => {
    setError('');
    setLoading(true);
    try {
      await startAutoAudio({ phase: selectedPhase, test_mode: selectedPhase === 'phase3', limit: selectedPhase === 'phase2' ? phase2Limit : undefined });
      const data = await getAutoAudioStatus();
      setSession(data);
      onAutoAudioSessionUpdate(data);
      setShowStartConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start session.');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (stopConfirmText !== 'CONFIRM') return;
    setShowStopConfirm(false);
    setStopConfirmText('');
    setError('');
    try {
      await stopAutoAudio();
      const data = await getAutoAudioStatus();
      setSession(data);
      onAutoAudioSessionUpdate(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop session.');
    }
  };

  const progressPct = session?.progress.total ? Math.round((session.progress.done / session.progress.total) * 100) : 0;
  const chapterPct = session?.chapter_progress?.total ? Math.round((session.chapter_progress.done / session.chapter_progress.total) * 100) : 0;
  const totalStories = session?.story_results?.length ?? 0;
  const totalGenerated = session?.story_results?.reduce((acc, r) => acc + r.chapters_uploaded, 0) ?? 0;
  const needsConfig = !configLoading && (!config?.main_be_api_base_url || !config?.main_be_user_id);

  const val = (dark: string, light: string) => isDark ? dark : light;
  const txtMuted = val('text-slate-400', 'text-gray-400');
  const txtSub = val('text-slate-300', 'text-gray-600');

  const glassBase = isDark
    ? 'bg-white/[0.03] backdrop-blur-xl border border-white/[0.06]'
    : 'bg-white/70 backdrop-blur-xl border border-black/5';

  const btnColor = (phase: string) => {
    if (phase === 'phase1') return 'bg-blue-500 hover:bg-blue-400 text-white';
    if (phase === 'phase2') return 'bg-amber-500 hover:bg-amber-400 text-white';
    return 'bg-emerald-500 hover:bg-emerald-400 text-white';
  };

  const phaseTabActive = (phase: string) => {
    if (phase === 'phase1') return isDark ? 'text-blue-400' : 'text-blue-600';
    if (phase === 'phase2') return isDark ? 'text-amber-400' : 'text-amber-600';
    return isDark ? 'text-emerald-400' : 'text-emerald-600';
  };

  const logLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warning': return 'text-amber-400';
      default: return '';
    }
  };

  const statusBgClass = (status: string) => {
    switch (status) {
      case 'running': return isDark ? 'bg-blue-900/40 text-blue-400' : 'bg-blue-100 text-blue-700';
      case 'completed': return isDark ? 'bg-emerald-900/40 text-emerald-400' : 'bg-emerald-100 text-emerald-700';
      case 'error': return isDark ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-700';
      case 'stopped': case 'stopping': return isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-100 text-amber-700';
      default: return isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-gray-100 text-gray-600';
    }
  };

  const subtleBg2 = isDark ? 'bg-white/[0.03]' : 'bg-black/[0.02]';

  return (
    <div className={`min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0 ${val('bg-slate-950', 'bg-gray-50')}`}>
      <main className="w-full xl:w-[72vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">

        {/* Header */}
        <div className="space-y-1">
          <h1 className={`text-2xl font-bold ${val('text-white', 'text-gray-900')}`}>Auto Audio</h1>
          <p className={`text-sm ${txtMuted}`}>Discover stories with missing audio and generate TTS automatically</p>
        </div>

        <ServerModeBanner
          serverUrl={config?.main_be_api_base_url ?? null}
          isDark={isDark}
          isConfigLoading={configLoading}
          isConfigValid={config ? Boolean(config.main_be_api_base_url && config.main_be_user_id) : undefined}
          onConfigure={() => window.location.href = '/settings'}
        />

        {error && (
          <div className={`p-3 rounded-xl text-sm ${isDark ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
            {error}
          </div>
        )}

        {/* Phase Segmented Control */}
        <div className={`p-1 rounded-2xl ${isDark ? 'bg-white/[0.04]' : 'bg-white/80 backdrop-blur-xl border border-black/5'}`}>
          <div className="grid grid-cols-3 gap-1">
            {PHASES.map(phase => {
              const isActive = selectedPhase === phase.id;
              const isSessionPhase = session?.phase === phase.id;
              return (
                <button
                  key={phase.id}
                  onClick={() => { if (!isRunning) { setSelectedPhase(phase.id); setShowStartConfirm(false); } }}
                  className={`
                    relative px-3 py-2.5 rounded-xl text-center transition-all duration-200
                    ${isActive
                      ? isDark
                        ? 'bg-white/10 shadow-sm shadow-black/20 text-white'
                        : 'bg-white shadow-sm shadow-gray-200/80 text-gray-900'
                      : `${isDark ? 'hover:bg-white/[0.04] text-slate-400 hover:text-slate-300' : 'hover:bg-white/70 text-gray-400 hover:text-gray-600'}`
                    }
                  `}
                >
                  <span className={`block text-sm font-semibold ${isActive ? phaseTabActive(phase.id) : ''}`}>{phase.label}</span>
                  <span className={`block text-xs mt-0.5 ${isActive ? (isDark ? 'text-white/60' : 'text-gray-500') : ''}`}>{phase.subtitle}</span>
                  {isSessionPhase && isRunning && (
                    <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${isDark ? 'bg-blue-400' : 'bg-blue-500'} animate-pulse`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Phase Detail Panel */}
        <div className={`${glassBase} rounded-2xl p-5 space-y-4`}>
          {/* Phase header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className={`text-base font-semibold ${val('text-white', 'text-gray-900')}`}>{currentPhaseInfo.subtitle}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isDark ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-indigo-50 text-indigo-600 border border-indigo-100'}`}>
                  {currentPhaseInfo.badge}
                </span>
              </div>
              <p className={`text-sm ${txtMuted}`}>{currentPhaseInfo.desc}</p>
            </div>

            {/* Inline action buttons */}
            <div className="flex-shrink-0 flex items-center gap-2">
              {!isRunning ? (
                !showStartConfirm ? (
                  <button
                    onClick={() => setShowStartConfirm(true)}
                    disabled={needsConfig}
                    className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-95 ${btnColor(selectedPhase)} ${needsConfig ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    {needsConfig ? 'Setup' : 'Start'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setShowStartConfirm(false)}
                      disabled={loading}
                      className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-slate-400' : 'bg-gray-100 hover:bg-gray-200 text-gray-500'} disabled:opacity-40`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleStart}
                      disabled={loading}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors ${btnColor(selectedPhase)} disabled:opacity-50`}
                    >
                      {loading ? 'Starting...' : 'Start'}
                    </button>
                  </>
                )
              ) : (
                <button
                  onClick={() => setShowStopConfirm(true)}
                  disabled={isStopping}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-500 hover:bg-red-400 text-white transition-all duration-200 active:scale-95 disabled:opacity-50"
                >
                  {isStopping ? 'Stopping...' : 'Stop'}
                </button>
              )}
            </div>
          </div>

          {/* Limit input for phase 2 */}
          {selectedPhase === 'phase2' && (
            <div className="flex items-center gap-3">
              <label className={`text-sm ${txtSub}`}>Stories to scan:</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPhase2Limit(l => Math.max(1, l - 5))}
                  disabled={isRunning}
                  className={`w-7 h-7 rounded-lg text-sm font-medium flex items-center justify-center transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-slate-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'} disabled:opacity-30`}
                >−</button>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={phase2Limit}
                  onChange={e => setPhase2Limit(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
                  disabled={isRunning}
                  className={`w-16 text-center text-sm rounded-xl border transition-colors ${isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900'} focus:outline-none focus:border-indigo-400 disabled:opacity-40`}
                />
                <button
                  onClick={() => setPhase2Limit(l => Math.min(500, l + 5))}
                  disabled={isRunning}
                  className={`w-7 h-7 rounded-lg text-sm font-medium flex items-center justify-center transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-slate-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'} disabled:opacity-30`}
                >+</button>
              </div>
            </div>
          )}

          {/* Status badge when not running */}
          {session && !isRunning && (
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${statusBgClass(session.status)}`}>
              {session.status === 'running' && (
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isDark ? 'bg-blue-400' : 'bg-blue-600'}`} />
              )}
              {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
            </div>
          )}

          {/* Progress bars when running (show even when viewing a different phase tab) */}
          {isRunning && (
            <div className="space-y-3">
              {session!.progress.total > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className={`text-xs ${txtMuted}`}>Stories</span>
                    <span className={`text-xs font-mono ${isDark ? 'text-indigo-300' : 'text-indigo-600'}`}>{session!.progress.done}/{session!.progress.total} <span className={txtMuted}>({progressPct}%)</span></span>
                  </div>
                  <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-white/5' : 'bg-gray-200'}`}>
                    <div className={`h-full rounded-full transition-all duration-500 ${isDark ? 'bg-indigo-400' : 'bg-indigo-500'}`} style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}
              {session!.chapter_progress?.total > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className={`text-xs ${txtMuted}`}>Chapters</span>
                    <span className={`text-xs font-mono font-bold ${isDark ? 'text-amber-300' : 'text-amber-600'}`}>{session!.chapter_progress.done}/{session!.chapter_progress.total} <span className={txtMuted}>({chapterPct}%)</span></span>
                  </div>
                  <div className={`h-3 rounded-full overflow-hidden ${isDark ? 'bg-white/5' : 'bg-gray-200'} ${isDark ? 'ring-1 ring-inset ring-slate-700' : 'ring-1 ring-inset ring-gray-200'}`}>
                    <div className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-amber-500 to-amber-400" style={{ width: `${chapterPct}%` }} />
                  </div>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className={`text-xs ${txtMuted}`}>{session!.current_step_desc || 'Initializing'}</span>
                <span className={`text-xs font-mono ${isDark ? 'text-white/40' : 'text-gray-400'}`}>Step {session!.current_step}/11</span>
              </div>
            </div>
          )}

          {/* Current story */}
          {isRunning && session?.current_story && (
            <div className={`p-3 rounded-xl ${subtleBg2}`}>
              <span className={`text-xs ${txtMuted}`}>Processing</span>
              <p className={`text-sm font-medium ${val('text-white', 'text-gray-900')} truncate`}>{session.current_story}</p>
            </div>
          )}

          {/* Session summary when done */}
          {isDone && (
            <div className={`p-3 rounded-xl space-y-1 ${isDark ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-emerald-50 border border-emerald-100'}`}>
              <p className={`text-sm font-semibold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>Summary</p>
              <p className={`text-xs ${txtMuted}`}>{totalStories} stories processed</p>
              <p className={`text-xs ${txtMuted}`}>{totalGenerated} chapters uploaded</p>
            </div>
          )}

          {/* Error when errored */}
          {session?.status === 'error' && session.error && (
            <div className={`p-3 rounded-xl text-xs ${isDark ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
              <strong>Error:</strong> {session.error}
            </div>
          )}

          {/* Timestamps */}
          {session && (
            <div className={`flex justify-between text-xs ${txtMuted} pt-1 border-t ${isDark ? 'border-white/[0.06]' : 'border-black/5'}`}>
              <span>{session.started_at ? `Started ${formatTime(session.started_at)}` : '—'}</span>
              <span>{session.finished_at ? formatTime(session.finished_at) : '—'}</span>
            </div>
          )}
        </div>

        {/* Stats + Preview row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Missing Audio Preview */}
          <div className={`${glassBase} rounded-2xl p-5 space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className={`text-sm font-semibold ${val('text-white', 'text-gray-900')}`}>Missing Audio</h3>
              <button
                onClick={async () => {
                  try {
                    const data = await getAutoAudioStatus();
                    setSession(data);
                    onAutoAudioSessionUpdate(data);
                  } catch { /* ignore */ }
                }}
                disabled={isRunning}
                className={`p-1.5 rounded-lg transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-slate-400' : 'bg-gray-100 hover:bg-gray-200 text-gray-500'} disabled:opacity-40`}
                title="Refresh preview"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {!(session?.stories_missing_audio ?? []).length && (
              <p className={`text-xs ${txtMuted}`}>
                {session?.status === 'running' ? 'Scanning...' : 'No preview. Start a session.'}
              </p>
            )}

            {(session?.stories_missing_audio ?? []).length > 0 && (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {(session!.stories_missing_audio ?? []).map(story => (
                  <div key={story.storyId} className={`flex justify-between items-center py-2 px-3 rounded-xl ${subtleBg2}`}>
                    <span className={`text-sm truncate flex-1 mr-3 ${val('text-white/80', 'text-gray-700')}`}>{story.title}</span>
                    <span className={`text-xs font-mono flex-shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>{story.missingCount}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Story Results */}
          <div className={`${glassBase} rounded-2xl p-5 space-y-3`}>
            <h3 className={`text-sm font-semibold ${val('text-white', 'text-gray-900')}`}>Story Results</h3>
            {!session && <p className={`text-xs ${txtMuted}`}>No active session</p>}
            {session && (!session.story_results || session.story_results.length === 0) && (
              <p className={`text-xs ${txtMuted}`}>{isRunning ? 'Processing stories...' : 'No results yet.'}</p>
            )}
            {session && session.story_results && session.story_results.length > 0 && (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {session.story_results.map((result, i) => (
                  <div key={i} className={`flex justify-between items-start py-2 px-3 rounded-xl ${subtleBg2}`}>
                    <div className="flex-1 min-w-0 mr-3">
                      <p className={`text-sm font-medium truncate ${val('text-white/80', 'text-gray-700')}`}>{result.story_title}</p>
                      <p className={`text-xs ${txtMuted}`}>Gen: {result.chapters_generated} · Up: {result.chapters_uploaded}</p>
                      {result.error && <p className={`text-xs mt-0.5 ${isDark ? 'text-red-400' : 'text-red-500'}`}>{result.error}</p>}
                    </div>
                    {result.chapters_uploaded > 0 && (
                      <span className={`flex-shrink-0 text-xs font-mono font-bold px-2 py-0.5 rounded-lg ${isDark ? 'text-emerald-400 bg-emerald-500/15' : 'text-emerald-600 bg-emerald-50'}`}>
                        {result.chapters_uploaded}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live Log */}
        <div className={`${glassBase} rounded-2xl p-5 space-y-3`}>
          <h3 className={`text-sm font-semibold ${val('text-white', 'text-gray-900')}`}>Live Log</h3>
          {!session && <p className={`text-xs ${txtMuted}`}>No active session</p>}
          {session && session.logs.length === 0 && <p className={`text-xs ${txtMuted}`}>Waiting for logs...</p>}
          {session && session.logs.length > 0 && (
            <div className={`rounded-xl p-3 font-mono text-xs space-y-0.5 max-h-[320px] overflow-y-auto ${isDark ? 'bg-black/20 text-slate-300' : 'bg-gray-50 text-gray-700'}`}
              style={{ fontSize: '0.7rem', lineHeight: '1.6' }}>
              {session.logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className={`flex-shrink-0 ${isDark ? 'text-slate-600' : 'text-gray-300'}`}>[{log.timestamp}]</span>
                  <span className={`flex-shrink-0 w-5 text-right ${isDark ? 'text-indigo-400/60' : 'text-indigo-400'}`}>S{log.step}</span>
                  <span className={logLevelColor(log.level)}>{log.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>


      </main>

      {/* Stop Modal */}
      {showStopConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}>
          <div className={`${glassBase} rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl`}>
            <h3 className={`text-base font-semibold ${val('text-white', 'text-gray-900')}`}>Stop Session?</h3>
            <p className={`text-sm ${txtSub}`}>Audio generation will halt. Already-generated chapters may still be uploaded.</p>
            <div className="space-y-2">
              <p className={`text-xs ${txtMuted}`}>Type <strong className={isDark ? 'text-red-400' : 'text-red-500'}>CONFIRM</strong> to stop:</p>
              <input
                type="text"
                value={stopConfirmText}
                onChange={e => setStopConfirmText(e.target.value)}
                placeholder="CONFIRM"
                autoFocus
                className={`w-full px-3 py-2 rounded-xl text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50 ${
                  isDark ? 'bg-white/5 border-white/10 text-white placeholder:text-slate-600' : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'
                }`}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setShowStopConfirm(false); setStopConfirmText(''); }}
                className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-slate-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleStop}
                disabled={stopConfirmText !== 'CONFIRM'}
                className={`py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  stopConfirmText === 'CONFIRM'
                    ? 'bg-red-500 hover:bg-red-400 text-white'
                    : `${isDark ? 'bg-white/5 text-slate-600' : 'bg-gray-100 text-gray-400'} cursor-not-allowed`
                }`}
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AutoAudioPage;
