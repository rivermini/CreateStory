import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startBatchCrawl, type CrawlRequest, detectSite, getNovelChapters, listSites, type NovelMetadata, type SiteInfoResponse } from '../api/client';
import { Icon, appIcons } from '../components/Icon';
import type { ThemeMode } from '../types/theme';

interface BatchPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

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

export function BatchPage({ themeMode }: BatchPageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();
  const [entries, setEntries] = useState<BatchEntry[]>([createEntry(1, ''), createEntry(2, '')]);
  const [nextId, setNextId] = useState(3);
  const outputFormat = 'md' as const;
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [supportedSites, setSupportedSites] = useState<SiteInfoResponse[]>([]);

  useEffect(() => {
    listSites()
      .then(sites => setSupportedSites(sites))
      .catch(() => {/* ignore */});
  }, []);

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
          : e.url;
        return {
          spider_name: e.siteInfo!.config_name,
          site_name: e.siteInfo!.site_name,
          novel: crawlUrl,
          limit: e.totalChapterCount ?? 99999,
          output_format: outputFormat,
          novel_name: e.storyTitle || undefined,
          completed: e.novelMetadata?.completed,
          chapter_range: e.chapterRange || undefined,
          source_url: e.url,
        };
      });

      await startBatchCrawl(requests);
      navigate('/results/all');
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start batch crawl');
      setIsStarting(false);
    }
  };

  const validCount = entries.filter(e => e.isValid && !e.novelMetadata?.is_paywalled).length;
  const totalChapters = entries.reduce((sum, e) => sum + (e.totalChapterCount ?? 0), 0);
  const anyLoading = entries.some(e => e.isLoading);

  const val = (dark: string, light: string) => isDark ? dark : light;
  const c = (key: string) => {
    const map: Record<string, [string, string]> = {
      bg: ['bg-[#0a0a14]', 'bg-[#e8e4f8]'],
      bgAlt: ['bg-[#0f0f1e]', 'bg-[#f0e8f8]'],
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
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />

      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <main className="w-full xl:max-w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">

          {/* Page Header */}
          <div className="lg-glass-deep px-6 py-5 flex items-start justify-between gap-4">
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold tracking-tight ${c('text')}`}>Batch Crawl</h1>
              <p className={`text-sm mt-1 ${c('textMuted')}`}>Crawl multiple novels at once</p>
            </div>
          </div>

          {/* Summary bar */}
          <div className={`lg-glass p-4 flex flex-wrap items-center gap-4`}>
            <div className="flex items-center gap-2 text-sm">
              <span className={c('textMuted')}>URLs:</span>
              <span className={`font-semibold ${c('textBodyStrong')}`}>{entries.length}</span>
            </div>
            <div className={`w-px h-5 hidden sm:block ${c('divider')}`} />
            <div className="flex items-center gap-2 text-sm">
              <span className={c('textMuted')}>Valid:</span>
              <span className={`font-semibold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{validCount}</span>
            </div>
            <div className={`w-px h-5 hidden sm:block ${c('divider')}`} />
            <div className="flex items-center gap-2 text-sm">
              <span className={c('textMuted')}>Total chapters:</span>
              <span className={`font-semibold ${c('textBodyStrong')}`}>{totalChapters.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 text-xs ml-auto">
              <span className={c('textSub')}>Press Enter to detect</span>
            </div>
          </div>

          {/* URL entries */}
          <section className="lg-glass p-5 sm:p-6 space-y-4">
            <h2 className={`text-base font-semibold ${c('text')}`}>Novel URLs</h2>

            {entries.map((entry, idx) => {
              const isPaywalled = entry.novelMetadata?.is_paywalled === true;
              return (
                <div key={entry.id}>
                  <div className="flex items-center gap-3">
                    {/* Entry number */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${isDark
                      ? 'bg-white/[0.04] border border-white/[0.06]'
                      : 'bg-[rgba(0,0,0,0.04)] border border-black/5'
                    }`}>
                      <span className={`text-sm font-bold ${c('textMuted')}`}>{idx + 1}</span>
                    </div>

                    {/* URL input */}
                    <div className="relative flex-1">
                      <input
                        type="url"
                        value={entry.url}
                        onChange={e => handleUrlChange(entry.id, e.target.value)}
                        onBlur={() => handleDetectEntry(entry)}
                        onKeyDown={e => handleUrlKeyDown(e, entry)}
                        placeholder={supportedSites.length > 0
                          ? `https://www.${supportedSites[0]?.base_url.replace('https://', '').replace('http://', '') || 'wattpad.com'}/...`
                          : 'https://www.wattpad.com/... or https://www.novelworm.com/...'}
                        className={`w-full px-4 py-3 border rounded-xl text-sm transition-all duration-200
                          focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                          ${isDark
                            ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder-white/30'
                            : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)] placeholder-[rgba(0,0,0,0.3)]'
                          }`}
                      />
                      {entry.isLoading && (
                        <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                          <Icon icon={appIcons.refresh} className="animate-spin h-4 w-4 text-indigo-400" />
                        </div>
                      )}
                    </div>

                    {/* Status icon */}
                    {!entry.isLoading && entry.isValid && !isPaywalled && (
                      <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${isDark
                        ? 'bg-emerald-500/10 border border-emerald-500/20'
                        : 'bg-emerald-50 border border-emerald-200'
                      }`} title="Valid">
                        <Icon icon={appIcons.success} className={`w-4 h-4 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
                      </div>
                    )}
                    {!entry.isLoading && entry.isValid && entry.novelMetadata?.is_paywalled && (
                      <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${isDark
                        ? 'bg-amber-500/10 border border-amber-500/20'
                        : 'bg-amber-50 border border-amber-200'
                      }`} title="Paywalled">
                        <Icon icon={appIcons.paywall} className={`w-4 h-4 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
                      </div>
                    )}
                    {!entry.isLoading && entry.error && (
                      <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${isDark
                        ? 'bg-red-500/10 border border-red-500/20'
                        : 'bg-red-50 border border-red-200'
                      }`} title={entry.error}>
                        <Icon icon={appIcons.close} className={`w-4 h-4 ${isDark ? 'text-red-400' : 'text-red-600'}`} />
                      </div>
                    )}

                    {/* Remove */}
                    {entries.length > 2 && (
                      <button
                        onClick={() => handleRemoveEntry(entry.id)}
                        className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl transition-colors ${isDark
                          ? 'text-white/30 hover:text-red-400 hover:bg-red-500/10'
                          : 'text-[rgba(0,0,0,0.3)] hover:text-red-600 hover:bg-red-50'
                        }`}
                        title="Remove"
                      >
                        <Icon icon={appIcons.close} className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {entry.isValid && !isPaywalled && (
                    <div className="ml-11 flex items-center gap-3 py-2">
                      <label className={`text-xs ${c('textMuted')}`}>Range (optional):</label>
                      <input
                        type="text"
                        value={entry.chapterRange}
                        onChange={e => updateEntry(entry.id, { chapterRange: e.target.value })}
                        placeholder="e.g. 1-100 or 50-75"
                        className={`px-3 py-1.5 border rounded-xl text-xs transition-colors
                          focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                          w-36 ${isDark
                            ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder-white/30'
                            : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)] placeholder-[rgba(0,0,0,0.3)]'
                          }`}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={handleAddEntry}
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${isDark
                ? 'text-indigo-400 hover:text-indigo-300'
                : 'text-indigo-600 hover:text-indigo-700'
              }`}
            >
              <Icon icon={appIcons.add} className="w-4 h-4" />
              Add another URL
            </button>
          </section>

          {/* Detection results */}
          {entries.some(e => e.isValid || e.error) && (
            <section className="lg-glass p-5 sm:p-6 space-y-3">
              <h2 className={`text-sm font-semibold ${c('textBodyStrong')}`}>Detection Results</h2>
              {entries.map((entry, idx) => {
                const isPaywalled = entry.novelMetadata?.is_paywalled === true;
                return (
                  <div key={entry.id} className={`flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 text-sm py-2 border-b last:border-0 ${c('rowBorder')}`}>
                    <span className={`w-5 text-xs font-mono ${c('textMuted')}`}>{idx + 1}.</span>
                    {entry.isValid ? (
                      <>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isPaywalled ? (isDark ? 'bg-amber-400' : 'bg-amber-500') : (isDark ? 'bg-emerald-400' : 'bg-emerald-500')}`} />
                        <span className={`font-medium truncate max-w-[120px] sm:max-w-none ${c('textBodyStrong')}`}>{entry.siteInfo?.site_name}</span>
                        {entry.storyTitle && <span className={`truncate max-w-[150px] sm:max-w-[200px] ${c('textMuted')}`}>— {entry.storyTitle}</span>}
                        {entry.totalChapterCount != null && (
                          <span className={`ml-auto text-xs ${c('textMuted')}`}>{entry.totalChapterCount.toLocaleString()} ch</span>
                        )}
                        {isPaywalled && (
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${isDark
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-amber-100 text-amber-700 border-amber-200'
                          }`}>Paywalled</span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isDark ? 'bg-red-400' : 'bg-red-500'}`} />
                        <span className={`truncate flex-1 ${c('textMuted')}`}>{entry.url}</span>
                        <span className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{entry.error}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* Output format */}
          <section className="lg-glass p-5 sm:p-6 space-y-3">
            <h2 className={`text-base font-semibold ${c('text')}`}>Output Format</h2>
            <p className={`text-sm ${c('textMuted')}`}>Applied to all novels in this batch</p>
            <div className="flex items-center gap-3">
              <label className={`text-sm ${c('textMuted')}`}>Format:</label>
              <span className="px-3 py-1 text-sm font-semibold rounded-lg bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">MD</span>
            </div>
          </section>

          {/* Error */}
          {startError && (
            <div className={`flex items-center gap-3 p-4 rounded-xl text-sm ${isDark
              ? 'bg-red-500/10 border border-red-500/20 text-red-400'
              : 'bg-red-50 border border-red-200 text-red-600'
            }`}>
              <Icon icon={appIcons.error} className="w-5 h-5 flex-shrink-0" />
              {startError}
            </div>
          )}

          {/* Start button */}
          <button
            onClick={handleStart}
            disabled={isStarting || validCount === 0 || anyLoading}
            className={`w-full py-4 font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg ${isStarting || validCount === 0 || anyLoading
              ? isDark
                ? 'bg-white/[0.04] text-white/30 cursor-not-allowed shadow-none border border-white/[0.05]'
                : 'bg-[rgba(0,0,0,0.04)] text-[rgba(0,0,0,0.3)] cursor-not-allowed shadow-none border border-black/5'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 hover:shadow-xl hover:shadow-indigo-500/40'
            }`}
          >
            {isStarting ? (
              <>
                <Icon icon={appIcons.refresh} className="animate-spin h-5 w-5" />
                Starting {validCount} crawl{validCount !== 1 ? 's' : ''}...
              </>
            ) : (
              <>
                <Icon icon={appIcons.autoAudio} className="w-5 h-5" />
                Crawl All ({validCount} novel{validCount !== 1 ? 's' : ''})
              </>
            )}
          </button>

          {validCount === 0 && !anyLoading && (
            <p className={`text-xs text-center ${c('textSub')}`}>
              Detect all URLs first by pressing Enter in each field or clicking outside.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
