import { useCallback, useEffect, useRef, useState } from 'react';
import { getBinarySearchTotal, getNovelChapters } from '../api';
import type { BinarySearchTotalResponse, ChapterEntry, ChapterListResponse } from '../api';

export interface UseNovelInfoResult {
  chapters: ChapterEntry[];
  chapterCount: number;
  totalChapterCount: number | null;
  storyTitle: string | null;
  isLoadingChapters: boolean;
  chaptersError: string;
  warning: string | null;
  isChapterUrl: boolean;
  isResolvingTotal: boolean;
  refresh: (url: string) => Promise<void>;
  reset: () => void;
}

export function useNovelInfo(): UseNovelInfoResult {
  const [chapters, setChapters] = useState<ChapterEntry[]>([]);
  const [chapterCount, setChapterCount] = useState(0);
  const [totalChapterCount, setTotalChapterCount] = useState<number | null>(null);
  const [storyTitle, setStoryTitle] = useState<string | null>(null);
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);
  const [chaptersError, setChaptersError] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [isChapterUrl, setIsChapterUrl] = useState(false);
  const [isResolvingTotal, setIsResolvingTotal] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const currentUrlRef = useRef<string>('');
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsResolvingTotal(false);
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setChapters([]);
    setChapterCount(0);
    setTotalChapterCount(null);
    setStoryTitle(null);
    setIsLoadingChapters(false);
    setChaptersError('');
    setWarning(null);
    setIsChapterUrl(false);
    currentUrlRef.current = '';
  }, [stopPolling]);

  const pollTotal = useCallback((url: string, abortSignal: AbortSignal) => {
    stopPolling();
    setIsResolvingTotal(true);
    pollIntervalRef.current = setInterval(async () => {
      if (abortSignal.aborted || currentUrlRef.current !== url) {
        stopPolling();
        return;
      }
      try {
        const result: BinarySearchTotalResponse = await getBinarySearchTotal(url);
        if (abortSignal.aborted || currentUrlRef.current !== url) {
          stopPolling();
          return;
        }
        if (result.done && result.total !== null && result.total !== undefined) {
          setTotalChapterCount(result.total);
          stopPolling();
        }
      } catch {
        // Silently ignore polling errors — will retry on next interval
      }
    }, 2000);
  }, [stopPolling]);

  const refresh = useCallback(async (url: string) => {
    if (!url.trim()) {
      reset();
      return;
    }

    stopPolling();

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const abort = new AbortController();
    abortRef.current = abort;
    currentUrlRef.current = url;

    setIsLoadingChapters(true);
    setChaptersError('');
    setWarning(null);
    setIsChapterUrl(false);
    // Keep the old total visible until a new one arrives — don't clear it
    // so the panel doesn't flicker between "2262" and blank when re-visiting a story

    try {
      const result: ChapterListResponse = await getNovelChapters(url);

      if (abort.signal.aborted) return;

      if (!result.valid) {
        if (result.reason === 'chapter_url') {
          setIsChapterUrl(true);
          setChapters([]);
          setChapterCount(0);
          setTotalChapterCount(null);
        } else {
          setChaptersError(result.message);
          setChapters([]);
          setChapterCount(0);
          setTotalChapterCount(null);
        }
        stopPolling();
        return;
      }

      setChapters(result.chapters);
      setChapterCount(result.chapter_count);
      setTotalChapterCount(result.total_chapter_count ?? null);
      setStoryTitle(result.story_title ?? null);
      setWarning(result.warning ?? null);
      setIsChapterUrl(false);

      // If total_chapter_count is null, kick off background polling for NovelWorm
      if (result.total_chapter_count === null || result.total_chapter_count === undefined) {
        pollTotal(url, abort.signal);
      }
    } catch (e) {
      if (abort.signal.aborted) return;
      setChaptersError(e instanceof Error ? e.message : 'Failed to fetch chapter list');
      setChapters([]);
      setChapterCount(0);
      setTotalChapterCount(null);
    } finally {
      if (!abort.signal.aborted) {
        setIsLoadingChapters(false);
      }
    }
  }, [reset, stopPolling, pollTotal]);

  useEffect(() => {
    return () => {
      stopPolling();
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [stopPolling]);

  return {
    chapters,
    chapterCount,
    totalChapterCount,
    storyTitle,
    isLoadingChapters,
    chaptersError,
    warning,
    isChapterUrl,
    isResolvingTotal,
    refresh,
    reset,
  };
}
