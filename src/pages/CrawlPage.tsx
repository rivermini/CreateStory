import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cancelCrawl } from '../api/client';
import { useCrawlStream } from '../hooks/useCrawlStream';
import { ProgressBar } from '../components/ProgressBar';
import { StatsPanel } from '../components/StatsPanel';
import { CrawlLog } from '../components/CrawlLog';
import { type ThemeMode } from '../components/ThemeToggle';

interface CrawlPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function CrawlPage({ themeMode }: CrawlPageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const crawlId = searchParams.get('session');

  const { logLines, progress, status, error, sourceUrl, onFirstComplete } = useCrawlStream(crawlId);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!crawlId) {
      navigate('/');
    }
  }, [crawlId, navigate]);

  // Persist the "already redirected" flag in sessionStorage so navigating back
  // to a finished crawl page does NOT trigger another redirect.
  useEffect(() => {
    onFirstComplete((sessionId: string) => {
      const key = `crawl_redirected_${sessionId}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        setTimeout(() => navigate(`/results?session=${sessionId}`), 1500);
      }
    });
  }, [onFirstComplete]);

  const handleCancel = async () => {
    if (!crawlId) return;
    setCancelling(true);
    try {
      await cancelCrawl(crawlId);
    } catch {
      // ignore — SSE will update the status
    }
    setCancelling(false);
  };

  if (!crawlId) return null;

  const chaptersCrawled = progress?.chapters_crawled ?? 0;
  const chaptersTotal = progress?.chapters_total ?? 0;
  const currentTitle = progress?.current_title ?? '';
  const startedAt = null;
  const finishedAt = (status === 'completed' || status === 'failed' || status === 'cancelled')
    ? new Date().toLocaleTimeString()
    : null;

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
      <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* Page Header */}
        <div className="mb-2">
          <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            Crawl Progress
          </h1>
          <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            Your novel is being crawled
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div className={`flex items-center gap-3 p-4 rounded-2xl text-sm ${isDark
            ? 'bg-red-900/20 border border-red-800/30 text-red-400'
            : 'bg-red-50 border border-red-200 text-red-600'
          }`}>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Status redirect notice */}
        {(status === 'completed' || status === 'failed' || status === 'cancelled') && (
          <div className={`flex items-center gap-3 p-4 rounded-2xl text-sm ${status === 'completed'
            ? isDark ? 'bg-emerald-900/20 border border-emerald-800/30 text-emerald-400' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            : status === 'failed'
              ? isDark ? 'bg-red-900/20 border border-red-800/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'
              : isDark ? 'bg-amber-900/20 border border-amber-800/30 text-amber-400' : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Redirecting to results page...
          </div>
        )}

        {/* Source URL */}
        {sourceUrl && (
          <div className={`flex items-center gap-3 p-4 rounded-2xl text-sm ${isDark
            ? 'bg-slate-900/60 border border-slate-800/60 text-slate-400'
            : 'bg-white border border-gray-200 text-gray-600'
          }`}>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span className="text-xs">
              <span className="font-medium">Source:</span>{' '}
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`underline hover:no-underline ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'}`}
              >
                {sourceUrl}
              </a>
            </span>
          </div>
        )}

        {/* Progress */}
        <section className={`rounded-2xl p-5 sm:p-6 space-y-4 ${isDark
          ? 'bg-slate-900/60 border border-slate-800/60'
          : 'bg-white border border-gray-200'
        }`}>
          <ProgressBar
            chaptersCrawled={chaptersCrawled}
            chaptersTotal={chaptersTotal}
            currentTitle={currentTitle}
            status={status}
            isDark={isDark}
          />
        </section>

        {/* Stats */}
        <StatsPanel
          chaptersCrawled={chaptersCrawled}
          chaptersTotal={chaptersTotal}
          status={status}
          startedAt={startedAt}
          finishedAt={finishedAt}
          isDark={isDark}
        />

        {/* Log */}
        <section className={`rounded-2xl p-5 sm:p-6 ${isDark
          ? 'bg-slate-900/60 border border-slate-800/60'
          : 'bg-white border border-gray-200'
        }`}>
          <CrawlLog lines={logLines} maxLines={200} isDark={isDark} />
        </section>

        {/* Actions */}
        <div className="flex items-center gap-4">
          {status === 'running' && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className={`px-6 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 shadow-lg ${cancelling
                ? isDark
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                : isDark
                  ? 'text-white bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/30'
                  : 'text-white bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/30'
                }`}
            >
              {cancelling ? 'Cancelling...' : 'Cancel Crawl'}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
