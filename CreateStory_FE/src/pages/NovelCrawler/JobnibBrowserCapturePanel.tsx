import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  closeJobnibBrowserCapture,
  getJobnibBrowserCaptureStatus,
  pairJobnibBrowserCapture,
  type JobnibBrowserCapturePairResponse,
  type JobnibBrowserCaptureStatus,
} from '../../api';
import { BASE_URL } from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { createJobnibPairingCode } from './jobnibPairingCode';

interface Props {
  readonly batchId: string;
  readonly selectedRowIndex: number | null;
  readonly selectedStoryTitle?: string;
  readonly selectedStoryStatus?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onActivity?: () => void;
  readonly onSessionActiveChange?: (active: boolean) => void;
}

function formatExpiry(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export function JobnibBrowserCapturePanel({ batchId, selectedRowIndex, selectedStoryTitle = '', selectedStoryStatus = '', disabled = false, disabledReason = '', onActivity, onSessionActiveChange }: Props) {
  const [pairing, setPairing] = useState<JobnibBrowserCapturePairResponse | null>(null);
  const [status, setStatus] = useState<JobnibBrowserCaptureStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const polling = useRef(false);
  const lastProgressSnapshot = useRef('');
  const code = useMemo(
    () => pairing ? createJobnibPairingCode(pairing, BASE_URL || window.location.origin) : '',
    [pairing],
  );
  const active = pairing?.status === 'active' && (!status || status.status === 'active');
  const assignment = status?.active_assignment;
  const chapterProgress = assignment?.total_chapters
    ? Math.min(100, Math.round((assignment.completed_chapters / assignment.total_chapters) * 1000) / 10)
    : 0;
  const batchProgress = status?.batch.total_chapters
    ? Math.min(100, Math.round((status.batch.crawled_chapters / status.batch.total_chapters) * 1000) / 10)
    : 0;
  const pairingLabel = !status
    ? 'Pairing ready'
    : status.status !== 'active'
      ? status.status
      : status.batch.phase === 'completed'
        ? 'Complete'
        : assignment
          ? 'Waiting for unlock / capture'
          : status.submitted_chapters > 0 || status.reported_events > 0
            ? 'Companion paired / preparing next'
            : 'Waiting for companion';

  const refresh = useCallback(async () => {
    if (!pairing || polling.current) return;
    polling.current = true;
    try {
      const next = await getJobnibBrowserCaptureStatus(
        pairing.batch_id,
        pairing.pairing_id,
        pairing.pairing_token,
      );
      setStatus(next);
      setError('');
      const progressSnapshot = `${next.status}|${next.submitted_chapters}|${next.batch.phase}|${next.batch.crawled_chapters}`;
      if (lastProgressSnapshot.current !== progressSnapshot) {
        lastProgressSnapshot.current = progressSnapshot;
        onActivity?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh the browser-assisted session.');
    } finally {
      polling.current = false;
    }
  }, [onActivity, pairing]);

  useEffect(() => {
    if (!active) return;
    const initialTimer = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [active, refresh]);

  useEffect(() => {
    onSessionActiveChange?.(active);
    return () => { if (active) onSessionActiveChange?.(false); };
  }, [active, onSessionActiveChange]);

  const start = async () => {
    setBusy('pair');
    setError('');
    setNotice('');
    try {
      const next = await pairJobnibBrowserCapture(batchId, {
        ttl_seconds: 900,
        row_index: selectedRowIndex ?? undefined,
      });
      setPairing(next);
      setStatus(null);
      lastProgressSnapshot.current = '';
      setNotice(`Pairing created for ${selectedStoryTitle || 'the selected story'}. Open the companion and paste the one-time code below.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a browser-assisted session.');
    } finally {
      setBusy('');
    }
  };

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically. Select the pairing code and copy it manually.');
    }
  };

  const close = async () => {
    if (!pairing) return;
    setBusy('close');
    setError('');
    try {
      const response = await closeJobnibBrowserCapture(
        pairing.batch_id,
        pairing.pairing_id,
        pairing.pairing_token,
      );
      setNotice(`Assisted session closed after ${response.submitted_chapters.toLocaleString()} captured chapter(s).`);
      setPairing(null);
      setStatus(null);
      onActivity?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close the browser-assisted session.');
    } finally {
      setBusy('');
    }
  };

  const panel = 'var(--cs-surface-elevated)';
  const border = 'var(--cs-border)';
  const muted = 'var(--cs-surface-muted)';
  const soft = 'var(--cs-text-soft)';
  const faint = 'var(--cs-text-faint)';
  const primaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section className="rounded-2xl border p-4 sm:p-5" style={{ background: panel, borderColor: border }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-600 text-sm font-bold text-white">2</span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Browser-assisted full capture</h2>
              <span className="rounded-full border px-2 py-0.5 text-xs font-semibold" style={{ borderColor: 'rgba(34,197,94,.4)', background: 'rgba(34,197,94,.08)', color: '#22c55e' }}>Only capture method</span>
            </div>
            <p className="mt-1 max-w-3xl text-sm" style={{ color: soft }}>
              Select one story from the list, then the companion captures only that story through visible Chrome.
            </p>
          </div>
        </div>
        {!pairing ? (
          <div>
            <button type="button" className={primaryButton} disabled={disabled || !batchId || !selectedRowIndex || !!busy} onClick={() => void start()}>
              <Icon icon={busy === 'pair' ? appIcons.spinner : appIcons.link} className={`h-4 w-4 ${busy === 'pair' ? 'animate-spin' : ''}`} />
              Create pairing code
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} disabled={busy === 'close'} onClick={() => void refresh()} style={{ borderColor: border, background: muted }}>
              <Icon icon={appIcons.refresh} className="h-4 w-4" />Refresh
            </button>
            <button type="button" className={secondaryButton} disabled={busy === 'close'} onClick={() => void close()} style={{ borderColor: border, background: muted }}>
              <Icon icon={busy === 'close' ? appIcons.spinner : appIcons.stop} className={`h-4 w-4 ${busy === 'close' ? 'animate-spin' : ''}`} />End session
            </button>
          </div>
        )}
      </div>

      {!pairing && disabledReason && <div className="mt-4 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: border, background: muted, color: soft }}><Icon icon={appIcons.info} className="mr-2 inline h-4 w-4" />{disabledReason}</div>}
      {!pairing && selectedRowIndex && <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: border, background: muted }}><Icon icon={appIcons.checkCircle} className="h-4 w-4 text-emerald-500" /><span style={{ color: soft }}>Selected story:</span><strong>{selectedStoryTitle || `Story #${selectedRowIndex}`}</strong>{selectedStoryStatus && <span className="rounded-full border px-2 py-0.5 text-xs capitalize" style={{ borderColor: border }}>{selectedStoryStatus}</span>}</div>}

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {[
          ['1. Download once', 'Download and open the standalone Windows capture tool. No repository or Node.js installation is required.'],
          ['2. Select and pair', 'Choose one story in the list, create its short-lived pairing code, then paste it into the tool.'],
          ['3. Unlock and capture', 'Use Jobnib normally in Chrome. Each full validated chapter is submitted before the companion advances.'],
        ].map(([title, body]) => (
          <div key={title} className="rounded-lg border p-3" style={{ borderColor: border, background: muted }}>
            <div className="text-sm font-semibold">{title}</div>
            <p className="mt-1 text-xs leading-5" style={{ color: soft }}>{body}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: 'rgba(245,158,11,.4)', background: 'rgba(245,158,11,.07)', color: soft }}>
        <Icon icon={appIcons.info} className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>This mode does not solve or bypass CAPTCHA/Turnstile. It waits for your normal browser interaction and never exports preview-only chapters as complete.</span>
      </div>

      {pairing && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border p-3" style={{ borderColor: border, background: muted }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase" style={{ color: faint }}>One-time pairing code</div>
                <div className="mt-1 text-xs" style={{ color: soft }}>Pairing {pairing.pairing_id} · expires {formatExpiry(pairing.expires_at)}</div>
              </div>
              <button type="button" className={secondaryButton} onClick={() => void copyCommand()} style={{ borderColor: border }}>
                <Icon icon={copied ? appIcons.check : appIcons.link} className="h-4 w-4" />{copied ? 'Copied' : 'Copy pairing code'}
              </button>
            </div>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-md border p-3 text-xs" style={{ borderColor: border, background: 'var(--cs-page)' }}>{code}</pre>
            <p className="mt-2 text-xs" style={{ color: '#f59e0b' }}>The pairing code contains a temporary secret. Do not share it. It expires automatically and disappears from this page on refresh.</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="rounded-lg border p-3" style={{ borderColor: border, background: muted }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Current chapter</div>
                <span className="rounded-full border px-2 py-1 text-xs font-semibold capitalize" style={{ borderColor: border }}>
                  {pairingLabel}
                </span>
              </div>
              {assignment ? (
                <div className="mt-3">
                  <a href={assignment.url} target="_blank" rel="noreferrer" className="font-semibold underline">{assignment.story_title}</a>
                  <div className="mt-1 text-sm" style={{ color: soft }}>
                    {assignment.volume_label ? `${assignment.volume_label} · ` : ''}{assignment.chapter_title || `Chapter ${assignment.displayed_chapter_number ?? assignment.sequence_index}`}
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'var(--cs-page)' }}><div className="h-full bg-orange-600" style={{ width: `${chapterProgress}%` }} /></div>
                  <div className="mt-1 flex justify-between text-xs" style={{ color: faint }}><span>{assignment.completed_chapters.toLocaleString()} / {assignment.total_chapters.toLocaleString()} chapters</span><span>{chapterProgress}%</span></div>
                  <p className="mt-3 text-xs" style={{ color: soft }}>Expected segments: {assignment.expected_segment_ids.length || 'checking'}.</p>
                </div>
              ) : (
                <p className="mt-3 text-sm" style={{ color: soft }}>Open the companion and paste the pairing code. It will request the next eligible chapter and open it in Chrome.</p>
              )}
            </div>

            <div className="rounded-lg border p-3" style={{ borderColor: border, background: muted }}>
              <div className="text-xs font-semibold uppercase" style={{ color: faint }}>Session progress</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{status?.submitted_chapters.toLocaleString() ?? 0}</div>
              <div className="text-xs" style={{ color: soft }}>full chapters submitted</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'var(--cs-page)' }}><div className="h-full bg-emerald-500" style={{ width: `${batchProgress}%` }} /></div>
              <div className="mt-1 flex justify-between text-xs" style={{ color: faint }}><span>{status?.batch.crawled_chapters.toLocaleString() ?? 0} / {status?.batch.total_chapters.toLocaleString() ?? 0}</span><span>{batchProgress}%</span></div>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'rgba(34,197,94,.35)', background: 'rgba(34,197,94,.08)' }}>{notice}</div>}
      {error && <div className="mt-3 rounded-lg border px-3 py-2 text-sm text-red-500" style={{ borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)' }}><Icon icon={appIcons.error} className="mr-2 inline h-4 w-4" />{error}</div>}
    </section>
  );
}
