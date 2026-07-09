import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  exportInkittBatchCatalog,
  getInkittBatchDownloadUrl,
  getInkittBatchRows,
  getInkittBatchStatus,
  importInkittDiscoveredCatalog,
  crawlInkittBatch,
  listInkittBatches,
  pauseInkittBatch,
  removeInkittBatch,
  startInkittBatch,
  type InkittBatchRow,
  type InkittBatchSummary,
} from '../../api';
import { apiFetch, downloadWithAuth } from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';
import type { ThemeMode } from '../../types/theme';
import { getInkittLogTone, inkittLogToneClass, splitInkittLogLine } from './inkittLogUtils';

interface InkittBatchPageProps {
  readonly themeMode: ThemeMode;
}

const GENRES = [
  ['action', 'Action'],
  ['adventure', 'Adventure'],
  ['drama', 'Drama'],
  ['erotica', 'Erotica'],
  ['fantasy', 'Fantasy'],
  ['historical-fiction', 'Historical Fiction'],
  ['horror', 'Horror'],
  ['humor', 'Humor'],
  ['lgbtq', 'LGBTQ+'],
  ['literary-fiction', 'Literary Fiction'],
  ['mystery', 'Mystery'],
  ['other', 'Other'],
  ['poetry', 'Poetry'],
  ['romance', 'Romance'],
  ['scifi', 'Scifi'],
  ['thriller', 'Thriller'],
  ['young-adult', 'Young Adult'],
] as const;

const ALL_GENRE_SLUGS = GENRES.map(([slug]) => slug);
const DISCOVER_ALL_MAX_PAGES = 1000;
const ROW_PAGE_SIZE = 500;

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Exported' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'failed', label: 'Failed' },
  { value: 'crawling', label: 'Crawling' },
  { value: 'queued', label: 'Queued' },
];

