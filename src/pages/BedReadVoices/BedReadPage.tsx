import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cancelBatchJob,
  getBatchJob,
  getBatchZipUrl,
  getBedReadChapters,
  getChapterAudioUrl,
  getDriveSyncConfig,
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
} from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';

interface BedReadPageProps {
  themeMode: 'light' | 'dark';
  onThemeChange: (mode: 'light' | 'dark') => void;
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
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const selectedSurface = isDark ? 'rgba(79,70,229,0.16)' : 'rgba(79,70,229,0.08)';
  const tagSurface = isDark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)';

  const fetchPage1 = () => {
    setStoriesLoading(true);
    setStoriesError('');
    setHasLoadedAll(false);

    searchBedReadStories({ sort: sortBy, page: 1, limit: 20 })
      .then((response: BedReadStorySearchResponse) => {
        setAllLoadedStories(response.stories);
        setTotalStories(response.total);
        saveStories(response.stories);
        setCurrentPage(1);
        if (response.stories.length >= response.total) {
          setHasLoadedAll(true);
        }
      })
      .catch(() => setStoriesError('Failed to load stories. Is the backend running?'))
      .finally(() => setStoriesLoading(false));
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
          .flatMap((stories) => stories)
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

  const filteredStories = allLoadedStories.filter(
    (story) =>
      story.title.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      story.author.toLowerCase().includes(searchKeyword.toLowerCase()),
  );

  const paginatedStories = filteredStories.slice((currentPage - 1) * pageLimit, currentPage * pageLimit);
  const filteredTotalPages = Math.max(1, Math.ceil(filteredStories.length / pageLimit));

  useEffect(() => {
    fetchPage1();
    getVoices().then(setVoices).catch(() => setVoices([]));
    getLanguages().then(setLanguages).catch(() => setLanguages([]));
  }, []);

  useEffect(() => {
    setHasLoadedAll(false);
    fetchPage1();
  }, [sortBy]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchKeyword]);

  useEffect(() => {
    const languageVoices = voices.filter((voice) => voice.lang === selectedLang);
    if (languageVoices.length > 0 && !languageVoices.find((voice) => voice.id === selectedVoice)) {
      setSelectedVoice(languageVoices[0].id);
    }
  }, [selectedLang, voices, selectedVoice]);

  useEffect(() => {
    getDriveSyncConfig()
      .then((config) => {
        if (config?.main_be_user_id) {
          setBedReadUserId(config.main_be_user_id);
        }
        if (config?.main_be_api_base_url) {
          setMainBeApiUrl(config.main_be_api_base_url);
        }
        setConfigInvalid(!config?.main_be_api_base_url || !config?.main_be_user_id);
      })
      .catch(() => setConfigInvalid(true))
      .finally(() => setConfigLoading(false));
  }, []);

  useEffect(() => {
    setBatchId(null);
    setBatchJob(null);
    setIsGenerating(false);
    setGenerationError('');
    if (!selectedStory) return;

    setChaptersLoading(true);
    getBedReadChapters(selectedStory.storyId, bedReadUserId ?? undefined)
      .then((chapterList) => {
        setChapters(chapterList);
        const maxChapter = Math.max(...chapterList.map((chapter) => chapter.chapterNumber), 1);
        setRangeEnd(maxChapter);
      })
      .catch(() => setChapters([]))
      .finally(() => setChaptersLoading(false));
  }, [selectedStory, bedReadUserId]);

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
    saveSortBy(newSort);
  };

  const filteredVoices = voices.filter((voice) => voice.lang === selectedLang);
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
          voice: selectedVoice,
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
    const anchor = document.createElement('a');
    anchor.href = getChapterAudioUrl(batchId, chapterNumber);
    anchor.download = `chapter_${chapterNumber}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handleDownloadZip = () => {
    if (!batchId) return;
    const anchor = document.createElement('a');
    anchor.href = getBatchZipUrl(batchId);
    anchor.download = `bedread_${batchId}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handleListenChapter = (chapterNumber: number) => {
    if (!batchId) return;
    window.open(getChapterAudioUrl(batchId, chapterNumber), '_blank');
  };

  const hasAnyCompleted = batchJob?.chapters.some((chapter) => chapter.status === 'completed') ?? false;
  const progressPct = batchJob?.progress_pct ?? 0;

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <Icon icon={appIcons.check} className={`h-4 w-4 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />;
      case 'failed':
        return <Icon icon={appIcons.close} className="h-4 w-4 text-red-400" />;
      case 'processing':
      case 'queued':
        return <Icon icon={appIcons.refresh} className={`h-4 w-4 animate-spin ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />;
      default:
        return <div className={`h-4 w-4 rounded-full border ${isDark ? 'border-white/20' : 'border-gray-300'}`} />;
    }
  };

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <main className="space-y-6">
          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Audio
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                BedReads
              </h1>
              <p className="text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                Browse BedRead stories, choose a chapter range, and generate TTS audio in batch.
              </p>
            </div>
          </section>

          <ServerModeBanner
            serverUrl={mainBeApiUrl}
            isDark={isDark}
            isConfigLoading={configLoading}
            isConfigValid={configInvalid ? false : configLoading ? undefined : Boolean(mainBeApiUrl && bedReadUserId)}
            onConfigure={() => {
              window.location.href = '/settings/drive-sync';
            }}
          />

          <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-[420px_minmax(0,1fr)]">
            <section
              className="overflow-hidden rounded-2xl border"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="border-b px-5 pb-4 pt-5" style={{ borderColor: panelBorder }}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <StepBadge number={1} isDark={isDark} />
                    <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                      Library
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {!hasLoadedAll && (
                      <button
                        onClick={loadAllStories}
                        disabled={isLoadingAll}
                        className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed"
                        style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                      >
                        {isLoadingAll ? 'Loading…' : `Load All (${totalStories.toLocaleString()})`}
                      </button>
                    )}
                    {hasLoadedAll && (
                      <span
                        className="rounded-md px-2.5 py-1 text-xs"
                        style={{ background: mutedSurface, color: secondaryText }}
                      >
                        All {totalStories.toLocaleString()} loaded
                      </span>
                    )}
                    <button
                      onClick={() => fetchPage1()}
                      disabled={storiesLoading || isLoadingAll}
                      className="rounded-md border p-2 transition-colors disabled:cursor-not-allowed"
                      style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
                      title="Refresh story list"
                    >
                      <Icon icon={appIcons.refresh} className={`h-4 w-4 ${storiesLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <Icon
                    icon={appIcons.search}
                    className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
                    style={{ color: tertiaryText }}
                  />
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(event) => setSearchKeyword(event.target.value)}
                    placeholder="Search by title or author..."
                    className="w-full rounded-md border py-3 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                    style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                  />
                </div>
              </div>

              <div className="border-b px-5 py-3" style={{ borderColor: panelBorder }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: tertiaryText }}>
                    Sort:
                  </span>
                  <select
                    value={sortBy}
                    onChange={(event) => handleSortChange(event.target.value as typeof sortBy)}
                    className="flex-1 rounded-md border px-3 py-2 text-xs outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                    style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                  >
                    <option value="release_date">Latest</option>
                    <option value="recently_updated">Recently Updated</option>
                    <option value="recently_added">Recently Added</option>
                    <option value="popular">Popular</option>
                  </select>
                </div>
              </div>

              <div className="max-h-[70vh] overflow-y-auto xl:max-h-[50vh]">
                {storiesLoading && (
                  <div className="flex flex-col items-center justify-center py-16 text-sm" style={{ color: secondaryText }}>
                    <Icon
                      icon={appIcons.refresh}
                      className={`mb-3 h-8 w-8 animate-spin ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}
                    />
                    Loading stories...
                  </div>
                )}

                {storiesError && (
                  <div className="p-5">
                    <FeedbackBox tone="error" isDark={isDark}>
                      {storiesError}
                    </FeedbackBox>
                  </div>
                )}

                {!storiesLoading && !storiesError && filteredStories.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-sm" style={{ color: tertiaryText }}>
                    <Icon icon={appIcons.close} className="mb-3 h-12 w-12" />
                    <p>No stories found</p>
                  </div>
                )}

                <div className="space-y-2 p-3">
                  {paginatedStories.map((story) => {
                    const isSelected = selectedStory?.storyId === story.storyId;
                    return (
                      <button
                        key={story.storyId}
                        onClick={() => {
                          setSelectedStory(story);
                          saveSelectedStoryId(story.storyId);
                        }}
                        className="flex w-full gap-3 rounded-xl border p-3 text-left transition-colors"
                        style={{
                          background: isSelected ? selectedSurface : mutedSurface,
                          borderColor: isSelected ? 'rgba(99,102,241,0.22)' : 'transparent',
                        }}
                      >
                        {story.coverUrl ? (
                          <div className="relative shrink-0">
                            <img
                              src={story.coverUrl}
                              alt={story.title}
                              className="h-[4.5rem] w-14 rounded-xl object-cover"
                              style={{ background: mutedSurface }}
                              onError={(event) => {
                                (event.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                        ) : (
                          <div
                            className="flex h-[4.5rem] w-14 shrink-0 items-center justify-center rounded-xl"
                            style={{ background: tagSurface }}
                          >
                            <Icon icon={appIcons.book} className="h-6 w-6" style={{ color: secondaryText }} />
                          </div>
                        )}

                        <div className="min-w-0 flex-1 py-0.5">
                          <p className="line-clamp-2 text-sm font-medium leading-snug" style={{ color: pageText }}>
                            {story.title}
                          </p>
                          <p className="mt-1 truncate text-xs" style={{ color: secondaryText }}>
                            {story.author}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2">
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                              style={{ background: mutedSurface, color: secondaryText }}
                            >
                              {story.chapterCount} ch
                            </span>
                            {story.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="rounded px-1.5 py-0.5 text-xs"
                                style={{
                                  background: tagSurface,
                                  color: isDark ? '#a5b4fc' : '#4f46e5',
                                  maxWidth: '60px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t px-4 py-3" style={{ borderColor: panelBorder }}>
                <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-1.5">
                  {storiesLoading ? (
                    <div className="flex items-center gap-2 text-xs" style={{ color: tertiaryText }}>
                      <Icon
                        icon={appIcons.refresh}
                        className={`h-4 w-4 animate-spin ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}
                      />
                      Loading stories...
                    </div>
                  ) : (
                    <>
                      <PaginationButton
                        disabled={currentPage <= 1}
                        isDark={isDark}
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                        panelBorder={panelBorder}
                        mutedSurface={mutedSurface}
                        secondaryText={secondaryText}
                        tertiaryText={tertiaryText}
                      >
                        <Icon icon={appIcons.chevronLeft} className="h-4 w-4" />
                      </PaginationButton>

                      {buildPagination(currentPage, filteredTotalPages).map((page, index) =>
                        page === '...' ? (
                          <span key={`ellipsis-${index}`} className="flex h-8 w-8 items-center justify-center text-xs" style={{ color: tertiaryText }}>
                            ...
                          </span>
                        ) : (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-xs font-medium transition-colors"
                            style={{
                              background: page === currentPage ? '#4f46e5' : mutedSurface,
                              color: page === currentPage ? '#ffffff' : pageText,
                            }}
                          >
                            {page}
                          </button>
                        ),
                      )}

                      <PaginationButton
                        disabled={currentPage >= filteredTotalPages}
                        isDark={isDark}
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

            <div className="space-y-4 lg:sticky lg:top-6">
              {selectedStory && (
                <section className="rounded-2xl border p-5 sm:p-6" style={{ background: panelBackground, borderColor: panelBorder }}>
                  <div className="flex items-start gap-4">
                    {selectedStory.coverUrl && (
                      <img
                        src={selectedStory.coverUrl}
                        alt={selectedStory.title}
                        className="h-28 w-20 shrink-0 rounded-xl object-cover"
                        style={{ background: mutedSurface }}
                        onError={(event) => {
                          (event.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                        {selectedStory.title}
                      </h2>
                      <p className="mt-0.5 text-sm" style={{ color: secondaryText }}>
                        {selectedStory.author}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: tertiaryText }}>
                        {selectedStory.chapterCount} chapters
                      </p>
                      {selectedStory.description && (
                        <p className="mt-2 line-clamp-3 text-sm" style={{ color: secondaryText }}>
                          {selectedStory.description}
                        </p>
                      )}
                      {selectedStory.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {selectedStory.tags.slice(0, 5).map((tag) => (
                            <span
                              key={tag}
                              className="rounded px-2 py-0.5 text-xs"
                              style={{ background: mutedSurface, color: secondaryText }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 border-t pt-4" style={{ borderColor: panelBorder }}>
                    <h3 className="mb-3 text-sm font-medium" style={{ color: pageText }}>
                      Chapters
                    </h3>
                    <div className="space-y-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="chapter-mode"
                          checked={allChapters}
                          onChange={() => setAllChapters(true)}
                          className="accent-indigo-500"
                        />
                        <span className="text-sm" style={{ color: secondaryText }}>
                          All chapters
                        </span>
                        <span className="text-xs" style={{ color: tertiaryText }}>
                          ({chapters.length})
                        </span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="chapter-mode"
                          checked={!allChapters}
                          onChange={() => setAllChapters(false)}
                          className="accent-indigo-500"
                        />
                        <span className="text-sm" style={{ color: secondaryText }}>
                          Range
                        </span>
                      </label>
                      {!allChapters && (
                        <div className="ml-6 flex items-center gap-3">
                          <div>
                            <label className="mb-1 block text-xs" style={{ color: tertiaryText }}>
                              From
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={rangeEnd}
                              value={rangeStart}
                              onChange={(event) => setRangeStart(Math.max(1, parseInt(event.target.value) || 1))}
                              className="w-20 rounded-md border px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                              style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                            />
                          </div>
                          <span className="mt-4 text-xs" style={{ color: tertiaryText }}>
                            to
                          </span>
                          <div>
                            <label className="mb-1 block text-xs" style={{ color: tertiaryText }}>
                              To
                            </label>
                            <input
                              type="number"
                              min={rangeStart}
                              max={chapters.length || 999}
                              value={rangeEnd}
                              onChange={(event) => setRangeEnd(Math.max(rangeStart, parseInt(event.target.value) || rangeStart))}
                              className="w-20 rounded-md border px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                              style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                            />
                          </div>
                          <span className="mt-4 text-xs" style={{ color: tertiaryText }}>
                            ({Math.max(0, rangeEnd - rangeStart + 1)} chapters)
                          </span>
                        </div>
                      )}
                    </div>
                    {chaptersLoading && (
                      <p className="mt-2 text-xs" style={{ color: tertiaryText }}>
                        Loading chapters...
                      </p>
                    )}
                  </div>
                </section>
              )}

              {selectedStory && (
                <section className="rounded-2xl border p-5 sm:p-6" style={{ background: panelBackground, borderColor: panelBorder }}>
                  <div className="mb-4 flex items-center gap-2">
                    <StepBadge number={2} isDark={isDark} />
                    <h3 className="text-lg font-semibold" style={{ color: pageText }}>
                      Voice settings
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm" style={{ color: secondaryText }}>
                        Language
                      </label>
                      <select
                        value={selectedLang}
                        onChange={(event) => setSelectedLang(event.target.value)}
                        disabled={isGenerating}
                        className="w-full rounded-md border px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed"
                        style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                      >
                        {languages.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm" style={{ color: secondaryText }}>
                        Voice
                      </label>
                      <select
                        value={selectedVoice}
                        onChange={(event) => setSelectedVoice(event.target.value)}
                        disabled={isGenerating}
                        className="w-full rounded-md border px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed"
                        style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                      >
                        {filteredVoices.map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-sm" style={{ color: secondaryText }}>
                        Speed
                      </label>
                      <span className="text-sm font-mono" style={{ color: isDark ? '#a5b4fc' : '#4f46e5' }}>
                        {speed.toFixed(2)}x
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0.25}
                        max={2.0}
                        step={0.05}
                        value={speed}
                        onChange={(event) => setSpeed(parseFloat(event.target.value))}
                        disabled={isGenerating}
                        className="flex-1 accent-indigo-500"
                      />
                      <input
                        type="number"
                        min={0.25}
                        max={2.0}
                        step={0.01}
                        value={speed}
                        onChange={(event) => {
                          const value = parseFloat(event.target.value);
                          if (!Number.isNaN(value) && value >= 0.25 && value <= 2.0) {
                            setSpeed(value);
                          }
                        }}
                        disabled={isGenerating}
                        className="w-20 rounded-md border px-2 py-1.5 text-center text-sm font-mono outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                        style={{ background: mutedSurface, borderColor: panelBorder, color: pageText }}
                      />
                    </div>
                    <div className="mt-0.5 flex justify-between text-xs" style={{ color: tertiaryText }}>
                      <span>0.25x</span>
                      <span>1.0x</span>
                      <span>2.0x</span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="mb-1.5 block text-sm" style={{ color: secondaryText }}>
                      Format
                    </label>
                    <div className="flex gap-3">
                      {(['wav', 'mp3'] as const).map((audioFormat) => (
                        <label key={audioFormat} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="format"
                            value={audioFormat}
                            checked={format === audioFormat}
                            onChange={() => setFormat(audioFormat)}
                            disabled={isGenerating}
                            className="accent-indigo-500"
                          />
                          <span className="text-sm uppercase" style={{ color: secondaryText }}>
                            {audioFormat}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {selectedStory && (
                <section className="rounded-2xl border p-5 sm:p-6" style={{ background: panelBackground, borderColor: panelBorder }}>
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <StepBadge number={3} isDark={isDark} />
                        <h3 className="text-lg font-semibold" style={{ color: pageText }}>
                          Generate audio
                        </h3>
                      </div>
                      <p className="text-sm" style={{ color: secondaryText }}>
                        {chaptersToGenerate.length} chapter{chaptersToGenerate.length !== 1 ? 's' : ''} selected
                      </p>
                    </div>
                  </div>

                  {generationError && <FeedbackBox tone="error" isDark={isDark}>{generationError}</FeedbackBox>}

                  {chaptersToGenerate.length > 100 && !isGenerating && (
                    <FeedbackBox tone="warning" isDark={isDark}>
                      <span>
                        <strong>Note:</strong> You are about to generate {chaptersToGenerate.length} chapters. This may take a very long time.
                      </span>
                    </FeedbackBox>
                  )}

                  {isGenerating && batchJob && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize" style={{ color: secondaryText }}>
                          {batchJob.status}
                        </span>
                        <span className="text-xs" style={{ color: tertiaryText }}>
                          {batchJob.chapters.filter((chapter) => chapter.status === 'completed').length}/{batchJob.chapters.length} chapters
                        </span>
                        <span className="font-mono" style={{ color: isDark ? '#a5b4fc' : '#4f46e5' }}>
                          {progressPct}%
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full" style={{ background: mutedSurface }}>
                        <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>
                  )}

                  {batchJob && !isGenerating && batchJob.status === 'completed' && (
                    <div className="flex items-center gap-2 text-sm" style={{ color: isDark ? '#6ee7b7' : '#047857' }}>
                      <Icon icon={appIcons.check} className="h-5 w-5" />
                      All chapters generated successfully!
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {!isGenerating && !batchJob && (
                      <button
                        onClick={handleGenerate}
                        disabled={!selectedStory || chaptersToGenerate.length === 0}
                        className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed"
                        style={{
                          background:
                            !selectedStory || chaptersToGenerate.length === 0
                              ? isDark
                                ? 'rgba(255,255,255,0.08)'
                                : 'rgba(55,53,47,0.14)'
                              : '#4f46e5',
                          color: !selectedStory || chaptersToGenerate.length === 0 ? secondaryText : '#ffffff',
                        }}
                      >
                        <Icon icon={appIcons.play} className="h-4 w-4" />
                        Generate audio
                      </button>
                    )}

                    {isGenerating && (
                      <button
                        onClick={handleCancel}
                        className="inline-flex items-center gap-2 rounded-md bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-95"
                      >
                        <Icon icon={appIcons.stop} className="h-4 w-4" />
                        Cancel
                      </button>
                    )}

                    {hasAnyCompleted && (
                      <button
                        onClick={handleDownloadZip}
                        className="inline-flex items-center gap-2 rounded-md border px-5 py-2.5 text-sm font-medium transition-colors"
                        style={{ borderColor: panelBorder, background: mutedSurface, color: isDark ? '#a5b4fc' : '#4f46e5' }}
                      >
                        <Icon icon={appIcons.download} className="h-4 w-4" />
                        Download All (ZIP)
                      </button>
                    )}
                  </div>
                </section>
              )}

              {batchJob && batchJob.chapters.length > 0 && (
                <section className="rounded-2xl border p-5 sm:p-6" style={{ background: panelBackground, borderColor: panelBorder }}>
                  <h3 className="mb-3 text-sm font-medium" style={{ color: pageText }}>
                    Chapter progress
                  </h3>
                  <div className="max-h-[400px] space-y-1.5 overflow-y-auto">
                    {batchJob.chapters.map((chapter) => (
                      <div
                        key={chapter.chapter_number}
                        className="flex items-center gap-3 rounded-xl px-3 py-2"
                        style={{ background: mutedSurface }}
                      >
                        {statusIcon(chapter.status)}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium" style={{ color: pageText }}>
                            Ch. {chapter.chapter_number}: {chapter.title}
                          </p>
                          {chapter.error && (
                            <p className="max-w-[200px] truncate text-xs text-red-400" title={chapter.error}>
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
                              style={{ background: tagSurface, color: isDark ? '#a5b4fc' : '#4f46e5' }}
                            >
                              <Icon icon={appIcons.play} className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDownloadChapter(chapter.chapter_number)}
                              title="Download"
                              className="rounded-md p-1.5 transition-colors"
                              style={{ background: tagSurface, color: isDark ? '#a5b4fc' : '#4f46e5' }}
                            >
                              <Icon icon={appIcons.download} className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {!selectedStory && (
                <section className="rounded-2xl border p-8 text-center" style={{ background: panelBackground, borderColor: panelBorder }}>
                  <Icon icon={appIcons.book} className="mx-auto mb-4 h-12 w-12" style={{ color: tertiaryText }} />
                  <p className="text-sm" style={{ color: secondaryText }}>
                    Select a story from the list to get started.
                  </p>
                </section>
              )}

              {selectedStory && (
                <div className="text-center text-xs" style={{ color: tertiaryText }}>
                  <button
                    onClick={() => navigate('/bedread/jobs')}
                    className="underline"
                    style={{ color: isDark ? '#a5b4fc' : '#4f46e5' }}
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

function StepBadge({ number, isDark }: { number: number; isDark: boolean }) {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-semibold"
      style={{
        background: isDark ? 'rgba(99,102,241,0.16)' : 'rgba(99,102,241,0.12)',
        color: isDark ? '#a5b4fc' : '#4f46e5',
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
}: {
  tone: 'error' | 'warning';
  isDark: boolean;
  children: React.ReactNode;
}) {
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
    <div className="rounded-xl border px-4 py-3 text-sm" style={style}>
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
}: {
  children: React.ReactNode;
  disabled: boolean;
  isDark: boolean;
  onClick: () => void;
  panelBorder: string;
  mutedSurface: string;
  secondaryText: string;
  tertiaryText: string;
}) {
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
