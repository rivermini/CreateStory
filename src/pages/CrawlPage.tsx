import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cancelCrawl } from '../api/client';
import { useCrawlStream } from '../hooks/useCrawlStream';
import { ProgressBar } from '../components/ProgressBar';
import { StatsPanel } from '../components/StatsPanel';
import { CrawlLog } from '../components/CrawlLog';
import type { ThemeMode } from '../types/theme';

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
      // ignore
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

  const pageBg = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)';

  const c = (key: string) => {
    const map: Record<string, [string, string]> = {
      text:      ['text-white/90',      'text-[rgba(0,0,0,0.85)]'],
      textMuted: ['text-white/40',       'text-[rgba(0,0,0,0.4)]'],
      textSub:   ['text-white/25',       'text-[rgba(0,0,0,0.25)]'],
      textBody:  ['text-white/70',       'text-[rgba(0,0,0,0.65)]'],
      textBodyStrong: ['text-white/90', 'text-[rgba(0,0,0,0.85)]'],
      glassBg:   ['bg-white/[0.03]',     'bg-white/70'],
      glassBorder: ['border-white/[0.06]','border-black/[0.06]'],
      glassHover:['hover:bg-white/[0.05]','hover:bg-white/80'],
      rowBg:     ['bg-white/[0.04]',     'bg-[rgba(0,0,0,0.04)]'],
      rowBorder:  ['border-white/[0.05]', 'border-black/[0.05]'],
      divider:   ['border-white/[0.06]', 'border-black/[0.06]'],
      glassNav:  ['bg-[#0f0f1e]/90',    'bg-white/80'],
    };
    return map[key]?.[isDark ? 0 : 1] ?? '';
  };

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBg }}>
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />
      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <main className="w-full xl:max-w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          {/* Page Header */}
          <div className="lg-glass-deep px-6 py-5 flex items-start justify-between gap-4">
            <div>
              <h1 className={`text-2xl sm:text-3xl font-bold ${c('text')}`}>Crawl Progress</h1>
              <p className={`mt-1 text-sm sm:text-base ${c('textMuted')}`}>Your novel is being crawled</p>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className={`lg-glass-card px-4 py-3 text-sm ${isDark ? 'text-red-400' : 'text-red-500'}`}>
              {error}
            </div>
          )}

          {/* Status redirect notice */}
          {(status === 'completed' || status === 'failed' || status === 'cancelled') && (
            <div className={`lg-glass-card px-4 py-3 text-sm ${status === 'completed'
              ? isDark ? 'text-emerald-400' : 'text-emerald-600'
              : status === 'failed'
                ? isDark ? 'text-red-400' : 'text-red-600'
                : isDark ? 'text-amber-400' : 'text-amber-600'
            }`}>
              Redirecting to results page...
            </div>
          )}

          {/* Source URL */}
          {sourceUrl && (
            <div className={`lg-glass px-4 py-3 text-sm ${c('textSub')}`}>
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
          <section className="lg-glass p-5 sm:p-6 space-y-4">
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
          <section className="lg-glass p-5 sm:p-6">
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
                    ? 'bg-white/[0.04] text-white/30 cursor-not-allowed shadow-none border border-white/[0.05]'
                    : 'bg-[rgba(0,0,0,0.04)] text-[rgba(0,0,0,0.3)] cursor-not-allowed shadow-none border border-black/5'
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
    </div>
  );
}
