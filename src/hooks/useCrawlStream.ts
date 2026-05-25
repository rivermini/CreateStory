import { useCallback, useEffect, useRef, useState } from 'react';
import { getCrawlStatusWithLogs, type ProgressUpdate } from '../api/client';

export interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'error' | 'warning' | 'debug';
}

export interface UseCrawlStreamResult {
  logLines: LogEntry[];
  progress: ProgressUpdate | null;
  status: string;
  error: string;
  sourceUrl: string;
  close: () => void;
  reconnect: () => void;
}

export function useCrawlStream(crawlId: string | null): UseCrawlStreamResult {
  const [logLines, setLogLines] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!crawlId) return;

    try {
      const data = await getCrawlStatusWithLogs(crawlId);
      setProgress(data.progress);
      setStatus(data.progress.status);
      if (data.progress.source_url) {
        setSourceUrl(data.progress.source_url);
      }
      if (data.progress.error_message) {
        setError(data.progress.error_message);
      }

      // Update log lines - keep last 200
      if (data.log_lines && data.log_lines.length > 0) {
        setLogLines((prev) => {
          const combined = [...prev, ...data.log_lines];
          // Remove duplicates by timestamp + message
          const seen = new Set<string>();
          const deduped = combined.filter((entry) => {
            const key = `${entry.timestamp}:${entry.message}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          return deduped.length > 200 ? deduped.slice(-200) : deduped;
        });
      }
    } catch (e) {
      // Session not found or other error - stop polling
      if (e instanceof Error && e.message.includes('not found')) {
        setError(e.message);
        stopPolling();
      }
    }
  }, [crawlId, stopPolling]);

  const reconnect = useCallback(() => {
    stopPolling();
    setLogLines([]);
    setProgress(null);
    setStatus('idle');
    setError('');
    setSourceUrl('');
    fetchStatus();
  }, [stopPolling, fetchStatus]);

  useEffect(() => {
    if (!crawlId) return;

    stopPolling();
    setLogLines([]);
    setProgress(null);
    setStatus('idle');
    setError('');
    setSourceUrl('');

    // Initial fetch
    fetchStatus();

    // Poll every 2 seconds
    pollTimerRef.current = setInterval(fetchStatus, 2000);

    return () => {
      stopPolling();
    };
  }, [crawlId, fetchStatus, stopPolling]);

  const close = useCallback(() => {
    stopPolling();
  }, [stopPolling]);

  return { logLines, progress, status, error, sourceUrl, close, reconnect };
}
