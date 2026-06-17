import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cancelBatchJob,
  getBatchJob,
  getBatchZipUrl,
  getBedReadChapters,
  getChapterAudioUrl,
  getLanguages,
  getVoices,
  searchBedReadStories,
  startBatchGenerate,
  type BatchJob,
  type BedReadChapter,
  type BedReadStory,
  type BedReadStorySearchResponse,
  type TTSLanguage,
  type TTSVoice,
} from '../../api/BedReadVoices';
import { getDriveSyncConfig } from '../../api/BedReadDriveSync';
import { downloadWithAuth, getStoredAccessToken } from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';

interface BedReadPageProps {
  readonly themeMode: 'light' | 'dark';
}

const STORAGE_KEY_STORIES = 'bedread_stories';
const STORAGE_KEY_SELECTED = 'bedread_selected_story_id';
const STORAGE_KEY_SORT = 'bedread_sort_by';

function loadStoredStories(): BedReadStory[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_STORIES);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveStories(stories: BedReadStory[]) {
  try {
    localStorage.setItem(STORAGE_KEY_STORIES, JSON.stringify(stories));
  } catch {
    // ignore
  }
}

function loadStoredSelectedId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_SELECTED);
  } catch {
    return null;
  }
}

function saveSelectedStoryId(id: string | null) {
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEY_SELECTED, id);
    } else {
      localStorage.removeItem(STORAGE_KEY_SELECTED);
    }
  } catch {
    // ignore
  }
}

const VALID_SORT_VALUES = ['release_date', 'popular', 'recently_updated', 'recently_added'] as const;

function loadStoredSort(): (typeof VALID_SORT_VALUES)[number] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SORT);
    if (stored && VALID_SORT_VALUES.includes(stored as (typeof VALID_SORT_VALUES)[number])) {
      return stored as (typeof VALID_SORT_VALUES)[number];
    }
  } catch {
    // ignore
  }
  return 'release_date';
}

function saveSortBy(sort: string) {
  try {
    localStorage.setItem(STORAGE_KEY_SORT, sort);
  } catch {
    // ignore
  }
}

