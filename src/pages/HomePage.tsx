import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startCrawl } from '../api/client';
import { NovelInfoPanel } from '../components/NovelInfoPanel';
import { useSiteDetection } from '../hooks/useSiteDetection';
import { useNovelInfo } from '../hooks/useNovelInfo';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface HomePageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function HomePage({ themeMode, onThemeChange }: HomePageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();
  const { siteInfo, slug, storyTitle, resolvedUrl, isValid, isLoading, error, detect, novelMetadata } = useSiteDetection();
  const { chapters, chapterCount, totalChapterCount, storyTitle: panelTitle, isLoadingChapters, chaptersError, warning, isChapterUrl, refresh } = useNovelInfo();

  const [inputUrl, setInputUrl] = useState('');
  const [toChapter, setToChapter] = useState(10);
  const [rangeFrom, setRangeFrom] = useState(2);
  const [rangeTo, setRangeTo] = useState(6);
  const [rangeMode, setRangeMode] = useState<'count' | 'range'>('count');
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const outputFormat = 'txt' as const;

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
      });
      navigate(`/crawl?session=${res.crawl_id}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start crawl');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-900' : 'bg-gray-50'}`}>
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title={"Single Crawl"}
        subtitle={"Quickly crawl a single novel"}
      />

      <main className="w-full xl:w-[70vw] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">

          {/* Left column */}
          <div className="space-y-6">

            {/* URL Input */}
            <section className={`rounded-xl p-4 sm:p-6 space-y-4 ${isDark
              ? 'bg-slate-800 border border-slate-700'
              : 'bg-white border border-gray-200'
            }`}>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h2 className={`text-base font-medium ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>1. Paste a Novel URL</h2>
                  <p className={`text-xs sm:text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Supported: freewebnovel.com, wattpad.com</p>
                </div>
                <button
                  onClick={() => navigate('/batch')}
                  className={`flex-shrink-0 px-3 py-1.5 text-sm border rounded-lg transition-colors flex items-center gap-1.5 w-full sm:w-auto justify-center sm:justify-start ${isDark
                    ? 'text-indigo-400 hover:text-indigo-300 border-indigo-600/40 hover:bg-indigo-600/10'
                    : 'text-indigo-600 hover:text-indigo-700 border-indigo-300 hover:bg-indigo-50'
                  }`}
                  title="Crawl multiple novels at once"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  Batch
                </button>
              </div>
              <div className="space-y-2">
                <label htmlFor="url-input" className={`block text-sm font-medium ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                  Novel URL
                </label>
                <div className="relative">
                  <input
                    id="url-input"
                    type="url"
                    value={inputUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://freewebnovel.com/novel/martial-peak"
                    className={`w-full px-4 py-3 border rounded-lg
                      focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors
                      ${isDark
                        ? 'bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-500'
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
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

              {isValid && siteInfo && (
                <div className="space-y-1.5">
                  <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>
                      Detected: <span className={`font-medium ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>{siteInfo.site_name}</span>
                      {storyTitle && (
                        <span className={`ml-1 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}> — {storyTitle}</span>
                      )}
                    </span>
                  </div>
                  {siteInfo.config_name === 'wattpad' && resolvedUrl && (
                    <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                      URL type resolved: {inputUrl.includes('/character') ? 'Character page' :
                        inputUrl.includes('/prologue') ? 'Prologue' :
                          inputUrl.includes('/chapter-') ? 'Chapter page' : 'Story page'} &rarr; Chapter 1
                      {slug && <span className="ml-1">(ID: <code className={isDark ? 'text-indigo-300' : 'text-indigo-600'}>{slug}</code>)</span>}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}
            </section>

            {/* Chapter Range */}
            <section className={`rounded-xl p-4 sm:p-6 space-y-4 transition-opacity duration-200 ${inputsLocked ? 'opacity-60' : ''} ${isDark
              ? inputsLocked ? 'bg-slate-800 border border-slate-700' : 'bg-slate-800 border border-slate-700'
              : inputsLocked ? 'bg-white border border-gray-200' : 'bg-white border border-gray-200'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className={`text-base font-medium ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>2. Chapter Range</h2>
                  <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                    {inputsLocked ? 'Paste a novel URL first' : 'Set which chapters to crawl'}
                  </p>
                </div>
                {totalChapterCount != null && (
                  <div className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-right border ${isDark
                    ? 'bg-indigo-900/30 border-indigo-800/40'
                    : 'bg-indigo-50 border-indigo-200'
                  }`}>
                    <p className={`text-xs font-semibold leading-none ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
                      {totalChapterCount.toLocaleString()}
                    </p>
                    <p className={`text-[10px] mt-0.5 leading-none ${isDark ? 'text-indigo-400/70' : 'text-indigo-500/70'}`}>max chapters</p>
                  </div>
                )}
              </div>

              {/* Mode toggle */}
              <div className={`flex items-center gap-1 p-1 rounded-lg w-fit ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>
                <button
                  onClick={() => setRangeMode('count')}
                  disabled={inputsLocked}
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${rangeMode === 'count'
                    ? 'bg-indigo-600 text-white'
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
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${rangeMode === 'range'
                    ? 'bg-indigo-600 text-white'
                    : isDark
                      ? 'text-slate-400 hover:text-slate-200 disabled:opacity-40'
                      : 'text-gray-500 hover:text-gray-700 disabled:opacity-40'
                    }`}
                >
                  Range
                </button>
              </div>

              {rangeMode === 'count' ? (
                <div className="max-w-xs w-full">
                  <label className={`block text-sm mb-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
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
                      className={`w-full px-4 py-2.5 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed
                        focus:outline-none focus:ring-2 focus:ring-indigo-500
                        ${isDark
                          ? 'bg-slate-700 border-slate-600 text-slate-100'
                          : 'bg-white border-gray-300 text-gray-900'
                        }`}
                    />
                    {totalChapterCount != null && (
                      <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
                        / {totalChapterCount.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-3 max-w-sm w-full">
                  <div className="flex-1 min-w-0">
                    <label className={`block text-sm mb-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
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
                      className={`w-full px-4 py-2.5 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed
                        focus:outline-none focus:ring-2 focus:ring-indigo-500
                        ${isDark
                          ? 'bg-slate-700 border-slate-600 text-slate-100'
                          : 'bg-white border-gray-300 text-gray-900'
                        }`}
                    />
                  </div>
                  <span className={`pb-3 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>to</span>
                  <div className="flex-1">
                    <label className={`block text-sm mb-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
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
                      className={`w-full px-4 py-2.5 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed
                        focus:outline-none focus:ring-2 focus:ring-indigo-500
                        ${isDark
                          ? 'bg-slate-700 border-slate-600 text-slate-100'
                          : 'bg-white border-gray-300 text-gray-900'
                        }`}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <label className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>Format:</label>
                <span className="px-3 py-1 text-sm rounded-md bg-indigo-600 text-white">TXT</span>
              </div>

              {rangeMode === 'range' && !inputsLocked && (
                <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                  Will crawl chapters {rangeFrom}&ndash;{rangeTo} ({rangeTotal.toLocaleString()} total)
                </p>
              )}
            </section>

            {/* Start Error */}
            {startError && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${isDark
                ? 'bg-red-900/30 border border-red-800 text-red-400'
                : 'bg-red-50 border border-red-200 text-red-600'
              }`}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className={`w-full py-3.5 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 ${isPaywalled || isStarting || !isValid
                ? isDark
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
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

            {/* Supported Sites */}
            <section className={`rounded-xl p-4 sm:p-6 space-y-3 ${isDark
              ? 'bg-slate-800 border border-slate-700'
              : 'bg-white border border-gray-200'
            }`}>
              <h2 className={`text-sm font-medium ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>Supported Sites</h2>
              <div className={`space-y-2 text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
                  <span className={`font-medium min-w-28 sm:min-w-32 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>freewebnovel.com</span>
                  <code className={`text-xs break-all ${isDark ? 'text-indigo-300' : 'text-indigo-600'}`}>https://freewebnovel.com/novel/martial-peak</code>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
                  <span className={`font-medium min-w-28 sm:min-w-32 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>wattpad.com</span>
                  <code className={`text-xs break-all ${isDark ? 'text-indigo-300' : 'text-indigo-600'}`}>https://www.wattpad.com/1284690197-...-chapter-one</code>
                </div>
              </div>
            </section>
          </div>

          {/* Right column */}
          <div className="space-y-4 lg:sticky lg:top-20">
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
