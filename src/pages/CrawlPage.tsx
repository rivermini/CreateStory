import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cancelCrawl } from '../api/client';
import { useCrawlStream } from '../hooks/useCrawlStream';
import { ProgressBar } from '../components/ProgressBar';
import { StatsPanel } from '../components/StatsPanel';
import { CrawlLog } from '../components/CrawlLog';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface CrawlPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function CrawlPage({ themeMode, onThemeChange }: CrawlPageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const crawlId = searchParams.get('session');

  const { logLines, progress, status, error } = useCrawlStream(crawlId);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!crawlId) {
      navigate('/');
    }
  }, [crawlId, navigate]);

  useEffect(() => {
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      const timer = setTimeout(() => {
        if (crawlId) navigate(`/results?session=${crawlId}`);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [status, crawlId, navigate]);

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
    <div className={`min-h-screen ${isDark ? 'bg-slate-900' : 'bg-gray-50'}`}>
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title={"Crawling"}
        subtitle={<span className="font-mono">session: {crawlId}</span>}
      />

      <main className="w-full xl:w-[70vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Error banner */}
        {error && (
          <div className={`flex items-center gap-2 p-3 border rounded-lg text-sm ${isDark
            ? 'bg-red-900/30 border-red-800 text-red-400'
            : 'bg-red-50 border-red-200 text-red-600'
          }`}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Status redirect notice */}
        {(status === 'completed' || status === 'failed' || status === 'cancelled') && (
          <div className={`flex items-center gap-2 p-3 border rounded-lg text-sm ${status === 'completed'
            ? isDark ? 'bg-emerald-900/30 border-emerald-800 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : status === 'failed'
              ? isDark ? 'bg-red-900/30 border-red-800 text-red-400' : 'bg-red-50 border-red-200 text-red-600'
              : isDark ? 'bg-amber-900/30 border-amber-800 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Redirecting to results page...
          </div>
        )}

        {/* Progress */}
        <section className={`rounded-xl p-4 sm:p-6 space-y-4 ${isDark
          ? 'bg-slate-800 border border-slate-700'
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
        <section className={`rounded-xl p-4 sm:p-6 ${isDark
          ? 'bg-slate-800 border border-slate-700'
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
              className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-colors ${cancelling
                ? isDark
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : isDark
                  ? 'text-white bg-red-600 hover:bg-red-500'
                  : 'text-white bg-red-600 hover:bg-red-500'
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
