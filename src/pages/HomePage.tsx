import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startCrawl, getSettings } from '../api/client';
import { NovelInfoPanel } from '../components/NovelInfoPanel';
import { useSiteDetection } from '../hooks/useSiteDetection';
import { useNovelInfo } from '../hooks/useNovelInfo';
import { type ThemeMode } from '../components/ThemeToggle';

interface HomePageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function HomePage({ themeMode }: HomePageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();
  const { siteInfo, slug, storyTitle, resolvedUrl, isValid, isLoading, error, detect, novelMetadata } = useSiteDetection();
  const { chapters, chapterCount, totalChapterCount, storyTitle: panelTitle, isLoadingChapters, chaptersError, warning, isChapterUrl, refresh } = useNovelInfo();

  const [inputUrl, setInputUrl] = useState('');
  const [toChapter, setToChapter] = useState(10);
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(10);
  const [rangeMode, setRangeMode] = useState<'count' | 'range'>('count');
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const outputFormat = 'txt' as const;

  // Apply defaults loaded from backend settings on mount
  useEffect(() => {
    getSettings()
      .then(s => {
        setRangeMode(s.crawl_mode as 'count' | 'range');
        setToChapter(s.crawl_default_count);
        setRangeFrom(s.crawl_default_range_from);
        setRangeTo(s.crawl_default_range_to);
      })
      .catch(() => {/* ignore — use local defaults */});
  }, []);

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

  const isPaywalled = novelMetadata?.is_paywalled === true;

  const handleStart = async () => {
    if (!siteInfo || !slug) {
      setStartError('Please enter a valid novel URL and wait for site detection to complete.');
      return;
    }
    if (isPaywalled) {
      setStartError('Crawling is disabled for Wattpad Original stories.');
      return;
    }
    setIsStarting(true);
    setStartError('');
    try {
      const crawlUrl = siteInfo.config_name === 'wattpad' ? (resolvedUrl || slug) : slug;
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

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
      <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            New Crawl
          </h1>
          <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            Enter a novel URL to start crawling chapters
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">

          {/* Left column */}
          <div className="space-y-6">

            {/* URL Input Card */}
            <section className={`rounded-2xl p-5 sm:p-6 space-y-5 ${isDark
              ? 'bg-slate-900/60 border border-slate-800/60'
              : 'bg-white border border-gray-200'
            }`}>
              {/* Card Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${isDark
                      ? 'bg-indigo-600/20 text-indigo-400'
                      : 'bg-indigo-100 text-indigo-600'
                    }`}>
                      1
                    </span>
                    <h2 className={`text-base font-semibold ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>
                      Paste a Novel URL
                    </h2>
                  </div>
                  <p className={`text-xs sm:text-sm ml-8 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                    Supported: wattpad.com
                  </p>
                </div>
                <button
                  onClick={() => navigate('/batch')}
                  className={`flex-shrink-0 px-3.5 py-2 text-sm font-medium border rounded-xl transition-all duration-200 flex items-center gap-2 ${isDark
                    ? 'text-indigo-400 border-indigo-800/50 hover:border-indigo-600 hover:bg-indigo-600/10'
                    : 'text-indigo-600 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50'
                  }`}
                  title="Crawl multiple novels at once"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  Batch
                </button>
              </div>

              {/* URL Input */}
              <div className="space-y-2">
                <label htmlFor="url-input" className={`block text-sm font-medium ${isDark ? 'text-slate-400' : 'text-gray-700'}`}>
                  Novel URL
                </label>
                <div className="relative">
                  <input
                    id="url-input"
                    type="url"
                    value={inputUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://www.wattpad.com/1284690197-...-chapter-one"
                    className={`w-full px-4 py-3.5 border rounded-xl
                      focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200
                      ${isDark
                        ? 'bg-slate-800/60 border-slate-700 text-slate-100 placeholder-slate-500'
                        : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'
                      }`}
                  />
                  {isLoading && (
                    <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                      <svg className="animate-spin h-5 w-5 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>

              {/* Detection Result */}
              {isValid && siteInfo && (
                <div className={`rounded-xl p-4 space-y-2 ${isDark
                  ? 'bg-emerald-900/20 border border-emerald-800/30'
                  : 'bg-emerald-50 border border-emerald-200'
                }`}>
                  <div className="flex items-center gap-2">
                    <svg className={`w-5 h-5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className={`font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                      {siteInfo.site_name}
                    </span>
                    {storyTitle && (
                      <span className={`${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                        — {storyTitle}
                      </span>
                    )}
                  </div>
                  {siteInfo.config_name === 'wattpad' && resolvedUrl && (
                    <p className={`text-xs ml-7 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
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
                  ? 'bg-red-900/20 border border-red-800/30 text-red-400'
                  : 'bg-red-50 border border-red-200 text-red-600'
                }`}>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}
            </section>

            {/* Chapter Range Card */}
            <section className={`rounded-2xl p-5 sm:p-6 space-y-5 transition-all duration-200 ${inputsLocked ? 'opacity-60' : ''} ${isDark
              ? 'bg-slate-900/60 border border-slate-800/60'
              : 'bg-white border border-gray-200'
            }`}>
              {/* Card Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${isDark
                      ? 'bg-indigo-600/20 text-indigo-400'
                      : 'bg-indigo-100 text-indigo-600'
                    }`}>
                      2
                    </span>
                    <h2 className={`text-base font-semibold ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>
                      Chapter Range
                    </h2>
                  </div>
                  <p className={`text-xs sm:text-sm ml-8 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                    {inputsLocked ? 'Paste a novel URL first' : 'Set which chapters to crawl'}
                  </p>
                </div>
                {totalChapterCount != null && (
                  <div className={`flex-shrink-0 px-3 py-2 rounded-xl text-right ${isDark
                    ? 'bg-indigo-900/30 border border-indigo-800/40'
                    : 'bg-indigo-50 border border-indigo-200'
                  }`}>
                    <p className={`text-sm font-bold leading-none ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
                      {totalChapterCount.toLocaleString()}
                    </p>
                    <p className={`text-[10px] mt-0.5 leading-none ${isDark ? 'text-indigo-400/70' : 'text-indigo-500/70'}`}>max chapters</p>
                  </div>
                )}
              </div>

              {/* Mode toggle */}
              <div className={`flex items-center gap-1 p-1 rounded-xl w-fit ${isDark ? 'bg-slate-800/80' : 'bg-gray-100'}`}>
                <button
                  onClick={() => setRangeMode('count')}
                  disabled={inputsLocked}
                  className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${rangeMode === 'count'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                    : isDark
                      ? 'text-slate-400 hover:text-slate-200 disabled:opacity-40'
                      : 'text-gray-500 hover:text-gray-700 disabled:opacity-40'
                    }`}
                >
                  Count
                </button>
                <button
                  onClick={() => setRangeMode('range')}
                  disabled={inputsLocked}
                  className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${rangeMode === 'range'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                    : isDark
                      ? 'text-slate-400 hover:text-slate-200 disabled:opacity-40'
                      : 'text-gray-500 hover:text-gray-700 disabled:opacity-40'
                    }`}
                >
                  Range
                </button>
              </div>

              {/* Range inputs */}
              {rangeMode === 'count' ? (
                <div className="max-w-xs w-full">
                  <label className={`block text-sm mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                    Max chapters to crawl
                    {totalChapterCount != null && (
                      <span className={`ml-2 text-xs ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>(max: {totalChapterCount.toLocaleString()})</span>
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
                          ? 'bg-slate-800/60 border-slate-700 text-slate-100'
                          : 'bg-gray-50 border-gray-300 text-gray-900'
                        }`}
                    />
                    {totalChapterCount != null && (
                      <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-sm pointer-events-none ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
                        / {totalChapterCount.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-3 max-w-sm w-full">
                  <div className="flex-1 min-w-0">
                    <label className={`block text-sm mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                      From chapter
                      {totalChapterCount != null && (
                        <span className={`ml-2 text-xs ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>(max: {totalChapterCount.toLocaleString()})</span>
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
                          ? 'bg-slate-800/60 border-slate-700 text-slate-100'
                          : 'bg-gray-50 border-gray-300 text-gray-900'
                        }`}
                    />
                  </div>
                  <span className={`pb-3 font-medium ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>to</span>
                  <div className="flex-1">
                    <label className={`block text-sm mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                      To chapter
                      {totalChapterCount != null && (
                        <span className={`ml-2 text-xs ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>(max: {totalChapterCount.toLocaleString()})</span>
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
                          ? 'bg-slate-800/60 border-slate-700 text-slate-100'
                          : 'bg-gray-50 border-gray-300 text-gray-900'
                        }`}
                    />
                  </div>
                </div>
              )}

              {/* Format indicator */}
              <div className="flex items-center gap-3">
                <label className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>Format:</label>
                <span className="px-3 py-1 text-sm font-semibold rounded-lg bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">TXT</span>
              </div>

              {rangeMode === 'range' && !inputsLocked && (
                <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                  Will crawl chapters {rangeFrom}&ndash;{rangeTo} ({rangeTotal.toLocaleString()} total)
                </p>
              )}
            </section>

            {/* Start Error */}
            {startError && (
              <div className={`flex items-center gap-3 p-4 rounded-xl text-sm ${isDark
                ? 'bg-red-900/20 border border-red-800/30 text-red-400'
                : 'bg-red-50 border border-red-200 text-red-600'
              }`}>
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
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
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 hover:shadow-xl hover:shadow-indigo-500/40'
                }`}
            >
              {isStarting ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Starting crawl...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Start Crawl
                </>
              )}
            </button>

          </div>

          {/* Right column */}
          <div className="space-y-4 lg:sticky lg:top-6">
            {isValid && (
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
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
