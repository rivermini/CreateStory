import { useEffect, useRef } from 'react';
import type { LogEntry } from '../hooks/useCrawlStream';

export interface CrawlLogProps {
  lines: LogEntry[];
  maxLines?: number;
}

const levelStyles: Record<string, string> = {
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-slate-300',
  debug: 'text-slate-500',
};

export function CrawlLog({ lines, maxLines = 200 }: CrawlLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const displayLines = lines.slice(-maxLines);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">Crawl Log</h3>
        <span className="text-xs text-slate-500">{displayLines.length} lines</span>
      </div>
      <div
        className="bg-slate-950 border border-slate-700 rounded-lg p-3 overflow-y-auto"
        style={{ maxHeight: 'min(400px, 40vh)' }}
      >
        {displayLines.length === 0 ? (
          <p className="text-slate-500 text-sm italic">Waiting for output...</p>
        ) : (
          displayLines.map((entry, idx) => (
            <div key={idx} className={`font-mono text-xs leading-relaxed ${levelStyles[entry.level] ?? 'text-slate-300'}`}>
              <span className="text-slate-600">[{entry.timestamp}]</span>{' '}
              <span>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
