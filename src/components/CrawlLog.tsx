import { useEffect, useRef } from 'react';
import type { LogEntry } from '../hooks/useCrawlStream';

export interface CrawlLogProps {
  lines: LogEntry[];
  maxLines?: number;
  isDark?: boolean;
}

const levelStylesDark: Record<string, string> = {
  error:   'text-red-400',
  warning: 'text-amber-400',
  info:    'text-slate-300',
  debug:   'text-slate-500',
};

const levelStylesLight: Record<string, string> = {
  error:   'text-red-600',
  warning: 'text-amber-600',
  info:    'text-gray-700',
  debug:   'text-gray-400',
};

export function CrawlLog({ lines, maxLines = 200, isDark = true }: CrawlLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const displayLines = lines.slice(-maxLines);
  const levelStyles = isDark ? levelStylesDark : levelStylesLight;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <h3 className={`text-sm font-medium ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>Crawl Log</h3>
        <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{displayLines.length} lines</span>
      </div>
      <div
        className={`border rounded-lg p-3 overflow-y-auto ${isDark
          ? 'bg-slate-950 border-slate-700'
          : 'bg-gray-100 border-gray-200'
        }`}
        style={{ maxHeight: 'min(400px, 40vh)' }}
      >
        {displayLines.length === 0 ? (
          <p className={`text-sm italic ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Waiting for output...</p>
        ) : (
          displayLines.map((entry, idx) => (
            <div key={idx} className={`font-mono text-xs leading-relaxed ${levelStyles[entry.level] ?? levelStyles.info}`}>
              <span className={isDark ? 'text-slate-600' : 'text-gray-400'}>[{entry.timestamp}]</span>{' '}
              <span>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
