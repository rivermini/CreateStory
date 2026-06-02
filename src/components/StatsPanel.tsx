import { type ReactNode } from 'react';

export interface StatsPanelProps {
  chaptersCrawled: number;
  chaptersTotal: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  isDark?: boolean;
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

  const statusDotMap: Record<string, string> = {
    running:   '#60a5fa',
    completed: '#34d399',
    failed:   '#f87171',
    cancelled: '#fbbf24',
    idle:     isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
  };

  const statusTextMap: Record<string, string> = {
    running:   '#60a5fa',
    completed: '#34d399',
    failed:   '#f87171',
    cancelled: '#fbbf24',
    idle:     isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
  };

  const dot = statusDotMap[status] ?? (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)');
  const text = statusTextMap[status] ?? (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)');
  const label = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
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

function StatCard({ label, value, sub, isDark }: {
  label: string;
  value: ReactNode;
  sub?: string;
  isDark: boolean;
}) {
  return (
    <div className="lg-glass-card p-4">
      <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${isDark ? 'text-white/30' : 'text-black/30'}`}>{label}</p>
      <p className="text-xl sm:text-2xl font-bold" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)' }}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${isDark ? 'text-white/30' : 'text-black/30'}`}>{sub}</p>}
    </div>
  );
}
