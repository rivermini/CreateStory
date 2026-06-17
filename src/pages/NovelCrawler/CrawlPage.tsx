import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cancelCrawl } from '../../api';
import { CrawlLog } from '../../components/NovelCrawler/CrawlLog';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { ProgressBar } from '../../components/NovelCrawler/ProgressBar';
import { StatsPanel } from '../../components/NovelCrawler/StatsPanel';
import { useCrawlStream } from '../../hooks/useCrawlStream';
import type { ThemeMode } from '../../types/theme';

interface CrawlPageProps {
  readonly themeMode: ThemeMode;
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
  }, [onFirstComplete, navigate]);

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
  const startedAt = progress?.started_at ?? null;
  const finishedAt = status === 'completed' || status === 'failed' || status === 'cancelled'
    ? new Date().toLocaleTimeString()
    : null;
  const isFinished = status === 'completed' || status === 'failed' || status === 'cancelled';

  const pageBackground = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';

  const statusStateStyles: Record<string, { bg: string; borderColor: string; color: string; dotColor: string }> = {
    running: { bg: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.25)', color: '#93c5fd', dotColor: '#60a5fa' },
    completed: { bg: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.25)', color: '#86efac', dotColor: '#4ade80' },
    failed: { bg: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.25)', color: '#fca5a5', dotColor: '#f87171' },
    cancelled: { bg: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)', color: '#fcd34d', dotColor: '#fbbf24' },
  };
  const fallbackStyle = { bg: 'rgba(255,255,255,0.06)', borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(17,17,17,0.1)', color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)', dotColor: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.5)' };
  const st = statusStateStyles[status] ?? fallbackStyle;

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-3 py-4 sm:px-5 lg:px-6 lg:py-5">
        <main className="space-y-4">
          <section
            className="rounded-xl border px-4 py-4 sm:px-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Session
              </div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl" style={{ color: pageText }}>
                Crawl progress
              </h1>
              <p className="text-sm leading-5" style={{ color: secondaryText }}>
                Your novel is being crawled. Follow the live log, progress updates, and session status below.
              </p>
            </div>
          </section>

          {error && (
            <section className="rounded-xl border px-4 py-3 text-sm" style={{
              background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(220,38,38,0.06)',
              borderColor: isDark ? 'rgba(239,68,68,0.3)' : 'rgba(220,38,38,0.2)',
              color: isDark ? '#fca5a5' : '#dc2626',
            }}>
              <span className="mr-2 flex inline-flex items-center">
                <Icon icon={appIcons.error} className="mr-1.5 h-4 w-4" />
              </span>
              {error}
            </section>
          )}

          <section className="rounded-xl border px-4 py-3 text-sm" style={{ background: st.bg, borderColor: st.borderColor }}>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${status === 'running' ? 'animate-pulse' : ''}`}
                style={{ background: st.dotColor }}
              />
              {status === 'running' ? (
                <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
              ) : status === 'completed' ? (
                <Icon icon={appIcons.checkCircle} className="h-4 w-4" />
              ) : status === 'failed' ? (
                <Icon icon={appIcons.error} className="h-4 w-4" />
              ) : (
                <Icon icon={appIcons.stop} className="h-4 w-4" />
              )}
              <span style={{ color: st.color }}>
                {isFinished ? 'Redirecting to results page...' : 'Streaming crawl updates in real time.'}
              </span>
            </div>
          </section>

          {sourceUrl && (
            <section
              className="rounded-xl border px-4 py-3 sm:px-5"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="text-xs uppercase tracking-[0.14em]" style={{ color: tertiaryText }}>
                Source
              </div>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block break-all text-sm underline hover:no-underline"
                style={{ color: pageText }}
              >
                {sourceUrl}
              </a>
            </section>
          )}

          <section
            className="rounded-xl border px-4 py-4 sm:px-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                  Progress
                </h2>
                <p className="text-sm" style={{ color: secondaryText }}>
                  {currentTitle || 'Waiting for crawl output...'}
                </p>
              </div>
              <div
                className="rounded-lg border px-3 py-2 text-right"
                style={{
                  borderColor: st.borderColor,
                  background: st.bg,
                }}
              >
                <p className="text-sm font-semibold" style={{ color: st.color }}>
                  {chaptersCrawled}
                  {chaptersTotal > 0 ? ` / ${chaptersTotal}` : ''}
                </p>
                <p className="text-[10px]" style={{ color: st.color, opacity: 0.7 }}>
                  chapters
                </p>
              </div>
            </div>

            <ProgressBar
              chaptersCrawled={chaptersCrawled}
              chaptersTotal={chaptersTotal}
              currentTitle={currentTitle}
              status={status}
              isDark={isDark}
            />
          </section>

          <StatsPanel
            chaptersCrawled={chaptersCrawled}
            chaptersTotal={chaptersTotal}
            status={status}
            startedAt={startedAt}
            finishedAt={finishedAt}
            isDark={isDark}
          />

          <section
            className="rounded-xl border px-4 py-4 sm:px-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="mb-3">
              <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                Crawl log
              </h2>
              <p className="text-sm" style={{ color: secondaryText }}>
                Live output from the current crawl session.
              </p>
            </div>
            <CrawlLog lines={logLines} maxLines={200} isDark={isDark} />
          </section>

          <div className="flex items-center gap-4">
            {status === 'running' && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="rounded-md px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed"
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  color: isDark ? '#fca5a5' : '#dc2626',
                  opacity: cancelling ? 0.65 : 1,
                }}
              >
                {cancelling ? 'Cancelling...' : 'Cancel crawl'}
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
