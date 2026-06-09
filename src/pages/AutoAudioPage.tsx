import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getAutoAudioStatus,
  startAutoAudio,
  stopAutoAudio,
  pauseAutoAudio,
  resumeAutoAudio,
  getDriveSyncConfig,
  type AutoAudioSession,
  type DriveSyncConfig,
} from '../api/client';
import { ServerModeBanner } from '../components/ServerModeBanner';
import { Icon, appIcons } from '../components/Icon';
import type { ThemeMode } from '../types/theme';

interface AutoAudioPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
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

function formatElapsed(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const PHASES = [
  { id: 'phase1', label: 'Needing Update', desc: 'Stories with missing audio in the dashboard.' },
  { id: 'phase2', label: 'Recently Updated', desc: 'Most recently updated stories.' },
  { id: 'phase3', label: 'Test Story', desc: 'Hardcoded test IDs. Verifies the pipeline safely.' },
];

const PHASE_ACCENT: Record<string, string> = {
  phase1: '#6366f1',
  phase2: '#f59e0b',
  phase3: '#10b981',
};

const STEP_NAMES: Record<number, string> = {
  1: 'Fetching stories',
  2: 'Finding missing audio',
  3: 'Creating audio queue',
  4: 'Generating TTS chapters',
  5: 'Polling generation status',
  6: 'Saving audio files',
  7: 'Fetching GDrive folder',
  8: 'Uploading chapters',
  9: 'Updating story metadata',
  10: 'Finalizing',
  11: 'Complete',
};

export function AutoAudioPage({ themeMode, onThemeChange: _onThemeChange }: AutoAudioPageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();
  const location = useLocation();

  const [session, setSession] = useState<AutoAudioSession | null>(() => {
    try {
      const stored = localStorage.getItem('autoaudio_last_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.status === 'completed' || parsed.status === 'error' || parsed.status === 'stopped') {
          return parsed;
        }
      }
    } catch { /* ignore */ }
    return null;
  });
  const [selectedPhase, setSelectedPhase] = useState<string>(() => 'phase1');
  const [phase2Limit, setPhase2Limit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [stopConfirmText, setStopConfirmText] = useState('');
  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const logEndRef = useRef<HTMLDivElement>(null);
  const prevLogLenRef = useRef(0);

  const isRunning = session?.status === 'running';
  const isPaused = session?.status === 'paused';
  const isActive = isRunning || isPaused;
  const isStopping = session?.status === 'stopping';
  const isLive = isActive || isStopping;
  const isDone = session?.status === 'completed' || session?.status === 'error' || session?.status === 'stopped';
  const currentPhaseInfo = PHASES.find(p => p.id === selectedPhase)!;
  const runningAccent = PHASE_ACCENT[session?.phase || 'phase1'] || '#6366f1';

  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await getAutoAudioStatus({ logLimit: 200, resultLimit: 100 });
        if (!cancelled) {
          if (data === null && sessionRef.current !== null) return;
          setSession(data);
        }
      } catch { /* ignore */ }
    };
    poll();
    const t = setInterval(poll, isLive ? 2000 : 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isLive]);
  useEffect(() => { getDriveSyncConfig().then(cfg => setConfig(cfg)).catch(() => {}).finally(() => setConfigLoading(false)); }, []);
  useEffect(() => {
    if (session?.phase && (session.status === 'running' || session.status === 'paused')) setSelectedPhase(session.phase);
  }, [session?.phase, session?.status]);
  useEffect(() => {
    if (logEndRef.current && session?.logs && session.logs.length > prevLogLenRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
      prevLogLenRef.current = session.logs.length;
    }
  }, [session?.logs]);

  useEffect(() => {
    if (!session?.started_at || !isLive) {
      setElapsed(0);
      return;
    }
    const startMs = new Date(session.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - startMs) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session?.started_at, isLive]);

  const handleStart = async () => {
    setError('');
    setLoading(true);
    localStorage.removeItem('autoaudio_last_session');
    try {
      await startAutoAudio({ phase: selectedPhase, test_mode: selectedPhase === 'phase3', limit: selectedPhase === 'phase2' ? phase2Limit : undefined });
      const data = await getAutoAudioStatus({ logLimit: 200, resultLimit: 100 });
      setSession(data);
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
      const data = await getAutoAudioStatus({ logLimit: 200, resultLimit: 100 });
      setSession(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop session.');
    }
  };

  const handlePauseToggle = async () => {
    setError('');
    try {
      if (isPaused) {
        await resumeAutoAudio();
      } else {
        await pauseAutoAudio();
      }
      const data = await getAutoAudioStatus({ logLimit: 200, resultLimit: 100 });
      setSession(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update pause state.');
    }
  };

  const progressPct = session?.progress.total ? Math.round((session.progress.done / session.progress.total) * 100) : 0;
  const chapterPct = session?.chapter_progress?.total ? Math.round((session.chapter_progress.done / session.chapter_progress.total) * 100) : 0;
  const needsConfig = !configLoading && (!config?.main_be_api_base_url || !config?.main_be_user_id);

  const progressTrackStyle = {
    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.12)',
    border: isDark ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(15,23,42,0.12)',
    boxShadow: isDark ? 'inset 0 1px 0 rgba(255,255,255,0.03)' : 'inset 0 1px 1px rgba(255,255,255,0.7)',
  };

  const statusLabel = session?.status ? session.status.charAt(0).toUpperCase() + session.status.slice(1) : 'Idle';

  const val = (dark: string, light: string) => isDark ? dark : light;
  const c = (key: string) => {
    const map: Record<string, [string, string]> = {
      bg: ['bg-[#0a0a14]', 'bg-[#e8e4f8]'],
      bgAlt: ['bg-[#0f0f1e]', 'bg-[#f0e8f8]'],
      glassOrb1: ['#4f46e5', '#6366f1'],
      glassOrb2: ['#7c3aed', '#8b5cf6'],
      glassOrb3: ['#0369a1', '#0ea5e9'],
      text: ['text-white/90', 'text-[rgba(0,0,0,0.85)]'],
      textMuted: ['text-white/40', 'text-[rgba(0,0,0,0.4)]'],
      textSub: ['text-white/30', 'text-[rgba(0,0,0,0.3)]'],
      textBody: ['text-white/70', 'text-[rgba(0,0,0,0.7)]'],
      textBodyStrong: ['text-white/85', 'text-[rgba(0,0,0,0.8)]'],
      divider: ['bg-white/6', 'bg-black/6'],
      logBg: ['bg-black/30', 'bg-black/4'],
      logText: ['text-white/50', 'text-[rgba(0,0,0,0.5)]'],
      logTime: ['text-white/20', 'text-[rgba(0,0,0,0.25)]'],
      rowBg: ['bg-white/[0.04]', 'bg-[rgba(0,0,0,0.03)]'],
      rowBorder: ['border-white/[0.05]', 'border-black/5'],
      cardSubtleBg: ['bg-white/[0.03]', 'bg-[rgba(0,0,0,0.02)]'],
      progressTrack: ['bg-white/[0.06]', 'bg-white/8'],
      inputBg: ['bg-white/[0.05]', 'bg-[rgba(0,0,0,0.04)]'],
      inputBorder: ['border-white/[0.08]', 'border-black/8'],
      inputText: ['text-white', 'text-[rgba(0,0,0,0.85)]'],
    };
    return isDark ? map[key][0] : map[key][1];
  };

  const statusChipClass = () => {
    switch (session?.status) {
      case 'running': return 'lg-chip lg-chip-blue';
      case 'paused': return 'lg-chip lg-chip-amber';
      case 'completed': return 'lg-chip lg-chip-green';
      case 'error': return 'lg-chip lg-chip-red';
      case 'stopping': case 'stopped': return 'lg-chip lg-chip-amber';
      default: return 'lg-chip lg-chip-neutral';
    }
  };

  const pageBg = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)';

  return (
    <div className={`min-h-screen relative overflow-hidden ${val('dark', 'light')}`} style={{ background: pageBg }}>
      {/* Ambient orbs */}
      <div className="lg-orb lg-orb-1" style={{ background: isDark ? PHASE_ACCENT.phase1 : '#6366f1' }} />
      <div className="lg-orb lg-orb-2" style={{ background: isDark ? PHASE_ACCENT.phase3 : '#8b5cf6' }} />
      <div className="lg-orb lg-orb-3" style={{ background: isDark ? PHASE_ACCENT.phase2 : '#0ea5e9' }} />

      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <main className="w-full xl:w-[72vw] mx-auto px-4 sm:px-6 py-6 space-y-5">

          {/* ── Page Header ── */}
          <div className="lg-glass-deep px-6 py-5 flex items-start justify-between gap-4">
            <div>
              <h1 className={`text-2xl font-bold tracking-tight ${c('text')}`}>Auto Audio</h1>
              <p className={`text-sm mt-1 ${c('textMuted')}`}>Discover stories with missing audio and generate TTS automatically</p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-2">
              {isLive && elapsed > 0 && (
                <span className="lg-chip lg-chip-neutral tabular-nums">
                  {formatElapsed(elapsed)}
                </span>
              )}
              {session && (
                <span className={statusChipClass()}>
                  {isRunning && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />}
                  {isPaused && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />}
                  {statusLabel}
                </span>
              )}
            </div>
          </div>

          <ServerModeBanner
            serverUrl={config?.main_be_api_base_url ?? null}
            isDark={isDark}
            isConfigLoading={configLoading}
            isConfigValid={config ? Boolean(config.main_be_api_base_url && config.main_be_user_id) : undefined}
            onConfigure={() => navigate('/settings', { state: { backgroundPath: location.pathname + location.search } })}
          />

          {error && (
            <div className={`lg-glass-card px-4 py-3 text-sm ${isDark ? 'text-red-400' : 'text-red-500'}`}>
              {error}
            </div>
          )}

          {/* ── Phase Selector ── */}
          <div className="lg-glass-nav p-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
              {PHASES.map(phase => {
                const isSelected = selectedPhase === phase.id;
                const isSessionPhase = session?.phase === phase.id;
                const color = PHASE_ACCENT[phase.id];
                return (
                  <button
                    key={phase.id}
                    onClick={() => { if (!isLive) { setSelectedPhase(phase.id); setShowStartConfirm(false); } }}
                    className="relative flex flex-col items-center gap-0.5 px-3 py-3 rounded-[14px] transition-all duration-200 cursor-pointer"
                    style={{
                      background: isSelected ? `linear-gradient(135deg, ${color}22, ${color}15)` : 'transparent',
                      border: isSelected ? `1px solid ${color}40` : '1px solid transparent',
                      boxShadow: isSelected ? `0 4px 16px ${color}20` : 'none',
                    }}
                  >
                    <span className="text-sm font-semibold" style={{ color: isSelected ? color : isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }}>{phase.label}</span>
                    {isSessionPhase && isLive && (
                      <span className="absolute top-2 right-2" style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Phase Detail ── */}
          <div className="lg-glass p-6 space-y-5">
            {/* Phase header row */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className={`text-base font-semibold ${c('text')}`}>{currentPhaseInfo.label}</h2>
                  <span className="lg-chip lg-chip-neutral">Phase {selectedPhase.replace('phase', '')}</span>
                </div>
                <p className={`text-sm mt-1 ${c('textMuted')}`}>{currentPhaseInfo.desc}</p>
              </div>

              {/* Action buttons */}
              <div className="flex-shrink-0 flex flex-wrap items-center gap-2">
                {!isLive ? (
                  !showStartConfirm ? (
                    <button
                      onClick={() => setShowStartConfirm(true)}
                      disabled={needsConfig}
                      className="lg-btn-primary"
                      style={{ opacity: needsConfig ? 0.4 : 1 }}
                    >
                      {needsConfig ? (
                        <Icon icon={appIcons.settings} className="w-[14px] h-[14px]" />
                      ) : null}
                      {needsConfig ? 'Setup' : 'Start Session'}
                    </button>
                  ) : (
                    <>
                      <button onClick={() => setShowStartConfirm(false)} disabled={loading} className="lg-btn-ghost">Cancel</button>
                      <button onClick={handleStart} disabled={loading} className="lg-btn-primary">
                        {loading ? (
                          <Icon icon={appIcons.spinner} className="animate-spin w-[14px] h-[14px]" />
                        ) : null}
                        {loading ? 'Starting…' : 'Launch'}
                      </button>
                    </>
                  )
                ) : (
                  <>
                    {isActive && (
                      <button onClick={handlePauseToggle} className={isPaused ? 'lg-btn-primary' : 'lg-btn-ghost'}>
                        {isPaused ? (
                          <Icon icon={appIcons.play} className="w-[14px] h-[14px]" />
                        ) : (
                          <Icon icon={appIcons.pause} className="w-[14px] h-[14px]" />
                        )}
                        {isPaused ? 'Resume' : 'Pause'}
                      </button>
                    )}
                  <button onClick={() => setShowStopConfirm(true)} disabled={isStopping} className="lg-btn-danger">
                    {isStopping ? (
                      <Icon icon={appIcons.spinner} className="animate-spin w-[14px] h-[14px]" />
                    ) : (
                      <Icon icon={appIcons.stop} className="w-[14px] h-[14px]" />
                    )}
                    {isStopping ? 'Stopping…' : 'Stop'}
                  </button>
                  </>
                )}
              </div>
            </div>

            {/* Phase 2 limit */}
            {selectedPhase === 'phase2' && (
              <div className="flex items-center gap-4 px-1">
                <span className="text-sm font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>Stories to scan</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPhase2Limit(l => Math.max(1, l - 5))}
                    disabled={isLive}
                    className="lg-icon-btn"
                    style={{ width: 28, height: 28, borderRadius: 8 }}
                  >−</button>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={phase2Limit}
                    onChange={e => setPhase2Limit(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
                    disabled={isLive}
                    className="w-16 text-center text-sm rounded-xl border"
                    style={{
                      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                      border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
                      color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)',
                      fontWeight: 600,
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={() => setPhase2Limit(l => Math.min(500, l + 5))}
                    disabled={isLive}
                    className="lg-icon-btn"
                    style={{ width: 28, height: 28, borderRadius: 8 }}
                  >+</button>
                </div>
              </div>
            )}

            {/* Progress section */}
            {isLive && (
              <div className="space-y-4">
                {session!.progress.total > 0 && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>Stories</span>
                      <span className="text-xs font-bold tabular-nums" style={{ color: runningAccent }}>{session!.progress.done} / {session!.progress.total}</span>
                    </div>
                    <div className="lg-progress-track" style={{ ...progressTrackStyle, height: 8 }}>
                      <div className="lg-progress-fill" style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${runningAccent}, ${runningAccent}cc)`, boxShadow: `0 0 12px ${runningAccent}55` }} />
                    </div>
                  </div>
                )}

                {session!.chapter_progress?.total > 0 && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>Chapters</span>
                      <span className="text-xs font-bold tabular-nums" style={{ color: '#f59e0b' }}>{session!.chapter_progress.done} / {session!.chapter_progress.total}</span>
                    </div>
                    <div className="lg-progress-track" style={{ ...progressTrackStyle, height: 8 }}>
                      <div className="lg-progress-fill" style={{ width: `${chapterPct}%`, background: 'linear-gradient(90deg, #f59e0b, #fbbf24)', boxShadow: '0 0 12px rgba(245,158,11,0.35)' }} />
                    </div>
                  </div>
                )}

                {/* Step indicator */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 grid grid-cols-11 gap-0.5">
                    {Array.from({ length: 11 }, (_, i) => {
                      const step = i + 1;
                      const done = (session!.current_step || 0) >= step;
                      const active = (session!.current_step || 0) === step;
                      return (
                        <div
                          key={step}
                          className="h-1 rounded-full transition-all duration-500"
                          style={{
                            background: done ? runningAccent : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                            boxShadow: active ? `0 0 6px ${runningAccent}80` : 'none',
                          }}
                        />
                      );
                    })}
                  </div>
                  <span className="text-xs tabular-nums flex-shrink-0" style={{ color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }}>
                    Step {session!.current_step || 1}/11
                  </span>
                </div>

                <p className="text-xs text-center" style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>
                  {session!.current_step_desc || STEP_NAMES[session!.current_step || 1] || 'Initializing…'}
                </p>

                {session?.current_story && (
                  <div className="lg-glass-card px-4 py-3 flex items-center gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${runningAccent}15` }}>
                      <Icon icon={appIcons.book} className="w-[14px] h-[14px]" style={{ color: runningAccent }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }}>Processing</p>
                      <p className="text-sm font-semibold truncate" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)' }}>{session.current_story}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Session done summary */}
            {isDone && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: session?.story_results?.length ?? 0, label: 'Stories Processed' },
                  { value: session?.story_results?.reduce((acc, r) => acc + r.chapters_uploaded, 0) ?? 0, label: 'Chapters Uploaded' },
                ].map(({ value, label }) => (
                  <div key={label} className="lg-glass-card px-4 py-4 text-center">
                    <div className="lg-metric-value" style={{ color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)' }}>{value}</div>
                    <div className="lg-metric-label" style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {session?.status === 'error' && session.error && (
              <div className="lg-glass-card px-4 py-3" style={{ color: isDark ? '#f87171' : '#ef4444', background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)', border: isDark ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(239,68,68,0.15)' }}>
                <strong>Error:</strong> {session.error}
              </div>
            )}

            {/* Timestamps */}
            {session && (
              <>
                <div className={`lg-divider`} />
                <div className={`flex justify-between text-xs ${c('textSub')}`}>
                  <span>{session.started_at ? `Started ${formatTime(session.started_at)}` : '—'}</span>
                  <span>{session.finished_at ? formatTime(session.finished_at) : '—'}</span>
                </div>
              </>
            )}
          </div>

          {/* ── Stats + Preview row ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Missing Audio */}
            <div className="lg-glass p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-semibold ${c('text')}`}>Missing Audio</h3>
                <button
                  onClick={async () => {
                    try {
                      const data = await getAutoAudioStatus({ logLimit: 200, resultLimit: 100 });
                      setSession(data);
                    } catch { /* ignore */ }
                  }}
                  disabled={isLive}
                  className="lg-icon-btn"
                >
                  <Icon icon={appIcons.refresh} className="w-[14px] h-[14px]" />
                </button>
              </div>

              {!(session?.stories_missing_audio ?? []).length ? (
                <p className={`text-sm ${c('textMuted')}`}>
                  {isLive ? 'Scanning stories...' : 'No preview available. Start a session.'}
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {session!.stories_missing_audio.map(story => (
                    <div key={story.storyId} className={`flex items-center justify-between px-3 py-2.5 rounded-xl ${c('rowBg')}`} style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                      <span className={`text-sm font-medium truncate flex-1 mr-3 ${c('textBody')}`}>{story.title}</span>
                      <span className="flex-shrink-0 text-xs font-bold tabular-nums px-2 py-0.5 rounded-lg" style={{ background: isDark ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>{story.missingCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Story Results */}
            <div className="lg-glass p-5 space-y-4">
              <h3 className={`text-sm font-semibold ${c('text')}`}>Story Results</h3>

              {!session && <p className={`text-sm ${c('textMuted')}`}>No active session</p>}
              {session && (session.story_results!.length > 0 || session.current_story) && (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {(() => {
                    const processedIds = new Set(session.story_results.map(r => r.story_id));
                    const currentId = session.current_story;
                    const displayResults = [
                      ...session.story_results,
                      ...(currentId && !processedIds.has(currentId) ? [{ story_id: currentId, story_title: currentId, chapters_generated: 0, chapters_uploaded: 0, upload_errors: [], error: '', _processing: true }] : []),
                    ];
                    return displayResults.map((result: any) => {
                      const expected = result.chapters_expected
                        ?? session.stories_missing_audio.find(s => s.storyId === result.story_id)?.missingCount
                        ?? result.chapters_generated;
                      return (
                      <div key={result.story_id} className={`flex items-start justify-between px-3 py-2.5 rounded-xl ${c('rowBg')}`} style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                        <div className="flex-1 min-w-0 mr-3">
                          <p className={`text-sm font-medium truncate ${c('textBody')}`}>{result.story_title}</p>
                          {result._processing ? (
                            <p className="text-xs mt-0.5" style={{ color: runningAccent }}>Processing…</p>
                          ) : (
                            <p className="text-xs mt-0.5" style={{ color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }}>Gen: {result.chapters_generated} · Up: {result.chapters_uploaded}/{expected}</p>
                          )}
                          {result.error && <p className="text-xs mt-0.5" style={{ color: isDark ? '#f87171' : '#ef4444' }}>{result.error}</p>}
                        </div>
                        {result._processing ? (
                          <span className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${runningAccent}40`, borderTopColor: runningAccent }} />
                        ) : result.chapters_uploaded > 0 ? (
                          <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: isDark ? 'rgba(52,211,153,0.15)' : 'rgba(52,211,153,0.12)' }}>
                            <Icon icon={appIcons.check} className="w-[10px] h-[10px] text-emerald-500" />
                          </span>
                        ) : null}
                      </div>
                    )});
                  })()}
                </div>
              )}
              {session && !session.current_story && (!session.story_results || session.story_results.length === 0) && (
                <p className={`text-sm ${c('textMuted')}`}>No results yet.</p>
              )}
            </div>
          </div>

          {/* ── Live Log ── */}
          <div className="lg-glass p-5 space-y-4">
            <div className="flex items-center gap-2">
              <h3 className={`text-sm font-semibold ${c('text')}`}>Live Log</h3>
              {isLive && (
                <span className="lg-chip lg-chip-blue" style={{ fontSize: '0.6rem' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  {isPaused ? 'PAUSED' : 'LIVE'}
                </span>
              )}
            </div>

            {!session && <p className={`text-sm ${c('textMuted')}`}>No active session</p>}
            {session && session.logs.length === 0 && <p className={`text-sm ${c('textMuted')}`}>Waiting for logs…</p>}
            {session && session.logs.length > 0 && (
              <div className={`lg-log-container ${c('logBg')}`}>
                {session.logs.map((log, i) => {
                  const levelColor = log.level === 'error' ? (isDark ? '#f87171' : '#ef4444') : log.level === 'warning' ? '#fbbf24' : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)');
                  return (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="flex-shrink-0" style={{ color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.25)', fontSize: '0.62rem' }}>[{log.timestamp}]</span>
                      <span className="flex-shrink-0 text-right tabular-nums" style={{ color: runningAccent, fontSize: '0.62rem', opacity: 0.7, minWidth: 16 }}>S{log.step}</span>
                      <span style={{ color: levelColor, fontSize: '0.62rem' }}>{log.message}</span>
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ── Stop Modal ── */}
      {showStopConfirm && (
        <div className="lg-modal-overlay">
          <div className="lg-glass-deep p-6 w-full max-w-sm space-y-5">
            <div>
              <h3 className={`text-base font-bold ${c('text')}`}>Stop Session?</h3>
              <p className={`text-sm mt-1 ${c('textMuted')}`}>Audio generation will halt. Already-generated chapters may still be uploaded.</p>
            </div>
            <div className="space-y-2">
              <p className={`text-xs ${c('textSub')}`}>
                Type <strong style={{ color: isDark ? '#f87171' : '#ef4444' }}>CONFIRM</strong> to stop:
              </p>
              <input
                type="text"
                value={stopConfirmText}
                onChange={e => setStopConfirmText(e.target.value)}
                placeholder="CONFIRM"
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{
                  background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                  border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
                  color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)',
                  outline: 'none',
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setShowStopConfirm(false); setStopConfirmText(''); }} className="lg-btn-ghost">Cancel</button>
              <button
                onClick={handleStop}
                disabled={stopConfirmText !== 'CONFIRM'}
                className="lg-btn-danger"
                style={{ opacity: stopConfirmText !== 'CONFIRM' ? 0.4 : 1 }}
              >Stop Session</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

export default AutoAudioPage;
