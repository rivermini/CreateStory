import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listSites, startCrawl, getSettings, checkInkittCookies } from '../api/client';
import type { InkittCookieStatusResponse, SiteInfoResponse } from '../api/client';
import { NovelInfoPanel } from '../components/NovelInfoPanel';
import { MobileBottomSheet } from '../components/MobileBottomSheet';
import { Icon, appIcons } from '../components/Icon';
import { useSiteDetection } from '../hooks/useSiteDetection';
import { useNovelInfo } from '../hooks/useNovelInfo';
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
  const { chapters, chapterCount, totalChapterCount, storyTitle: panelTitle, isLoadingChapters, chaptersError, warning, isChapterUrl, isResolvingTotal, refresh } = useNovelInfo();

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
      .then(sites => setSupportedSites(sites))
      .catch(() => {/* ignore — gracefully degrade */});
  }, []);

  useEffect(() => {
    getSettings()
      .then(s => {
        setRangeMode(s.crawl_mode as 'count' | 'range');
        setToChapter(s.crawl_default_count);
        setRangeFrom(s.crawl_default_range_from);
        setRangeTo(s.crawl_default_range_to);
        if (s.crawl_auto_max_chapters) {
          setAutoMaxChapters(s.crawl_auto_max_chapters);
        }
      })
      .catch(() => {/* ignore — use local defaults */});
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
      .then(status => {
        if (!cancelled) setInkittCookieStatus(status);
      })
      .catch(err => {
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

  const handleRangeToChange = (val: number) => {
    const clamped = Math.min(val, effectiveMax);
    setRangeTo(clamped);
  };

  const handleRangeFromChange = (val: number) => {
    const clamped = Math.max(1, Math.min(val, effectiveMax));
    setRangeFrom(clamped);
  };

  const handleToChapterChange = (val: number) => {
    setToChapter(Math.max(1, Math.min(val, effectiveMax)));
  };

  const handleUrlChange = (val: string) => {
    setInputUrl(val);
    detect(val);
    refresh(val);
  };

  const handleCrawlNovel = (_toChapter: number) => {
    setRangeTo(_toChapter);
    setRangeMode('range');
    setRangeFrom(1);
  };

  const isInkitt = siteInfo?.config_name === 'inkitt';
  const isPaywalled = novelMetadata?.is_paywalled === true;

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
      const crawlUrl = siteInfo.config_name === 'wattpad'
        ? (resolvedUrl || slug)
        : inputUrl;
      const limit = rangeMode === 'range' ? rangeTotal : toChapter;
      const res = await startCrawl({
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
      navigate(`/crawl?session=${res.crawl_id}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start crawl');
    } finally {
      setIsStarting(false);
    }
  };

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

  const pageBg = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)';

  return (
    <div className={`min-h-screen relative overflow-hidden ${val('dark', 'light')}`} style={{ background: pageBg }}>
      {/* Ambient orbs */}
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />

      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <main className="w-full xl:max-w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

          {/* Page Header */}
          <div className="lg-glass-deep px-6 py-5 flex items-start justify-between gap-4">
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold tracking-tight ${c('text')}`}>New Crawl</h1>
              <p className={`text-sm mt-1 ${c('textMuted')}`}>Enter a novel URL to start crawling chapters</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">

            {/* Left column */}
            <div className="space-y-5">

              {/* Mobile: Novel Info Preview */}
              {isValid && (
                <button
                  onClick={() => setMobileSheetOpen(true)}
                  className={`lg:hidden w-full rounded-2xl p-4 flex items-center gap-4 transition-all duration-200 ${c('cardSubtleBg')} border ${c('rowBorder')}`}
                >
                  <div className={`w-12 h-16 rounded-lg flex items-center justify-center flex-shrink-0 ${c('inputBg')}`}>
                    {novelMetadata?.cover_url ? (
                      <img
                        src={novelMetadata.cover_url}
                        alt="Cover"
                        className="w-full h-full rounded-lg object-cover"
                        onError={(e) => e.currentTarget.style.display = 'none'}
                      />
                    ) : (
                      <Icon icon={appIcons.bookOpen} className={`text-xl ${c('textMuted')}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className={`font-semibold truncate ${c('textBodyStrong')}`}>{panelTitle || storyTitle}</p>
                    {totalChapterCount != null && (
                      <p className={`text-sm ${c('textMuted')}`}>{totalChapterCount.toLocaleString()} chapters</p>
                    )}
                  </div>
                  <Icon icon={appIcons.chevronRight} className={`w-5 h-5 flex-shrink-0 ${c('textMuted')}`} />
                </button>
              )}

              {/* URL Input Card */}
              <section className="lg-glass p-5 sm:p-6 space-y-5">
                {/* Card Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${isDark ? 'bg-indigo-600/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}>1</span>
                      <h2 className={`text-base font-semibold ${c('text')}`}>Paste a Novel URL</h2>
                    </div>
                    <p className={`text-xs sm:text-sm ml-8 ${c('textMuted')}`}>
                      {supportedSites.length > 0
                        ? `Supported: ${supportedSites.map(s => s.base_url.replace('https://', '').replace('http://', '')).join(', ')}`
                        : 'Supported: wattpad.com'}
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/batch')}
                    className={`flex-shrink-0 px-3.5 py-2 text-sm font-medium border rounded-xl transition-all duration-200 flex items-center gap-2 ${isDark
                      ? 'text-indigo-400 border-white/[0.08] hover:border-indigo-400/50 hover:bg-indigo-400/10'
                      : 'text-indigo-600 border-black/10 hover:border-indigo-400 hover:bg-indigo-50'
                    }`}
                    title="Crawl multiple novels at once"
                  >
                    <Icon icon={appIcons.list} className="w-4 h-4" />
                    Batch
                  </button>
                </div>

                {/* URL Input */}
                <div className="space-y-2">
                  <label htmlFor="url-input" className={`block text-sm font-medium ${c('textMuted')}`}>Novel URL</label>
                  <div className="relative">
                    <input
                      id="url-input"
                      type="url"
                      value={inputUrl}
                      onChange={(e) => handleUrlChange(e.target.value)}
                      placeholder="https://www.wattpad.com/... or https://www.inkitt.com/... or https://www.novelworm.com/..."
                      className={`w-full px-4 py-3.5 border rounded-xl
                        focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200
                        ${isDark
                          ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder-white/30'
                          : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)] placeholder-[rgba(0,0,0,0.3)]'
                        }`}
                    />
                    {isLoading && (
                      <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                        <Icon icon={appIcons.spinner} className="animate-spin h-5 w-5 text-indigo-400" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Detection Result */}
                {isValid && siteInfo && (
                  <div className={`rounded-xl p-4 space-y-2 ${isDark
                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                    : 'bg-emerald-50 border border-emerald-200'
                  }`}>
                    <div className="flex items-center gap-2">
                      <Icon icon={appIcons.checkCircle} className={`w-5 h-5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
                      <span className={`font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>{siteInfo.site_name}</span>
                      {storyTitle && (
                        <span className={c('textBody')}>— {storyTitle}</span>
                      )}
                    </div>
                    {siteInfo.config_name === 'wattpad' && resolvedUrl && (
                      <p className={`text-xs ml-7 ${c('textMuted')}`}>
                        {inputUrl.includes('/character') ? 'Character page' :
                          inputUrl.includes('/prologue') ? 'Prologue' :
                            inputUrl.includes('/chapter-') ? 'Chapter page' : 'Story page'} &rarr; Chapter 1
                        {slug && <span className="ml-1">(ID: <code className={`${isDark ? 'text-indigo-300' : 'text-indigo-600'} font-mono`}>{slug}</code>)</span>}
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${isDark
                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                    : 'bg-red-50 border border-red-200 text-red-600'
                  }`}>
                    <Icon icon={appIcons.info} className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {isInkitt && (
                  <div className={`rounded-xl p-4 border ${isCheckingInkittCookies
                    ? isDark
                      ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : inkittCookieStatus?.valid === true
                      ? isDark
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : inkittCookieStatus?.valid === null
                        ? isDark
                          ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                          : 'bg-amber-50 border-amber-200 text-amber-700'
                        : isDark
                          ? 'bg-red-500/10 border-red-500/20 text-red-400'
                          : 'bg-red-50 border-red-200 text-red-600'
                  }`}>
                    <div className="flex items-start gap-3">
                      {isCheckingInkittCookies ? (
                        <Icon icon={appIcons.spinner} className="animate-spin w-5 h-5 mt-0.5 flex-shrink-0" />
                      ) : inkittCookieStatus?.valid === true ? (
                        <Icon icon={appIcons.checkCircle} className="w-5 h-5 mt-0.5 flex-shrink-0" />
                      ) : inkittCookieStatus?.valid === null ? (
                        <Icon icon={appIcons.info} className="w-5 h-5 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Icon icon={appIcons.statusWarning} className="w-5 h-5 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {isCheckingInkittCookies ? 'Checking saved Inkitt cookies...' : inkittCookieStatus?.message || 'Could not test saved Inkitt cookies.'}
                        </p>
                        {!isCheckingInkittCookies && inkittCookieStatus?.valid !== true && (
                          <p className={`text-xs mt-1 ${isDark ? 'text-white/45' : 'text-[rgba(0,0,0,0.45)]'}`}>
                            Update Inkitt cookies in Settings before crawling login-gated chapters.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Chapter Range Card */}
              <section className={`lg-glass p-5 sm:p-6 space-y-5 transition-all duration-200 ${inputsLocked ? 'opacity-60' : ''}`}>
                {/* Card Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${isDark ? 'bg-indigo-600/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}>2</span>
                      <h2 className={`text-base font-semibold ${c('text')}`}>Chapter Range</h2>
                    </div>
                    <p className={`text-xs sm:text-sm ml-8 ${c('textMuted')}`}>
                      {inputsLocked ? 'Paste a novel URL first' : 'Set which chapters to crawl'}
                    </p>
                  </div>
                  {totalChapterCount != null && (
                    <div className={`flex-shrink-0 px-3 py-2 rounded-xl text-right ${isDark
                      ? 'bg-indigo-500/10 border border-indigo-500/20'
                      : 'bg-indigo-50 border border-indigo-200'
                    }`}>
                      <p className={`text-sm font-bold leading-none ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>{totalChapterCount.toLocaleString()}</p>
                      <p className={`text-[10px] mt-0.5 leading-none ${isDark ? 'text-indigo-400/70' : 'text-indigo-500/70'}`}>max chapters</p>
                    </div>
                  )}
                </div>

                {/* Mode toggle */}
                <div className={`flex items-center gap-1 p-1 rounded-xl w-fit ${isDark ? 'bg-white/[0.04]' : 'bg-[rgba(0,0,0,0.04)]'}`}>
                  <button
                    onClick={() => setRangeMode('count')}
                    disabled={inputsLocked}
                    className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${rangeMode === 'count'
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : isDark
                        ? 'text-white/40 hover:text-white/70'
                        : 'text-[rgba(0,0,0,0.4)] hover:text-[rgba(0,0,0,0.7)]'
                      }`}
                  >Count</button>
                  <button
                    onClick={() => setRangeMode('range')}
                    disabled={inputsLocked}
                    className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${rangeMode === 'range'
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : isDark
                        ? 'text-white/40 hover:text-white/70'
                        : 'text-[rgba(0,0,0,0.4)] hover:text-[rgba(0,0,0,0.7)]'
                      }`}
                  >Range</button>
                </div>

                {/* Range inputs */}
                {rangeMode === 'count' ? (
                  <div className="max-w-xs w-full">
                    <label className={`block text-sm mb-2 ${c('textMuted')}`}>
                      Max chapters to crawl
                      {totalChapterCount != null && (
                        <span className={`ml-2 text-xs ${c('textSub')}`}>(max: {totalChapterCount.toLocaleString()})</span>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={1}
                        max={effectiveMax}
                        value={toChapter}
                        disabled={inputsLocked}
                        onChange={(e) => handleToChapterChange(parseInt(e.target.value) || 1)}
                        className={`w-full px-4 py-3 border rounded-xl disabled:opacity-50 disabled:cursor-not-allowed
                          focus:outline-none focus:ring-2 focus:ring-indigo-500
                          ${isDark
                            ? 'bg-white/[0.05] border-white/[0.08] text-white/90'
                            : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)]'
                          }`}
                      />
                      {totalChapterCount != null && (
                        <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-sm pointer-events-none ${c('textMuted')}`}>
                          / {totalChapterCount.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-end gap-3 max-w-sm w-full">
                    <div className="flex-1 min-w-0">
                      <label className={`block text-sm mb-2 ${c('textMuted')}`}>
                        From chapter
                        {totalChapterCount != null && (
                          <span className={`ml-2 text-xs ${c('textSub')}`}>(max: {totalChapterCount.toLocaleString()})</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={effectiveMax}
                        value={rangeFrom}
                        disabled={inputsLocked}
                        onChange={(e) => handleRangeFromChange(parseInt(e.target.value) || 1)}
                        className={`w-full px-4 py-3 border rounded-xl disabled:opacity-50 disabled:cursor-not-allowed
                          focus:outline-none focus:ring-2 focus:ring-indigo-500
                          ${isDark
                            ? 'bg-white/[0.05] border-white/[0.08] text-white/90'
                            : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)]'
                          }`}
                      />
                    </div>
                    <span className={`pb-3 font-medium ${c('textMuted')}`}>to</span>
                    <div className="flex-1">
                      <label className={`block text-sm mb-2 ${c('textMuted')}`}>
                        To chapter
                        {totalChapterCount != null && (
                          <span className={`ml-2 text-xs ${c('textSub')}`}>(max: {totalChapterCount.toLocaleString()})</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min={rangeFrom}
                        max={effectiveMax}
                        value={rangeTo}
                        disabled={inputsLocked}
                        onChange={(e) => handleRangeToChange(parseInt(e.target.value) || rangeFrom)}
                        className={`w-full px-4 py-3 border rounded-xl disabled:opacity-50 disabled:cursor-not-allowed
                          focus:outline-none focus:ring-2 focus:ring-indigo-500
                          ${isDark
                            ? 'bg-white/[0.05] border-white/[0.08] text-white/90'
                            : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)]'
                          }`}
                      />
                    </div>
                  </div>
                )}

                {/* Format indicator */}
                <div className="flex items-center gap-3">
                  <label className={`text-sm ${c('textMuted')}`}>Format:</label>
                  <span className="px-3 py-1 text-sm font-semibold rounded-lg bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">MD</span>
                </div>

                {rangeMode === 'range' && !inputsLocked && (
                  <p className={`text-sm ${c('textMuted')}`}>Will crawl chapters {rangeFrom}&ndash;{rangeTo} ({rangeTotal.toLocaleString()} total)</p>
                )}
              </section>

              {/* Start Error */}
              {startError && (
                <div className={`flex items-center gap-3 p-4 rounded-xl text-sm ${isDark
                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                  : 'bg-red-50 border border-red-200 text-red-600'
                }`}>
                  <Icon icon={appIcons.info} className="w-5 h-5 flex-shrink-0" />
                  {startError}
                </div>
              )}

              {/* Start Button */}
              <button
                onClick={handleStart}
                disabled={isStarting || !isValid || isPaywalled}
                title={isPaywalled ? 'Crawling disabled — Wattpad Original' : undefined}
                className={`w-full py-4 font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg ${isPaywalled || isStarting || !isValid
                  ? isDark
                    ? 'bg-white/[0.04] text-white/30 cursor-not-allowed shadow-none border border-white/[0.05]'
                    : 'bg-[rgba(0,0,0,0.04)] text-[rgba(0,0,0,0.3)] cursor-not-allowed shadow-none border border-black/5'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 hover:shadow-xl hover:shadow-indigo-500/40'
                  }`}
              >
                {isStarting ? (
                  <>
                    <Icon icon={appIcons.spinner} className="animate-spin h-5 w-5" />
                    Starting crawl...
                  </>
                ) : (
                  <>
                    <Icon icon={appIcons.trends} className="w-5 h-5" />
                    Start Crawl
                  </>
                )}
              </button>

            </div>

            {/* Right column */}
            <div className="space-y-4 lg:sticky lg:top-6">
              {isValid && (
                <div className="lg-glass p-4 rounded-2xl">
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

        {/* Mobile Bottom Sheet */}
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
