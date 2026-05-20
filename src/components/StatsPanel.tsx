import { type ReactNode } from 'react';

export interface StatsPanelProps {
  chaptersCrawled: number;
  chaptersTotal: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
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

const statusColors: Record<string, string> = {
  running: 'bg-blue-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  cancelled: 'bg-amber-500',
  idle: 'bg-slate-500',
};

const statusLabels: Record<string, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  idle: 'Idle',
};

export function StatsPanel({ chaptersCrawled, chaptersTotal, status, startedAt, finishedAt }: StatsPanelProps) {
  const target = chaptersTotal > 0 ? chaptersTotal : 'N/A';
  const duration = formatDuration(startedAt, finishedAt);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
      <StatCard
        label="Chapters Scraped"
        value={chaptersCrawled}
        sub={chaptersTotal > 0 ? `of ${chaptersTotal}` : undefined}
      />
      <StatCard
        label="Target"
        value={target}
      />
      <StatCard
        label="Status"
        value={(
          <span className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusColors[status] ?? 'bg-slate-500'} ${status === 'running' ? 'animate-pulse' : ''}`} />
            {statusLabels[status] ?? status}
          </span>
        )}
      />
      <StatCard
        label="Duration"
        value={duration}
        sub={startedAt ? `Started ${formatTs(startedAt)}` : undefined}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">{label}</p>
      <p className="text-2xl font-semibold text-slate-100">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}
