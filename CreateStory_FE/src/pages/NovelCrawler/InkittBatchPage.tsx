import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getInkittBatchDownloadUrl,
  getInkittBatchRows,
  getInkittBatchStatus,
  listInkittBatches,
  removeInkittBatch,
  startInkittBatch,
  type InkittBatchRow,
  type InkittBatchSummary,
} from '../../api';
import { downloadWithAuth } from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';
import type { ThemeMode } from '../../types/theme';

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

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Exported' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'failed', label: 'Failed' },
  { value: 'crawling', label: 'Crawling' },
  { value: 'queued', label: 'Queued' },
];

export function InkittBatchPage({ themeMode }: InkittBatchPageProps) {
  const isDark = themeMode === 'dark';
  const [batchName, setBatchName] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>(() => GENRES.map(([slug]) => slug));
  const [maxPages, setMaxPages] = useState(3);
  const [discoverConcurrency, setDiscoverConcurrency] = useState(4);
  const [crawlConcurrency, setCrawlConcurrency] = useState(2);
  const [requestDelaySeconds, setRequestDelaySeconds] = useState(0.35);
  const [batchId, setBatchId] = useState(() => sessionStorage.getItem('inkitt_batch_id') || '');
  const [summary, setSummary] = useState<InkittBatchSummary | null>(null);
  const [history, setHistory] = useState<InkittBatchSummary[]>([]);
  const [rows, setRows] = useState<InkittBatchRow[]>([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowLimit, setRowLimit] = useState(100);
  const [rowFilter, setRowFilter] = useState('all');
  const [isStarting, setIsStarting] = useState(false);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InkittBatchSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const active = summary?.phase === 'running';
  const progressPercent = summary && summary.total_stories > 0
    ? Math.round((summary.processed_count / summary.total_stories) * 100)
    : active ? 5 : 0;
  const selectedGenreLabels = useMemo(
    () => GENRES.filter(([slug]) => selectedGenres.includes(slug)).map(([, label]) => label),
    [selectedGenres],
  );

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

  const fetchRows = useCallback(() => {
    if (!batchId) return;
    setRowsLoading(true);
    getInkittBatchRows(batchId, { offset: 0, limit: rowLimit, status: rowFilter })
      .then((response) => {
        setRows(response.items);
        setRowTotal(response.total);
        setSummary(response.batch);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Inkitt batch rows.'))
      .finally(() => setRowsLoading(false));
  }, [batchId, rowFilter, rowLimit]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!batchId) return;
    sessionStorage.setItem('inkitt_batch_id', batchId);
    fetchRows();
  }, [batchId, fetchRows]);

  useEffect(() => {
    if (!batchId || !active) return;
    const id = window.setInterval(() => {
      fetchStatus();
      fetchRows();
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

  const handleStart = async () => {
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
      });
      setBatchId(response.batch_id);
      setSummary(response);
      setRows([]);
      setRowTotal(0);
      setRowFilter('all');
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Inkitt batch.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleDownload = () => {
    if (!batchId) return;
    void downloadWithAuth(getInkittBatchDownloadUrl(batchId), `inkitt_batch_${batchId}.zip`);
  };

  const handleSelectBatch = (batch: InkittBatchSummary) => {
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
                <NumberField label="Pages/genre" value={maxPages} min={1} max={25} onChange={setMaxPages} />
                <NumberField label="Discover workers" value={discoverConcurrency} min={1} max={6} onChange={setDiscoverConcurrency} />
                <NumberField label="Crawl workers" value={crawlConcurrency} min={1} max={4} onChange={setCrawlConcurrency} />
                <DecimalField label="Delay seconds" value={requestDelaySeconds} min={0} max={5} step={0.05} onChange={setRequestDelaySeconds} />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={isStarting || active || selectedGenres.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: primary, color: '#fff' }}
                >
                  {isStarting ? <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" /> : <Icon icon={appIcons.play} className="h-4 w-4" />}
                  Start batch
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!summary?.download_ready}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: panelBorder, background: muted, color: text }}
                >
                  <Icon icon={appIcons.download} className="h-4 w-4" />
                  Download ZIP
                </button>
              </div>
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
              </div>
              <div className="mt-4">
                <Progress label="Progress" value={progressPercent} />
              </div>
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
                        <button type="button" onClick={() => setDeleteTarget(batch)} disabled={batch.phase === 'running'} className="inline-flex h-9 w-9 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-45" style={{ borderColor: panelBorder, background: muted, color: batch.phase === 'running' ? faint : '#dc2626' }}>
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

          {summary && (
            <section className="overflow-hidden rounded-lg border" style={{ background: panelBg, borderColor: panelBorder }}>
              <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between" style={{ borderColor: panelBorder }}>
                <div>
                  <h2 className="text-base font-semibold" style={{ color: text }}>Stories</h2>
                  <p className="text-sm" style={{ color: soft }}>Showing {rows.length.toLocaleString()} of {rowTotal.toLocaleString()} rows</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map((filter) => (
                    <button key={filter.value} type="button" onClick={() => { setRowFilter(filter.value); setRowLimit(100); }} className="rounded-md border px-2.5 py-1.5 text-xs font-medium" style={{ borderColor: panelBorder, background: rowFilter === filter.value ? 'var(--cs-primary-soft)' : muted, color: rowFilter === filter.value ? primary : soft }}>
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
                        <td className="px-4 py-3" style={{ color: soft }}>{row.output_file || row.error || '-'}</td>
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
                  <button type="button" onClick={() => setRowLimit((value) => value + 100)} disabled={rowsLoading} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60" style={{ borderColor: panelBorder, background: muted, color: text }}>
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
      <div className="mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--cs-text-soft)' }}><span>{label}</span><span>{value}%</span></div>
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
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
  };
  return labels[phase] ?? phase;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
