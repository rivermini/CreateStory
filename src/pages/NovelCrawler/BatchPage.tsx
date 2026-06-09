import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  detectSite,
  getNovelChapters,
  listSites,
  startBatchCrawl,
  type CrawlRequest,
  type NovelMetadata,
  type SiteInfoResponse,
} from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';
import type { ThemeMode } from '../../types/theme';

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
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [supportedSites, setSupportedSites] = useState<SiteInfoResponse[]>([]);

  const pageBackground = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const activeSurface = isDark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)';

  useEffect(() => {
    listSites()
      .then((sites) => setSupportedSites(sites))
      .catch(() => {
        // ignore
      });
  }, []);

  const updateEntry = useCallback((id: number, patch: Partial<BatchEntry>) => {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const handleUrlChange = useCallback(
    (id: number, value: string) => {
      updateEntry(id, {
        url: value,
        isLoading: true,
        error: '',
        isValid: false,
        siteInfo: null,
        slug: '',
        storyTitle: '',
        resolvedUrl: '',
        novelMetadata: null,
        totalChapterCount: null,
      });
    },
    [updateEntry],
  );

  const handleAddEntry = () => {
    setEntries((prev) => [...prev, createEntry(nextId, '')]);
    setNextId((id) => id + 1);
  };

  const handleRemoveEntry = (id: number) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const handleDetectEntry = useCallback(
    async (entry: BatchEntry) => {
      if (!entry.url.trim()) return;
      updateEntry(entry.id, { isLoading: true, error: '' });

      try {
        const [siteResult, chaptersResult] = await Promise.all([detectSite(entry.url), getNovelChapters(entry.url)]);

        const { site, slug, valid, message, story_title, resolved_url, novel_metadata } = siteResult;
        const isValid = valid && site !== null && slug !== null;
        const totalChapterCount =
          chaptersResult.total_chapter_count ?? chaptersResult.chapter_count ?? null;
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
    },
    [updateEntry],
  );

  const handleUrlKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, entry: BatchEntry) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleDetectEntry(entry);
    }
  };

  const handleStart = async () => {
    const validEntries = entries.filter((entry) => entry.isValid && !entry.novelMetadata?.is_paywalled);
    if (validEntries.length === 0) {
      setStartError('No valid URLs detected yet. Detect each URL first by pressing Enter or clicking outside.');
      return;
    }

    setIsStarting(true);
    setStartError('');

    try {
      const requests: CrawlRequest[] = validEntries.map((entry) => {
        const crawlUrl =
          entry.siteInfo!.config_name === 'wattpad' ? entry.resolvedUrl || entry.slug : entry.url;
        return {
          spider_name: entry.siteInfo!.config_name,
          site_name: entry.siteInfo!.site_name,
          novel: crawlUrl,
          limit: entry.totalChapterCount ?? 99999,
          output_format: 'md' as const,
          novel_name: entry.storyTitle || undefined,
          completed: entry.novelMetadata?.completed,
          chapter_range: entry.chapterRange || undefined,
          source_url: entry.url,
        };
      });

      await startBatchCrawl(requests);
      navigate('/results/all');
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start batch crawl');
      setIsStarting(false);
    }
  };

  const validCount = entries.filter((entry) => entry.isValid && !entry.novelMetadata?.is_paywalled).length;
  const totalChapters = entries.reduce((sum, entry) => sum + (entry.totalChapterCount ?? 0), 0);
  const anyLoading = entries.some((entry) => entry.isLoading);

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <main className="space-y-5">
          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Crawl
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                Batch crawl
              </h1>
              <p className="text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                Add multiple novel URLs, detect each one, and crawl them all in a single batch.
              </p>
            </div>
          </section>

          <div
            className="flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-3"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: secondaryText }}>URLs:</span>
              <span className="font-semibold" style={{ color: pageText }}>
                {entries.length}
              </span>
            </div>
            <div className="hidden h-5 sm:block" style={{ width: '1px', background: panelBorder }} />
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: secondaryText }}>Valid:</span>
              <span className="font-semibold" style={{ color: isDark ? '#6ee7b7' : '#047857' }}>
                {validCount}
              </span>
            </div>
            <div className="hidden h-5 sm:block" style={{ width: '1px', background: panelBorder }} />
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: secondaryText }}>Total chapters:</span>
              <span className="font-semibold" style={{ color: pageText }}>
                {totalChapters.toLocaleString()}
              </span>
            </div>
            <div className="ml-auto text-xs" style={{ color: tertiaryText }}>
              Press Enter to detect
            </div>
          </div>

          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <h2 className="mb-4 text-base font-semibold" style={{ color: pageText }}>
              Novel URLs
            </h2>

            <div className="space-y-4">
              {entries.map((entry, index) => {
                const isPaywalled = entry.novelMetadata?.is_paywalled === true;
                return (
                  <div key={entry.id}>
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                        style={{ background: mutedSurface, border: `1px solid ${panelBorder}`, color: secondaryText }}
                      >
                        {index + 1}
                      </div>

                      <div className="relative flex-1">
                        <input
                          type="url"
                          value={entry.url}
                          onChange={(event) => handleUrlChange(entry.id, event.target.value)}
                          onBlur={() => handleDetectEntry(entry)}
                          onKeyDown={(event) => handleUrlKeyDown(event, entry)}
                          placeholder={
                            supportedSites.length > 0
                              ? `https://www.${supportedSites[0]?.base_url.replace('https://', '').replace('http://', '')}/...`
                              : 'https://www.wattpad.com/... or https://www.novelworm.com/...'
                          }
                          className="w-full rounded-md border px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                          style={{
                            background: mutedSurface,
                            borderColor: panelBorder,
                            color: pageText,
                          }}
                        />
                        {entry.isLoading && (
                          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                            <Icon icon={appIcons.refresh} className="h-4 w-4 animate-spin text-indigo-400" />
                          </div>
                        )}
                      </div>

                      {!entry.isLoading && entry.isValid && !isPaywalled && (
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                          style={{
                            background: isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.06)',
                            border: `1px solid ${isDark ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.16)'}`,
                          }}
                          title="Valid"
                        >
                          <Icon icon={appIcons.success} className="h-4 w-4" style={{ color: isDark ? '#6ee7b7' : '#047857' }} />
                        </div>
                      )}
                      {!entry.isLoading && entry.isValid && isPaywalled && (
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                          style={{
                            background: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.06)',
                            border: `1px solid ${isDark ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.16)'}`,
                          }}
                          title="Paywalled"
                        >
                          <Icon icon={appIcons.paywall} className="h-4 w-4" style={{ color: isDark ? '#fcd34d' : '#b45309' }} />
                        </div>
                      )}
                      {!entry.isLoading && entry.error && (
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                          style={{
                            background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
                            border: `1px solid ${isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'}`,
                          }}
                          title={entry.error}
                        >
                          <Icon icon={appIcons.close} className="h-4 w-4" style={{ color: isDark ? '#f87171' : '#dc2626' }} />
                        </div>
                      )}

                      {entries.length > 2 && (
                        <button
                          onClick={() => handleRemoveEntry(entry.id)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors"
                          style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(55,53,47,0.3)' }}
                          title="Remove"
                        >
                          <Icon icon={appIcons.close} className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {entry.isValid && !isPaywalled && (
                      <div className="ml-11 flex items-center gap-3 py-2">
                        <label className="text-xs" style={{ color: secondaryText }}>
                          Range (optional):
                        </label>
                        <input
                          type="text"
                          value={entry.chapterRange}
                          onChange={(event) => updateEntry(entry.id, { chapterRange: event.target.value })}
                          placeholder="e.g. 1-100 or 50-75"
                          className="w-36 rounded-md border px-3 py-1.5 text-xs outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                          style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={handleAddEntry}
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium transition-colors"
              style={{ color: isDark ? '#a5b4fc' : '#4f46e5' }}
            >
              <Icon icon={appIcons.add} className="h-4 w-4" />
              Add another URL
            </button>
          </section>

          {entries.some((entry) => entry.isValid || entry.error) && (
            <section
              className="rounded-2xl border px-5 py-5 sm:px-6"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <h2 className="mb-3 text-sm font-semibold" style={{ color: pageText }}>
                Detection results
              </h2>
              <div className="space-y-0">
                {entries.map((entry, index) => {
                  const isPaywalled = entry.novelMetadata?.is_paywalled === true;
                  return (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0 sm:gap-3 sm:flex-nowrap"
                      style={{ borderColor: panelBorder }}
                    >
                      <span className="w-5 text-xs font-mono" style={{ color: secondaryText }}>
                        {index + 1}.
                      </span>
                      {entry.isValid ? (
                        <>
                          <div
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              background: isPaywalled
                                ? isDark
                                  ? '#fcd34d'
                                  : '#b45309'
                                : isDark
                                  ? '#6ee7b7'
                                  : '#047857',
                            }}
                          />
                          <span className="max-w-[120px] truncate font-medium text-sm sm:max-w-none" style={{ color: pageText }}>
                            {entry.siteInfo?.site_name}
                          </span>
                          {entry.storyTitle && (
                            <span
                              className="max-w-[150px] truncate text-sm sm:max-w-[200px]"
                              style={{ color: secondaryText }}
                            >
                              — {entry.storyTitle}
                            </span>
                          )}
                          {entry.totalChapterCount != null && (
                            <span className="ml-auto text-xs" style={{ color: secondaryText }}>
                              {entry.totalChapterCount.toLocaleString()} ch
                            </span>
                          )}
                          {isPaywalled && (
                            <span
                              className="rounded-lg border px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                background: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.06)',
                                borderColor: isDark ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.16)',
                                color: isDark ? '#fcd34d' : '#b45309',
                              }}
                            >
                              Paywalled
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <div
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: isDark ? '#f87171' : '#dc2626' }}
                          />
                          <span className="flex-1 truncate text-sm" style={{ color: secondaryText }}>
                            {entry.url}
                          </span>
                          <span className="text-xs" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
                            {entry.error}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <h2 className="mb-1 text-base font-semibold" style={{ color: pageText }}>
              Output format
            </h2>
            <p className="mb-3 text-sm" style={{ color: secondaryText }}>
              Applied to all novels in this batch
            </p>
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: secondaryText }}>
                Format:
              </span>
              <span
                className="rounded-md px-3 py-1 text-sm font-medium"
                style={{ background: activeSurface, border: `1px solid ${panelBorder}`, color: pageText }}
              >
                MD
              </span>
            </div>
          </section>

          {startError && (
            <div
              className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
              style={{
                background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
                borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
                color: isDark ? '#f87171' : '#dc2626',
              }}
            >
              <Icon icon={appIcons.error} className="h-5 w-5 shrink-0" />
              {startError}
            </div>
          )}

          <button
            onClick={handleStart}
            disabled={isStarting || validCount === 0 || anyLoading}
            className="flex w-full items-center justify-center gap-2 rounded-md py-3.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed"
            style={{
              background:
                isStarting || validCount === 0 || anyLoading
                  ? isDark
                    ? 'rgba(255,255,255,0.08)'
                    : 'rgba(55,53,47,0.14)'
                  : '#4f46e5',
              color:
                isStarting || validCount === 0 || anyLoading
                  ? secondaryText
                  : '#ffffff',
              opacity: isStarting ? 0.7 : 1,
            }}
          >
            {isStarting ? (
              <>
                <Icon icon={appIcons.refresh} className="h-5 w-5 animate-spin" />
                Starting {validCount} crawl{validCount !== 1 ? 's' : ''}...
              </>
            ) : (
              <>
                <Icon icon={appIcons.autoAudio} className="h-5 w-5" />
                Crawl All ({validCount} novel{validCount !== 1 ? 's' : ''})
              </>
            )}
          </button>

          {validCount === 0 && !anyLoading && (
            <p className="text-center text-xs" style={{ color: tertiaryText }}>
              Detect all URLs first by pressing Enter in each field or clicking outside.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
