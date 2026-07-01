import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  getGoodnovelBatchRows,
  getGoodnovelBatchStatus,
  getGoodnovelBatchDownloadUrl,
  listGoodnovelBatches,
  startGoodnovelBatchCrawl,
  startGoodnovelBatchScan,
  type GoodNovelBatchRow,
  type GoodNovelBatchSummary,
  type GoodNovelBatchSplitMode,
} from '../../api';
import { downloadWithAuth } from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';
import type { ThemeMode } from '../../types/theme';

interface GoodNovelBatchPageProps {
  readonly themeMode: ThemeMode;
}

type DelimiterMode = 'semicolon' | 'newline';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'found', label: 'Found' },
  { value: 'not_found', label: 'Not found' },
  { value: 'ambiguous', label: 'Ambiguous' },
  { value: 'error', label: 'Errors' },
  { value: 'crawled', label: 'Crawled' },
  { value: 'crawl_failed', label: 'Crawl failed' },
];

export function GoodNovelBatchPage({ themeMode }: GoodNovelBatchPageProps) {
  const isDark = themeMode === 'dark';
  const [titlesText, setTitlesText] = useState('');
  const [fileName, setFileName] = useState('');
  const [delimiter, setDelimiter] = useState<DelimiterMode>('semicolon');
  const [scanConcurrency, setScanConcurrency] = useState(4);
  const [batchId, setBatchId] = useState(() => sessionStorage.getItem('goodnovel_batch_id') || '');
  const [summary, setSummary] = useState<GoodNovelBatchSummary | null>(null);
  const [rows, setRows] = useState<GoodNovelBatchRow[]>([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowLimit, setRowLimit] = useState(100);
  const [rowFilter, setRowFilter] = useState('all');
  const [rowsLoading, setRowsLoading] = useState(false);
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [isStartingCrawl, setIsStartingCrawl] = useState(false);
  const [error, setError] = useState('');
  const [splitMode, setSplitMode] = useState<GoodNovelBatchSplitMode>('stories_per_folder');
  const [storiesPerFolder, setStoriesPerFolder] = useState(100);
  const [folderCount, setFolderCount] = useState(80);
  const [crawlConcurrency, setCrawlConcurrency] = useState(3);
  const [requestDelaySeconds, setRequestDelaySeconds] = useState(0.15);
  const [batchHistory, setBatchHistory] = useState<GoodNovelBatchSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const titleCount = useMemo(
    () => countTitles(titlesText, delimiter),
    [titlesText, delimiter],
  );

  const active = summary?.phase === 'scanning' || summary?.phase === 'crawling';
  const scanPercent = summary && summary.total_titles > 0
    ? Math.round((summary.scanned_count / summary.total_titles) * 100)
    : 0;
  const crawlPercent = summary && summary.crawl_total > 0
    ? Math.round(((summary.crawled_count + summary.crawl_failed_count + summary.crawl_skipped_count) / summary.crawl_total) * 100)
    : 0;

  const fetchStatus = useCallback(() => {
    if (!batchId) return;
    getGoodnovelBatchStatus(batchId)
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to refresh GoodNovel batch status.'));
  }, [batchId]);

  const fetchRows = useCallback(() => {
    if (!batchId) return;
    setRowsLoading(true);
    getGoodnovelBatchRows(batchId, { offset: 0, limit: rowLimit, status: rowFilter })
      .then((response) => {
        setRows(response.items);
        setRowTotal(response.total);
        setSummary(response.batch);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load GoodNovel batch rows.'))
      .finally(() => setRowsLoading(false));
  }, [batchId, rowFilter, rowLimit]);

  const fetchHistory = useCallback(() => {
    setHistoryLoading(true);
    listGoodnovelBatches()
      .then(setBatchHistory)
      .catch(() => {
        // History is helpful but non-blocking.
      })
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- history is loaded from the backend when opening the page
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!batchId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rows are loaded from the current batch id after scan creation
    fetchRows();
  }, [batchId, fetchRows]);

  useEffect(() => {
    if (batchId) {
      sessionStorage.setItem('goodnovel_batch_id', batchId);
    }
  }, [batchId]);

  useEffect(() => {
    if (!batchId || !active) return;
    const id = window.setInterval(() => {
      fetchStatus();
      fetchRows();
      fetchHistory();
    }, 2500);
    return () => window.clearInterval(id);
  }, [active, batchId, fetchHistory, fetchRows, fetchStatus]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setTitlesText(await file.text());
    setError('');
  };

  const handleStartScan = async () => {
    if (titleCount <= 0) {
      setError('Upload or paste at least one GoodNovel story title.');
      return;
    }
    setIsStartingScan(true);
    setError('');
    try {
      const response = await startGoodnovelBatchScan({
        titles_text: titlesText,
        delimiter: delimiter === 'newline' ? 'newline' : ';',
        scan_concurrency: scanConcurrency,
        batch_name: fileName || `GoodNovel batch ${titleCount.toLocaleString()} titles`,
      });
      setBatchId(response.batch_id);
      setSummary(response);
      setRows([]);
      setRowLimit(100);
      setRowFilter('all');
      setRowTotal(0);
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start GoodNovel scan.');
    } finally {
      setIsStartingScan(false);
    }
  };

  const handleStartCrawl = async () => {
    if (!batchId || !summary || summary.crawl_total <= 0) return;
    setIsStartingCrawl(true);
    setError('');
    try {
      const response = await startGoodnovelBatchCrawl(batchId, {
        split_mode: splitMode,
        stories_per_folder: storiesPerFolder,
        folder_count: splitMode === 'folder_count' ? folderCount : null,
        crawl_concurrency: crawlConcurrency,
        request_delay_seconds: requestDelaySeconds,
      });
      setSummary(response);
      fetchHistory();
      fetchRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start GoodNovel batch crawl.');
    } finally {
      setIsStartingCrawl(false);
    }
  };

  const handleDownload = () => {
    if (!batchId) return;
    void downloadWithAuth(getGoodnovelBatchDownloadUrl(batchId), `goodnovel_batch_${batchId}.zip`);
  };

  const handleSelectBatch = (batch: GoodNovelBatchSummary) => {
    setBatchId(batch.batch_id);
    setSummary(batch);
    setRows([]);
    setRowLimit(100);
    setRowFilter('all');
    setRowTotal(0);
    setError('');
  };

  const pageBg = 'var(--cs-page)';
  const panelBg = 'var(--cs-surface-elevated)';
  const panelBorder = 'var(--cs-border)';
  const muted = 'var(--cs-surface-muted)';
  const text = 'var(--cs-text)';
  const soft = 'var(--cs-text-soft)';
  const faint = 'var(--cs-text-faint)';
  const primary = 'var(--cs-primary)';

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBg }}>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-3 py-4 sm:px-5 lg:px-6 lg:py-5">
        <main className="space-y-4">
          <section className="rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase" style={{ color: faint }}>
                  GoodNovel
                </div>
                <h1 className="text-xl font-semibold sm:text-2xl" style={{ color: text }}>
                  Batch free-chapter crawler
                </h1>
                <p className="max-w-3xl text-sm leading-5" style={{ color: soft }}>
                  Upload a semicolon-separated title list, scan GoodNovel matches, then export grouped story folders with one combined Markdown file per story.
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

          <section className="rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold" style={{ color: text }}>
                  Batch history
                </h2>
                <p className="text-sm" style={{ color: soft }}>
                  Each upload is kept as its own batch and ZIP package.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchHistory}
                disabled={historyLoading}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
                style={{ borderColor: panelBorder, background: muted, color: text }}
              >
                <Icon icon={appIcons.refresh} className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {batchHistory.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-md border" style={{ borderColor: panelBorder }}>
                <div
                  className="hidden grid-cols-[minmax(220px,1fr)_118px_86px_86px_86px] border-b px-3 py-2 text-xs font-medium md:grid"
                  style={{ borderColor: panelBorder, background: muted, color: faint }}
                >
                  <span>Batch</span>
                  <span>Status</span>
                  <span>Titles</span>
                  <span>Links</span>
                  <span>Files</span>
                </div>
                {batchHistory.slice(0, 12).map((batch, index) => {
                  const selected = batch.batch_id === batchId;
                  return (
                    <button
                      key={batch.batch_id}
                      type="button"
                      onClick={() => handleSelectBatch(batch)}
                      className="grid w-full gap-2 px-3 py-3 text-left transition-colors md:grid-cols-[minmax(220px,1fr)_118px_86px_86px_86px] md:items-center"
                      style={{
                        borderTop: index === 0 ? 'none' : `1px solid ${panelBorder}`,
                        borderLeft: selected ? '3px solid var(--cs-primary)' : '3px solid transparent',
                        background: selected ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)') : panelBg,
                        color: text,
                      }}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{batch.batch_name || batch.batch_id}</p>
                        <p className="mt-1 text-xs" style={{ color: soft }}>
                          {batch.created_at} - {batch.batch_id}
                        </p>
                      </div>
                      <span className="w-fit rounded border px-2 py-1 text-xs font-medium" style={{ borderColor: panelBorder, background: muted, color: soft }}>
                        {phaseLabel(batch.phase)}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: soft }}>{batch.total_titles.toLocaleString()}</span>
                      <span className="text-xs tabular-nums" style={{ color: soft }}>{batch.crawl_total.toLocaleString()}</span>
                      <span className="text-xs tabular-nums" style={{ color: soft }}>{batch.crawled_count.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border px-4 py-6 text-center text-sm" style={{ borderColor: panelBorder, color: soft }}>
                {historyLoading ? 'Loading batch history...' : 'No GoodNovel batches yet.'}
              </div>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4 rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold" style={{ color: text }}>
                    Title file
                  </h2>
                  <p className="text-sm" style={{ color: soft }}>
                    {fileName || 'No file selected'} - {titleCount.toLocaleString()} parsed title{titleCount === 1 ? '' : 's'}
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: panelBorder, background: muted, color: text }}>
                  <Icon icon={appIcons.uploadFile} className="h-4 w-4" />
                  Upload file
                  <input type="file" accept=".txt,.csv,.md" className="hidden" onChange={handleFileChange} />
                </label>
              </div>

              <textarea
                value={titlesText}
                onChange={(event) => setTitlesText(event.target.value)}
                placeholder="Story title 1; Story title 2; Story title 3"
                className="min-h-[170px] w-full resize-y rounded-md border px-3 py-3 text-sm outline-none"
                style={{ background: muted, borderColor: panelBorder, color: text }}
              />

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase" style={{ color: faint }}>
                    Delimiter
                  </label>
                  <div className="inline-flex rounded-md border p-0.5" style={{ borderColor: panelBorder, background: muted }}>
                    <button
                      type="button"
                      onClick={() => setDelimiter('semicolon')}
                      className="rounded px-3 py-1.5 text-sm"
                      style={{ background: delimiter === 'semicolon' ? 'var(--cs-primary-soft)' : 'transparent', color: delimiter === 'semicolon' ? primary : soft }}
                    >
                      Semicolon
                    </button>
                    <button
                      type="button"
                      onClick={() => setDelimiter('newline')}
                      className="rounded px-3 py-1.5 text-sm"
                      style={{ background: delimiter === 'newline' ? 'var(--cs-primary-soft)' : 'transparent', color: delimiter === 'newline' ? primary : soft }}
                    >
                      Newline
                    </button>
                  </div>
                </div>
                <NumberField label="Scan workers" value={scanConcurrency} min={1} max={8} onChange={setScanConcurrency} />
                <button
                  type="button"
                  onClick={handleStartScan}
                  disabled={isStartingScan || titleCount <= 0 || active}
                  className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: 'var(--cs-primary)', color: '#ffffff' }}
                >
                  {isStartingScan ? <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" /> : <Icon icon={appIcons.search} className="h-4 w-4" />}
                  Start scan
                </button>
              </div>
            </div>

            <div className="rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
              <h2 className="text-base font-semibold" style={{ color: text }}>
                Batch totals
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Titles" value={summary?.total_titles ?? titleCount} />
                <Stat label="Scanned" value={summary?.scanned_count ?? 0} />
                <Stat label="Links" value={summary?.crawl_total ?? 0} />
                <Stat label="Exact" value={summary?.found_count ?? 0} />
                <Stat label="Ambiguous" value={summary?.ambiguous_count ?? 0} />
                <Stat label="Not found" value={summary?.not_found_count ?? 0} />
                <Stat label="Crawled" value={summary?.crawled_count ?? 0} />
                <Stat label="Skipped" value={summary?.crawl_skipped_count ?? 0} />
              </div>
              {summary && (
                <div className="mt-4 space-y-3">
                  <Progress label="Scan" value={scanPercent} />
                  <Progress label="Crawl" value={crawlPercent} />
                </div>
              )}
            </div>
          </section>

          {summary && (
            <section className="rounded-lg border px-4 py-4 sm:px-5" style={{ background: panelBg, borderColor: panelBorder }}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-3">
                  <h2 className="text-base font-semibold" style={{ color: text }}>
                    Folder split
                  </h2>
                  <div className="inline-flex rounded-md border p-0.5" style={{ borderColor: panelBorder, background: muted }}>
                    <button
                      type="button"
                      onClick={() => setSplitMode('stories_per_folder')}
                      className="rounded px-3 py-1.5 text-sm"
                      style={{ background: splitMode === 'stories_per_folder' ? 'var(--cs-primary-soft)' : 'transparent', color: splitMode === 'stories_per_folder' ? primary : soft }}
                    >
                      Stories per folder
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplitMode('folder_count')}
                      className="rounded px-3 py-1.5 text-sm"
                      style={{ background: splitMode === 'folder_count' ? 'var(--cs-primary-soft)' : 'transparent', color: splitMode === 'folder_count' ? primary : soft }}
                    >
                      Folder count
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <NumberField label="Stories/folder" value={storiesPerFolder} min={1} max={1000} disabled={splitMode !== 'stories_per_folder'} onChange={setStoriesPerFolder} />
                    <NumberField label="Folders" value={folderCount} min={1} max={10000} disabled={splitMode !== 'folder_count'} onChange={setFolderCount} />
                    <NumberField label="Crawl workers" value={crawlConcurrency} min={1} max={8} onChange={setCrawlConcurrency} />
                    <DecimalField label="Delay seconds" value={requestDelaySeconds} min={0} max={5} step={0.05} onChange={setRequestDelaySeconds} />
                  </div>
                  <p className="text-sm" style={{ color: soft }}>
                    {splitMode === 'stories_per_folder'
                      ? `Estimated folders: ${Math.max(1, Math.ceil((summary.crawl_total || 0) / Math.max(1, storiesPerFolder))).toLocaleString()}`
                      : `Estimated stories per folder: ${Math.max(1, Math.ceil((summary.crawl_total || 0) / Math.max(1, folderCount))).toLocaleString()}`}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleStartCrawl}
                    disabled={isStartingCrawl || summary.phase === 'scanning' || summary.phase === 'crawling' || summary.crawl_total <= 0}
                    className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: 'var(--cs-primary)', color: '#ffffff' }}
                  >
                    {isStartingCrawl ? <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" /> : <Icon icon={appIcons.play} className="h-4 w-4" />}
                    Start crawl
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!summary.download_ready}
                    className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ borderColor: panelBorder, background: muted, color: text }}
                  >
                    <Icon icon={appIcons.download} className="h-4 w-4" />
                    Download ZIP
                  </button>
                </div>
              </div>
            </section>
          )}

          {error && (
            <section className="rounded-lg border px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.22)', color: isDark ? '#fca5a5' : '#dc2626' }}>
              <span className="inline-flex items-center gap-2">
                <Icon icon={appIcons.error} className="h-4 w-4" />
                {error}
              </span>
            </section>
          )}

          {summary && (
            <section className="overflow-hidden rounded-lg border" style={{ background: panelBg, borderColor: panelBorder }}>
              <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between" style={{ borderColor: panelBorder }}>
                <div>
                  <h2 className="text-base font-semibold" style={{ color: text }}>
                    Matched titles
                  </h2>
                  <p className="text-sm" style={{ color: soft }}>
                    Showing {rows.length.toLocaleString()} of {rowTotal.toLocaleString()} rows
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => {
                        setRowFilter(filter.value);
                        setRowLimit(100);
                      }}
                      className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
                      style={{
                        borderColor: panelBorder,
                        background: rowFilter === filter.value ? 'var(--cs-primary-soft)' : muted,
                        color: rowFilter === filter.value ? primary : soft,
                      }}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead style={{ color: faint }}>
                    <tr className="border-b" style={{ borderColor: panelBorder }}>
                      <th className="w-16 px-4 py-3 font-medium">#</th>
                      <th className="min-w-[220px] px-4 py-3 font-medium">Input</th>
                      <th className="min-w-[130px] px-4 py-3 font-medium">Status</th>
                      <th className="min-w-[260px] px-4 py-3 font-medium">GoodNovel match</th>
                      <th className="min-w-[130px] px-4 py-3 font-medium">Free</th>
                      <th className="min-w-[220px] px-4 py-3 font-medium">Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.index} className="border-b align-top last:border-b-0" style={{ borderColor: panelBorder }}>
                        <td className="px-4 py-3" style={{ color: faint }}>{row.index}</td>
                        <td className="px-4 py-3 font-medium" style={{ color: text }}>{row.input_title}</td>
                        <td className="px-4 py-3">
                          <StatusChip row={row} />
                        </td>
                        <td className="px-4 py-3">
                          {row.url ? (
                            <a href={row.url} target="_blank" rel="noopener noreferrer" className="font-medium underline hover:no-underline" style={{ color: text }}>
                              {row.matched_title || row.url}
                            </a>
                          ) : (
                            <span style={{ color: soft }}>{row.error || 'No match'}</span>
                          )}
                          {row.author && <div className="mt-1 text-xs" style={{ color: soft }}>{row.author}</div>}
                          {row.status === 'ambiguous' && row.candidates.length > 0 && (
                            <div className="mt-1 text-xs" style={{ color: soft }}>
                              Top candidate score: {Math.round(row.candidates[0].score * 100)}%
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3" style={{ color: soft }}>
                          {row.free_chapters != null ? `${row.free_chapters}/${row.total_chapters ?? '-'}` : '-'}
                          {row.crawled_chapters > 0 && <div className="text-xs">{row.crawled_chapters} saved</div>}
                        </td>
                        <td className="px-4 py-3" style={{ color: soft }}>
                          {row.output_file || row.error || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rows.length === 0 && (
                <div className="px-6 py-10 text-center text-sm" style={{ color: soft }}>
                  {rowsLoading ? 'Loading rows...' : 'No rows for this filter.'}
                </div>
              )}

              {rows.length < rowTotal && (
                <div className="border-t px-4 py-4 sm:px-5" style={{ borderColor: panelBorder }}>
                  <button
                    type="button"
                    onClick={() => setRowLimit((value) => value + 100)}
                    disabled={rowsLoading}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
                    style={{ borderColor: panelBorder, background: muted, color: text }}
                  >
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

function NumberField({
  label,
  value,
  min,
  max,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase" style={{ color: 'var(--cs-text-faint)' }}>
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(clampNumber(Number.parseInt(event.target.value) || min, min, max))}
        className="w-36 rounded-md border px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: 'var(--cs-surface-muted)', borderColor: 'var(--cs-border)', color: 'var(--cs-text)' }}
      />
    </label>
  );
}

function DecimalField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase" style={{ color: 'var(--cs-text-faint)' }}>
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(clampNumber(Number.parseFloat(event.target.value) || min, min, max))}
        className="w-36 rounded-md border px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--cs-surface-muted)', borderColor: 'var(--cs-border)', color: 'var(--cs-text)' }}
      />
    </label>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--cs-border)', background: 'var(--cs-surface-muted)' }}>
      <div className="text-xs" style={{ color: 'var(--cs-text-faint)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--cs-text)' }}>{value.toLocaleString()}</div>
    </div>
  );
}

