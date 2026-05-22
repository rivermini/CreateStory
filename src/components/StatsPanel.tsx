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
    running:   isDark ? 'bg-blue-500'   : 'bg-blue-500',
    completed: isDark ? 'bg-emerald-500' : 'bg-emerald-500',
    failed:   isDark ? 'bg-red-500'   : 'bg-red-500',
    cancelled: isDark ? 'bg-amber-500' : 'bg-amber-500',
    idle:     isDark ? 'bg-slate-500' : 'bg-gray-400',
  };

  const statusTextMap: Record<string, string> = {
    running:   isDark ? 'text-blue-400'   : 'text-blue-600',
    completed: isDark ? 'text-emerald-400' : 'text-emerald-600',
    failed:   isDark ? 'text-red-400'   : 'text-red-600',
    cancelled: isDark ? 'text-amber-400' : 'text-amber-600',
    idle:     isDark ? 'text-slate-400' : 'text-gray-500',
  };

  const dot = statusDotMap[status] ?? (isDark ? 'bg-slate-500' : 'bg-gray-400');
  const text = statusTextMap[status] ?? (isDark ? 'text-slate-400' : 'text-gray-500');
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
            <span className={`w-2 h-2 rounded-full ${dot} ${status === 'running' ? 'animate-pulse' : ''}`} />
            <span className={text}>{label}</span>
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
    <div className={`rounded-lg p-4 border ${isDark
      ? 'bg-slate-800 border-slate-700'
      : 'bg-white border-gray-200'
    }`}>
      <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{label}</p>
      <p className={`text-2xl font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}
