import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getCrawlResult,
  getCombinedResult,
  getDownloadUrl,
  getDownloadCombinedUrl,
  getDownloadAllUrl,
  listAllResults,
  type CrawlSessionSummary,
} from '../../api/client';
import { FilePreview } from '../../components/NovelCrawler/FilePreview';
import { Icon, appIcons } from '../../components/Shared/Icon';
import type { ThemeMode } from '../../types/theme';

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
  const [sessions, setSessions] = useState<CrawlSessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showIndividualFiles, setShowIndividualFiles] = useState(false);

  const fetchResult = useCallback(() => {
    if (!crawlId) return;

    Promise.all([
      getCrawlResult(crawlId).catch(() => null),
      getCombinedResult(crawlId, 30000).catch(() => null),
    ])
      .then(([individualResult, combinedResult]) => {
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
            .map((file) => ({
              filename: file.filename,
              size_bytes: file.size_bytes,
              chapter_number: file.chapter_number,
            }))
            .sort((a, b) => a.chapter_number - b.chapter_number);

          setFiles(allFiles);
        }

        if (combinedResult) {
          const txtFile = combinedResult.combined_txt_file;
          const jsonFile = combinedResult.output_files?.[0]?.filename;
          setCombinedFilename(txtFile || jsonFile || '');
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load crawl results.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [crawlId]);

  const fetchHistory = useCallback(() => {
    setHistoryLoading(true);
    listAllResults()
      .then((data) => setSessions(data))
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
    if (!result || result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled') {
      return;
    }
    const interval = setInterval(fetchResult, 3000);
    return () => clearInterval(interval);
  }, [result?.status, fetchResult]);

  if (!crawlId) return null;

  const pageBg = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const activeSurface = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(17,17,17,0.08)';
  const strongSurface = isDark ? 'rgba(255,255,255,0.92)' : '#111111';
  const strongSurfaceText = isDark ? '#111111' : '#ffffff';
  const statusToneMap: Record<string, { text: string; dot: string }> = {
    completed: {
      text: isDark ? 'rgba(255,255,255,0.92)' : '#111111',
      dot: isDark ? 'rgba(255,255,255,0.92)' : '#111111',
    },
    failed: {
      text: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)',
      dot: isDark ? 'rgba(255,255,255,0.56)' : 'rgba(17,17,17,0.56)',
    },
    cancelled: {
      text: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)',
      dot: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)',
    },
    running: {
      text: isDark ? 'rgba(255,255,255,0.92)' : '#111111',
      dot: isDark ? 'rgba(255,255,255,0.92)' : '#111111',
    },
    idle: {
      text: secondaryText,
      dot: tertiaryText,
    },
  };

  if (isLoading) {
    return (
      <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBg }}>
        <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-3 py-4 sm:px-5 lg:px-6">
          <section
            className="rounded-xl border px-5 py-4 text-sm"
            style={{ background: panelBackground, borderColor: panelBorder, color: secondaryText }}
          >
            <div className="flex items-center gap-3">
              <Icon icon={appIcons.spinner} className="h-5 w-5 animate-spin" />
              Loading results…
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBg }}>
        <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-3 py-4 sm:px-5 lg:px-6">
          <section
            className="max-w-md rounded-xl border px-5 py-5 text-center"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="flex items-center justify-center gap-2" style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)' }}>
              <Icon icon={appIcons.info} className="h-5 w-5" />
              <span>{error || 'Results not found'}</span>
            </div>
            <button
              onClick={() => navigate('/')}
              className="mt-4 rounded-md px-4 py-2 text-sm font-medium"
              style={{ background: strongSurface, color: strongSurfaceText }}
            >
              Start new crawl
            </button>
          </section>
        </div>
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    running: 'Running',
  };

  const statusChipStyle = () => {
    const status = result.status;
    if (status === 'running' || status === 'completed') {
      return {
        background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)',
        color: isDark ? 'rgba(255,255,255,0.92)' : '#111111',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.12)'}`,
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      return {
        background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17,17,17,0.04)',
        color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(17,17,17,0.1)'}`,
      };
    }
    return {
      background: mutedSurface,
      color: secondaryText,
      border: `1px solid ${panelBorder}`,
    };
  };

  const meta = result.novel_metadata;
  const nonCombinedFiles = files.filter((file) => file.filename !== combinedFilename);

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

  const otherSessions = sessions.filter((session) => session.crawl_id !== crawlId);

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBg }}>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-3 py-4 sm:px-5 lg:px-6 lg:py-5">
        <main className="space-y-4">
          <section
            className="rounded-xl border px-4 py-4 sm:px-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                  Results
                </div>
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl" style={{ color: pageText }}>
                  {result.novel_name || 'Crawl session'}
                </h1>
                <p className="max-w-3xl text-sm leading-5" style={{ color: secondaryText }}>
                  Review session details, preview output files, and jump across recent crawl runs.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium"
                  style={statusChipStyle()}
                >
                  {result.status === 'running' && (
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: 'currentColor', animation: 'pulse 1.5s ease-in-out infinite' }}
                    />
                  )}
                  {result.status.charAt(0).toUpperCase() + result.status.slice(1)}
                </span>
                <button
                  onClick={() => {
                    setShowHistory((value) => !value);
                    if (!sessions.length) fetchHistory();
                  }}
                  className="rounded-md border px-3 py-2 text-sm transition-colors"
                  style={{
                    borderColor: showHistory ? (isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.12)') : panelBorder,
                    background: showHistory ? activeSurface : mutedSurface,
                    color: showHistory ? pageText : secondaryText,
                  }}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon icon={appIcons.clock} className="h-4 w-4" />
                    {showHistory ? 'Hide history' : 'Show history'}
                  </span>
                </button>
              </div>
            </div>
          </section>

          {combinedFilename && (
            <section
              className="rounded-xl border px-4 py-4 sm:px-5"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                    Primary output
                  </div>
                  <h2 className="mt-1 text-lg font-semibold" style={{ color: pageText }}>
                    Combined file
                  </h2>
                  <p className="mt-1 text-sm" style={{ color: secondaryText }}>
                    All chapters merged into a single file.
                  </p>
                </div>
                <button
                  onClick={handleDownloadCombined}
                  className="rounded-md px-4 py-2 text-sm font-medium"
                  style={{ background: strongSurface, color: strongSurfaceText }}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon icon={appIcons.download} className="h-4 w-4" />
                    Download combined
                  </span>
                </button>
              </div>

              <div className="mt-4">
                <FilePreview
                  crawlId={result.crawl_id}
                  filename={combinedFilename}
                  sizeBytes={files.find((file) => file.filename === combinedFilename)?.size_bytes || 0}
                  onDownload={handleDownloadCombined}
                  isDark={isDark}
                />
              </div>
            </section>
          )}

          {showHistory && (
            <section
              className="overflow-hidden rounded-xl border"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="flex items-center justify-between border-b px-4 py-3.5 sm:px-5" style={{ borderColor: panelBorder }}>
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                    Recent sessions
                  </h2>
                  <p className="text-sm" style={{ color: secondaryText }}>
                    {otherSessions.length} other session{otherSessions.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  onClick={fetchHistory}
                  disabled={historyLoading}
                  className="rounded-md border px-3 py-2 text-sm transition-colors"
                  style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon icon={appIcons.refresh} className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </span>
                </button>
              </div>

              {historyLoading && otherSessions.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm" style={{ color: secondaryText }}>
                  Loading history…
                </div>
              ) : otherSessions.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm" style={{ color: secondaryText }}>
                  No other sessions yet.
                </div>
              ) : (
                <div>
                  {otherSessions.slice(0, 8).map((session, index) => {
                    const tone = statusToneMap[session.status] ?? { text: secondaryText, dot: tertiaryText };
                    const displayTitle = session.novel_name || session.crawl_id;

                    return (
                      <button
                        key={session.crawl_id}
                        type="button"
                        onClick={() => navigate(`/results?session=${session.crawl_id}`)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors sm:px-5"
                        style={{
                          borderTop: index === 0 ? 'none' : `1px solid ${panelBorder}`,
                          background: 'transparent',
                        }}
                      >
                        <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone.dot }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" style={{ color: pageText }}>
                            {displayTitle}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: secondaryText }}>
                            <span>{session.chapters_crawled} ch</span>
                            <span>{formatDate(session.started_at)}</span>
                            {session.finished_at && <span>{formatDuration(session.started_at, session.finished_at)}</span>}
                          </div>
                        </div>
                        <Icon icon={appIcons.chevronRight} className="h-4 w-4 shrink-0" style={{ color: tertiaryText }} />
                      </button>
                    );
                  })}
                </div>
              )}

              {otherSessions.length > 8 && (
                <div className="border-t px-5 py-4 sm:px-6" style={{ borderColor: panelBorder }}>
                  <button
                    onClick={() => navigate('/results/all')}
                    className="text-sm font-medium"
                    style={{ color: pageText }}
                  >
                    View all {otherSessions.length} sessions →
                  </button>
                </div>
              )}
            </section>
          )}

          <section
            className="rounded-xl border px-4 py-4 sm:px-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                  Session
                </div>
                {meta?.author_fullname && (
                  <p className="text-sm" style={{ color: secondaryText }}>
                    by {meta.author_fullname}
                  </p>
                )}
                <p className="text-sm" style={{ color: secondaryText }}>
                  {result.spider_name || 'Unknown site'} ·{' '}
                  <span style={{ color: statusToneMap[result.status]?.text ?? secondaryText }}>
                    {statusLabels[result.status] ?? result.status}
                  </span>
                  {result.chapters_crawled > 0 && (
                    <> · {result.chapters_crawled} chapter{result.chapters_crawled !== 1 ? 's' : ''}</>
                  )}
                </p>
                {result.source_url && (
                  <p className="text-xs leading-6" style={{ color: tertiaryText }}>
                    <span style={{ color: secondaryText }}>Source:</span>{' '}
                    <a
                      href={result.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:no-underline"
                      style={{ color: pageText }}
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
                  className="rounded-md px-4 py-2 text-sm font-medium"
                  style={{ background: strongSurface, color: strongSurfaceText }}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon icon={appIcons.download} className="h-4 w-4" />
                    Download all
                  </span>
                </button>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetaItem label="Started" value={formatDate(result.started_at)} secondaryText={secondaryText} pageText={pageText} />
              <MetaItem label="Finished" value={formatDate(result.finished_at)} secondaryText={secondaryText} pageText={pageText} />
              <MetaItem label="Duration" value={formatDuration(result.started_at, result.finished_at)} secondaryText={secondaryText} pageText={pageText} />
              <MetaItem
                label="Progress"
                value={result.chapters_total > 0 ? `${result.chapters_crawled}/${result.chapters_total}` : `${result.chapters_crawled}`}
                secondaryText={secondaryText}
                pageText={pageText}
              />
            </div>

            {meta && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs" style={{ color: secondaryText }}>
                {meta.views != null && <span>{meta.views.toLocaleString()} views</span>}
                {meta.stars != null && <span>{meta.stars.toLocaleString()} stars</span>}
                {meta.chapter_count != null && <span>{meta.chapter_count} parts</span>}
                {meta.completed === true && <InlineChip label="Completed" tone="strong" isDark={isDark} />}
                {meta.mature === true && <InlineChip label="18+" tone="soft" isDark={isDark} />}
                {meta.is_paywalled === true && <InlineChip label="Locked chapters present" tone="soft" isDark={isDark} />}
              </div>
            )}

            {meta?.tags && meta.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {meta.tags.map((tag) => (
                  <InlineChip key={tag} label={tag} tone="neutral" isDark={isDark} />
                ))}
              </div>
            )}

            {meta?.description && (
              <p className="mt-4 text-sm leading-6" style={{ color: secondaryText }}>
                {meta.description}
              </p>
            )}

            {result.error_message && (
              <div
                className="mt-4 rounded-xl border px-4 py-3 text-sm"
                style={{
                  background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)',
                  borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.12)',
                  color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)',
                }}
              >
                <strong>Error:</strong> {result.error_message}
              </div>
            )}
          </section>

          {nonCombinedFiles.length > 0 ? (
            <section
              className="rounded-xl border px-4 py-4 sm:px-5"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                    Individual chapters
                  </h2>
                  <p className="text-sm" style={{ color: secondaryText }}>
                    {nonCombinedFiles.length} file{nonCombinedFiles.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIndividualFiles((value) => !value)}
                  className="rounded-md border px-3 py-2 text-sm transition-colors"
                  style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon
                      icon={appIcons.chevronDown}
                      className={`h-4 w-4 transition-transform ${showIndividualFiles ? 'rotate-180' : ''}`}
                    />
                    {showIndividualFiles ? 'Hide files' : 'Show files'}
                  </span>
                </button>
              </div>

              {showIndividualFiles ? (
                <div className="mt-4 space-y-3">
                  {nonCombinedFiles.map((file) => (
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
                <p className="mt-4 text-sm" style={{ color: secondaryText }}>
                  Individual chapter files are hidden. Expand to preview and download them.
                </p>
              )}
            </section>
          ) : !combinedFilename ? (
            <section
              className="rounded-xl border px-4 py-8 text-center sm:px-5"
              style={{ background: panelBackground, borderColor: panelBorder, color: secondaryText }}
            >
              No output files found for this crawl session.
            </section>
          ) : null}

          <section
            className="rounded-xl border px-4 py-4 sm:px-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Phase 2
              </div>
              <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                Send to Company Backend
              </h2>
              <p className="text-sm leading-6" style={{ color: secondaryText }}>
                This feature will POST crawled chapter content to the company NestJS/Java backend. It will be enabled once the API endpoint details are confirmed.
              </p>
            </div>
            <button
              disabled
              className="mt-4 rounded-md px-4 py-2 text-sm font-medium"
              style={{ background: mutedSurface, color: secondaryText, opacity: 0.7, cursor: 'not-allowed', border: `1px solid ${panelBorder}` }}
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

function MetaItem({
  label,
  value,
  secondaryText,
  pageText,
}: {
  label: string;
  value: string;
  secondaryText: string;
  pageText: string;
}) {
  return (
    <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'rgba(127,127,127,0.12)' }}>
      <div className="text-xs uppercase tracking-[0.14em]" style={{ color: secondaryText }}>
        {label}
      </div>
      <div className="mt-1 text-sm font-medium" style={{ color: pageText }}>
        {value}
      </div>
    </div>
  );
}

function InlineChip({
  label,
  tone,
  isDark,
}: {
  label: string;
  tone: 'strong' | 'soft' | 'neutral';
  isDark: boolean;
}) {
  const styles: Record<'strong' | 'soft' | 'neutral', { background: string; color: string; border: string }> = {
    strong: {
      background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)',
      color: isDark ? 'rgba(255,255,255,0.92)' : '#111111',
      border: isDark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(17,17,17,0.12)',
    },
    soft: {
      background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17,17,17,0.04)',
      color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)',
      border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(17,17,17,0.1)',
    },
    neutral: {
      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)',
      color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(55,53,47,0.72)',
      border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(55,53,47,0.12)',
    },
  };

  return (
    <span className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium" style={styles[tone]}>
      {label}
    </span>
  );
}
