import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  checkJobnibCookies,
  crawlJobnibBatch,
  exportJobnibBatchCatalog,
  getJobnibBatchDownloadUrl,
  getJobnibBatchRows,
  getJobnibBatchStatus,
  importJobnibCatalog,
  listJobnibBatches,
  pauseJobnibBatch,
  removeJobnibBatch,
  retryJobnibFailedStories,
  retryJobnibSessionStories,
  startJobnibBatch,
  type JobnibBatchRow,
  type JobnibBatchSummary,
  type JobnibCrawlMode,
  type JobnibCookieStatusResponse,
} from '../../api';
import { downloadWithAuth } from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';
import type { ThemeMode } from '../../types/theme';
import { getInkittLogTone, inkittLogToneClass, splitInkittLogLine } from './inkittLogUtils';
import { JobnibBrowserCapturePanel } from './JobnibBrowserCapturePanel';

interface Props { readonly themeMode: ThemeMode }

const ROW_LIMIT = 500;
const FILTERS = [
  ['all', 'All'], ['completed', 'Exported'], ['needs_session', 'Needs session'],
  ['failed', 'Failed'], ['crawling', 'Crawling'], ['queued', 'Queued'], ['skipped', 'Skipped'],
] as const;

function downloadJson(payload: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function duration(seconds?: number | null) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-';
  const value = Math.max(0, Math.round(seconds));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m` : `${value}s`;
}

function modeDescription(mode: JobnibCrawlMode) {
  return mode === 'fast' ? '2 stories · 4 request slots · 0.75s minimum' : '1 story · 2 request slots · 1.5s minimum';
}

export function JobnibBatchPage({ themeMode }: Props) {
  const isDark = themeMode === 'dark';
  const [batchName, setBatchName] = useState('Jobnib completed stories');
  const [mode, setMode] = useState<JobnibCrawlMode>('slow');
  const [storiesPerRun, setStoriesPerRun] = useState(20);
  const [batchId, setBatchId] = useState(() => sessionStorage.getItem('jobnib_batch_id') || '');
  const [summary, setSummary] = useState<JobnibBatchSummary | null>(null);
  const [history, setHistory] = useState<JobnibBatchSummary[]>([]);
  const [rows, setRows] = useState<JobnibBatchRow[]>([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [filter, setFilter] = useState('all');
  const [session, setSession] = useState<JobnibCookieStatusResponse | null>(null);
  const [browserCaptureActive, setBrowserCaptureActive] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const statusBusy = useRef(false);
  const rowsBusy = useRef(false);
  const historyBusy = useRef(false);
  const rowsRequestKey = `${batchId}|${filter}`;
  const rowsRequestKeyRef = useRef(rowsRequestKey);
  rowsRequestKeyRef.current = rowsRequestKey;

  const active = summary?.phase === 'discovering' || summary?.phase === 'crawling';
  const interactionLocked = active || browserCaptureActive;
  const loadedRows = Math.max(ROW_LIMIT, rows.length);
  const estimate = summary?.crawl_estimate;
  const progress = summary?.total_chapters
    ? Math.min(100, Math.round((summary.crawled_chapters / summary.total_chapters) * 1000) / 10)
    : 0;

  const fetchStatus = useCallback(async () => {
    if (!batchId || statusBusy.current) return;
    statusBusy.current = true;
    try { setSummary(await getJobnibBatchStatus(batchId)); } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh Jobnib batch.');
    } finally { statusBusy.current = false; }
  }, [batchId]);

  const fetchRows = useCallback(async () => {
    if (!batchId || rowsBusy.current) return;
    rowsBusy.current = true;
    const requestKey = `${batchId}|${filter}`;
    try {
      const items: JobnibBatchRow[] = [];
      let offset = 0;
      let response = null as Awaited<ReturnType<typeof getJobnibBatchRows>> | null;
      while (offset < loadedRows) {
        const pageSize = Math.min(ROW_LIMIT, loadedRows - offset);
        response = await getJobnibBatchRows(batchId, { offset, limit: pageSize, status: filter });
        items.push(...response.items);
        offset += response.items.length;
        if (response.items.length < pageSize || offset >= response.total) break;
      }
      if (rowsRequestKeyRef.current === requestKey && response) {
        setRows(items); setRowTotal(response.total); setSummary(response.batch);
      }
    } catch (err) { if (rowsRequestKeyRef.current === requestKey) setError(err instanceof Error ? err.message : 'Failed to refresh Jobnib rows.'); }
    finally { rowsBusy.current = false; }
  }, [batchId, filter, loadedRows]);

  const loadMoreRows = async () => {
    if (!batchId || rowsBusy.current || rows.length >= rowTotal) return;
    rowsBusy.current = true; setBusy('rows');
    const requestKey = `${batchId}|${filter}`;
    try {
      const response = await getJobnibBatchRows(batchId, { offset: rows.length, limit: ROW_LIMIT, status: filter });
      if (rowsRequestKeyRef.current === requestKey) {
        setRows((current) => [...current, ...response.items]); setRowTotal(response.total); setSummary(response.batch);
      }
    } catch (err) { if (rowsRequestKeyRef.current === requestKey) setError(err instanceof Error ? err.message : 'Failed to load more Jobnib rows.'); }
    finally { rowsBusy.current = false; setBusy(''); }
  };

  const fetchHistory = useCallback(async () => {
    if (historyBusy.current) return;
    historyBusy.current = true;
    try { setHistory(await listJobnibBatches()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load Jobnib history.'); }
    finally { historyBusy.current = false; }
  }, []);

  useEffect(() => { void fetchHistory(); }, [fetchHistory]);
  useEffect(() => {
    if (!batchId) { setSummary(null); setRows([]); return; }
    sessionStorage.setItem('jobnib_batch_id', batchId);
    void Promise.all([fetchStatus(), fetchRows()]);
  }, [batchId, fetchRows, fetchStatus]);
  useEffect(() => { void fetchRows(); }, [filter, fetchRows]);
  useEffect(() => {
    if (!active) return;
    const statusTimer = window.setInterval(() => { void fetchStatus(); }, 2500);
    const rowsTimer = window.setInterval(() => { void fetchRows(); }, 10000);
    const historyTimer = window.setInterval(() => { void fetchHistory(); }, 30000);
    return () => { window.clearInterval(statusTimer); window.clearInterval(rowsTimer); window.clearInterval(historyTimer); };
  }, [active, fetchHistory, fetchRows, fetchStatus]);
  useEffect(() => { if (!active) void fetchHistory(); }, [active, fetchHistory, summary?.phase]);

  const act = useCallback(async (name: string, action: () => Promise<JobnibBatchSummary>) => {
    setBusy(name); setError('');
    try {
      const next = await action();
      setSummary(next); setBatchId(next.batch_id);
      await Promise.all([fetchRows(), fetchHistory()]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Jobnib action failed.'); }
    finally { setBusy(''); }
  }, [fetchHistory, fetchRows]);

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy('import'); setError('');
    try {
      const text = await file.text();
      let payload: unknown = { text };
      if (file.name.toLowerCase().endsWith('.json')) payload = JSON.parse(text);
      const response = await importJobnibCatalog(payload);
      setBatchId(response.batch.batch_id); setSummary(response.batch); await fetchHistory();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not import the Jobnib catalog.'); }
    finally { setBusy(''); }
  };

  const checkSession = async () => {
    setBusy('session'); setError('');
    try { setSession(await checkJobnibCookies()); } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not test the Jobnib session.');
    } finally { setBusy(''); }
  };

  const downloadBatch = async (targetBatchId: string) => {
    if (!targetBatchId) return;
    const target = `download:${targetBatchId}`;
    setBusy(target); setError('');
    try {
      await downloadWithAuth(
        getJobnibBatchDownloadUrl(targetBatchId),
        `jobnib_batch_${targetBatchId}.zip`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download Jobnib ZIP.');
    } finally {
      setBusy('');
    }
  };

  const refreshAfterBrowserCapture = useCallback(() => {
    void fetchStatus();
    void fetchRows();
  }, [fetchRows, fetchStatus]);

  const statCards = useMemo(() => summary ? [
    ['Homepage found', summary.discovery.archive_found], ['Completed', summary.discovery.completed_eligible],
    ['Excluded', summary.discovery.excluded], ['Exported', summary.completed_count],
    ['Needs session', summary.needs_session_count], ['Failed', summary.failed_count],
  ] : [], [summary]);

  const panel = 'var(--cs-surface-elevated)';
  const border = 'var(--cs-border)';
  const muted = 'var(--cs-surface-muted)';
  const text = 'var(--cs-text)';
  const soft = 'var(--cs-text-soft)';
  const faint = 'var(--cs-text-faint)';
  const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
  const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-50';

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: 'var(--cs-page)', color: text }}>
      <main className="mx-auto w-full max-w-7xl space-y-4 px-3 py-4 sm:px-5 lg:px-6">
        <section className="rounded-xl border p-4 sm:p-5" style={{ background: panel, borderColor: border }}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div><div className="text-xs font-semibold uppercase" style={{ color: faint }}>Novel crawler</div><h1 className="mt-1 text-2xl font-semibold">Jobnib Batch</h1><p className="mt-1 text-sm" style={{ color: soft }}>Completed stories only · full chapters only · safe checkpoint resume</p></div>
            <div className="flex flex-wrap gap-2">
              <span className={secondaryButton} style={{ borderColor: border, background: muted }} title="Open the workspace gear, then choose Jobnib Session"><Icon icon={appIcons.settings} className="h-4 w-4" />Session settings: workspace gear</span>
              <button type="button" onClick={() => void checkSession()} disabled={busy === 'session'} className={secondaryButton} style={{ borderColor: border, background: muted }}><Icon icon={busy === 'session' ? appIcons.spinner : appIcons.shield} className={`h-4 w-4 ${busy === 'session' ? 'animate-spin' : ''}`} />Test session</button>
            </div>
          </div>
          {(session || summary?.session.required) && <div className="mt-4 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: session?.valid ? 'rgba(34,197,94,.4)' : 'rgba(245,158,11,.45)', background: session?.valid ? 'rgba(34,197,94,.08)' : 'rgba(245,158,11,.08)' }}>{session?.message || summary?.session.last_error || 'Jobnib needs a refreshed browser session.'}</div>}
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-xl border p-4 sm:p-5" style={{ background: panel, borderColor: border }}>
            <h2 className="text-base font-semibold">Batch setup</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="sm:col-span-2 lg:col-span-3"><span className="text-xs font-semibold uppercase" style={{ color: faint }}>Name</span><input value={batchName} onChange={(e) => setBatchName(e.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" style={{ background: muted, borderColor: border }} /></label>
              <div><span className="text-xs font-semibold uppercase" style={{ color: faint }}>Discovery source</span><div className="mt-1 flex h-10 items-center rounded-lg border px-3 text-sm" style={{ background: muted, borderColor: border }}>Current Jobnib homepage</div></div>
              <label><span className="text-xs font-semibold uppercase" style={{ color: faint }}>Stories per run</span><input type="number" min={1} max={10000} value={storiesPerRun} onChange={(e) => setStoriesPerRun(Number(e.target.value))} className="mt-1 h-10 w-full rounded-lg border px-3" style={{ background: muted, borderColor: border }} /></label>
              <div><span className="text-xs font-semibold uppercase" style={{ color: faint }}>Crawl mode</span><div className="mt-1 flex rounded-lg border p-1" style={{ borderColor: border, background: muted }}>{(['slow', 'fast'] as const).map((item) => <button type="button" key={item} onClick={() => setMode(item)} className="flex-1 rounded-md px-3 py-1.5 text-sm font-semibold capitalize" style={{ background: mode === item ? 'rgba(249,115,22,.18)' : 'transparent', color: mode === item ? 'var(--cs-primary)' : soft }}>{item}</button>)}</div></div>
            </div>
            <p className="mt-2 text-xs" style={{ color: faint }}>{modeDescription(mode)}{active && summary?.mode !== mode ? ' · applies to next run' : ''}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={primaryButton} disabled={!!busy || interactionLocked} onClick={() => void act('discover', () => startJobnibBatch({ batch_name: batchName, max_archive_pages: 1, mode, crawl_after_discovery: false }))}><Icon icon={busy === 'discover' ? appIcons.spinner : appIcons.search} className={`h-4 w-4 ${busy === 'discover' ? 'animate-spin' : ''}`} />Discover homepage</button>
              <button type="button" className={primaryButton} disabled={!!busy || interactionLocked || !batchId} onClick={() => void act('crawl', () => crawlJobnibBatch(batchId, { mode, max_stories: storiesPerRun }))}><Icon icon={busy === 'crawl' ? appIcons.spinner : appIcons.play} className={`h-4 w-4 ${busy === 'crawl' ? 'animate-spin' : ''}`} />Start/Resume crawl</button>
              {active && <button type="button" className={secondaryButton} disabled={!!busy || !!summary?.cancel_requested} onClick={() => void act('pause', () => pauseJobnibBatch(batchId))} style={{ borderColor: border, background: muted }}><Icon icon={appIcons.pause} className="h-4 w-4" />Graceful pause</button>}
              <button type="button" className={secondaryButton} disabled={!summary?.download_ready || !!busy} onClick={() => void downloadBatch(batchId)} style={{ borderColor: border, background: muted }}><Icon icon={busy === `download:${batchId}` ? appIcons.spinner : appIcons.download} className={`h-4 w-4 ${busy === `download:${batchId}` ? 'animate-spin' : ''}`} />{busy === `download:${batchId}` ? 'Preparing ZIP' : 'Download exported ZIP'}</button>
              <button type="button" className={secondaryButton} disabled={!!busy || interactionLocked} onClick={() => fileRef.current?.click()} style={{ borderColor: border, background: muted }}><Icon icon={busy === 'import' ? appIcons.spinner : appIcons.uploadFile} className={`h-4 w-4 ${busy === 'import' ? 'animate-spin' : ''}`} />Import catalog/URLs</button>
              <input ref={fileRef} type="file" accept=".json,.txt,.csv,application/json,text/plain,text/csv" onChange={(event) => void importFile(event)} className="hidden" />
            </div>
          </div>

          <aside className="rounded-xl border p-4" style={{ background: panel, borderColor: border }}>
            <h2 className="font-semibold">Current batch</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">{statCards.map(([label, value]) => <div key={String(label)} className="rounded-lg border p-3" style={{ background: muted, borderColor: border }}><div className="text-xs" style={{ color: faint }}>{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{Number(value).toLocaleString()}</div></div>)}</div>
            {summary && <><div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: muted }}><div className="h-full bg-orange-600" style={{ width: `${progress}%` }} /></div><div className="mt-2 flex justify-between text-xs" style={{ color: soft }}><span>{summary.crawled_chapters.toLocaleString()} / {summary.total_chapters.toLocaleString()} chapters</span><span>{progress}%</span></div></>}
          </aside>
        </section>

        <JobnibBrowserCapturePanel
          key={batchId}
          batchId={batchId}
          disabled={active || !!busy || !summary || summary.total_stories === 0}
          onActivity={refreshAfterBrowserCapture}
          onSessionActiveChange={setBrowserCaptureActive}
        />

        {error && <section className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)', color: isDark ? '#fca5a5' : '#dc2626' }}><Icon icon={appIcons.error} className="mr-2 inline h-4 w-4" />{error}</section>}

        {summary && <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-xl border p-4" style={{ background: panel, borderColor: border }}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Batch log</h2><p className="text-xs" style={{ color: faint }}>Latest {summary.log_lines.length} lines</p></div><Link to={`/jobnib-batch/${encodeURIComponent(summary.batch_id)}/full-logs`} className={secondaryButton} style={{ borderColor: border, background: muted }}>Full logs</Link></div>
            <div className="mt-3 max-h-64 overflow-auto rounded-lg border p-2 font-mono text-xs" style={{ borderColor: border, background: muted }}>{summary.log_lines.length ? summary.log_lines.slice().reverse().map((line, index) => { const parts = splitInkittLogLine(line); return <div key={`${index}-${line}`} className={`mb-1 rounded border-l-2 px-2 py-1 ${inkittLogToneClass(getInkittLogTone(line))}`}><span className="mr-2 opacity-60">{parts.time}</span>{parts.message}</div>; }) : <div className="p-5 text-center" style={{ color: faint }}>No log lines yet.</div>}</div>
          </div>
          <aside className="rounded-xl border p-4" style={{ background: panel, borderColor: border }}>
            <div className="flex items-center justify-between"><h2 className="font-semibold">Time estimate</h2><span className="rounded border px-2 py-1 text-xs capitalize" style={{ borderColor: border, color: soft }}>{summary.mode}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2">{[
              ['Remaining stories', estimate?.remaining_stories?.toLocaleString() || '-'],
              ['Remaining chapters', estimate?.remaining_chapters?.toLocaleString() || '-'],
              ['Speed', estimate?.chapters_per_hour ? `${Math.round(estimate.chapters_per_hour).toLocaleString()} ch/h` : '-'],
              ['Elapsed', duration(estimate?.elapsed_seconds)],
              ['ETA', duration(estimate?.estimated_remaining_seconds)],
              ['Cooldown', duration(summary.rate_limit?.cooldown_remaining_seconds)],
            ].map(([label, value]) => <div key={label} className="rounded-lg border p-2.5" style={{ background: muted, borderColor: border }}><div className="text-xs" style={{ color: faint }}>{label}</div><div className="mt-1 font-semibold tabular-nums">{value}</div></div>)}</div>
            <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: border, background: muted }}><div className="text-xs" style={{ color: faint }}>Finish</div><div className="mt-1 font-semibold">{estimate?.estimated_finished_at || '-'}</div></div>
          </aside>
        </section>}

        <section className="rounded-xl border p-4" style={{ background: panel, borderColor: border }}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Batch history</h2><p className="text-xs" style={{ color: faint }}>{history.length} retained batch(es)</p></div><button type="button" className={secondaryButton} onClick={() => void fetchHistory()} style={{ borderColor: border, background: muted }}><Icon icon={appIcons.refresh} className="h-4 w-4" />Refresh</button></div>
          <div className="mt-3 space-y-2">{history.map((item) => <div key={item.batch_id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: item.batch_id === batchId ? 'var(--cs-primary)' : border, background: muted }}><button type="button" onClick={() => setBatchId(item.batch_id)} className="min-w-0 text-left"><div className="truncate text-sm font-semibold">{item.batch_name || `Jobnib ${item.batch_id}`}</div><div className="mt-1 text-xs" style={{ color: faint }}>{item.created_at} · {item.completed_count.toLocaleString()} exports · {item.total_stories.toLocaleString()} stories · <span className="capitalize">{item.phase.replaceAll('_', ' ')}</span></div></button><div className="flex flex-wrap gap-2">
            {item.download_ready && <button type="button" className={secondaryButton} disabled={!!busy} onClick={() => void downloadBatch(item.batch_id)} style={{ borderColor: border }}><Icon icon={busy === `download:${item.batch_id}` ? appIcons.spinner : appIcons.download} className={`h-4 w-4 ${busy === `download:${item.batch_id}` ? 'animate-spin' : ''}`} />ZIP</button>}
            <button type="button" className={secondaryButton} onClick={() => { setBusy('export'); void exportJobnibBatchCatalog(item.batch_id).then((data) => downloadJson(data, `jobnib_catalog_${item.batch_id}.json`)).catch((err) => setError(err instanceof Error ? err.message : 'Export failed.')).finally(() => setBusy('')); }} style={{ borderColor: border }}><Icon icon={appIcons.download} className="h-4 w-4" />Catalog</button>
            {!['discovering', 'crawling'].includes(item.phase) && <button type="button" className={secondaryButton} onClick={() => { if (!window.confirm(`Delete ${item.batch_name}?`)) return; setBusy('delete'); void removeJobnibBatch(item.batch_id).then(() => { if (batchId === item.batch_id) setBatchId(''); return fetchHistory(); }).catch((err) => setError(err instanceof Error ? err.message : 'Delete failed.')).finally(() => setBusy('')); }} style={{ borderColor: border }}><Icon icon={appIcons.delete} className="h-4 w-4" /></button>}
          </div></div>)}</div>
        </section>

        {summary && <section className="overflow-hidden rounded-xl border" style={{ background: panel, borderColor: border }}>
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between" style={{ borderColor: border }}><div><h2 className="font-semibold">Stories</h2><p className="text-xs" style={{ color: faint }}>Showing {rows.length.toLocaleString()} of {rowTotal.toLocaleString()} rows</p></div><div className="flex flex-wrap gap-2">{FILTERS.map(([value, label]) => <button type="button" key={value} onClick={() => setFilter(value)} className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: filter === value ? 'var(--cs-primary)' : border, background: filter === value ? 'rgba(249,115,22,.15)' : muted }}>{label}</button>)}</div></div>
          {(summary.failed_count > 0 || summary.needs_session_count > 0) && <div className="flex flex-wrap gap-2 border-b px-4 py-3" style={{ borderColor: border }}>
            {summary.failed_count > 0 && <button type="button" className={secondaryButton} disabled={!!busy || browserCaptureActive} onClick={() => void act('retry-failed', () => retryJobnibFailedStories(batchId))} style={{ borderColor: border }}><Icon icon={appIcons.refresh} className="h-4 w-4" />Retry failed</button>}
            {summary.needs_session_count > 0 && <button type="button" className={secondaryButton} disabled={!!busy || browserCaptureActive} onClick={() => void act('retry-session', () => retryJobnibSessionStories(batchId))} style={{ borderColor: border }}><Icon icon={appIcons.shield} className="h-4 w-4" />Retry session rows</button>}
          </div>}
          <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead style={{ background: muted, color: faint }}><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Story</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Chapters</th><th className="px-4 py-3">Output / error</th></tr></thead><tbody>{rows.map((row) => <tr key={row.index} className="border-t align-top" style={{ borderColor: border }}><td className="px-4 py-3 tabular-nums">{row.index}</td><td className="px-4 py-3"><a href={row.url} target="_blank" rel="noreferrer" className="font-semibold underline">{row.title}</a><div className="mt-1 text-xs" style={{ color: faint }}>{row.author || row.story_id}</div></td><td className="px-4 py-3"><span className="rounded border px-2 py-1 text-xs capitalize" style={{ borderColor: border }}>{row.status.replaceAll('_', ' ')}</span></td><td className="px-4 py-3 tabular-nums">{row.crawled_chapters.toLocaleString()}/{row.total_chapters?.toLocaleString() ?? '-'}</td><td className="max-w-xl px-4 py-3 text-xs" style={{ color: row.error ? '#f59e0b' : soft }}>{row.error || row.output_file || '-'}</td></tr>)}</tbody></table>{rows.length === 0 && <div className="p-8 text-center text-sm" style={{ color: soft }}>No rows match this filter.</div>}</div>
          {rows.length < rowTotal && <div className="border-t p-3 text-center" style={{ borderColor: border }}><button type="button" onClick={() => void loadMoreRows()} disabled={busy === 'rows'} className={secondaryButton} style={{ borderColor: border, background: muted }}><Icon icon={busy === 'rows' ? appIcons.spinner : appIcons.add} className={`h-4 w-4 ${busy === 'rows' ? 'animate-spin' : ''}`} />Load more rows</button></div>}
        </section>}
      </main>
    </div>
  );
}