function Progress({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--cs-text-soft)' }}>
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--cs-surface-muted)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: 'var(--cs-primary)' }} />
      </div>
    </div>
  );
}

function StatusChip({ row }: { readonly row: GoodNovelBatchRow }) {
  const label = row.crawl_status === 'completed'
    ? 'Crawled'
    : row.crawl_status === 'failed'
      ? 'Crawl failed'
      : row.crawl_status === 'skipped'
        ? 'Skipped'
        : row.crawl_status === 'crawling'
          ? 'Crawling'
          : row.status === 'found'
            ? 'Found'
            : row.status === 'not_found'
              ? 'Not found'
              : row.status.charAt(0).toUpperCase() + row.status.slice(1);
  const tone = row.crawl_status === 'completed' || row.status === 'found'
    ? 'success'
    : row.status === 'ambiguous' || row.crawl_status === 'skipped'
      ? 'warning'
      : row.status === 'not_found' || row.status === 'error' || row.crawl_status === 'failed'
        ? 'danger'
        : 'neutral';
  const colors = {
    success: { bg: 'rgba(34,197,94,0.1)', color: '#16a34a', border: 'rgba(34,197,94,0.22)' },
    warning: { bg: 'rgba(245,158,11,0.1)', color: '#d97706', border: 'rgba(245,158,11,0.24)' },
    danger: { bg: 'rgba(239,68,68,0.1)', color: '#dc2626', border: 'rgba(239,68,68,0.24)' },
    neutral: { bg: 'var(--cs-surface-muted)', color: 'var(--cs-text-soft)', border: 'var(--cs-border)' },
  }[tone];
  return (
    <span className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold" style={{ background: colors.bg, color: colors.color, borderColor: colors.border }}>
      {label}
    </span>
  );
}

function countTitles(text: string, delimiter: DelimiterMode): number {
  const raw = text.trim();
  if (!raw) return 0;
  const parts = delimiter === 'newline' ? raw.split(/\r?\n/) : raw.split(';');
  return parts.map((part) => part.trim()).filter(Boolean).length;
}

function phaseLabel(phase: GoodNovelBatchSummary['phase']): string {
  const labels: Record<GoodNovelBatchSummary['phase'], string> = {
    scanning: 'Scanning titles',
    scan_completed: 'Scan complete',
    crawling: 'Crawling free chapters',
    completed: 'Completed',
    failed: 'Failed',
  };
  return labels[phase] ?? phase;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
