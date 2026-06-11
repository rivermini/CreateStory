import { type ReactNode } from 'react';

export interface StatsPanelProps {
  readonly chaptersCrawled: number;
  readonly chaptersTotal: number;
  readonly status: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly isDark?: boolean;
}

function formatDuration(started: string | null, finished: string | null): string {
  if (!started || !finished) return '—';
  try {
    const s = new Date(started).getTime();
    const f = new Date(finished).getTime();
    const secs = Math.floor((f - s) / 1000);
    const mins = Math.floor(secs / 60);
    const secsRem = secs % 60;
    return `${mins}m ${secsRem}s`;
  } catch {
    return '—';
  }
}

function formatTs(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

export function StatsPanel({ chaptersCrawled, chaptersTotal, status, startedAt, finishedAt, isDark = true }: StatsPanelProps) {
  const target = chaptersTotal > 0 ? chaptersTotal : 'N/A';
  const duration = formatDuration(startedAt, finishedAt);

  const statusColorMap: Record<string, { dot: string; text: string; dotBg?: string }> = {
    running: { dot: '#4ade80', text: isDark ? 'rgba(255,255,255,0.92)' : '#111111', dotBg: 'rgba(74,222,128,0.15)' },
    completed: { dot: '#22c55e', text: isDark ? 'rgba(255,255,255,0.92)' : '#111111', dotBg: 'rgba(34,197,94,0.15)' },
    failed: { dot: '#f87171', text: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)', dotBg: 'rgba(248,113,113,0.15)' },
    cancelled: { dot: '#fbbf24', text: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)', dotBg: 'rgba(251,191,36,0.15)' },
    idle: { dot: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)', text: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' },
  };

  const dot = statusColorMap[status]?.dot ?? (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)');
  const text = statusColorMap[status]?.text ?? (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)');
  const dotBg = statusColorMap[status]?.dotBg;
  const label = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
      <StatCard
        label="Chapters Scraped"
        value={chaptersCrawled}
        sub={chaptersTotal > 0 ? `of ${chaptersTotal}` : undefined}
        isDark={isDark}
      />
      <StatCard
        label="Target"
        value={target}
        isDark={isDark}
      />
      <StatCard
        label="Status"
        value={(
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: dot, ...(status === 'running' ? { animation: 'pulse 2s infinite' } : {}) }} />
            <span style={{ color: text }}>{label}</span>
          </span>
        )}
        dotBg={dotBg}
        isDark={isDark}
      />
      <StatCard
        label="Duration"
        value={duration}
        sub={startedAt ? `Started ${formatTs(startedAt)}` : undefined}
        isDark={isDark}
      />
    </div>
  );
}

function StatCard({ label, value, sub, dotBg, isDark }: {
  readonly label: string;
  readonly value: ReactNode;
  readonly sub?: string;
  readonly dotBg?: string;
  readonly isDark: boolean;
}) {
  return (
    <div
      className="rounded-xl border px-3.5 py-3"
      style={{
        background: dotBg ?? (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(17,17,17,0.04)'),
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)',
      }}
    >
      <p className={`mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{label}</p>
      <p className="text-lg font-semibold sm:text-xl" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)' }}>{value}</p>
      {sub && <p className={`mt-1 text-[11px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{sub}</p>}
    </div>
  );
}
