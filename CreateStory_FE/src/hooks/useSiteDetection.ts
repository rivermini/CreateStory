import { useCallback, useEffect, useRef, useState } from 'react';
import type { NovelMetadata, SiteDetectResponse } from '../api';
import { detectSite } from '../api';

export interface UseSiteDetectionResult {
  siteInfo: SiteDetectResponse['site'];
  slug: string | null;
  storyTitle: string | null;
  resolvedUrl: string | null;
  isValid: boolean;
  isLoading: boolean;
  error: string;
  novelMetadata: NovelMetadata | null;
  detect: (url: string) => void;
  reset: () => void;
}

export function useSiteDetection(): UseSiteDetectionResult {
  const [siteInfo, setSiteInfo] = useState<SiteDetectResponse['site']>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [storyTitle, setStoryTitle] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [novelMetadata, setNovelMetadata] = useState<NovelMetadata | null>(null);

  // One-shot debounce timer — replaced on each keystroke; the old callback
  // is abandoned when a new timer is set, so it cannot call a stale controller.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Controller ref so we can abort an in-flight request when the user types
  // a new character before the previous one resolves.
  const controllerRef = useRef<AbortController | null>(null);

  const detect = useCallback((url: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (!url.trim()) {
      // Cancel any in-flight request immediately — no point waiting for it.
      controllerRef.current?.abort();
      controllerRef.current = null;
      setSiteInfo(null);
      setSlug(null);
      setStoryTitle(null);
      setResolvedUrl(null);
      setIsValid(false);
      setError('');
      setNovelMetadata(null);
      setIsLoading(false);
      return;
    }

    debounceTimer.current = setTimeout(async () => {
      // Cancel any request that started before this tick.
      controllerRef.current?.abort();

      const controller = new AbortController();
      controllerRef.current = controller;
      setIsLoading(true);
      setError('');

      try {
        const result = await detectSite(url, { signal: controller.signal });

        // Silently drop the result if the controller was superseded by a newer
        // call that started after this one was queued.
        if (controller.signal.aborted) return;

        setSiteInfo(result.site);
        setSlug(result.slug);
        setStoryTitle(result.story_title ?? null);
        setResolvedUrl(result.resolved_url ?? null);
        setIsValid(result.valid);
        setNovelMetadata(result.novel_metadata ?? null);
        if (!result.valid) {
          setError(result.message);
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setSiteInfo(null);
        setSlug(null);
        setStoryTitle(null);
        setResolvedUrl(null);
        setIsValid(false);
        setError(e instanceof Error ? e.message : 'Detection failed');
        setNovelMetadata(null);
      } finally {
        if (controllerRef.current === controller) {
          setIsLoading(false);
        }
      }
    }, 300);
  }, []);

  // Abort any pending work when the component unmounts.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      controllerRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    controllerRef.current?.abort();
    controllerRef.current = null;
    setSiteInfo(null);
    setSlug(null);
    setStoryTitle(null);
    setResolvedUrl(null);
    setIsValid(false);
    setIsLoading(false);
    setError('');
    setNovelMetadata(null);
  }, []);

  return { siteInfo, slug, storyTitle, resolvedUrl, isValid, isLoading, error, novelMetadata, detect, reset };
}
