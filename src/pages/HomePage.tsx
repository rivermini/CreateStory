import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { checkInkittCookies, getSettings, listSites, startCrawl } from '../api/client';
import type { InkittCookieStatusResponse, SiteInfoResponse } from '../api/client';
import { MobileBottomSheet } from '../components/MobileBottomSheet';
import { NovelInfoPanel } from '../components/NovelInfoPanel';
import { Icon, appIcons } from '../components/Icon';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useNovelInfo } from '../hooks/useNovelInfo';
import { useSiteDetection } from '../hooks/useSiteDetection';
import type { ThemeMode } from '../types/theme';

interface HomePageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function HomePage({ themeMode }: HomePageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { siteInfo, slug, storyTitle, resolvedUrl, isValid, isLoading, error, detect, novelMetadata } = useSiteDetection();
  const {
    chapters,
    chapterCount,
    totalChapterCount,
    storyTitle: panelTitle,
    isLoadingChapters,
    chaptersError,
    warning,
    isChapterUrl,
    isResolvingTotal,
    refresh,
  } = useNovelInfo();

  const [inputUrl, setInputUrl] = useState('');
  const [toChapter, setToChapter] = useState(10);
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(10);
  const [rangeMode, setRangeMode] = useState<'count' | 'range'>('count');
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [supportedSites, setSupportedSites] = useState<SiteInfoResponse[]>([]);
  const [autoMaxChapters, setAutoMaxChapters] = useState(false);
  const [inkittCookieStatus, setInkittCookieStatus] = useState<InkittCookieStatusResponse | null>(null);
  const [isCheckingInkittCookies, setIsCheckingInkittCookies] = useState(false);
  const outputFormat = 'md' as const;

  useEffect(() => {
    listSites()
      .then((sites) => setSupportedSites(sites))
      .catch(() => {
        // ignore — gracefully degrade
      });
  }, []);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setRangeMode(settings.crawl_mode as 'count' | 'range');
        setToChapter(settings.crawl_default_count);
        setRangeFrom(settings.crawl_default_range_from);
        setRangeTo(settings.crawl_default_range_to);
        if (settings.crawl_auto_max_chapters) {
          setAutoMaxChapters(settings.crawl_auto_max_chapters);
        }
      })
      .catch(() => {
        // ignore — use local defaults
      });
  }, []);

  useEffect(() => {
    const retryUrl = searchParams.get('retryUrl');
    const retryRangeFrom = searchParams.get('retryFrom');
    const retryRangeTo = searchParams.get('retryTo');
    const retryLimit = searchParams.get('retryLimit');

    if (retryUrl) {
      setInputUrl(retryUrl);
      detect(retryUrl);
      refresh(retryUrl);
    }
    if (retryRangeFrom && retryRangeTo) {
      setRangeMode('range');
      setRangeFrom(parseInt(retryRangeFrom) || 1);
      setRangeTo(parseInt(retryRangeTo) || 10);
    } else if (retryLimit) {
      setRangeMode('count');
      setToChapter(parseInt(retryLimit) || 10);
    }

    if (retryUrl || retryRangeFrom || retryRangeTo || retryLimit) {
      setSearchParams({});
    }
  }, []);

  useEffect(() => {
    if (!autoMaxChapters || !totalChapterCount || totalChapterCount <= 0) return;
    setToChapter(totalChapterCount);
    setRangeTo(totalChapterCount);
  }, [autoMaxChapters, totalChapterCount]);

  useEffect(() => {
    if (siteInfo?.config_name !== 'inkitt' || !isValid || !inputUrl.trim()) {
      setInkittCookieStatus(null);
      setIsCheckingInkittCookies(false);
      return;
    }

    let cancelled = false;
    setIsCheckingInkittCookies(true);
    setInkittCookieStatus(null);
    checkInkittCookies(inputUrl)
      .then((status) => {
        if (!cancelled) setInkittCookieStatus(status);
      })
      .catch((err) => {
        if (!cancelled) {
          setInkittCookieStatus({
            valid: false,
            reason: 'request_failed',
            message: err instanceof Error ? err.message : 'Could not test saved Inkitt cookies.',
            cookie_count: 0,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingInkittCookies(false);
      });

    return () => {
      cancelled = true;
    };
  }, [siteInfo?.config_name, isValid, inputUrl]);

  const inputsLocked = !isValid;
  const effectiveMax = totalChapterCount ?? 999999;
  const rangeTotal = Math.max(0, rangeTo - rangeFrom + 1);
  const isInkitt = siteInfo?.config_name === 'inkitt';
  const isPaywalled = novelMetadata?.is_paywalled === true;

  const pageBackground = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const activeSurface = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(55,53,47,0.1)';
  const sectionDisabledClass = inputsLocked ? 'opacity-60' : '';

  const handleRangeToChange = (value: number) => {
    const clamped = Math.min(value, effectiveMax);
    setRangeTo(clamped);
  };

  const handleRangeFromChange = (value: number) => {
    const clamped = Math.max(1, Math.min(value, effectiveMax));
    setRangeFrom(clamped);
  };

  const handleToChapterChange = (value: number) => {
    setToChapter(Math.max(1, Math.min(value, effectiveMax)));
  };

  const handleUrlChange = (value: string) => {
    setInputUrl(value);
    detect(value);
    refresh(value);
  };

  const handleCrawlNovel = (maxChapter: number) => {
    setRangeTo(maxChapter);
    setRangeMode('range');
    setRangeFrom(1);
  };

  const handleStart = async () => {
    if (!siteInfo || !slug) {
      setStartError('Please enter a valid novel URL and wait for site detection to complete.');
      return;
    }
    if (isPaywalled) {
      setStartError('Crawling is disabled for this story (paywalled content).');
      return;
    }

    setIsStarting(true);
    setStartError('');
    try {
      const crawlUrl = siteInfo.config_name === 'wattpad' ? resolvedUrl || slug : inputUrl;
      const limit = rangeMode === 'range' ? rangeTotal : toChapter;
      const response = await startCrawl({
        spider_name: siteInfo.config_name,
        site_name: siteInfo.site_name,
        novel: crawlUrl,
        limit,
        output_format: outputFormat,
        novel_name: storyTitle || undefined,
        ...(rangeMode === 'range' && rangeFrom > 0 && rangeTo >= rangeFrom
          ? { chapter_range: `${rangeFrom}-${rangeTo}` }
          : {}),
        completed: novelMetadata?.completed,
        source_url: inputUrl,
      });
      navigate(`/crawl?session=${response.crawl_id}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start crawl');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <main className="space-y-6">
          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Crawl
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                New crawl
              </h1>
              <p className="max-w-3xl text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                Paste a supported novel URL, review the detected metadata, and choose how many chapters to crawl.
              </p>
            </div>
          </section>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-5">
              {isValid && (
                <button
                  onClick={() => setMobileSheetOpen(true)}
                  className="flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-colors lg:hidden"
                  style={{ background: panelBackground, borderColor: panelBorder }}
                >
                  <div
                    className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                    style={{ background: mutedSurface }}
                  >
                    {novelMetadata?.cover_url ? (
                      <img
                        src={novelMetadata.cover_url}
                        alt="Cover"
                        className="h-full w-full rounded-lg object-cover"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <Icon icon={appIcons.bookOpen} className="text-xl" style={{ color: secondaryText }} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" style={{ color: pageText }}>
                      {panelTitle || storyTitle}
                    </p>
                    {totalChapterCount != null && (
                      <p className="text-sm" style={{ color: secondaryText }}>
                        {totalChapterCount.toLocaleString()} chapters
                      </p>
                    )}
                  </div>
                  <Icon icon={appIcons.chevronRight} className="h-5 w-5 shrink-0" style={{ color: secondaryText }} />
                </button>
              )}

              <section
                className="space-y-5 rounded-2xl border px-5 py-5 sm:px-6"
                style={{ background: panelBackground, borderColor: panelBorder }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StepBadge number={1} isDark={isDark} />
                      <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                        Paste a novel URL
                      </h2>
                    </div>
                    <p className="text-sm" style={{ color: secondaryText }}>
                      {supportedSites.length > 0
                        ? `Supported: ${supportedSites.map((site) => site.base_url.replace('https://', '').replace('http://', '')).join(', ')}`
                        : 'Supported: wattpad.com'}
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/batch')}
                    className="rounded-md border px-3 py-2 text-sm transition-colors"
                    style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                    title="Crawl multiple novels at once"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Icon icon={appIcons.list} className="h-4 w-4" />
                      Batch
                    </span>
                  </button>
                </div>

                <div className="space-y-2">
                  <label htmlFor="url-input" className="block text-sm" style={{ color: secondaryText }}>
                    Novel URL
                  </label>
                  <div className="relative">
                    <input
                      id="url-input"
                      type="url"
                      value={inputUrl}
                      onChange={(event) => handleUrlChange(event.target.value)}
                      placeholder="https://www.wattpad.com/... or https://www.inkitt.com/... or https://www.novelworm.com/..."
                      className="w-full rounded-md border px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                      style={{
                        background: mutedSurface,
                        borderColor: panelBorder,
                        color: pageText,
                      }}
                    />
                    {isLoading && (
                      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        <Icon icon={appIcons.spinner} className="h-5 w-5 animate-spin text-indigo-400" />
                      </div>
                    )}
                  </div>
                </div>

                {isValid && siteInfo && (
                  <div
                    className="rounded-xl border px-4 py-4"
                    style={{
                      background: isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.06)',
                      borderColor: isDark ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.16)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Icon icon={appIcons.checkCircle} className="h-5 w-5" style={{ color: isDark ? '#6ee7b7' : '#059669' }} />
                      <span className="font-medium" style={{ color: isDark ? '#6ee7b7' : '#047857' }}>
                        {siteInfo.site_name}
                      </span>
                      {storyTitle && <span style={{ color: secondaryText }}>— {storyTitle}</span>}
                    </div>
                    {siteInfo.config_name === 'wattpad' && resolvedUrl && (
                      <p className="ml-7 mt-2 text-xs" style={{ color: secondaryText }}>
                        {inputUrl.includes('/character')
                          ? 'Character page'
                          : inputUrl.includes('/prologue')
                            ? 'Prologue'
                            : inputUrl.includes('/chapter-')
                              ? 'Chapter page'
                              : 'Story page'}{' '}
                        → Chapter 1
                        {slug && (
                          <span>
                            {' '}(ID: <code style={{ color: isDark ? '#a5b4fc' : '#4f46e5' }}>{slug}</code>)
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <FeedbackBox tone="error" isDark={isDark} icon={appIcons.info}>
                    {error}
                  </FeedbackBox>
                )}

                {isInkitt && (
                  <div
                    className="rounded-xl border px-4 py-4"
                    style={inkittStateStyle(isDark, isCheckingInkittCookies, inkittCookieStatus)}
                  >
                    <div className="flex items-start gap-3">
                      {isCheckingInkittCookies ? (
                        <Icon icon={appIcons.spinner} className="mt-0.5 h-5 w-5 shrink-0 animate-spin" />
                      ) : inkittCookieStatus?.valid === true ? (
                        <Icon icon={appIcons.checkCircle} className="mt-0.5 h-5 w-5 shrink-0" />
                      ) : inkittCookieStatus?.valid === null ? (
                        <Icon icon={appIcons.info} className="mt-0.5 h-5 w-5 shrink-0" />
                      ) : (
                        <Icon icon={appIcons.statusWarning} className="mt-0.5 h-5 w-5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {isCheckingInkittCookies
                            ? 'Checking saved Inkitt cookies...'
                            : inkittCookieStatus?.message || 'Could not test saved Inkitt cookies.'}
                        </p>
                        {!isCheckingInkittCookies && inkittCookieStatus?.valid !== true && (
                          <p className="mt-1 text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(55,53,47,0.6)' }}>
                            Update Inkitt cookies in Settings before crawling login-gated chapters.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section
                className={`space-y-5 rounded-2xl border px-5 py-5 sm:px-6 ${sectionDisabledClass}`}
                style={{ background: panelBackground, borderColor: panelBorder }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StepBadge number={2} isDark={isDark} />
                      <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                        Chapter range
                      </h2>
                    </div>
                    <p className="text-sm" style={{ color: secondaryText }}>
                      {inputsLocked ? 'Paste a novel URL first' : 'Set which chapters to crawl'}
                    </p>
                  </div>
                  {totalChapterCount != null && (
                    <div className="rounded-xl border px-3 py-2 text-right" style={{ borderColor: panelBorder, background: mutedSurface }}>
                      <p className="text-sm font-semibold" style={{ color: pageText }}>
                        {totalChapterCount.toLocaleString()}
                      </p>
                      <p className="text-[10px]" style={{ color: tertiaryText }}>
                        max chapters
                      </p>
                    </div>
                  )}
                </div>

                <div className="inline-flex rounded-xl border p-1" style={{ borderColor: panelBorder, background: mutedSurface }}>
                  <button
                    onClick={() => setRangeMode('count')}
                    disabled={inputsLocked}
                    className="rounded-lg px-4 py-2 text-sm transition-colors"
                    style={{
                      background: rangeMode === 'count' ? activeSurface : 'transparent',
                      color: rangeMode === 'count' ? pageText : secondaryText,
                    }}
                  >
                    Count
                  </button>
                  <button
                    onClick={() => setRangeMode('range')}
                    disabled={inputsLocked}
                    className="rounded-lg px-4 py-2 text-sm transition-colors"
                    style={{
                      background: rangeMode === 'range' ? activeSurface : 'transparent',
                      color: rangeMode === 'range' ? pageText : secondaryText,
                    }}
                  >
                    Range
                  </button>
                </div>

                {rangeMode === 'count' ? (
                  <div className="max-w-xs">
                    <label className="mb-2 block text-sm" style={{ color: secondaryText }}>
                      Max chapters to crawl
                      {totalChapterCount != null && (
                        <span style={{ color: tertiaryText }}> (max: {totalChapterCount.toLocaleString()})</span>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={1}
                        max={effectiveMax}
                        value={toChapter}
                        disabled={inputsLocked}
                        onChange={(event) => handleToChapterChange(parseInt(event.target.value) || 1)}
                        className="w-full rounded-md border px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed"
                        style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                      />
                      {totalChapterCount != null && (
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm" style={{ color: secondaryText }}>
                          / {totalChapterCount.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex w-full max-w-md items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <label className="mb-2 block text-sm" style={{ color: secondaryText }}>
                        From chapter
                        {totalChapterCount != null && (
                          <span style={{ color: tertiaryText }}> (max: {totalChapterCount.toLocaleString()})</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={effectiveMax}
                        value={rangeFrom}
                        disabled={inputsLocked}
                        onChange={(event) => handleRangeFromChange(parseInt(event.target.value) || 1)}
                        className="w-full rounded-md border px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed"
                        style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                      />
                    </div>
                    <span className="pb-3" style={{ color: secondaryText }}>
                      to
                    </span>
                    <div className="flex-1">
                      <label className="mb-2 block text-sm" style={{ color: secondaryText }}>
                        To chapter
                        {totalChapterCount != null && (
                          <span style={{ color: tertiaryText }}> (max: {totalChapterCount.toLocaleString()})</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min={rangeFrom}
                        max={effectiveMax}
                        value={rangeTo}
                        disabled={inputsLocked}
                        onChange={(event) => handleRangeToChange(parseInt(event.target.value) || rangeFrom)}
                        className="w-full rounded-md border px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed"
                        style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <label className="text-sm" style={{ color: secondaryText }}>
                    Format:
                  </label>
                  <span
                    className="inline-flex items-center rounded-md px-3 py-1 text-sm font-medium"
                    style={{ background: activeSurface, border: `1px solid ${panelBorder}`, color: pageText }}
                  >
                    MD
                  </span>
                </div>

                {rangeMode === 'range' && !inputsLocked && (
                  <p className="text-sm" style={{ color: secondaryText }}>
                    Will crawl chapters {rangeFrom}–{rangeTo} ({rangeTotal.toLocaleString()} total)
                  </p>
                )}
              </section>

              {startError && (
                <FeedbackBox tone="error" isDark={isDark} icon={appIcons.info}>
                  {startError}
                </FeedbackBox>
              )}

              <button
                onClick={handleStart}
                disabled={isStarting || !isValid || isPaywalled}
                title={isPaywalled ? 'Crawling disabled — Wattpad Original' : undefined}
                className="flex w-full items-center justify-center gap-2 rounded-md py-3.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed"
                style={{
                  background: isPaywalled || isStarting || !isValid ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.14)') : '#4f46e5',
                  color: isPaywalled || isStarting || !isValid ? secondaryText : '#ffffff',
                  opacity: isStarting ? 0.7 : 1,
                }}
              >
                {isStarting ? (
                  <>
                    <Icon icon={appIcons.spinner} className="h-5 w-5 animate-spin" />
                    Starting crawl...
                  </>
                ) : (
                  <>
                    <Icon icon={appIcons.trends} className="h-5 w-5" />
                    Start crawl
                  </>
                )}
              </button>
            </div>

            <div className="space-y-4 lg:sticky lg:top-6">
              {isValid && (
                <div className="rounded-2xl border p-4" style={{ background: panelBackground, borderColor: panelBorder }}>
                  <NovelInfoPanel
                    storyTitle={panelTitle || storyTitle}
                    siteName={siteInfo?.site_name || null}
                    chapters={chapters}
                    chapterCount={chapterCount}
                    totalChapterCount={totalChapterCount}
                    isLoading={isLoadingChapters}
                    isDetecting={isLoading}
                    error={chaptersError}
                    warning={warning}
                    isChapterUrl={isChapterUrl}
                    novelMetadata={novelMetadata}
                    onCrawlNovel={handleCrawlNovel}
                    isDark={isDark}
                    isResolvingTotal={isResolvingTotal}
                  />
                </div>
              )}
            </div>
          </div>
        </main>

        <MobileBottomSheet
          isOpen={mobileSheetOpen}
          onClose={() => setMobileSheetOpen(false)}
          storyTitle={panelTitle || storyTitle}
          chapters={chapters}
          chapterCount={chapterCount}
          totalChapterCount={totalChapterCount}
          novelMetadata={novelMetadata}
          onCrawlNovel={handleCrawlNovel}
          isDark={isDark}
        />
      </div>
    </div>
  );
}

function StepBadge({ number, isDark }: { number: number; isDark: boolean }) {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-semibold"
      style={{
        background: isDark ? 'rgba(99,102,241,0.16)' : 'rgba(99,102,241,0.12)',
        color: isDark ? '#a5b4fc' : '#4f46e5',
      }}
    >
      {number}
    </span>
  );
}

function FeedbackBox({
  tone,
  isDark,
  icon,
  children,
}: {
  tone: 'error';
  isDark: boolean;
  icon: IconDefinition;
  children: React.ReactNode;
}) {
  const style = tone === 'error'
    ? {
        background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
        borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
        color: isDark ? '#f87171' : '#dc2626',
      }
    : {
        background: 'transparent',
        borderColor: 'transparent',
        color: isDark ? '#f87171' : '#dc2626',
      };

  return (
    <div className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm" style={style}>
      <Icon icon={icon} className="h-5 w-5 shrink-0" />
      {children}
    </div>
  );
}

function inkittStateStyle(
  isDark: boolean,
  isCheckingInkittCookies: boolean,
  inkittCookieStatus: InkittCookieStatusResponse | null,
) {
  if (isCheckingInkittCookies) {
    return {
      background: isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)',
      borderColor: isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.16)',
      color: isDark ? '#a5b4fc' : '#4338ca',
    };
  }
  if (inkittCookieStatus?.valid === true) {
    return {
      background: isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.06)',
      borderColor: isDark ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.16)',
      color: isDark ? '#6ee7b7' : '#047857',
    };
  }
  if (inkittCookieStatus?.valid === null) {
    return {
      background: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.06)',
      borderColor: isDark ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.16)',
      color: isDark ? '#fcd34d' : '#b45309',
    };
  }
  return {
    background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
    borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
    color: isDark ? '#f87171' : '#dc2626',
  };
}
