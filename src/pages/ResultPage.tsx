import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCrawlResult, getCombinedResult, getDownloadUrl, getDownloadCombinedUrl, getDownloadAllUrl, listAllResults, type CrawlSessionSummary } from '../api/client';
import { FilePreview } from '../components/FilePreview';
import { type ThemeMode } from '../components/ThemeToggle';

interface ResultPageProps {
  themeMode: ThemeMode;
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

export function ResultPage({ themeMode }: ResultPageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const crawlId = searchParams.get('session');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CrawlSessionSummary | null>(null);
  const [combinedFilename, setCombinedFilename] = useState('');
  const [files, setFiles] = useState<{ filename: string; size_bytes: number; chapter_number: number }[]>([]);

  // Session history state
  const [sessions, setSessions] = useState<CrawlSessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showIndividualFiles, setShowIndividualFiles] = useState(false);

  const fetchResult = useCallback(() => {
    if (!crawlId) return;

    Promise.all([
      getCrawlResult(crawlId).catch(() => null),
      getCombinedResult(crawlId, 30000).catch(() => null),
    ]).then(([individualResult, combinedResult]) => {
      if (!individualResult && !combinedResult) {
        setError('Failed to load crawl results.');
        return;
      }

      if (individualResult) {
        setResult({
          crawl_id: individualResult.crawl_id,
          status: individualResult.status,
          spider_name: individualResult.spider_name,
          novel_name: individualResult.novel_name || '',
          chapters_crawled: individualResult.chapters_crawled,
          chapters_total: individualResult.chapters_total,
          started_at: individualResult.started_at,
          finished_at: individualResult.finished_at,
          error_message: individualResult.error_message,
          output_files: individualResult.output_files,
          novel_metadata: individualResult.novel_metadata || undefined,
          combined_file: '',
          combined_txt_file: '',
          source_url: (individualResult as { source_url?: string }).source_url || '',
        });

        const allFiles = individualResult.output_files
          .map(f => ({
            filename: f.filename,
            size_bytes: f.size_bytes,
            chapter_number: f.chapter_number,
          }))
          .sort((a, b) => a.chapter_number - b.chapter_number);

        setFiles(allFiles);
      }

      if (combinedResult) {
        const txtFile = combinedResult.combined_txt_file;
        const jsonFile = combinedResult.output_files?.[0]?.filename;
        setCombinedFilename(txtFile || jsonFile || '');
      }
    }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load crawl results.');
    }).finally(() => {
      setIsLoading(false);
    });
  }, [crawlId]);

  const fetchHistory = useCallback(() => {
    setHistoryLoading(true);
    listAllResults()
      .then(data => setSessions(data))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    if (!crawlId) {
      navigate('/');
      return;
    }
    setIsLoading(true);
    fetchResult();
    fetchHistory();
  }, [crawlId, navigate, fetchResult, fetchHistory]);

  useEffect(() => {
    if (!result || result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled') return;
    const interval = setInterval(fetchResult, 3000);
    return () => clearInterval(interval);
  }, [result?.status, fetchResult]);

  if (!crawlId) return null;

  const pageBg = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)';

  if (isLoading) {
  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBg }}>
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />
      <div className="relative z-10 min-h-screen flex items-center justify-center">
        <div className="lg-glass-card px-6 py-5 flex items-center gap-3">
            <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24" style={{ color: isDark ? 'rgba(129,140,248,0.8)' : 'rgba(99,102,241,0.8)' }}>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className={isDark ? 'text-white/70' : 'text-[rgba(0,0,0,0.7)]'}>Loading results...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBg }}>
        <div className="lg-orb lg-orb-1" />
        <div className="lg-orb lg-orb-2" />
        <div className="lg-orb lg-orb-3" />
        <div className="relative z-10 min-h-screen flex items-center justify-center">
          <div className="lg-glass-card p-8 text-center space-y-4 max-w-sm">
            <div className="flex items-center justify-center gap-2" style={{ color: isDark ? '#f87171' : '#ef4444' }}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error || 'Results not found'}</span>
            </div>
            <button
              onClick={() => navigate('/')}
              className="lg-btn-primary"
            >
              Start New Crawl
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    completed: isDark ? 'text-emerald-400' : 'text-emerald-600',
    failed:    isDark ? 'text-red-400'    : 'text-red-600',
    cancelled: isDark ? 'text-amber-400'  : 'text-amber-600',
    running:   isDark ? 'text-blue-400'   : 'text-blue-600',
  };

  const statusLabels: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    running: 'Running',
  };

  const statusDotMap: Record<string, string> = {
    completed: isDark ? 'bg-emerald-400' : 'bg-emerald-500',
    failed:    isDark ? 'bg-red-400'    : 'bg-red-500',
    cancelled: isDark ? 'bg-amber-400'  : 'bg-amber-500',
    running:   isDark ? 'bg-blue-400'   : 'bg-blue-500',
    idle:      isDark ? 'bg-slate-500'  : 'bg-gray-400',
  };

  const statusChipClass = () => {
    const status = result.status;
    if (status === 'completed') return 'lg-chip lg-chip-green';
    if (status === 'failed') return 'lg-chip lg-chip-red';
    if (status === 'cancelled') return 'lg-chip lg-chip-amber';
    if (status === 'running') return 'lg-chip lg-chip-blue';
    return 'lg-chip lg-chip-neutral';
  };

  const meta = result.novel_metadata;
  const nonCombinedFiles = files.filter(f => f.filename !== combinedFilename);

  const handleDownload = (filename: string) => {
    const a = document.createElement('a');
    a.href = getDownloadUrl(result.crawl_id, filename);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadCombined = () => {
    if (!combinedFilename) return;
    const a = document.createElement('a');
    a.href = getDownloadCombinedUrl(result.crawl_id, combinedFilename);
    a.download = combinedFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Filter out the current session from history
  const otherSessions = sessions.filter(s => s.crawl_id !== crawlId);

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
            <h1 className={`text-2xl sm:text-3xl font-bold tracking-tight ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>
              Crawl Results
            </h1>
            <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
              {result.novel_name || 'Crawl Session'}
            </p>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            <span className={statusChipClass()}>
              {result.status === 'running' && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
              )}
              {result.status.charAt(0).toUpperCase() + result.status.slice(1)}
            </span>
            <button
              onClick={() => {
                setShowHistory(v => !v);
                if (!sessions.length) fetchHistory();
              }}
              className="lg-icon-btn"
              style={showHistory ? { background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' } : {}}
              title={showHistory ? 'Hide History' : 'Session History'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Primary Combined File */}
        {combinedFilename && (
          <section className="lg-glass p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(52,211,153,0.15)' }}>
                  <svg width="16" height="16" fill="none" stroke="#34d399" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className={`text-xl sm:text-2xl font-bold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>
                    Combined File
                  </h2>
                  <p className={`text-xs ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>All chapters merged into a single file</p>
                </div>
              </div>
              <button
                onClick={handleDownloadCombined}
                className="lg-btn-primary"
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Combined
              </button>
            </div>

            <div className="mt-4">
              <FilePreview
                crawlId={result.crawl_id}
                filename={combinedFilename}
                sizeBytes={files.find(f => f.filename === combinedFilename)?.size_bytes || 0}
                onDownload={handleDownloadCombined}
                accent="emerald"
                isDark={isDark}
              />
            </div>
          </section>
        )}

        {/* Session History Panel */}
        {showHistory && (
          <section className="lg-glass overflow-hidden">
            <div className="px-5 py-3 border-b" style={{ borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
              <div className="flex items-center justify-between">
                <h2 className={`text-sm font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>
                  Recent Sessions ({otherSessions.length})
                </h2>
                <button
                  onClick={fetchHistory}
                  disabled={historyLoading}
                  className="lg-icon-btn"
                  title="Refresh"
                >
                  <svg className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>

            {historyLoading && otherSessions.length === 0 ? (
              <div className={`flex items-center justify-center gap-2 py-8 text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading history...
              </div>
            ) : otherSessions.length === 0 ? (
              <div className={`py-8 text-center text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                No other sessions yet.
              </div>
            ) : (
              <div className="divide-y divide-inherit">
                {otherSessions.slice(0, 8).map(session => {
                  const dot = statusDotMap[session.status] ?? (isDark ? 'bg-white/30' : 'bg-black/30');
                  const label = statusLabels[session.status] ?? session.status;
                  const textColor = statusColors[session.status] ?? (isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]');
                  const displayTitle = session.novel_name || session.crawl_id;

                  return (
                    <div
                      key={session.crawl_id}
                      className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-[rgba(0,0,0,0.02)]'}`}
                      style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}` }}
                      onClick={() => navigate(`/results?session=${session.crawl_id}`)}
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isDark ? 'text-white/85' : 'text-[rgba(0,0,0,0.8)]'}`}>
                          {displayTitle}
                        </p>
                        <div className={`flex items-center gap-2 text-xs ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                          <span className={textColor}>{label}</span>
                          <span>·</span>
                          <span>{session.chapters_crawled} ch</span>
                          <span>·</span>
                          <span>{formatDate(session.started_at)}</span>
                          {session.finished_at && (
                            <>
                              <span>·</span>
                              <span>{formatDuration(session.started_at, session.finished_at)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <svg className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  );
                })}
              </div>
            )}

            {otherSessions.length > 8 && (
              <div className="px-5 py-3 border-t" style={{ borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
                <button
                  onClick={() => navigate('/results/all')}
                  className="text-xs font-medium transition-colors"
                  style={{ color: isDark ? '#818cf8' : '#6366f1' }}
                >
                  View all {otherSessions.length} sessions →
                </button>
              </div>
            )}
          </section>
        )}

        {/* Summary Card */}
        <section className="lg-glass p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              {meta?.author_fullname && (
                <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>by {meta.author_fullname}</p>
              )}
              <p className={`text-sm ${isDark ? 'text-white/70' : 'text-[rgba(0,0,0,0.7)]'}`}>
                {result.spider_name || 'Unknown site'} &middot;{' '}
                <span className={statusColors[result.status] ?? (isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]')}>
                  {statusLabels[result.status] ?? result.status}
                </span>
                {result.chapters_crawled > 0 && (
                  <> &middot; {result.chapters_crawled} chapter{result.chapters_crawled !== 1 ? 's' : ''}</>
                )}
              </p>
              {result.source_url && (
                <p className={`text-xs mt-1 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                  <span className="font-medium">Source:</span>{' '}
                  <a
                    href={result.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:no-underline"
                    style={{ color: isDark ? '#818cf8' : '#6366f1' }}
                  >
                    {result.source_url}
                  </a>
                </p>
              )}
            </div>
            {files.length > 0 && (
              <button
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = getDownloadAllUrl(result.crawl_id);
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
                className="lg-btn-primary"
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download All
              </button>
            )}
          </div>

          {meta && (
            <div className={`flex flex-wrap gap-2 items-center text-xs ${isDark ? 'text-white/70' : 'text-[rgba(0,0,0,0.7)]'}`}>
              {meta.views != null && <span>{meta.views.toLocaleString()} views</span>}
              {meta.stars != null && <span>{meta.stars.toLocaleString()} stars</span>}
              {meta.chapter_count != null && <span>{meta.chapter_count} parts</span>}
              {meta.completed === true && (
                <span className="lg-chip lg-chip-green">Completed</span>
              )}
              {meta.mature === true && (
                <span className="lg-chip lg-chip-amber">18+</span>
              )}
              {meta.is_paywalled === true && (
                <span className="lg-chip lg-chip-red">Locked chapters present</span>
              )}
            </div>
          )}

          {meta?.tags && meta.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {meta.tags.map(tag => (
                <span key={tag} className="lg-chip lg-chip-neutral">{tag}</span>
              ))}
            </div>
          )}

          {meta?.description && (
            <p className={`text-sm line-clamp-2 ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>{meta.description}</p>
          )}

          {result.error_message && (
            <div className="p-3 rounded-xl text-sm" style={{
              background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
              border: isDark ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(239,68,68,0.15)',
              color: isDark ? '#f87171' : '#ef4444'
            }}>
              <strong>Error:</strong> {result.error_message}
            </div>
          )}
        </section>

        {/* Individual Files */}
        {nonCombinedFiles.length > 0 ? (
          <section className="lg-glass p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className={`text-base sm:text-lg font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>
                Individual Chapters ({nonCombinedFiles.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowIndividualFiles(v => !v)}
                className="lg-icon-btn"
              >
                {showIndividualFiles ? 'Hide' : 'Show'}
                <svg className={`h-3.5 w-3.5 transition-transform ${showIndividualFiles ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {showIndividualFiles ? (
              <div className="space-y-3">
                {nonCombinedFiles.map(file => (
                  <FilePreview
                    key={file.filename}
                    crawlId={result.crawl_id}
                    filename={file.filename}
                    sizeBytes={file.size_bytes}
                    onDownload={() => handleDownload(file.filename)}
                    isDark={isDark}
                  />
                ))}
              </div>
            ) : (
              <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                Individual chapter files are hidden. Expand to view and download.
              </p>
            )}
          </section>
        ) : !combinedFilename ? (
          <section className="lg-glass p-8 text-center">
            <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>No output files found for this crawl session.</p>
          </section>
        ) : null}

        {/* Phase 2 placeholder */}
        <section className="lg-glass p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </div>
            <h2 className={`text-base font-medium ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>Send to Company Backend</h2>
          </div>
          <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
            This feature will POST crawled chapter content to the company NestJS/Java backend.
            It will be enabled in Phase 2 once the API endpoint details are confirmed.
          </p>
          <button
            disabled
            className="lg-btn-primary"
            style={{ opacity: 0.4, cursor: 'not-allowed' }}
          >
            Send to Company BE (Phase 2)
          </button>
        </section>
      </main>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
