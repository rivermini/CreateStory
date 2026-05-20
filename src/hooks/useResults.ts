import { useCallback, useState } from 'react';
import type { CrawlResult } from '../api/client';
import { getCrawlResult, getCombinedResult, getDownloadUrl } from '../api/client';

export interface UseResultsResult {
  result: CrawlResult | null;
  isLoading: boolean;
  error: string;
  fetchResult: (crawlId: string) => Promise<void>;
  downloadFile: (crawlId: string, filename: string) => void;
}

export function useResults(): UseResultsResult {
  const [result, setResult] = useState<CrawlResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchResult = useCallback(async (crawlId: string) => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getCombinedResult(crawlId, 30000);
      setResult(data);
    } catch {
      try {
        const data = await getCrawlResult(crawlId, 30000);
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setResult(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const downloadFile = useCallback((crawlId: string, filename: string) => {
    const url = getDownloadUrl(crawlId, filename);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  return { result, isLoading, error, fetchResult, downloadFile };
}
