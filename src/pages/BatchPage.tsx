import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { startBatchCrawl, type CrawlRequest, detectSite, getNovelChapters, type NovelMetadata } from '../api/client';
// import { AppIcon } from '../components/AppIcon';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface BatchPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BatchEntry {
  id: number;
  url: string;
  siteInfo: { config_name: string; site_name: string } | null;
  slug: string;
  storyTitle: string;
  resolvedUrl: string;
  isValid: boolean;
  isLoading: boolean;
  error: string;
  novelMetadata: NovelMetadata | null;
  totalChapterCount: number | null;
  chapterRange: string;
}

// ---------------------------------------------------------------------------
// BatchPage
// ---------------------------------------------------------------------------

export function BatchPage({ themeMode, onThemeChange }: BatchPageProps) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<BatchEntry[]>([createEntry(1, ''), createEntry(2, '')]);
  const [nextId, setNextId] = useState(3);
  const outputFormat = 'txt' as const;
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState('');

  function createEntry(id: number, url: string): BatchEntry {
    return {
      id,
      url,
      siteInfo: null,
      slug: '',
      storyTitle: '',
      resolvedUrl: '',
      isValid: false,
      isLoading: false,
      error: '',
      novelMetadata: null,
      totalChapterCount: null,
      chapterRange: '',
    };
  }

  const updateEntry = useCallback((id: number, patch: Partial<BatchEntry>) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }, []);

  const handleUrlChange = useCallback((id: number, val: string) => {
    updateEntry(id, { url: val, isLoading: true, error: '', isValid: false, siteInfo: null, slug: '', storyTitle: '', resolvedUrl: '', novelMetadata: null, totalChapterCount: null });
  }, [updateEntry]);

  const handleAddEntry = () => {
    setEntries(prev => [...prev, createEntry(nextId, '')]);
    setNextId(n => n + 1);
  };

  const handleRemoveEntry = (id: number) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const handleDetectEntry = useCallback(async (entry: BatchEntry) => {
    if (!entry.url.trim()) return;

    updateEntry(entry.id, { isLoading: true, error: '' });

    try {
      const [siteResult, chaptersResult] = await Promise.all([
        detectSite(entry.url),
        getNovelChapters(entry.url),
      ]);

      const { site, slug, valid, message, story_title, resolved_url, novel_metadata } = siteResult;
      const isValid = valid && site !== null && slug !== null;

      const totalChapterCount = chaptersResult.total_chapter_count ?? chaptersResult.chapter_count ?? null;
      let error = '';
      if (!isValid) error = message || 'URL not recognized';

      updateEntry(entry.id, {
        isLoading: false,
        isValid,
        error,
        siteInfo: site,
        slug: slug ?? '',
        storyTitle: story_title ?? '',
        resolvedUrl: resolved_url ?? '',
        novelMetadata: novel_metadata ?? null,
        totalChapterCount,
      });
    } catch (err) {
      updateEntry(entry.id, {
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to detect site',
        isValid: false,
      });
    }
  }, [updateEntry]);

  const handleUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, entry: BatchEntry) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleDetectEntry(entry);
    }
  };

  const handleStart = async () => {
    const validEntries = entries.filter(e => e.isValid && !e.novelMetadata?.is_paywalled);

    if (validEntries.length === 0) {
      setStartError('No valid URLs detected yet. Detect each URL first by pressing Enter or clicking outside.');
      return;
    }

    setIsStarting(true);
    setStartError('');

    try {
      const requests: CrawlRequest[] = validEntries.map(e => {
        const crawlUrl = e.siteInfo!.config_name === 'wattpad'
          ? (e.resolvedUrl || e.slug)
          : e.slug;

        return {
          spider_name: e.siteInfo!.config_name,
          site_name: e.siteInfo!.site_name,
          novel: crawlUrl,
          limit: e.totalChapterCount ?? 99999,
          output_format: outputFormat,
          novel_name: e.storyTitle || undefined,
          completed: e.novelMetadata?.completed,
          chapter_range: e.chapterRange || undefined,
        };
      });

      await startBatchCrawl(requests);
      navigate('/results/all');
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start batch crawl');
      setIsStarting(false);
    }
  };

  const validCount = entries.filter(e => e.isValid && !e.novelMetadata?.['is_paywalled']).length;
  const totalChapters = entries.reduce((sum, e) => sum + (e.totalChapterCount ?? 0), 0);
  const anyLoading = entries.some(e => e.isLoading);

  return (
    <div className="min-h-screen bg-slate-900">
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title={"Batch Crawl"}
        subtitle={"Crawl multiple novels at once"}
        rightActions={<>
          {/* Single Crawl button removed; use floating New Crawl button */}
        </>}
      />

      <main className="w-full xl:w-[70vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
        {/* Summary bar */}
        <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-800 border border-slate-700 rounded-xl">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-slate-400">URLs:</span>
            <span className="font-semibold text-slate-200">{entries.length}</span>
          </div>
          <div className="w-px h-4 bg-slate-700 hidden sm:block" />
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-slate-400">Valid:</span>
            <span className="font-semibold text-emerald-400">{validCount}</span>
          </div>
          <div className="w-px h-4 bg-slate-700 hidden sm:block" />
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-slate-400">Total chapters:</span>
            <span className="font-semibold text-slate-200">{totalChapters.toLocaleString()}</span>
          </div>
          <div className="w-full sm:w-auto flex items-center gap-2 text-xs text-slate-500 sm:ml-auto">
            <span>Press Enter to detect</span>
          </div>
        </div>

        {/* URL entries */}
        <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-3">
          <h2 className="text-base font-medium text-slate-200">Novel URLs</h2>

          {entries.map((entry, idx) => {
            const isPaywalled = entry.novelMetadata?.['is_paywalled'] === true;
            return (
              <div key={entry.id}>
                <div className="flex items-center gap-2">
                  {/* Entry number */}
                  <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-700 border border-slate-600 flex items-center justify-center">
                    <span className="text-xs font-bold text-slate-400">{idx + 1}</span>
                  </div>

                  {/* URL input */}
                  <div className="relative flex-1">
                    <input
                      type="url"
                      value={entry.url}
                      onChange={e => handleUrlChange(entry.id, e.target.value)}
                      onBlur={() => handleDetectEntry(entry)}
                      onKeyDown={e => handleUrlKeyDown(e, entry)}
                      placeholder="https://freewebnovel.com/novel/martial-peak"
                      className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg
                               text-slate-100 placeholder-slate-500
                               focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                               transition-colors text-sm"
                    />
                    {entry.isLoading && (
                      <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                        <svg className="animate-spin h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Status icon */}
                  {!entry.isLoading && entry.isValid && !isPaywalled && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center" title="Valid">
                      <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                  {!entry.isLoading && entry.isValid && entry.novelMetadata?.is_paywalled && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-600/30 border border-amber-500/40 flex items-center justify-center" title="Paywalled">
                      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                  )}
                  {!entry.isLoading && entry.error && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-600/30 border border-red-500/40 flex items-center justify-center" title={entry.error}>
                      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  )}

                  {/* Remove */}
                  {entries.length > 2 && (
                    <button
                      onClick={() => handleRemoveEntry(entry.id)}
                      className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors"
                      title="Remove"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {entry.isValid && !isPaywalled && (
                  <div className="ml-7 flex items-center gap-2 py-2">
                    <label className="text-xs text-slate-400">Range (optional):</label>
                    <input
                      type="text"
                      value={entry.chapterRange}
                      onChange={e => updateEntry(entry.id, { chapterRange: e.target.value })}
                      placeholder="e.g. 1-100 or 50-75"
                      className="px-2.5 py-1.5 bg-slate-700 border border-slate-600 rounded-lg
                               text-slate-100 placeholder-slate-500 text-xs
                               focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                               transition-colors w-32"
                    />
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={handleAddEntry}
            className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add another URL
          </button>
        </section>

        {/* Detection results */}
        {entries.some(e => e.isValid || e.error) && (
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-2">
            <h2 className="text-sm font-medium text-slate-300 mb-3">Detection Results</h2>
            {entries.map((entry, idx) => {
              const isPaywalled = entry.novelMetadata?.is_paywalled === true;
              return (
                <div key={entry.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-slate-700 last:border-0">
                  <span className="w-5 text-xs text-slate-500 font-mono">{idx + 1}.</span>
                  {entry.isValid ? (
                    <>
                      <span className={`flex-shrink-0 w-2 h-2 rounded-full ${isPaywalled ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                      <span className="font-medium text-slate-200">{entry.siteInfo?.site_name}</span>
                      {entry.storyTitle && <span className="text-slate-400">— {entry.storyTitle}</span>}
                      {entry.totalChapterCount != null && (
                        <span className="ml-auto text-xs text-slate-500">{entry.totalChapterCount.toLocaleString()} ch</span>
                      )}
                      {isPaywalled && (
                        <span className="px-1.5 py-0.5 bg-amber-600/20 border border-amber-500/40 rounded text-[10px] font-semibold text-amber-400">Paywalled</span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-red-400" />
                      <span className="text-slate-400 truncate flex-1">{entry.url}</span>
                      <span className="text-red-400 text-xs">{entry.error}</span>
                    </>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* Output format */}
        <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-3">
          <h2 className="text-base font-medium text-slate-200">Output Format</h2>
          <p className="text-sm text-slate-500">Applied to all novels in this batch</p>
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-400">Format:</label>
            <span className="px-3 py-1 text-sm rounded-md bg-indigo-600 text-white">TXT</span>
          </div>
        </section>

        {/* Error */}
        {startError && (
          <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {startError}
          </div>
        )}

        {/* Start button */}
        <button
          onClick={handleStart}
          disabled={isStarting || validCount === 0 || anyLoading}
          className="w-full py-3.5 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed"
        >
          {isStarting ? (
            <>
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Starting {validCount} crawl{validCount !== 1 ? 's' : ''}...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Crawl All ({validCount} novel{validCount !== 1 ? 's' : ''})
            </>
          )}
        </button>

        {validCount === 0 && !anyLoading && (
          <p className="text-xs text-slate-500 text-center">
            Detect all URLs first by pressing Enter in each field or clicking outside.
          </p>
        )}
      </main>
    </div>
  );
}
