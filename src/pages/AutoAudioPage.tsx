import { useCallback, useEffect, useState, useRef } from 'react';
import {
  getAutoAudioStatus,
  startAutoAudio,
  stopAutoAudio,
  getDriveSyncConfig,
  type AutoAudioSession,
  type AutoAudioStoryPreview,
  type DriveSyncConfig,
} from '../api/client';
import { ServerModeBanner } from '../components/ServerModeBanner';
import { type ThemeMode } from '../components/ThemeToggle';

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

interface PhaseCardProps {
  phase: string;
  title: string;
  subtitle: string;
  description: string;
  badge?: string;
  isDark: boolean;
  cardClass: string;
  valueClass: string;
  mutedSmClass: string;
  mutedClass: string;
  isRunning: boolean;
  isStopping: boolean;
  loading: boolean;
  testMode: boolean;
  configLoading: boolean;
  config: DriveSyncConfig | null;
  session: AutoAudioSession | null;
  onStart: (confirm: boolean) => void;
  onConfirmStart: (phase: string) => void;
  onCancelConfirm: () => void;
  showStartConfirm: boolean;
  phaseLimit?: number;
  onPhaseLimitChange?: (limit: number) => void;
}

function PhaseCard({
  phase, title, subtitle, description, badge,
  isDark, cardClass, valueClass, mutedSmClass, mutedClass,
  isRunning, isStopping, loading, testMode, configLoading, config,
  session, onStart, onConfirmStart, onCancelConfirm, showStartConfirm,
  phaseLimit, onPhaseLimitChange,
}: PhaseCardProps) {
  const isCurrentPhase = session?.phase === phase;
  const disabled = isRunning || isStopping || loading;
  const needsConfig = !configLoading && (!config?.main_be_api_base_url || !config?.main_be_user_id);

  return (
    <section className={cardClass + ' p-5 sm:p-6 space-y-3' + (isCurrentPhase && isRunning ? ' ring-2 ring-indigo-500/50' : '')}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <h2 className={`text-base font-semibold ${valueClass}`}>{title}</h2>
          {badge && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isDark ? 'bg-indigo-900/40 text-indigo-300' : 'bg-indigo-100 text-indigo-700'}`}>
              {badge}
            </span>
          )}
          {isCurrentPhase && isRunning && (
            <span className={`w-2 h-2 rounded-full animate-pulse ${isDark ? 'bg-blue-400' : 'bg-blue-600'}`} />
          )}
        </div>
      </div>
      <p className={`text-xs ${mutedSmClass}`}>{description}</p>
      {testMode && (
        <p className={`text-xs ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>Test mode active</p>
      )}
      {phase === 'phase3' && phaseLimit !== undefined && onPhaseLimitChange && (
        <div className="flex items-center gap-2">
          <label className={`text-xs font-medium ${valueClass}`}>Stories to check:</label>
          <input
            type="number"
            min={1}
            max={500}
            value={phaseLimit}
            onChange={e => onPhaseLimitChange(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
            disabled={isRunning || isStopping || loading}
            className={`w-20 px-2 py-1 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
              isDark
                ? 'bg-slate-800 border-slate-700 text-slate-100'
                : 'bg-white border-gray-300 text-gray-900'
            } disabled:opacity-50`}
          />
        </div>
      )}

      {!isRunning && !isStopping ? (
        !showStartConfirm ? (
          <button
            onClick={() => onStart(true)}
            disabled={disabled || needsConfig}
            title={needsConfig ? 'Configure Drive Sync first' : undefined}
            className={`w-full px-5 py-2.5 text-white font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-sm ${
              phase === 'phase1'
                ? 'bg-blue-600 hover:bg-blue-500'
                : phase === 'phase2'
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-emerald-600 hover:bg-emerald-500'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {testMode ? 'Start (Test Mode)' : 'Start'}
          </button>
        ) : (
          <div className="space-y-2">
            <p className={`text-xs text-center ${mutedClass}`}>
              {testMode
                ? `Start ${subtitle} in test mode?`
                : `Start ${subtitle}? This will scan stories and generate audio.`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onCancelConfirm}
                disabled={loading}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-xl border transition-colors ${isDark
                  ? 'border-slate-700 text-slate-400 hover:bg-slate-800/60'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-100'} disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirmStart(phase)}
                disabled={loading}
                className={`flex-1 px-3 py-2 text-sm text-white font-semibold rounded-xl transition-colors ${
                  phase === 'phase1' ? 'bg-blue-600 hover:bg-blue-500' : phase === 'phase2' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
                } disabled:opacity-50`}
              >
                {loading ? 'Starting...' : 'Start'}
              </button>
            </div>
          </div>
        )
      ) : isCurrentPhase ? (
        <div className={`text-xs text-center py-1.5 rounded-lg ${isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-700'}`}>
          Currently running
        </div>
      ) : (
        <div className={`text-xs text-center py-1.5 rounded-lg ${isDark ? 'bg-slate-800/60 text-slate-500' : 'bg-gray-100 text-gray-400'}`}>
          Another phase is running
        </div>
      )}
    </section>
  );
}

export function AutoAudioPage({ themeMode }: AutoAudioPageProps) {
  const isDark = themeMode === 'dark';

  const [session, setSession] = useState<AutoAudioSession | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState('phase1');
  const [phase3Limit, setPhase3Limit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [missingPreview, setMissingPreview] = useState<AutoAudioStoryPreview[]>([]);
  const [fetchingPreview, setFetchingPreview] = useState(false);
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

  const loadStatus = useCallback(async () => {
    try {
      const data = await getAutoAudioStatus();
      setSession(data);
      if (data) {
        setMissingPreview(data.stories_missing_audio ?? []);
      }
    } catch { /* ignore polling errors */ }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]); // eslint-disable-line react-hooks/set-state-in-effect -- matches pre-existing DriveSyncHistoryPage pattern

  useEffect(() => {
    const interval = setInterval(loadStatus, 2000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    getDriveSyncConfig()
      .then(cfg => setConfig(cfg))
      .catch(() => {})
      .finally(() => setConfigLoading(false));
  }, []);

  useEffect(() => {
    if (logEndRef.current && session?.logs) {
      const newLogs = session.logs;
      if (newLogs.length > prevLogLenRef.current) {
        logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        prevLogLenRef.current = newLogs.length;
      }
    }
  }, [session?.logs]);

  const handlePhaseStart = async (phase: string) => {
    setError('');
    setLoading(true);
    try {
      await startAutoAudio({ phase, test_mode: testMode, limit: phase === 'phase3' ? phase3Limit : undefined });
      await loadStatus();
      setShowStartConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start session.');
    } finally {
      setLoading(false);
    }
  };


  const progressPct = session
    ? (session.progress.total > 0
      ? Math.round((session.progress.done / session.progress.total) * 100)
      : 0)
    : 0;

  const totalGenerated = session?.story_results?.reduce((acc, r) => acc + r.chapters_uploaded, 0) ?? 0;
  const totalStories = session?.story_results?.length ?? 0;
  const chapterPct = session?.chapter_progress?.total
    ? (Math.round((session.chapter_progress.done / session.chapter_progress.total) * 100))
    : 0;

  const cardClass = isDark
    ? 'rounded-2xl bg-slate-900/60 border border-slate-800/60'
    : 'rounded-2xl bg-white border border-gray-200';
  const valueClass = isDark ? 'text-slate-100' : 'text-gray-900';
  const mutedClass = isDark ? 'text-slate-500' : 'text-gray-500';
  const mutedSmClass = isDark ? 'text-slate-500' : 'text-gray-400';
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
        <div className="mb-8">
          <h1 className={`text-2xl sm:text-3xl font-bold ${valueClass}`}>
            Auto Audio
          </h1>
          <p className={`mt-1 text-sm sm:text-base ${mutedClass}`}>
            Automatically discover stories with missing audio and generate TTS across all published stories
          </p>
        </div>

        {/* Server Mode Banner */}
        <ServerModeBanner
          serverUrl={config?.main_be_api_base_url ?? null}
          isDark={isDark}
          isConfigLoading={configLoading}
          isConfigValid={config ? Boolean(config.main_be_api_base_url && config.main_be_user_id) : undefined}
          onConfigure={() => window.location.href = '/settings'}
        />

        {/* Error Banner */}
        {error && (
          <div className={`mb-4 p-3 rounded-xl text-sm ${isDark
            ? 'bg-red-900/20 border border-red-800/30 text-red-400'
            : 'bg-red-50 border border-red-200 text-red-600'}`}>
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[480px_1fr] gap-6 items-start">

          {/* Left Column: Controls */}
          <div className="space-y-4">

            {/* Shared Test Mode Toggle */}
            <section className={cardClass + ' p-5 sm:p-6 space-y-3'}>
              <h2 className={`text-base font-semibold ${valueClass}`}>Options</h2>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${valueClass}`}>Test Mode</p>
                  <p className={`text-xs ${mutedSmClass}`}>
                    {testMode ? 'Uses hardcoded story IDs only' : 'Processes real stories'}
                  </p>
                </div>
                <button
                  onClick={() => setTestMode(m => !m)}
                  disabled={isRunning || isStopping}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                    testMode ? 'bg-indigo-600' : isDark ? 'bg-slate-600' : 'bg-gray-300'
                  } disabled:opacity-50`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                      testMode ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </section>

            {/* Phase 1: Needing Update */}
            <PhaseCard
              phase="phase1"
              title="Phase 1"
              subtitle="Needing Update"
              description="Only stories marked as needing update in the dashboard."
              badge={testMode ? undefined : 'Recommended'}
              isDark={isDark}
              cardClass={cardClass}
              valueClass={valueClass}
              mutedSmClass={mutedSmClass}
              mutedClass={mutedClass}
              isRunning={isRunning}
              isStopping={isStopping}
              loading={loading}
              testMode={testMode}
              configLoading={configLoading}
              config={config}
              session={session}
              onStart={(confirm) => { setSelectedPhase('phase1'); setShowStartConfirm(confirm); }}
              onConfirmStart={handlePhaseStart}
              onCancelConfirm={() => setShowStartConfirm(false)}
              showStartConfirm={showStartConfirm && selectedPhase === 'phase1'}
            />

            {/* Phase 2: All Stories */}
            <PhaseCard
              phase="phase2"
              title="Phase 2"
              subtitle="All Stories"
              description="Scans ALL published stories for missing audio. Takes longer."
              badge={testMode ? undefined : 'Full Scan'}
              isDark={isDark}
              cardClass={cardClass}
              valueClass={valueClass}
              mutedSmClass={mutedSmClass}
              mutedClass={mutedClass}
              isRunning={isRunning}
              isStopping={isStopping}
              loading={loading}
              testMode={testMode}
              configLoading={configLoading}
              config={config}
              session={session}
              onStart={(confirm) => { setSelectedPhase('phase2'); setShowStartConfirm(confirm); }}
              onConfirmStart={handlePhaseStart}
              onCancelConfirm={() => setShowStartConfirm(false)}
              showStartConfirm={showStartConfirm && selectedPhase === 'phase2'}
            />

            {/* Phase 3: Recently Updated */}
            <PhaseCard
              phase="phase3"
              title="Phase 3"
              subtitle="Recently Updated"
              description="Check the most recently updated stories for missing audio. User selects the number of stories to scan."
              badge={testMode ? undefined : 'Recent'}
              isDark={isDark}
              cardClass={cardClass}
              valueClass={valueClass}
              mutedSmClass={mutedSmClass}
              mutedClass={mutedClass}
              isRunning={isRunning}
              isStopping={isStopping}
              loading={loading}
              testMode={testMode}
              configLoading={configLoading}
              config={config}
              session={session}
              onStart={(confirm) => { setSelectedPhase('phase3'); setShowStartConfirm(confirm); }}
              onConfirmStart={handlePhaseStart}
              onCancelConfirm={() => setShowStartConfirm(false)}
              showStartConfirm={showStartConfirm && selectedPhase === 'phase3'}
              phaseLimit={phase3Limit}
              onPhaseLimitChange={setPhase3Limit}
            />

            {/* Stop Button (when running) */}
            {isRunning && (
              <section className={cardClass + ' p-5 sm:p-6'}>
                <button
                  onClick={() => setShowStopConfirm(true)}
                  disabled={isStopping}
                  className="w-full px-6 py-3 text-white font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg bg-red-600 hover:bg-red-500 shadow-red-600/30 disabled:opacity-50"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                  {isStopping ? 'Stopping...' : 'Stop Session'}
                </button>
              </section>
            )}

            {/* Status Card */}
            {session && (
              <section className={cardClass + ' p-5 sm:p-6 space-y-3'}>
                <div className="flex items-center justify-between">
                  <h2 className={`text-base font-semibold ${valueClass}`}>Status</h2>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ${
                    session.status === 'running' ? (isDark ? 'bg-blue-900/40 text-blue-400' : 'bg-blue-100 text-blue-700') :
                    session.status === 'completed' ? (isDark ? 'bg-emerald-900/40 text-emerald-400' : 'bg-emerald-100 text-emerald-700') :
                    session.status === 'error' ? (isDark ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-700') :
                    session.status === 'stopped' ? (isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-100 text-amber-700') :
                    session.status === 'stopping' ? (isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-100 text-amber-700') :
                    (isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-gray-100 text-gray-600')
                  }`}>
                    {session.status === 'running' && (
                      <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isDark ? 'bg-blue-400' : 'bg-blue-600'}`} />
                    )}
                    {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                  </span>
                </div>

                {/* Step indicator */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={mutedSmClass}>Current Step ({session.current_step}/11)</span>
                    <span className={`text-xs font-medium ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
                      {session.current_step_desc || 'Initializing'}
                    </span>
                  </div>
                  <div className={`h-1.5 rounded-full overflow-hidden ${subtleBgClass}`}>
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min((session.current_step / 11) * 100, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Story progress */}
                {session.progress.total > 0 && (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={mutedSmClass}>Stories</span>
                      <span className={`text-xs font-mono ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
                        {session.progress.done}/{session.progress.total}
                      </span>
                    </div>
                    <div className={`h-2 rounded-full overflow-hidden ${subtleBgClass}`}>
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Chapter progress */}
                {session.chapter_progress?.total > 0 && (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={mutedSmClass}>Chapters</span>
                      <span className={`text-xs font-mono font-bold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                        {session.chapter_progress?.done}/{session.chapter_progress?.total}
                      </span>
                    </div>
                    <div className={`h-3 rounded-full overflow-hidden ${subtleBgClass} ring-1 ring-inset ${isDark ? 'ring-slate-700' : 'ring-gray-200'}`}>
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-500"
                        style={{ width: `${chapterPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Current story */}
                {session.current_story && (
                  <div className={`p-3 rounded-xl ${subtleBg2Class}`}>
                    <p className={`text-xs ${mutedSmClass}`}>Currently processing</p>
                    <p className={`text-sm font-medium ${valueClass} truncate`}>{session.current_story}</p>
                  </div>
                )}

                {/* Summary */}
                {isDone && totalStories > 0 && (
                  <div className={`p-3 rounded-xl ${isDark ? 'bg-emerald-900/20 border border-emerald-800/30' : 'bg-emerald-50 border border-emerald-200'}`}>
                    <p className={`text-sm font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                      Session Summary
                    </p>
                    <div className={`mt-1 space-y-0.5 text-xs ${mutedClass}`}>
                      <p>{totalStories} story/stories processed</p>
                      <p>{totalGenerated} chapter(s) uploaded</p>
                    </div>
                  </div>
                )}

                {session.status === 'error' && session.error && (
                  <div className={`p-3 rounded-xl text-xs ${isDark
                    ? 'bg-red-900/20 border border-red-800/30 text-red-400'
                    : 'bg-red-50 border border-red-200 text-red-600'}`}>
                    <strong>Error:</strong> {session.error}
                  </div>
                )}

                <div className={`flex justify-between text-xs ${mutedSmClass} pt-1`}>
                  <span>Started: {formatTime(session.started_at)}</span>
                  {session.finished_at && <span>Finished: {formatTime(session.finished_at)}</span>}
                </div>
              </section>
            )}

            {/* Missing Audio Preview */}
            <section className={cardClass + ' p-5 sm:p-6 space-y-3'}>
              <div className="flex items-center justify-between">
                <h2 className={`text-base font-semibold ${valueClass}`}>
                  Missing Audio Preview
                </h2>
                <button
                  onClick={async () => {
                    setFetchingPreview(true);
                    await loadStatus();
                    setFetchingPreview(false);
                  }}
                  disabled={fetchingPreview || isRunning}
                  className={`p-1.5 rounded-lg transition-colors ${subtleBgClass} hover:${isDark ? 'bg-slate-700/60' : 'bg-gray-200'} disabled:opacity-50`}
                  title="Refresh preview"
                >
                  <svg className={`w-4 h-4 ${mutedClass}${fetchingPreview ? ' animate-spin-ccw' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>

              {fetchingPreview && (
                <p className={`text-xs ${mutedSmClass}`}>Fetching preview...</p>
              )}

              {!fetchingPreview && missingPreview.length === 0 && (
                <p className={`text-xs ${mutedSmClass}`}>
                  {session?.status === 'running'
                    ? 'Scanning for stories with missing audio...'
                    : 'No missing audio preview. Start a session to discover stories.'}
                </p>
              )}

              {!fetchingPreview && missingPreview.length > 0 && (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {missingPreview.map(story => (
                    <div key={story.storyId} className={`p-3 rounded-xl ${subtleBg2Class}`}>
                      <p className={`text-sm font-medium ${valueClass} truncate`}>{story.title}</p>
                      <p className={`text-xs ${mutedClass}`}>{story.missingCount} missing chapter{story.missingCount !== 1 ? 's' : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

          </div>

          {/* Right Column: Live Log */}
          <div className="space-y-4 lg:sticky lg:top-6">

            <section className={cardClass + ' p-5 sm:p-6 space-y-3'}>
              <h2 className={`text-base font-semibold ${valueClass}`}>Live Log</h2>

              {!session && (
                <p className={`text-xs ${mutedSmClass}`}>No session active.</p>
              )}

              {session && session.logs.length === 0 && (
                <p className={`text-xs ${mutedSmClass}`}>Session started, waiting for logs...</p>
              )}

              {session && session.logs.length > 0 && (
                <div className={`rounded-xl p-3 font-mono text-xs space-y-1 max-h-[600px] overflow-y-auto ${isDark ? 'bg-slate-950/60' : 'bg-gray-50'} ${isDark ? 'text-slate-300' : 'text-gray-700'}`}
                  style={{ fontSize: '0.75rem', lineHeight: '1.5' }}>
                  {session.logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className={`flex-shrink-0 ${mutedSmClass}`}>[{log.timestamp}]</span>
                      <span className={`flex-shrink-0 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>S{log.step}</span>
                      <span className={logLevelColor(log.level)}>{log.message}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </section>

            {/* Story Results */}
            {session && session.story_results && session.story_results.length > 0 && (
              <section className={cardClass + ' p-5 sm:p-6 space-y-3'}>
                <h2 className={`text-base font-semibold ${valueClass}`}>Story Results</h2>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {session.story_results.map((result, i) => (
                    <div key={i} className={`p-3 rounded-xl ${subtleBg2Class}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium ${valueClass} truncate flex-1`}>{result.story_title}</p>
                        {result.chapters_uploaded > 0 && (
                          <span className={`inline-flex items-center gap-1 text-xs flex-shrink-0 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            {result.chapters_uploaded}
                          </span>
                        )}
                      </div>
                      <p className={`text-xs ${mutedSmClass} mt-0.5`}>
                        Generated: {result.chapters_generated}, Uploaded: {result.chapters_uploaded}
                      </p>
                      {result.upload_errors.length > 0 && (
                        <div className={`mt-1 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                          {result.upload_errors.slice(0, 3).map((e, j) => (
                            <p key={j}>{e}</p>
                          ))}
                        </div>
                      )}
                      {result.error && (
                        <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'} mt-0.5`}>{result.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

          </div>
        </div>
      </main>

      {/* Stop Confirmation Modal */}
      {showStopConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className={`rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-gray-200'}`}>
            <h3 className={`text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
              Stop Auto Audio Session?
            </h3>
            <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
              Stopping will halt all audio generation immediately. Any chapters already generated will still be uploaded,
              but remaining stories will not be processed.
            </p>
            <div className="space-y-2">
              <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                Type <strong className={isDark ? 'text-red-400' : 'text-red-600'}>CONFIRM</strong> to stop:
              </p>
              <input
                type="text"
                value={stopConfirmText}
                onChange={e => setStopConfirmText(e.target.value)}
                placeholder="CONFIRM"
                className={`w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-red-500 ${isDark
                  ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-600'
                  : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => { setShowStopConfirm(false); setStopConfirmText(''); }}
                className={`px-4 py-2 text-sm rounded-xl transition-colors ${isDark
                  ? 'text-slate-300 bg-slate-800 hover:bg-slate-700'
                  : 'text-gray-700 bg-gray-100 hover:bg-gray-200'}`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (stopConfirmText !== 'CONFIRM') return;
                  setShowStopConfirm(false);
                  setStopConfirmText('');
                  setError('');
                  try {
                    await stopAutoAudio();
                    await loadStatus();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to stop session.');
                  }
                }}
                disabled={stopConfirmText !== 'CONFIRM'}
                className={`px-4 py-2 text-sm rounded-xl transition-colors ${stopConfirmText !== 'CONFIRM'
                  ? (isDark ? 'bg-red-900/50 text-red-400 cursor-not-allowed' : 'bg-red-100 text-red-400 cursor-not-allowed')
                  : 'text-white bg-red-600 hover:bg-red-500'} `}
              >
                Stop Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AutoAudioPage;
