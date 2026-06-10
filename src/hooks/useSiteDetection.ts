import { useCallback, useRef, useState } from 'react';
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
  detect: (url: string) => Promise<void>;
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
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detect = useCallback(async (url: string) => {
    if (!url.trim()) {
      setSiteInfo(null);
      setSlug(null);
      setStoryTitle(null);
      setResolvedUrl(null);
      setIsValid(false);
      setError('');
      setNovelMetadata(null);
      return;
    }

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(async () => {
      setIsLoading(true);
      setError('');
      try {
        const result = await detectSite(url);
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
        setSiteInfo(null);
        setSlug(null);
        setStoryTitle(null);
        setResolvedUrl(null);
        setIsValid(false);
        setError(e instanceof Error ? e.message : 'Detection failed');
        setNovelMetadata(null);
      } finally {
        setIsLoading(false);
      }
    }, 300);
  }, []);

  const reset = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
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