export function BedReadPage({ themeMode }: BedReadPageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();

  const [storiesLoading, setStoriesLoading] = useState(true);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [hasLoadedAll, setHasLoadedAll] = useState(false);
  const [storiesError, setStoriesError] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<'release_date' | 'popular' | 'recently_updated' | 'recently_added'>(loadStoredSort);
  const [pageLimit] = useState(20);
  const [totalStories, setTotalStories] = useState(0);
  const [allLoadedStories, setAllLoadedStories] = useState<BedReadStory[]>(loadStoredStories);

  const [selectedStory, setSelectedStory] = useState<BedReadStory | null>(() => {
    const storedId = loadStoredSelectedId();
    const stories = loadStoredStories();
    return stories.find((story) => story.storyId === storedId) || null;
  });
  const [chapters, setChapters] = useState<BedReadChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [bedReadUserId, setBedReadUserId] = useState<string | null>(null);
  const [mainBeApiUrl, setMainBeApiUrl] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configInvalid, setConfigInvalid] = useState(false);

  const [allChapters, setAllChapters] = useState(true);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);

  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [languages, setLanguages] = useState<TTSLanguage[]>([]);
  const [selectedLang, setSelectedLang] = useState('en-us');
  const [selectedVoice, setSelectedVoice] = useState('af_heart');
  const [speed, setSpeed] = useState(0.69);
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');

  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');

  const pageBackground = isDark
    ? 'linear-gradient(180deg, #0f0f10 0%, #121214 100%)'
    : 'linear-gradient(180deg, #f2f2f0 0%, #ebebe8 100%)';
  const panelBackground = isDark ? '#171718' : 'rgba(255,255,255,0.9)';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(24,24,27,0.1)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#18181b';
  const secondaryText = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(24,24,27,0.68)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(24,24,27,0.46)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(24,24,27,0.045)';
  const selectedSurface = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(24,24,27,0.08)';
  const tagSurface = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(24,24,27,0.06)';
  const strongSurface = isDark ? '#f5f5f5' : '#18181b';
  const strongText = isDark ? '#18181b' : '#fafafa';

  const fetchStoriesPage = async (sort: typeof sortBy) => {
    setStoriesLoading(true);
    setStoriesError('');
    setHasLoadedAll(false);

    try {
      const response = await searchBedReadStories({ sort, page: 1, limit: 20 });
      setAllLoadedStories(response.stories);
      setTotalStories(response.total);
      saveStories(response.stories);
      if (response.stories.length >= response.total) {
        setHasLoadedAll(true);
      }
    } catch {
      setStoriesError('Failed to load stories. Is the backend running?');
    } finally {
      setStoriesLoading(false);
    }
  };

  const fetchPage1 = () => {
    void fetchStoriesPage(sortBy);
  };

  const loadAllStories = () => {
    if (hasLoadedAll || isLoadingAll) return;
    setIsLoadingAll(true);
    const totalPages = Math.max(1, Math.ceil(totalStories / 20));
    const pageRequests: Promise<BedReadStorySearchResponse>[] = [];
    for (let page = 2; page <= totalPages; page += 1) {
      pageRequests.push(searchBedReadStories({ sort: sortBy, page, limit: 20 }));
    }

    Promise.all(pageRequests)
      .then((responses) => {
        const seen = new Set<string>();
        const pageOneStories = allLoadedStories;
        const allStories: BedReadStory[] = [pageOneStories, ...responses.map((response) => response.stories)]
          .flat()
          .filter((story) => {
            if (seen.has(story.storyId)) return false;
            seen.add(story.storyId);
            return true;
          });

        setAllLoadedStories(allStories);
        saveStories(allStories);
        setHasLoadedAll(true);
      })
      .catch(() => setStoriesError('Failed to load all stories.'))
      .finally(() => setIsLoadingAll(false));
  };

  const filteredStories = useMemo(
    () =>
      allLoadedStories.filter(
        (story) =>
          story.title.toLowerCase().includes(searchKeyword.toLowerCase()) ||
          story.author.toLowerCase().includes(searchKeyword.toLowerCase()),
      ),
    [allLoadedStories, searchKeyword],
  );

  const currentVisiblePage = useMemo(() => {
    const maxPage = Math.max(1, Math.ceil(filteredStories.length / pageLimit));
    return Math.min(currentPage, maxPage);
  }, [currentPage, filteredStories.length, pageLimit]);

  const paginatedStories = filteredStories.slice((currentVisiblePage - 1) * pageLimit, currentVisiblePage * pageLimit);
  const filteredTotalPages = Math.max(1, Math.ceil(filteredStories.length / pageLimit));

  useEffect(() => {
    let isActive = true;

    const loadStories = async () => {
      setStoriesLoading(true);
      setStoriesError('');
      setHasLoadedAll(false);

      try {
        const response = await searchBedReadStories({ sort: sortBy, page: 1, limit: 20 });
        if (!isActive) return;
        setAllLoadedStories(response.stories);
        setTotalStories(response.total);
        saveStories(response.stories);
        if (response.stories.length >= response.total) {
          setHasLoadedAll(true);
        }
      } catch {
        if (!isActive) return;
        setStoriesError('Failed to load stories. Is the backend running?');
      } finally {
        if (isActive) {
          setStoriesLoading(false);
        }
      }
    };

    void loadStories();

    return () => {
      isActive = false;
    };
  }, [sortBy]);

  useEffect(() => {
    let isActive = true;

    const loadVoiceData = async () => {
      try {
        const [voiceList, languageList] = await Promise.all([getVoices(), getLanguages()]);
        if (!isActive) return;
        setVoices(voiceList);
        setLanguages(languageList);
      } catch {
        if (!isActive) return;
        setVoices([]);
        setLanguages([]);
      }
    };

    void loadVoiceData();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadConfig = async () => {
      try {
        const config = await getDriveSyncConfig();
        if (!isActive) return;
        if (config?.main_be_user_id) {
          setBedReadUserId(config.main_be_user_id);
        }
        if (config?.main_be_api_base_url) {
          setMainBeApiUrl(config.main_be_api_base_url);
        }
        setConfigInvalid(!config?.main_be_api_base_url || !config?.main_be_user_id);
      } catch {
        if (!isActive) return;
        setConfigInvalid(true);
      } finally {
        if (isActive) {
          setConfigLoading(false);
        }
      }
    };

    void loadConfig();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!batchId) return;

    const poll = async () => {
      try {
        const job = await getBatchJob(batchId);
        setBatchJob(job);
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          setIsGenerating(false);
        }
      } catch {
        // ignore
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [batchId]);

  const handleSortChange = (newSort: 'release_date' | 'popular' | 'recently_updated' | 'recently_added') => {
    setSortBy(newSort);
    setCurrentPage(1);
    saveSortBy(newSort);
  };

  const handleSelectStory = async (story: BedReadStory) => {
    setSelectedStory(story);
    setBatchId(null);
    setBatchJob(null);
    setIsGenerating(false);
    setGenerationError('');
    setChapters([]);
    setChaptersLoading(true);
    setRangeStart(1);
    setRangeEnd(1);
    saveSelectedStoryId(story.storyId);

    try {
      const chapterList = await getBedReadChapters(story.storyId, bedReadUserId ?? undefined);
      setChapters(chapterList);
      const maxChapter = Math.max(...chapterList.map((chapter) => chapter.chapterNumber), 1);
      setRangeStart(1);
      setRangeEnd(maxChapter);
    } catch {
      setChapters([]);
      setRangeStart(1);
      setRangeEnd(1);
    } finally {
      setChaptersLoading(false);
    }
  };

  const filteredVoices = voices.filter((voice) => voice.lang === selectedLang);
  const effectiveSelectedVoice =
    filteredVoices.find((voice) => voice.id === selectedVoice)?.id ?? filteredVoices[0]?.id ?? selectedVoice;
  const maxChapterNumber = Math.max(...chapters.map((chapter) => chapter.chapterNumber), 0);

  const chaptersToGenerate = allChapters
    ? chapters.map((chapter) => chapter.chapterNumber)
    : Array.from({ length: rangeEnd - rangeStart + 1 }, (_, index) => rangeStart + index).filter(
        (chapterNumber) => chapterNumber >= 1 && chapterNumber <= maxChapterNumber,
      );

  const handleGenerate = async () => {
    if (!selectedStory) return;
    setGenerationError('');
    setIsGenerating(true);
    setBatchJob(null);
    setBatchId(null);

    try {
      const response = await startBatchGenerate(
        {
          story_id: selectedStory.storyId,
          story_title: selectedStory.title,
          chapter_start: allChapters ? 1 : rangeStart,
          chapter_end: allChapters ? null : rangeEnd,
          voice: effectiveSelectedVoice,
          lang: selectedLang,
          speed,
          format,
        },
        bedReadUserId ?? undefined,
      );
      setBatchId(response.batch_id);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Failed to start batch job.');
      setIsGenerating(false);
    }
  };

  const handleCancel = async () => {
    if (!batchId) return;
    try {
      await cancelBatchJob(batchId);
    } catch {
      // ignore
    }
    setIsGenerating(false);
  };

  const handleDownloadChapter = (chapterNumber: number) => {
    if (!batchId) return;
    void downloadWithAuth(getChapterAudioUrl(batchId, chapterNumber), `chapter_${chapterNumber}.${format}`);
  };

  const handleDownloadZip = () => {
    if (!batchId) return;
    void downloadWithAuth(getBatchZipUrl(batchId), `bedread_${batchId}.zip`);
  };

  const handleListenChapter = (chapterNumber: number) => {
    if (!batchId) return;
    const url = getChapterAudioUrl(batchId, chapterNumber);
    void (async () => {
      try {
        const token = getStoredAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        globalThis.open(objectUrl, '_blank');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to play audio';
        void globalThis.alert(`Playback error: ${msg}`);
      }
    })();
  };

  const hasAnyCompleted = batchJob?.chapters.some((chapter) => chapter.status === 'completed') ?? false;
  const progressPct = batchJob?.progress_pct ?? 0;

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <Icon icon={appIcons.check} className={`h-4 w-4 ${isDark ? 'text-zinc-200' : 'text-zinc-700'}`} />;
      case 'failed':
        return <Icon icon={appIcons.close} className={`h-4 w-4 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`} />;
      case 'processing':
      case 'queued':
        return <Icon icon={appIcons.refresh} className={`h-4 w-4 animate-spin ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`} />;
      default:
        return <div className={`h-4 w-4 rounded-full border ${isDark ? 'border-white/20' : 'border-gray-300'}`} />;
    }
  };

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col px-3 py-4 sm:px-4 lg:px-6 lg:py-5">
        <main className="space-y-4">
          <section
            className="rounded-lg border px-4 py-3 sm:px-5 sm:py-4"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: tertiaryText }}>
                BedRead voices
              </div>
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl" style={{ color: pageText }}>
                Compact batch TTS workspace
              </h1>
              <p className="max-w-2xl text-sm leading-5" style={{ color: secondaryText }}>
                Browse stories, narrow the chapter range, and generate audio with a quieter monochrome layout.
              </p>
            </div>
          </section>

          <ServerModeBanner
            serverUrl={mainBeApiUrl}
            isDark={isDark}
            isConfigLoading={configLoading}
            isConfigValid={configInvalid ? false : configLoading ? undefined : Boolean(mainBeApiUrl && bedReadUserId)}
            onConfigure={() => {
              navigate('/');
            }}
          />

          <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)]">
            <section
              className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="border-b px-4 py-4">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <StepBadge number={1} isDark={isDark} />
                    <div className="flex flex-col">
                      <h2 className="text-base font-semibold" style={{ color: pageText }}>
                        Library
                      </h2>
                      <p className="text-xs" style={{ color: tertiaryText }}>
                        Search and pin a source story.
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!hasLoadedAll && (
                      <button
                        onClick={loadAllStories}
                        disabled={isLoadingAll}
                        className="rounded-md border px-2.5 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed"
                        style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                      >
                        {isLoadingAll ? 'Loading…' : `Load all ${totalStories.toLocaleString()}`}
                      </button>
                    )}
                    {hasLoadedAll && (
                      <span
                        className="rounded-md px-2 py-1 text-[11px]"
                        style={{ background: mutedSurface, color: secondaryText }}
                      >
                        Fully loaded
                      </span>
                    )}
                    <button
                      onClick={() => fetchPage1()}
                      disabled={storiesLoading || isLoadingAll}
                      className="inline-flex items-center justify-center rounded-md border px-2.5 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed"
                      style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                      title="Refresh story list"
                    >
                      <Icon icon={appIcons.refresh} className={`h-4 w-4 ${storiesLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="grid gap-2">
                  <div className="relative">
                    <Icon
                      icon={appIcons.search}
                      className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                      style={{ color: tertiaryText }}
                    />
                    <input
                      type="text"
                      value={searchKeyword}
                      onChange={(event) => {
                        setSearchKeyword(event.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Search title or author"
                      className="w-full rounded-md border py-2.5 pl-9 pr-3 text-sm outline-none transition"
                      style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[11px] uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                      Sort
                    </span>
                    <select
                      value={sortBy}
                      onChange={(event) => handleSortChange(event.target.value as typeof sortBy)}
                      className="min-w-0 flex-1 rounded-md border px-3 py-2 text-xs outline-none transition"
                      style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                    >
                      <option value="release_date">Latest</option>
                      <option value="recently_updated">Recently Updated</option>
                      <option value="recently_added">Recently Added</option>
                      <option value="popular">Popular</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto xl:max-h-[calc(100vh-250px)]">
                {storiesLoading && (
                  <div className="flex flex-col items-center justify-center py-14 text-sm" style={{ color: secondaryText }}>
                    <Icon icon={appIcons.refresh} className="mb-2 h-7 w-7 animate-spin" />
                    Loading stories...
                  </div>
                )}

                {storiesError && (
                  <div className="p-4">
                    <FeedbackBox tone="error" isDark={isDark}>{storiesError}</FeedbackBox>
                  </div>
                )}

                {!storiesLoading && !storiesError && filteredStories.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-14 text-sm" style={{ color: tertiaryText }}>
                    <Icon icon={appIcons.close} className="mb-2 h-9 w-9" />
                    <p>No stories found</p>
                  </div>
                )}

                <div className="space-y-1.5 p-2.5">
                  {paginatedStories.map((story) => {
                    const isSelected = selectedStory?.storyId === story.storyId;
                    return (
                      <button
                        key={story.storyId}
                        onClick={() => {
                          void handleSelectStory(story);
                        }}
                        className="flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors"
                        style={{
                          background: isSelected ? selectedSurface : 'transparent',
                          borderColor: isSelected ? panelBorder : 'transparent',
                        }}
                      >
                        {story.coverUrl ? (
                          <div className="relative shrink-0">
                            <img
                              src={story.coverUrl}
                              alt={story.title}
                              className="h-16 w-12 rounded-lg object-cover"
                              style={{ background: mutedSurface }}
                              onError={(event) => {
                                (event.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                        ) : (
                          <div
                            className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg"
                            style={{ background: tagSurface }}
                          >
                            <Icon icon={appIcons.book} className="h-5 w-5" style={{ color: secondaryText }} />
                          </div>
                        )}

                        <div className="min-w-0 flex-1 py-0.5">
                          <div className="flex items-start gap-2">
                            <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug" style={{ color: pageText }}>
                              {story.title}
                            </p>
                            <span
                              className="inline-flex h-6 min-w-[4.5rem] shrink-0 items-center justify-center rounded-full px-2.5 text-[11px] tabular-nums"
                              style={{ background: mutedSurface, color: secondaryText }}
                            >
                              {story.chapterCount.toLocaleString()} ch
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs" style={{ color: secondaryText }}>
                            {story.author}
                          </p>
                          {story.tags.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {story.tags.slice(0, 2).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-md px-1.5 py-0.5 text-[11px]"
                                  style={{
                                    background: tagSurface,
                                    color: secondaryText,
                                    maxWidth: '72px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t px-3 py-3" style={{ borderColor: panelBorder }}>
                <div className="mb-2 flex items-center justify-between text-[11px]" style={{ color: tertiaryText }}>
                  <span>{filteredStories.length.toLocaleString()} matches</span>
                  <span>Page {currentVisiblePage} / {filteredTotalPages}</span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-1.5">
                  {storiesLoading ? (
                    <div className="flex items-center gap-2 text-xs" style={{ color: tertiaryText }}>
                      <Icon icon={appIcons.refresh} className="h-4 w-4 animate-spin" />
                      Loading stories...
                    </div>
                  ) : (
                    <>
                      <PaginationButton
                        disabled={currentVisiblePage <= 1}
                        onClick={() => setCurrentPage((page) => Math.max(1, Math.min(filteredTotalPages, page - 1)))}
                        panelBorder={panelBorder}
                        mutedSurface={mutedSurface}
                        secondaryText={secondaryText}
                        tertiaryText={tertiaryText}
                      >
                        <Icon icon={appIcons.chevronLeft} className="h-4 w-4" />
                      </PaginationButton>

                      {buildPagination(currentVisiblePage, filteredTotalPages).map((page, index) =>
                        page === '...' ? (
                          <span key={`ellipsis-${index}-${currentVisiblePage}`} className="flex h-8 w-8 items-center justify-center text-xs" style={{ color: tertiaryText }}>
                            ...
                          </span>
                        ) : (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-xs font-medium transition-colors"
                            style={{
                              background: page === currentVisiblePage ? strongSurface : mutedSurface,
                              color: page === currentVisiblePage ? strongText : pageText,
                            }}
                          >
                            {page}
                          </button>
                        ),
                      )}

                      <PaginationButton
                        disabled={currentVisiblePage >= filteredTotalPages}
                        onClick={() => setCurrentPage((page) => Math.min(filteredTotalPages, page + 1))}
                        panelBorder={panelBorder}
                        mutedSurface={mutedSurface}
                        secondaryText={secondaryText}
                        tertiaryText={tertiaryText}
                      >
                        <Icon icon={appIcons.chevronRight} className="h-4 w-4" />
                      </PaginationButton>
                    </>
                  )}
                </div>
              </div>
            </section>

            <div className="grid h-full gap-4 lg:sticky lg:top-4">
              {selectedStory && (
                <section className="rounded-lg border p-4" style={{ background: panelBackground, borderColor: panelBorder }}>
                  <div className="space-y-4">
                    <div className="rounded-lg border p-3" style={{ background: mutedSurface, borderColor: panelBorder }}>
                      <div className="flex items-start gap-3">
                        {selectedStory.coverUrl && (
                          <img
                            src={selectedStory.coverUrl}
                            alt={selectedStory.title}
                            className="h-24 w-16 shrink-0 rounded-md object-cover"
                            style={{ background: mutedSurface }}
                            onError={(event) => {
                              (event.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <StepBadge number={2} isDark={isDark} />
                            <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                              Story setup
                            </span>
                          </div>
                          <h2 className="text-lg font-semibold leading-tight" style={{ color: pageText }}>
                            {selectedStory.title}
                          </h2>
                          <p className="mt-0.5 text-sm" style={{ color: secondaryText }}>
                            {selectedStory.author}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: tertiaryText }}>
                            <span className="inline-flex min-w-[5.5rem] items-center justify-center rounded-full px-2.5 py-0.5 tabular-nums" style={{ background: panelBackground }}>
                              {selectedStory.chapterCount.toLocaleString()} chapters
                            </span>
                            {selectedStory.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className="rounded-md px-2 py-0.5" style={{ background: tagSurface }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                          {selectedStory.description && (
                            <p className="mt-3 line-clamp-3 text-sm leading-5" style={{ color: secondaryText }}>
                              {selectedStory.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border p-3" style={{ background: mutedSurface, borderColor: panelBorder }}>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-medium" style={{ color: pageText }}>
                          Chapter range
                        </h3>
                        <span className="text-[11px]" style={{ color: tertiaryText }}>
                          {chaptersLoading ? 'Loading…' : `${chapters.length} available`}
                        </span>
                      </div>
                      <div className="space-y-2.5">
                        <label className="flex items-center justify-between gap-3 rounded-md px-2.5 py-2" style={{ background: tagSurface }}>
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="chapter-mode"
                              checked={allChapters}
                              onChange={() => setAllChapters(true)}
                              className="accent-neutral-500"
                            />
                            <span className="text-sm" style={{ color: secondaryText }}>
                              All chapters
                            </span>
                          </div>
                          <span className="text-[11px]" style={{ color: tertiaryText }}>
                            {chapters.length}
                          </span>
                        </label>
                        <label className="flex items-center gap-2 rounded-md px-2.5 py-2" style={{ background: tagSurface }}>
                          <input
                            type="radio"
                            name="chapter-mode"
                            checked={!allChapters}
                            onChange={() => setAllChapters(false)}
                            className="accent-neutral-500"
                          />
                          <span className="text-sm" style={{ color: secondaryText }}>
                            Custom range
                          </span>
                        </label>
                        {!allChapters && (
                          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
                            <div>
                              <label htmlFor="chapter-range-start" className="mb-1 block text-[11px] uppercase tracking-[0.12em]" style={{ color: tertiaryText }}>
                                From
                              </label>
                              <input
                                id="chapter-range-start"
                                type="number"
                                min={1}
                                max={rangeEnd}
                                value={rangeStart}
                                onChange={(event) => setRangeStart(Math.max(1, Number.parseInt(event.target.value, 10) || 1))}
                                className="w-full rounded-md border px-3 py-2 text-sm outline-none transition"
                                style={{ background: panelBackground, borderColor: panelBorder, color: pageText }}
                              />
                            </div>
                            <span className="hidden pb-2 text-xs sm:block" style={{ color: tertiaryText }}>
                              to
                            </span>
                            <div>
                              <label htmlFor="chapter-range-end" className="mb-1 block text-[11px] uppercase tracking-[0.12em]" style={{ color: tertiaryText }}>
                                To
                              </label>
                              <input
                                id="chapter-range-end"
                                type="number"
                                min={rangeStart}
                                max={chapters.length || 999}
                                value={rangeEnd}
                                onChange={(event) => setRangeEnd(Math.max(rangeStart, Number.parseInt(event.target.value, 10) || rangeStart))}
                                className="w-full rounded-md border px-3 py-2 text-sm outline-none transition"
                                style={{ background: panelBackground, borderColor: panelBorder, color: pageText }}
                              />
                            </div>
                            <span className="pb-1 text-[11px] sm:pb-2" style={{ color: tertiaryText }}>
                              {Math.max(0, rangeEnd - rangeStart + 1)} selected
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border p-3" style={{ background: mutedSurface, borderColor: panelBorder }}>
                      <div className="mb-3 flex items-center gap-2">
                        <StepBadge number={3} isDark={isDark} />
                        <h3 className="text-sm font-medium" style={{ color: pageText }}>
                          Voice settings
                        </h3>
                      </div>

                      <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label htmlFor="voice-language" className="mb-1 block text-[11px] uppercase tracking-[0.12em]" style={{ color: tertiaryText }}>
                              Language
                            </label>
                            <select
                              id="voice-language"
                              value={selectedLang}
                              onChange={(event) => {
                                const nextLanguage = event.target.value;
                                setSelectedLang(nextLanguage);
                                const nextVoice = voices.find((voice) => voice.lang === nextLanguage)?.id;
                                if (nextVoice) {
                                  setSelectedVoice(nextVoice);
                                }
                              }}
                              disabled={isGenerating}
                              className="w-full rounded-md border px-3 py-2 text-sm outline-none transition disabled:cursor-not-allowed"
                              style={{ background: panelBackground, borderColor: panelBorder, color: pageText }}
                            >
                              {languages.map((language) => (
                                <option key={language.code} value={language.code}>
                                  {language.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor="voice-selection" className="mb-1 block text-[11px] uppercase tracking-[0.12em]" style={{ color: tertiaryText }}>
                              Voice
                            </label>
                            <select
                              id="voice-selection"
                              value={effectiveSelectedVoice}
                              onChange={(event) => setSelectedVoice(event.target.value)}
                              disabled={isGenerating}
                              className="w-full rounded-md border px-3 py-2 text-sm outline-none transition disabled:cursor-not-allowed"
                              style={{ background: panelBackground, borderColor: panelBorder, color: pageText }}
                            >
                              {filteredVoices.map((voice) => (
                                <option key={voice.id} value={voice.id}>
                                  {voice.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <label htmlFor="voice-speed" className="text-[11px] uppercase tracking-[0.12em]" style={{ color: tertiaryText }}>
                              Speed
                            </label>
                            <span className="text-sm font-mono" style={{ color: pageText }}>
                              {speed.toFixed(2)}x
                            </span>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                            <input
                              id="voice-speed"
                              type="range"
                              min={0.25}
                              max={2}
                              step={0.05}
                              value={speed}
                              onChange={(event) => setSpeed(Number.parseFloat(event.target.value))}
                              disabled={isGenerating}
                              className="flex-1 accent-neutral-500"
                            />
                            <input
                              type="number"
                              min={0.25}
                              max={2}
                              step={0.01}
                              value={speed}
                              onChange={(event) => {
                                const value = Number.parseFloat(event.target.value);
                                if (!Number.isNaN(value) && value >= 0.25 && value <= 2) {
                                  setSpeed(value);
                                }
                              }}
                              disabled={isGenerating}
                              className="w-full rounded-md border px-2 py-1.5 text-center text-sm font-mono outline-none transition sm:w-20"
                              style={{ background: panelBackground, borderColor: panelBorder, color: pageText }}
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                          <span className="text-[11px] uppercase tracking-[0.12em]" style={{ color: tertiaryText }}>
                            Format
                          </span>
                          <div className="flex flex-wrap items-center gap-4">
                            {(['wav', 'mp3'] as const).map((audioFormat) => (
                              <label key={audioFormat} className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name="format"
                                  value={audioFormat}
                                  checked={format === audioFormat}
                                  onChange={() => setFormat(audioFormat)}
                                  disabled={isGenerating}
                                  className="accent-neutral-500"
                                />
                                <span className="text-sm uppercase" style={{ color: secondaryText }}>
                                  {audioFormat}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {selectedStory && (
                <section className="rounded-lg border p-4" style={{ background: panelBackground, borderColor: panelBorder }}>
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <StepBadge number={4} isDark={isDark} />
                        <h3 className="text-base font-semibold" style={{ color: pageText }}>
                          Generate audio
                        </h3>
                      </div>
                      <p className="mt-1 text-sm" style={{ color: secondaryText }}>
                        {chaptersToGenerate.length} chapter{chaptersToGenerate.length === 1 ? '' : 's'} queued for output.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!isGenerating && !batchJob && (
                        <button
                          onClick={handleGenerate}
                          disabled={!selectedStory || chaptersToGenerate.length === 0 || !effectiveSelectedVoice}
                          className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed"
                          style={{
                            background:
                              !selectedStory || chaptersToGenerate.length === 0 ? mutedSurface : strongSurface,
                            color: !selectedStory || chaptersToGenerate.length === 0 ? secondaryText : strongText,
                          }}
                        >
                          <Icon icon={appIcons.play} className="h-4 w-4" />
                          Generate
                        </button>
                      )}

                      {isGenerating && (
                        <button
                          onClick={handleCancel}
                          className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-opacity"
                          style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                        >
                          <Icon icon={appIcons.stop} className="h-4 w-4" />
                          Cancel
                        </button>
                      )}

                      {hasAnyCompleted && (
                        <button
                          onClick={handleDownloadZip}
                          className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
                          style={{ borderColor: panelBorder, background: mutedSurface, color: pageText }}
                        >
                          <Icon icon={appIcons.download} className="h-4 w-4" />
                          Download ZIP
                        </button>
                      )}
                    </div>
                  </div>

                  {generationError && <FeedbackBox tone="error" isDark={isDark}>{generationError}</FeedbackBox>}

                  {chaptersToGenerate.length > 100 && !isGenerating && (
                    <FeedbackBox tone="warning" isDark={isDark}>
                      <span>Large batch detected: {chaptersToGenerate.length} chapters may take a while.</span>
                    </FeedbackBox>
                  )}

                  <div className="mt-3 grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="rounded-lg border p-3" style={{ background: mutedSurface, borderColor: panelBorder }}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="capitalize" style={{ color: secondaryText }}>
                          {batchJob ? batchJob.status : 'idle'}
                        </span>
                        <span className="font-mono" style={{ color: pageText }}>
                          {batchJob ? `${progressPct}%` : '0%'}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full" style={{ background: tagSurface }}>
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progressPct}%`, background: strongSurface }} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: tertiaryText }}>
                        <span>
                          {batchJob ? `${batchJob.chapters.filter((chapter) => chapter.status === 'completed').length}/${batchJob.chapters.length} done` : 'Ready'}
                        </span>
                        <span>{format.toUpperCase()}</span>
                      </div>
                      {batchJob && !isGenerating && batchJob.status === 'completed' && (
                        <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: secondaryText }}>
                          <Icon icon={appIcons.check} className="h-4 w-4" />
                          Generation finished.
                        </div>
                      )}
                    </div>

                    {batchJob && batchJob.chapters.length > 0 ? (
                      <div className="max-h-[360px] space-y-1.5 overflow-y-auto rounded-lg border p-2" style={{ background: mutedSurface, borderColor: panelBorder }}>
                        {batchJob.chapters.map((chapter) => (
                          <div
                            key={chapter.chapter_number}
                            className="flex items-center gap-3 rounded-md px-3 py-2"
                            style={{ background: panelBackground }}
                          >
                            {statusIcon(chapter.status)}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium" style={{ color: pageText }}>
                                Ch. {chapter.chapter_number}: {chapter.title}
                              </p>
                              {chapter.error && (
                                <p className="max-w-[240px] truncate text-xs" style={{ color: tertiaryText }} title={chapter.error}>
                                  {chapter.error.length > 80 ? `${chapter.error.slice(0, 80)}...` : chapter.error}
                                </p>
                              )}
                            </div>
                            {chapter.status === 'completed' && (
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  onClick={() => handleListenChapter(chapter.chapter_number)}
                                  title="Listen"
                                  className="rounded-md p-1.5 transition-colors"
                                  style={{ background: tagSurface, color: pageText }}
                                >
                                  <Icon icon={appIcons.play} className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDownloadChapter(chapter.chapter_number)}
                                  title="Download"
                                  className="rounded-md p-1.5 transition-colors"
                                  style={{ background: tagSurface, color: pageText }}
                                >
                                  <Icon icon={appIcons.download} className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-4 text-sm" style={{ borderColor: panelBorder, color: tertiaryText }}>
                        Start a batch to see per-chapter progress here.
                      </div>
                    )}
                  </div>
                </section>
              )}

              {!selectedStory && (
                <section className="rounded-md border p-8 text-center" style={{ background: panelBackground, borderColor: panelBorder }}>
                  <Icon icon={appIcons.book} className="mx-auto mb-3 h-10 w-10" style={{ color: tertiaryText }} />
                  <p className="text-sm" style={{ color: secondaryText }}>
                    Select a story from the library to configure voice generation.
                  </p>
                </section>
              )}

              {selectedStory && (
                <div className="text-center text-xs" style={{ color: tertiaryText }}>
                  <button
                    onClick={() => navigate('/bedread/jobs')}
                    className="underline underline-offset-4"
                    style={{ color: pageText }}
                  >
                    View all TTS jobs
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function StepBadge({ number, isDark }: Readonly<{ number: number; isDark: boolean }>) {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-semibold"
      style={{
        background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(24,24,27,0.08)',
        color: isDark ? '#f4f4f5' : '#18181b',
      }}
    >
      {number}
    </span>
  );
}

function FeedbackBox({
  tone,
  isDark,
  children,
}: Readonly<{
  tone: 'error' | 'warning';
  isDark: boolean;
  children: React.ReactNode;
}>) {
  const style =
    tone === 'warning'
      ? {
          background: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.06)',
          borderColor: isDark ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.16)',
          color: isDark ? '#fcd34d' : '#b45309',
        }
      : {
          background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
          borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
          color: isDark ? '#f87171' : '#dc2626',
        };

  return (
    <div className="rounded-md border px-4 py-3 text-sm" style={style}>
      {children}
    </div>
  );
}

function PaginationButton({
  children,
  disabled,
  onClick,
  panelBorder,
  mutedSurface,
  secondaryText,
  tertiaryText,
}: Readonly<{
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  panelBorder: string;
  mutedSurface: string;
  secondaryText: string;
  tertiaryText: string;
}>) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed"
      style={{
        background: mutedSurface,
        border: `1px solid ${panelBorder}`,
        color: disabled ? tertiaryText : secondaryText,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

function buildPagination(currentPage: number, totalPages: number): Array<number | '...'> {
  const pages: Array<number | '...'> = [];
  if (totalPages <= 7) {
    for (let page = 1; page <= totalPages; page += 1) pages.push(page);
    return pages;
  }

  pages.push(1);
  if (currentPage > 3) pages.push('...');
  for (let page = Math.max(2, currentPage - 1); page <= Math.min(totalPages - 1, currentPage + 1); page += 1) {
    pages.push(page);
  }
  if (currentPage < totalPages - 2) pages.push('...');
  pages.push(totalPages);
  return pages;
}

export default BedReadPage;
