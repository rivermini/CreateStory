import { useCallback, useEffect, useRef, useState } from 'react';
import { getNovelChapters } from '../api/client';
import type { ChapterEntry, ChapterListResponse } from '../api/client';

export interface UseNovelInfoResult {
  chapters: ChapterEntry[];
  chapterCount: number;
  totalChapterCount: number | null;
  storyTitle: string | null;
  isLoadingChapters: boolean;
  chaptersError: string;
  warning: string | null;
  isChapterUrl: boolean;
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
  const abortRef = useRef<AbortController | null>(null);
  const currentUrlRef = useRef<string>('');

  const reset = useCallback(() => {
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
  }, []);

  const refresh = useCallback(async (url: string) => {
    if (!url.trim()) {
      reset();
      return;
    }

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
        return;
      }

      setChapters(result.chapters);
      setChapterCount(result.chapter_count);
      setTotalChapterCount(result.total_chapter_count ?? null);
      setStoryTitle(result.story_title ?? null);
      setWarning(result.warning ?? null);
      setIsChapterUrl(false);
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
  }, [reset]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return {
    chapters,
    chapterCount,
    totalChapterCount,
    storyTitle,
    isLoadingChapters,
    chaptersError,
    warning,
    isChapterUrl,
    refresh,
    reset,
  };
}