function downloadJsonFile(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function retryInkittFailedStories(batchId: string, rowIndex?: number): Promise<InkittBatchSummary> {
  return apiFetch<InkittBatchSummary>(`/api/crawl/inkitt-batch/${encodeURIComponent(batchId)}/retry-failed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rowIndex ? { row_index: rowIndex } : {}),
    timeout: 60000,
  });
}

function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-';
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

function formatRate(value?: number | null): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '-';
  return `${Math.round(value).toLocaleString()} ch/h`;
}

function formatStoryRate(value?: number | null): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '-';
  return `${Math.round(value).toLocaleString()} stories/h`;
}

function formatEstimateSpeed(chaptersPerHour?: number | null, storiesPerHour?: number | null): string {
  const chapterRate = formatRate(chaptersPerHour);
  return chapterRate !== '-' ? chapterRate : formatStoryRate(storiesPerHour);
}

function estimateSourceLabel(source?: string): string {
  const labels: Record<string, string> = {
    recent_chapters: 'Recent speed',
    all_time_chapters: 'All-time speed',
    all_time_stories: 'Story speed',
    complete: 'Complete',
    insufficient_data: 'Waiting for data',
  };
  return labels[source || ''] || 'Estimate';
}

export function InkittBatchPage({ themeMode }: InkittBatchPageProps) {
  const isDark = themeMode === 'dark';
  const [batchName, setBatchName] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>(() => GENRES.map(([slug]) => slug));
  const [maxPages, setMaxPages] = useState(3);
  const [discoverConcurrency, setDiscoverConcurrency] = useState(4);
  const [crawlConcurrency, setCrawlConcurrency] = useState(1);
  const [requestDelaySeconds, setRequestDelaySeconds] = useState(2);
  const [storiesPerRun, setStoriesPerRun] = useState(200);
  const [batchId, setBatchId] = useState(() => sessionStorage.getItem('inkitt_batch_id') || '');
  const [summary, setSummary] = useState<InkittBatchSummary | null>(null);
  const [history, setHistory] = useState<InkittBatchSummary[]>([]);
  const [rows, setRows] = useState<InkittBatchRow[]>([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowFilter, setRowFilter] = useState('all');
  const [isStarting, setIsStarting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isCatalogExporting, setIsCatalogExporting] = useState(false);
  const [isCatalogImporting, setIsCatalogImporting] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState('');
  const [rowsLoading, setRowsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InkittBatchSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState('');
  const [retryTarget, setRetryTarget] = useState('');
  const [error, setError] = useState('');
  const syncedBatchIdRef = useRef('');
  const catalogFileInputRef = useRef<HTMLInputElement | null>(null);

  const active = summary?.phase === 'discovering' || summary?.phase === 'crawling';
  const estimateTotalChapters = summary?.crawl_estimate?.estimated_total_chapters || summary?.total_chapters || 0;
  const crawlEstimate = summary?.crawl_estimate;
  const progressPercent = summary && estimateTotalChapters > 0
    ? Math.round((summary.crawled_chapters / estimateTotalChapters) * 1000) / 10
    : summary && summary.total_stories > 0
    ? Math.round((summary.processed_count / summary.total_stories) * 1000) / 10
    : active ? 5 : 0;
  const selectedGenreLabels = useMemo(
    () => GENRES.filter(([slug]) => selectedGenres.includes(slug)).map(([, label]) => label),
    [selectedGenres],
  );

  useEffect(() => {
    if (!summary || syncedBatchIdRef.current === summary.batch_id) return;
    syncedBatchIdRef.current = summary.batch_id;
    setBatchName(summary.batch_name || '');
    setSelectedGenres(summary.selected_genres?.length ? summary.selected_genres : ALL_GENRE_SLUGS);
    setMaxPages(summary.max_pages_per_genre || 3);
    setDiscoverConcurrency(summary.discover_concurrency || 4);
    setCrawlConcurrency(summary.crawl_concurrency || 1);
    setRequestDelaySeconds(summary.request_delay_seconds || 2);
  }, [summary]);

  const fetchHistory = useCallback(() => {
    setHistoryLoading(true);
    listInkittBatches()
      .then(setHistory)
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  const fetchStatus = useCallback(() => {
    if (!batchId) return;
    getInkittBatchStatus(batchId)
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to refresh Inkitt batch status.'));
  }, [batchId]);

  const fetchRows = useCallback((offset = 0) => {
    if (!batchId) return;
    setRowsLoading(true);
    getInkittBatchRows(batchId, { offset, limit: ROW_PAGE_SIZE, status: rowFilter })
      .then((response) => {
        setRows((current) => offset > 0 ? [...current, ...response.items] : response.items);
        setRowTotal(response.total);
        setSummary(response.batch);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Inkitt batch rows.'))
      .finally(() => setRowsLoading(false));
  }, [batchId, rowFilter]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!batchId) return;
    sessionStorage.setItem('inkitt_batch_id', batchId);
    fetchRows(0);
  }, [batchId, fetchRows]);

  useEffect(() => {
    if (!batchId || !active) return;
    const id = window.setInterval(() => {
      fetchStatus();
      fetchRows(0);
      fetchHistory();
    }, 2500);
    return () => window.clearInterval(id);
  }, [active, batchId, fetchHistory, fetchRows, fetchStatus]);

  const handleToggleGenre = (slug: string) => {
    setSelectedGenres((current) => {
      if (current.includes(slug)) {
        return current.filter((item) => item !== slug);
      }
      return [...current, slug];
    });
  };

  const handleDiscoverSelected = async () => {
    if (selectedGenres.length === 0) {
      setError('Select at least one Inkitt genre.');
      return;
    }
    setIsStarting(true);
    setError('');
    try {
      const response = await startInkittBatch({
        batch_name: batchName || `Inkitt ${selectedGenres.length} genre batch`,
        genres: selectedGenres,
        max_pages_per_genre: maxPages,
        discover_concurrency: discoverConcurrency,
        crawl_concurrency: crawlConcurrency,
        request_delay_seconds: requestDelaySeconds,
        crawl_after_discovery: false,
      });
      setBatchId(response.batch_id);
      setSummary(response);
      setRows([]);
      setRowTotal(0);
      setRowFilter('all');
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover Inkitt stories.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleDiscoverAll = async () => {
    setIsStarting(true);
    setError('');
    try {
      const response = await startInkittBatch({
        batch_name: batchName || 'Inkitt all free completed discovery',
        genres: ALL_GENRE_SLUGS,
        max_pages_per_genre: DISCOVER_ALL_MAX_PAGES,
        discover_concurrency: discoverConcurrency,
        crawl_concurrency: crawlConcurrency,
        request_delay_seconds: requestDelaySeconds,
        crawl_after_discovery: false,
      });
      setSelectedGenres(ALL_GENRE_SLUGS);
      setMaxPages(DISCOVER_ALL_MAX_PAGES);
      setBatchId(response.batch_id);
      setSummary(response);
      setRows([]);
      setRowTotal(0);
      setRowFilter('all');
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover all Inkitt stories.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleCrawlSelected = async () => {
    if (!batchId) return;
    setIsStarting(true);
    setError('');
    try {
      const response = await crawlInkittBatch(batchId, {
        crawl_concurrency: crawlConcurrency,
        request_delay_seconds: requestDelaySeconds,
        max_stories: storiesPerRun,
      });
      setSummary(response);
      fetchRows(0);
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Inkitt crawl.');
    } finally {
      setIsStarting(false);
    }
  };

  const handlePauseCrawl = async () => {
    if (!batchId) return;
    setIsPausing(true);
    setError('');
    try {
      const response = await pauseInkittBatch(batchId);
      setSummary(response);
      fetchRows(0);
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause Inkitt crawl.');
    } finally {
      setIsPausing(false);
    }
  };

  const handleRetryFailed = async (rowIndex?: number) => {
    if (!batchId) return;
    const target = rowIndex ? `row:${rowIndex}` : 'all';
    setRetryTarget(target);
    setError('');
    try {
      const response = await retryInkittFailedStories(batchId, rowIndex);
      setSummary(response);
      setRows([]);
      fetchRows(0);
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue failed Inkitt stories for retry.');
    } finally {
      setRetryTarget('');
    }
  };

  const handleDownload = async () => {
    if (!batchId) return;
    setDownloadTarget('all');
    setError('');
    try {
      await downloadWithAuth(getInkittBatchDownloadUrl(batchId), `inkitt_batch_${batchId}.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download Inkitt ZIP.');
    } finally {
      setDownloadTarget('');
    }
  };

  const handleDownloadRun = async (runId: string) => {
    if (!batchId) return;
    const target = `run:${runId}`;
    setDownloadTarget(target);
    setError('');
    try {
      await downloadWithAuth(getInkittBatchDownloadUrl(batchId, runId), `inkitt_batch_${batchId}_${runId}.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download Inkitt run ZIP.');
    } finally {
      setDownloadTarget('');
    }
  };

  const handleExportCatalog = async () => {
    const selectedBatchId = summary?.batch_id || batchId;
    if (!selectedBatchId) {
      setError('Select an Inkitt batch before exporting its discovered catalog.');
      return;
    }
    setIsCatalogExporting(true);
    setCatalogMessage('');
    setError('');
    try {
      const backup = await exportInkittBatchCatalog(selectedBatchId);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJsonFile(backup, `inkitt_batch_catalog_${selectedBatchId}_${stamp}_${backup.story_count}.json`);
      setCatalogMessage(`Exported ${backup.story_count.toLocaleString()} story/stories from the selected batch.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export selected Inkitt batch catalog.');
    } finally {
      setIsCatalogExporting(false);
    }
  };

  const handleImportCatalogClick = () => {
    catalogFileInputRef.current?.click();
  };

  const handleImportCatalogFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIsCatalogImporting(true);
    setCatalogMessage('');
    setError('');
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const response = await importInkittDiscoveredCatalog(payload);
      syncedBatchIdRef.current = '';
      setBatchId(response.batch.batch_id);
      setSummary(response.batch);
      setRows([]);
      setRowTotal(0);
      setRowFilter('all');
      setCatalogMessage(
        `Imported ${response.imported_count.toLocaleString()} valid story/stories; `
        + `${response.new_count.toLocaleString()} new; `
        + `${response.queued_count.toLocaleString()} queued from this file in a restored batch.`,
      );
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import Inkitt discovered catalog.');
    } finally {
      setIsCatalogImporting(false);
    }
  };

  const handleSelectBatch = (batch: InkittBatchSummary) => {
    syncedBatchIdRef.current = '';
    setBatchId(batch.batch_id);
    setSummary(batch);
    setRows([]);
    setRowTotal(0);
    setRowFilter('all');
    setError('');
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const deletingId = deleteTarget.batch_id;
    setIsDeleting(true);
    setError('');
    try {
      await removeInkittBatch(deletingId);
      setHistory((items) => items.filter((item) => item.batch_id !== deletingId));
      if (batchId === deletingId) {
        setBatchId('');
        setSummary(null);
        setRows([]);
        setRowTotal(0);
        sessionStorage.removeItem('inkitt_batch_id');
      }
      setDeleteTarget(null);
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete Inkitt batch.');
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const panelBg = 'var(--cs-surface-elevated)';
  const panelBorder = 'var(--cs-border)';
  const muted = 'var(--cs-surface-muted)';
  const text = 'var(--cs-text)';
  const soft = 'var(--cs-text-soft)';
  const faint = 'var(--cs-text-faint)';
  const primary = 'var(--cs-primary)';

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: 'var(--cs-page)' }}>
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg border p-5" style={{ background: panelBg, borderColor: panelBorder }}>
            <h3 className="text-lg font-semibold" style={{ color: text }}>Delete batch history</h3>
            <p className="mt-2 text-sm leading-6" style={{ color: soft }}>
              Delete "{deleteTarget.batch_name || deleteTarget.batch_id}" and its ZIP output folder?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={isDeleting} className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60" style={{ borderColor: panelBorder, background: muted, color: text }}>Cancel</button>
              <button type="button" onClick={handleConfirmDelete} disabled={isDeleting} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#dc2626' }}>
                {isDeleting && <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />}
                {isDeleting ? 'Deleting' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-3 py-4 sm:px-5 lg:px-6 lg:py-5">
        <main className="space-y-4">
          <section className="rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase" style={{ color: faint }}>Inkitt</div>
                <h1 className="text-xl font-semibold sm:text-2xl" style={{ color: text }}>Free completed genre batch</h1>
                <p className="max-w-3xl text-sm leading-5" style={{ color: soft }}>
                  Crawl only free readable completed Inkitt stories, group them by genre, and download one ZIP with combined Markdown plus info.json per story.
                </p>
              </div>
              {summary && (
                <span className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: panelBorder, background: muted, color: text }}>
                  {active && <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />}
                  {phaseLabel(summary.phase)}
                </span>
              )}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4 rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
              <div>
                <h2 className="text-base font-semibold" style={{ color: text }}>Batch setup</h2>
                <p className="text-sm" style={{ color: soft }}>{selectedGenres.length} selected genre{selectedGenres.length === 1 ? '' : 's'}</p>
              </div>

              <input
                value={batchName}
                onChange={(event) => setBatchName(event.target.value)}
                placeholder="Optional batch name"
                className="w-full rounded-md border px-3 py-2 text-sm outline-none"
                style={{ background: muted, borderColor: panelBorder, color: text }}
              />

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {GENRES.map(([slug, label]) => {
                  const checked = selectedGenres.includes(slug);
                  return (
                    <button
                      key={slug}
                      type="button"
                      onClick={() => handleToggleGenre(slug)}
                      className="inline-flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs font-semibold"
                      style={{
                        borderColor: checked ? primary : panelBorder,
                        background: checked ? 'var(--cs-primary-soft)' : muted,
                        color: checked ? primary : soft,
                      }}
                    >
                      <span>{label}</span>
                      {checked && <Icon icon={appIcons.check} className="h-3.5 w-3.5" />}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <NumberField label="Pages/genre" value={maxPages} min={1} max={DISCOVER_ALL_MAX_PAGES} onChange={setMaxPages} />
                <NumberField label="Discover workers" value={discoverConcurrency} min={1} max={6} onChange={setDiscoverConcurrency} />
                <NumberField label="Crawl workers" value={crawlConcurrency} min={1} max={10} onChange={setCrawlConcurrency} />
                <NumberField label="Stories/run" value={storiesPerRun} min={1} max={10000} onChange={setStoriesPerRun} />
                <DecimalField label="Delay seconds" value={requestDelaySeconds} min={1} max={15} step={0.25} onChange={setRequestDelaySeconds} />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCrawlSelected}
                  disabled={isStarting || active || !summary || summary.phase === 'completed' || summary.total_stories === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: primary, color: '#fff' }}
                >
                  {isStarting ? <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" /> : <Icon icon={appIcons.play} className="h-4 w-4" />}
                  Start/Resume crawl
                </button>
                <button
                  type="button"
                  onClick={handleDiscoverSelected}
                  disabled={isStarting || active || selectedGenres.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: panelBorder, background: muted, color: text }}
                >
                  {isStarting ? <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" /> : <Icon icon={appIcons.search} className="h-4 w-4" />}
                  Discover only
                </button>
                <button
                  type="button"
                  onClick={handleDiscoverAll}
                  disabled={isStarting || active}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: primary, background: 'var(--cs-primary-soft)', color: primary }}
                >
                  {isStarting ? <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" /> : <Icon icon={appIcons.search} className="h-4 w-4" />}
                  Discover all free completed
                </button>
                <button
                  type="button"
                  onClick={handlePauseCrawl}
                  disabled={isPausing || summary?.phase !== 'crawling' || summary?.cancel_requested}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: panelBorder, background: muted, color: text }}
                >
                  {isPausing || summary?.cancel_requested ? <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" /> : <Icon icon={appIcons.pause} className="h-4 w-4" />}
                  {summary?.cancel_requested ? 'Pausing...' : 'Pause crawl'}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!summary?.download_ready || Boolean(downloadTarget)}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: panelBorder, background: muted, color: text }}
                >
                  <Icon icon={downloadTarget === 'all' ? appIcons.spinner : appIcons.download} className={`h-4 w-4 ${downloadTarget === 'all' ? 'animate-spin' : ''}`} />
                  {downloadTarget === 'all' ? 'Preparing ZIP' : 'Download exported ZIP'}
                </button>
                <button
                  type="button"
                  onClick={handleExportCatalog}
                  disabled={isCatalogExporting || !summary}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: panelBorder, background: muted, color: text }}
                >
                  <Icon icon={isCatalogExporting ? appIcons.spinner : appIcons.download} className={`h-4 w-4 ${isCatalogExporting ? 'animate-spin' : ''}`} />
                  {isCatalogExporting ? 'Exporting batch' : 'Export selected batch'}
                </button>
                <button
                  type="button"
                  onClick={handleImportCatalogClick}
                  disabled={isCatalogImporting || active}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: panelBorder, background: muted, color: text }}
                >
                  <Icon icon={isCatalogImporting ? appIcons.spinner : appIcons.uploadFile} className={`h-4 w-4 ${isCatalogImporting ? 'animate-spin' : ''}`} />
                  {isCatalogImporting ? 'Importing catalog' : 'Import catalog'}
                </button>
                <input
                  ref={catalogFileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportCatalogFile}
                />
              </div>
              {catalogMessage && (
                <div className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.08)', color: isDark ? '#86efac' : '#15803d' }}>
                  {catalogMessage}
                </div>
              )}
            </div>

            <div className="rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
              <h2 className="text-base font-semibold" style={{ color: text }}>Batch totals</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Found" value={summary?.discovered_count ?? 0} />
                <Stat label="Processed" value={summary?.processed_count ?? 0} />
                <Stat label="Exported" value={summary?.completed_count ?? 0} />
                <Stat label="Skipped" value={summary?.skipped_count ?? 0} />
                <Stat label="Failed" value={summary?.failed_count ?? 0} />
                <Stat label="Genres" value={selectedGenres.length} />
                <Stat className="col-span-2" label="Chapters" value={`${(summary?.crawled_chapters ?? 0).toLocaleString()}/${(summary?.total_chapters ?? 0).toLocaleString()}`} />
              </div>
              <div className="mt-4">
                <Progress label="Progress" value={progressPercent} />
              </div>
              {summary && crawlEstimate && (
                <div className="mt-4 border-t pt-4" style={{ borderColor: panelBorder }}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold" style={{ color: text }}>Time estimate</h3>
                    <span className="rounded border px-2 py-1 text-xs font-medium" style={{ borderColor: panelBorder, background: muted, color: soft }}>
                      {estimateSourceLabel(crawlEstimate.source)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Stat label="Remaining stories" value={crawlEstimate.remaining_stories} />
                    <Stat label="Remaining chapters" value={crawlEstimate.remaining_chapters} />
                    <Stat label="Speed" value={formatEstimateSpeed(crawlEstimate.recent_chapters_per_hour ?? crawlEstimate.chapters_per_hour, crawlEstimate.stories_per_hour)} />
                    <Stat label="Elapsed" value={formatDuration(crawlEstimate.elapsed_seconds)} />
                    <Stat label="ETA" value={formatDuration(crawlEstimate.estimated_remaining_seconds)} />
                    <Stat className="col-span-2" label="Finish" value={crawlEstimate.estimated_finished_at || '-'} />
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold" style={{ color: text }}>Batch history</h2>
                <p className="text-sm" style={{ color: soft }}>{selectedGenreLabels.slice(0, 4).join(', ')}{selectedGenreLabels.length > 4 ? ', ...' : ''}</p>
              </div>
              <button type="button" onClick={fetchHistory} disabled={historyLoading} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60" style={{ borderColor: panelBorder, background: muted, color: text }}>
                <Icon icon={appIcons.refresh} className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {history.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-md border" style={{ borderColor: panelBorder }}>
                {history.slice(0, 12).map((batch, index) => {
                  const selected = batch.batch_id === batchId;
                  return (
                    <div key={batch.batch_id} className="grid gap-2 px-3 py-3 md:grid-cols-[minmax(220px,1fr)_110px_90px_90px_74px] md:items-center" style={{ borderTop: index === 0 ? 'none' : `1px solid ${panelBorder}`, borderLeft: selected ? '3px solid var(--cs-primary)' : '3px solid transparent', background: selected ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)') : panelBg, color: text }}>
                      <button type="button" onClick={() => handleSelectBatch(batch)} className="grid text-left md:contents">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{batch.batch_name || batch.batch_id}</p>
                          <p className="mt-1 text-xs" style={{ color: soft }}>{batch.created_at} - {batch.batch_id}</p>
                        </div>
                        <span className="w-fit rounded border px-2 py-1 text-xs font-medium" style={{ borderColor: panelBorder, background: muted, color: soft }}>{phaseLabel(batch.phase)}</span>
                        <span className="text-xs tabular-nums" style={{ color: soft }}>{batch.completed_count.toLocaleString()} files</span>
                        <span className="text-xs tabular-nums" style={{ color: soft }}>{batch.total_stories.toLocaleString()} stories</span>
                      </button>
                      <div className="flex justify-end">
                        <button type="button" onClick={() => setDeleteTarget(batch)} disabled={batch.phase === 'discovering' || batch.phase === 'crawling'} className="inline-flex h-9 w-9 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-45" style={{ borderColor: panelBorder, background: muted, color: batch.phase === 'discovering' || batch.phase === 'crawling' ? faint : '#dc2626' }}>
                          <Icon icon={appIcons.delete} className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border px-4 py-6 text-center text-sm" style={{ borderColor: panelBorder, color: soft }}>
                {historyLoading ? 'Loading batch history...' : 'No Inkitt batches yet.'}
              </div>
            )}
          </section>

          {error && (
            <section className="rounded-lg border px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.22)', color: isDark ? '#fca5a5' : '#dc2626' }}>
              <span className="inline-flex items-center gap-2"><Icon icon={appIcons.error} className="h-4 w-4" />{error}</span>
            </section>
          )}

          {summary && summary.log_lines.length > 0 && (
            <section className="rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold" style={{ color: text }}>Batch log</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums" style={{ color: faint }}>{summary.log_lines.length.toLocaleString()} latest lines</span>
                  <Link
                    to={`/inkitt-batch/${encodeURIComponent(summary.batch_id)}/full-logs`}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold"
                    style={{ borderColor: panelBorder, background: muted, color: text }}
                  >
                    <Icon icon={appIcons.file} className="h-3.5 w-3.5" />
                    Full logs
                  </Link>
                </div>
              </div>
              <div className="mt-3 max-h-56 overflow-auto rounded-md border p-2 font-mono text-xs leading-5" style={{ borderColor: panelBorder, background: muted }}>
                {summary.log_lines.slice().reverse().map((line, index) => {
                  const { time, message } = splitInkittLogLine(line);
                  const tone = getInkittLogTone(line);
                  return (
                    <div key={`${line}-${index}`} className={`mb-1 rounded border-l-2 px-2 py-1 last:mb-0 ${inkittLogToneClass(tone)}`}>
                      {time && <span className="mr-2 font-semibold opacity-70">{time}</span>}
                      <span className="break-words">{message}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {summary && (
            <section className="rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold" style={{ color: text }}>Crawl runs</h2>
                  <p className="text-sm" style={{ color: soft }}>Download one run or the full accumulated batch.</p>
                </div>
                <button type="button" onClick={handleDownload} disabled={!summary.download_ready || Boolean(downloadTarget)} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60" style={{ borderColor: panelBorder, background: muted, color: text }}>
                  <Icon icon={downloadTarget === 'all' ? appIcons.spinner : appIcons.download} className={`h-4 w-4 ${downloadTarget === 'all' ? 'animate-spin' : ''}`} />
                  {downloadTarget === 'all' ? 'Preparing ZIP' : 'Download all'}
                </button>
              </div>
              <div className="mt-4 grid gap-2">
                {(summary.crawl_runs || []).length > 0 ? summary.crawl_runs.map((run) => (
                  <div key={run.run_id} className="grid gap-2 rounded-md border px-3 py-3 md:grid-cols-[minmax(140px,1fr)_120px_120px_120px_auto] md:items-center" style={{ borderColor: panelBorder, background: muted, color: text }}>
                    <div>
                      <p className="text-sm font-semibold">{run.started_at}</p>
                      <p className="text-xs" style={{ color: soft }}>{run.run_id}</p>
                    </div>
                    <span className="text-xs" style={{ color: soft }}>{run.status}</span>
                    <span className="text-xs tabular-nums" style={{ color: soft }}>{run.completed_count.toLocaleString()}/{run.target_stories.toLocaleString()} stories</span>
                    <span className="text-xs tabular-nums" style={{ color: soft }}>{(run.crawled_chapters ?? 0).toLocaleString()}/{(run.total_chapters ?? 0).toLocaleString()} chapters</span>
                    <button type="button" onClick={() => { void handleDownloadRun(run.run_id); }} disabled={run.completed_count === 0 || Boolean(downloadTarget)} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold disabled:opacity-60" style={{ borderColor: panelBorder, background: panelBg, color: text }}>
                      <Icon icon={downloadTarget === `run:${run.run_id}` ? appIcons.spinner : appIcons.download} className={`h-3.5 w-3.5 ${downloadTarget === `run:${run.run_id}` ? 'animate-spin' : ''}`} />
                      {downloadTarget === `run:${run.run_id}` ? 'Preparing' : 'Download run'}
                    </button>
                  </div>
                )) : (
                  <div className="rounded-md border px-3 py-4 text-sm" style={{ borderColor: panelBorder, color: soft }}>No crawl runs yet.</div>
                )}
              </div>
            </section>
          )}

          {summary && (
            <section className="overflow-hidden rounded-lg border" style={{ background: panelBg, borderColor: panelBorder }}>
              <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between" style={{ borderColor: panelBorder }}>
                <div>
                  <h2 className="text-base font-semibold" style={{ color: text }}>Stories</h2>
                  <p className="text-sm" style={{ color: soft }}>Showing {rows.length.toLocaleString()} of {rowTotal.toLocaleString()} rows</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {summary.failed_count > 0 && (
                    <button
                      type="button"
                      onClick={() => { void handleRetryFailed(); }}
                      disabled={active || Boolean(retryTarget)}
                      className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ borderColor: panelBorder, background: muted, color: text }}
                    >
                      <Icon icon={retryTarget === 'all' ? appIcons.spinner : appIcons.refresh} className={`h-3.5 w-3.5 ${retryTarget === 'all' ? 'animate-spin' : ''}`} />
                      Retry failed
                    </button>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {FILTERS.map((filter) => (
                      <button key={filter.value} type="button" onClick={() => { setRowFilter(filter.value); setRows([]); setRowTotal(0); }} className="rounded-md border px-2.5 py-1.5 text-xs font-medium" style={{ borderColor: panelBorder, background: rowFilter === filter.value ? 'var(--cs-primary-soft)' : muted, color: rowFilter === filter.value ? primary : soft }}>
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead style={{ color: faint }}>
                    <tr className="border-b" style={{ borderColor: panelBorder }}>
                      <th className="w-16 px-4 py-3 font-medium">#</th>
                      <th className="min-w-[110px] px-4 py-3 font-medium">Genre</th>
                      <th className="min-w-[260px] px-4 py-3 font-medium">Story</th>
                      <th className="min-w-[120px] px-4 py-3 font-medium">Rating</th>
                      <th className="min-w-[120px] px-4 py-3 font-medium">Chapters</th>
                      <th className="min-w-[240px] px-4 py-3 font-medium">Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.story_id}-${row.index}`} className="border-b align-top last:border-b-0" style={{ borderColor: panelBorder }}>
                        <td className="px-4 py-3" style={{ color: faint }}>{row.index}</td>
                        <td className="px-4 py-3" style={{ color: soft }}>{row.genre}</td>
                        <td className="px-4 py-3">
                          <a href={row.url} target="_blank" rel="noopener noreferrer" className="font-medium underline hover:no-underline" style={{ color: text }}>{row.title}</a>
                          {row.author && <div className="mt-1 text-xs" style={{ color: soft }}>{row.author}</div>}
                          <div className="mt-1"><StatusChip row={row} /></div>
                        </td>
                        <td className="px-4 py-3" style={{ color: soft }}>
                          {row.rating != null ? row.rating : '-'}
                          {row.review_count != null && <div className="text-xs">{row.review_count.toLocaleString()} reviews</div>}
                          {row.read_count != null && <div className="text-xs">{row.read_count.toLocaleString()} reads</div>}
                        </td>
                        <td className="px-4 py-3" style={{ color: soft }}>
                          {row.crawled_chapters || 0}/{row.total_chapters ?? '-'}
                        </td>
                        <td className="px-4 py-3" style={{ color: soft }}>
                          <div>{row.output_file || row.error || '-'}</div>
                          {row.status === 'failed' && (
                            <button
                              type="button"
                              onClick={() => { void handleRetryFailed(row.index); }}
                              disabled={active || Boolean(retryTarget)}
                              className="mt-2 inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                              style={{ borderColor: panelBorder, background: muted, color: text }}
                            >
                              <Icon icon={retryTarget === `row:${row.index}` ? appIcons.spinner : appIcons.refresh} className={`h-3.5 w-3.5 ${retryTarget === `row:${row.index}` ? 'animate-spin' : ''}`} />
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rows.length === 0 && (
                <div className="px-6 py-10 text-center text-sm" style={{ color: soft }}>
                  {rowsLoading ? 'Loading rows...' : active ? 'Discovery is still running...' : 'No rows for this filter.'}
                </div>
              )}

              {rows.length < rowTotal && (
                <div className="border-t px-4 py-4 sm:px-5" style={{ borderColor: panelBorder }}>
                  <button type="button" onClick={() => fetchRows(rows.length)} disabled={rowsLoading} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60" style={{ borderColor: panelBorder, background: muted, color: text }}>
                    {rowsLoading && <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />}
                    Load more
                  </button>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase" style={{ color: 'var(--cs-text-faint)' }}>{label}</span>
      <input type="number" value={value} min={min} max={max} onChange={(event) => onChange(clampNumber(Number.parseInt(event.target.value) || min, min, max))} className="w-36 rounded-md border px-3 py-2 text-sm outline-none" style={{ background: 'var(--cs-surface-muted)', borderColor: 'var(--cs-border)', color: 'var(--cs-text)' }} />
    </label>
  );
}

function DecimalField({ label, value, min, max, step, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly step: number; readonly onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase" style={{ color: 'var(--cs-text-faint)' }}>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(clampNumber(Number.parseFloat(event.target.value) || min, min, max))} className="w-36 rounded-md border px-3 py-2 text-sm outline-none" style={{ background: 'var(--cs-surface-muted)', borderColor: 'var(--cs-border)', color: 'var(--cs-text)' }} />
    </label>
  );
}

function Stat({ label, value, className = '' }: { readonly label: string; readonly value: number | string; readonly className?: string }) {
  return (
    <div className={`min-w-0 rounded-md border px-3 py-2 ${className}`} style={{ borderColor: 'var(--cs-border)', background: 'var(--cs-surface-muted)' }}>
      <div className="text-xs" style={{ color: 'var(--cs-text-faint)' }}>{label}</div>
      <div className="mt-1 break-words text-base font-semibold leading-tight sm:text-lg" style={{ color: 'var(--cs-text)' }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  );
}

function formatProgressPercent(value: number): string {
  if (value > 0 && value < 0.1) return '<0.1%';
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function Progress({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--cs-text-soft)' }}><span>{label}</span><span>{formatProgressPercent(value)}</span></div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--cs-surface-muted)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: 'var(--cs-primary)' }} />
      </div>
    </div>
  );
}

function StatusChip({ row }: { readonly row: InkittBatchRow }) {
  const label = row.status === 'completed' ? 'Exported' : row.status.charAt(0).toUpperCase() + row.status.slice(1);
  const tone = row.status === 'completed' ? 'success' : row.status === 'skipped' ? 'warning' : row.status === 'failed' ? 'danger' : 'neutral';
  const colors = {
    success: { bg: 'rgba(34,197,94,0.1)', color: '#16a34a', border: 'rgba(34,197,94,0.22)' },
    warning: { bg: 'rgba(245,158,11,0.1)', color: '#d97706', border: 'rgba(245,158,11,0.24)' },
    danger: { bg: 'rgba(239,68,68,0.1)', color: '#dc2626', border: 'rgba(239,68,68,0.24)' },
    neutral: { bg: 'var(--cs-surface-muted)', color: 'var(--cs-text-soft)', border: 'var(--cs-border)' },
  }[tone];
  return <span className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold" style={{ background: colors.bg, color: colors.color, borderColor: colors.border }}>{label}</span>;
}

function phaseLabel(phase: InkittBatchSummary['phase']): string {
  const labels: Record<InkittBatchSummary['phase'], string> = {
    discovering: 'Discovering',
    ready: 'Ready',
    crawling: 'Crawling',
    completed: 'Completed',
    failed: 'Failed',
  };
  return labels[phase] ?? phase;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
