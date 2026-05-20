import { useEffect, useRef, useState } from 'react';

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ActionKind = 'upload_single' | 'upload_batch' | 'update_single' | 'update_batch' | 'test_sync' | 'config_save';
export type ActionStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface HistoryEntry {
  id: string;
  timestamp: string;
  kind: ActionKind;
  status: ActionStatus;
  title: string;
  subtitle: string;
  items?: HistoryItem[];
  error?: string;
}

export interface HistoryItem {
  id: string;
  label: string;
  status: ActionStatus;
  message?: string;
}

export interface UpdateHistoryPatch {
  status?: ActionStatus;
  items?: HistoryItem[];
  error?: string;
  subtitle?: string;
  title?: string;
}

// ─── ActionHistoryPanel ────────────────────────────────────────────────────────

interface ActionHistoryPanelProps {
  entries: HistoryEntry[];
  onClear: () => void;
  onRetry: (entry: HistoryEntry) => void;
}

type HistoryFilter = 'all' | 'upload' | 'update' | 'sync';

export function ActionHistoryPanel({ entries, onClear, onRetry }: ActionHistoryPanelProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(entries.length);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && entries.length > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevLenRef.current = entries.length;
  }, [entries.length, autoScroll]);

  const filtered = entries.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'upload') return e.kind === 'upload_single' || e.kind === 'upload_batch';
    if (filter === 'update') return e.kind === 'update_single' || e.kind === 'update_batch';
    if (filter === 'sync') return e.kind === 'test_sync' || e.kind === 'config_save';
    return true;
  });

  const kindLabel = (kind: ActionKind) => {
    switch (kind) {
      case 'upload_single': return 'Upload';
      case 'upload_batch':  return 'Upload All';
      case 'update_single': return 'Update';
      case 'update_batch':  return 'Update All';
      case 'test_sync':     return 'Test Sync';
      case 'config_save':   return 'Config';
    }
  };

  const kindIcon = (kind: ActionKind) => {
    if (kind === 'upload_single' || kind === 'upload_batch') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      );
    }
    if (kind === 'update_single' || kind === 'update_batch') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      );
    }
    if (kind === 'test_sync') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  };

  const statusBadge = (status: ActionStatus) => {
    if (status === 'running') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-900/50 text-indigo-300 border border-indigo-700/40">
        <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Running
      </span>
    );
    if (status === 'success') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Success
      </span>
    );
    if (status === 'error') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-900/50 text-red-300 border border-red-700/40">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        Error
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-slate-700/50 text-slate-400 border border-slate-600/40">
        Cancelled
      </span>
    );
  };

  const kindBadgeColor = (kind: ActionKind) => {
    if (kind === 'upload_single' || kind === 'upload_batch') return 'bg-indigo-900/50 text-indigo-300 border-indigo-700/40';
    if (kind === 'update_single' || kind === 'update_batch') return 'bg-amber-900/50 text-amber-300 border-amber-700/40';
    if (kind === 'test_sync') return 'bg-cyan-900/50 text-cyan-300 border-cyan-700/40';
    return 'bg-slate-700/50 text-slate-300 border-slate-600/40';
  };

  const itemStatusIcon = (status: ActionStatus) => {
    if (status === 'running') return (
      <svg className="w-3 h-3 text-indigo-400 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    );
    if (status === 'success') return (
      <svg className="w-3 h-3 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
    if (status === 'error') return (
      <svg className="w-3 h-3 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
    return <div className="w-3 h-3 rounded-full border border-slate-500 flex-shrink-0" />;
  };

  return (
    <section className="bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-700/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Action History
          </h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
                className="accent-indigo-500"
              />
              Auto-scroll
            </label>
            {entries.length > 0 && (
              <button
                onClick={onClear}
                className="text-xs text-slate-500 hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-900/40 rounded-lg w-fit">
          {([
            ['all', 'All'],
            ['upload', 'Upload'],
            ['update', 'Update'],
            ['sync', 'Sync'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                filter === value
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* History list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm">
            <svg className="w-10 h-10 mb-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>No actions yet</p>
            <p className="text-xs text-slate-600 mt-1">Actions will appear here as you work</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700/40">
            {filtered.map(entry => (
              <div key={entry.id} className="px-4 py-3 hover:bg-slate-700/20 transition-colors">
                {/* Entry header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div className={`mt-0.5 p-1.5 rounded-lg border flex-shrink-0 ${kindBadgeColor(entry.kind)}`}>
                      {kindIcon(entry.kind)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-300">{kindLabel(entry.kind)}</span>
                        {statusBadge(entry.status)}
                      </div>
                      <p className="text-sm text-slate-200 font-medium mt-0.5 truncate">{entry.title}</p>
                      {entry.subtitle && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{entry.subtitle}</p>
                      )}
                      {entry.error && (
                        <p className="text-xs text-red-400 mt-1">{entry.error}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-slate-500">
                      {new Date(entry.timestamp).toLocaleString()}
                    </p>
                    {entry.status === 'error' && entry.kind !== 'upload_batch' && entry.kind !== 'update_batch' && (
                      <button
                        onClick={() => onRetry(entry)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 transition-colors"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>

                {/* Item breakdown */}
                {entry.items && entry.items.length > 0 && (
                  <div className="mt-2 ml-9 space-y-1">
                    {entry.items.map(item => (
                      <div key={item.id} className="flex items-center gap-2 text-xs">
                        {itemStatusIcon(item.status)}
                        <span className={
                          item.status === 'error' ? 'text-red-400' :
                          item.status === 'success' ? 'text-emerald-400' :
                          'text-slate-400'
                        }>
                          {item.label}
                        </span>
                        {item.message && (
                          <span className="text-slate-500 truncate max-w-[200px]">— {item.message}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
