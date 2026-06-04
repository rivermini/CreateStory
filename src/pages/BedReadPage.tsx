import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cancelBatchJob,
  getBedReadChapters,
  getBatchJob,
  getChapterAudioUrl,
  getBatchZipUrl,
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
} from '../api/client';
import { ServerModeBanner } from '../components/ServerModeBanner';

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
  } catch { return []; }
}

function saveStories(stories: BedReadStory[]) {
  try {
    localStorage.setItem(STORAGE_KEY_STORIES, JSON.stringify(stories));
  } catch { /* ignore */ }
}

function loadStoredSelectedId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_SELECTED);
  } catch { return null; }
}

function saveSelectedStoryId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY_SELECTED, id);
    else localStorage.removeItem(STORAGE_KEY_SELECTED);
  } catch { /* ignore */ }
}

const VALID_SORT_VALUES = ['release_date', 'popular', 'recently_updated', 'recently_added'] as const;

function loadStoredSort(): typeof VALID_SORT_VALUES[number] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SORT);
    if (stored && VALID_SORT_VALUES.includes(stored as typeof VALID_SORT_VALUES[number])) return stored as typeof VALID_SORT_VALUES[number];
  } catch { /* ignore */ }
  return 'release_date';
}

function saveSortBy(sort: string) {
  try { localStorage.setItem(STORAGE_KEY_SORT, sort); } catch { /* ignore */ }
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
    return stories.find(s => s.storyId === storedId) || null;
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

  const fetchPage1 = () => {
    setStoriesLoading(true);
    setStoriesError('');
    setHasLoadedAll(false);

    searchBedReadStories({ sort: sortBy, page: 1, limit: 20 })
      .then((res: BedReadStorySearchResponse) => {
        setAllLoadedStories(res.stories);
        setTotalStories(res.total);
        saveStories(res.stories);
        setCurrentPage(1);
        if (res.stories.length >= res.total) {
          setHasLoadedAll(true);
        }
      })
      .catch(() => setStoriesError('Failed to load stories. Is the backend running?'))
      .finally(() => setStoriesLoading(false));
  };

  const loadAllStories = () => {
    if (hasLoadedAll || isLoadingAll) return;
    setIsLoadingAll(true);
    const totalPg = Math.max(1, Math.ceil(totalStories / 20));
    const pageRequests: Promise<BedReadStorySearchResponse>[] = [];
    for (let p = 2; p <= totalPg; p++) {
      pageRequests.push(searchBedReadStories({ sort: sortBy, page: p, limit: 20 }));
    }
    Promise.all(pageRequests)
      .then(responses => {
        const seen = new Set<string>();
        const page1Stories = allLoadedStories;
        const allStories: BedReadStory[] = [page1Stories, ...responses.map(r => r.stories)].flatMap(stories => stories)
          .filter(s => {
            if (seen.has(s.storyId)) return false;
            seen.add(s.storyId);
            return true;
          });
        setAllLoadedStories(allStories);
        saveStories(allStories);
        setHasLoadedAll(true);
      })
      .catch(() => setStoriesError('Failed to load all stories.'))
      .finally(() => setIsLoadingAll(false));
  };

  const filteredStories = allLoadedStories.filter(s =>
    s.title.toLowerCase().includes(searchKeyword.toLowerCase()) ||
    s.author.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  const paginatedStories = filteredStories.slice(
    (currentPage - 1) * pageLimit,
    currentPage * pageLimit
  );

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

  const handleSortChange = (newSort: 'release_date' | 'popular' | 'recently_updated' | 'recently_added') => {
    setSortBy(newSort);
    saveSortBy(newSort);
  };

  useEffect(() => { setCurrentPage(1); }, [searchKeyword]);

  useEffect(() => {
    const langVoices = voices.filter(v => v.lang === selectedLang);
    if (langVoices.length > 0 && !langVoices.find(v => v.id === selectedVoice)) {
      setSelectedVoice(langVoices[0].id);
    }
  }, [selectedLang, voices, selectedVoice]);

  useEffect(() => {
    getDriveSyncConfig().then(cfg => {
      if (cfg?.main_be_user_id) {
        setBedReadUserId(cfg.main_be_user_id);
      }
      if (cfg?.main_be_api_base_url) {
        setMainBeApiUrl(cfg.main_be_api_base_url);
      }
      setConfigInvalid(!cfg?.main_be_api_base_url || !cfg?.main_be_user_id);
    }).catch(() => setConfigInvalid(true)).finally(() => setConfigLoading(false));
  }, []);

  useEffect(() => {
    setBatchId(null);
    setBatchJob(null);
    setIsGenerating(false);
    setGenerationError('');
    if (!selectedStory) return;
    setChaptersLoading(true);
    getBedReadChapters(selectedStory.storyId, bedReadUserId ?? undefined)
      .then(ch => {
        setChapters(ch);
        const maxChapter = Math.max(...ch.map(c => c.chapterNumber), 1);
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
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [batchId]);

  const filteredVoices = voices.filter(v => v.lang === selectedLang);

  const chaptersToGenerate = allChapters
    ? chapters.map(c => c.chapterNumber)
    : Array.from({ length: rangeEnd - rangeStart + 1 }, (_, i) => rangeStart + i)
        .filter(n => n >= 1 && n <= Math.max(...chapters.map(c => c.chapterNumber), 0));

  const handleGenerate = async () => {
    if (!selectedStory) return;
    setGenerationError('');
    setIsGenerating(true);
    setBatchJob(null);
    setBatchId(null);
    try {
      const res = await startBatchGenerate({
        story_id: selectedStory.storyId,
        story_title: selectedStory.title,
        chapter_start: allChapters ? 1 : rangeStart,
        chapter_end: allChapters ? null : rangeEnd,
        voice: selectedVoice,
        lang: selectedLang,
        speed,
        format,
      }, bedReadUserId ?? undefined);
      setBatchId(res.batch_id);
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : 'Failed to start batch job.');
      setIsGenerating(false);
    }
  };

  const handleCancel = async () => {
    if (!batchId) return;
    try { await cancelBatchJob(batchId); } catch { /* ignore */ }
    setIsGenerating(false);
  };

  const handleDownloadChapter = (chapterNum: number) => {
    if (!batchId) return;
    const a = document.createElement('a');
    a.href = getChapterAudioUrl(batchId, chapterNum);
    a.download = `chapter_${chapterNum}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadZip = () => {
    if (!batchId) return;
    const a = document.createElement('a');
    a.href = getBatchZipUrl(batchId);
    a.download = `bedread_${batchId}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleListenChapter = (chapterNum: number) => {
    if (!batchId) return;
    window.open(getChapterAudioUrl(batchId, chapterNum), '_blank');
  };

  const hasAnyCompleted = batchJob?.chapters.some(c => c.status === 'completed') ?? false;
  const progressPct = batchJob?.progress_pct ?? 0;

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <svg className={'w-4 h-4 ' + (isDark ? 'text-emerald-400' : 'text-emerald-600')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'failed':
        return (
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'processing':
      case 'queued':
        return (
          <svg className={'w-4 h-4 animate-spin ' + (isDark ? 'text-indigo-400' : 'text-indigo-600')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      default:
        return <div className={'w-4 h-4 rounded-full border ' + (isDark ? 'border-white/20' : 'border-gray-300')} />;
    }
  };

  const c = (key: string) => {
    const map: Record<string, [string, string]> = {
      text: ['text-white/90', 'text-[rgba(0,0,0,0.85)]'],
      textMuted: ['text-white/40', 'text-[rgba(0,0,0,0.4)]'],
      textSub: ['text-white/30', 'text-[rgba(0,0,0,0.3)]'],
      textBody: ['text-white/70', 'text-[rgba(0,0,0,0.7)]'],
      textBodyStrong: ['text-white/85', 'text-[rgba(0,0,0,0.8)]'],
      divider: ['bg-white/6', 'bg-black/6'],
      rowBg: ['bg-white/[0.04]', 'bg-[rgba(0,0,0,0.03)]'],
      rowBorder: ['border-white/[0.05]', 'border-black/5'],
      cardSubtleBg: ['bg-white/[0.03]', 'bg-[rgba(0,0,0,0.02)]'],
      inputBg: ['bg-white/[0.05]', 'bg-[rgba(0,0,0,0.04)]'],
    };
    return isDark ? map[key][0] : map[key][1];
  };

  const pageBg = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)';

  const inputClass = isDark
    ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder-white/30'
    : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)] placeholder-[rgba(0,0,0,0.3)]';

  const selectClass = isDark
    ? 'bg-white/[0.05] border-white/[0.08] text-white/90'
    : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)]';

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBg }}>
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />

      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <main className="w-full xl:max-w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

          {/* Page Header */}
          <div className="lg-glass-deep px-6 py-5 flex items-start justify-between gap-4">
            <div>
              <h1 className={`text-2xl sm:text-3xl font-bold ${c('text')}`}>BedReads</h1>
              <p className={`mt-1 text-sm sm:text-base ${c('textMuted')}`}>Novel TTS Reader — batch audio from web novels</p>
            </div>
          </div>

          {/* Server Mode Banner */}
          <ServerModeBanner
            serverUrl={mainBeApiUrl}
            isDark={isDark}
            isConfigLoading={configLoading}
            isConfigValid={configInvalid ? false : (configLoading ? undefined : Boolean(mainBeApiUrl && bedReadUserId))}
            onConfigure={() => window.location.href = '/settings/drive-sync'}
          />

          <div className="grid grid-cols-1 2xl:grid-cols-[420px_1fr] gap-6 items-start">

            {/* Left Column: Story List */}
            <section className="lg-glass-card">
              {/* Card Header */}
              <div className={`px-5 pt-5 pb-4 border-b ${c('rowBorder')}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${isDark
                      ? 'bg-indigo-600/20 text-indigo-400'
                      : 'bg-indigo-100 text-indigo-600'
                    }`}>1</span>
                    <h2 className={`text-base font-semibold ${c('textBodyStrong')}`}>Library</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {!hasLoadedAll && (
                      <button
                        onClick={loadAllStories}
                        disabled={isLoadingAll}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isDark
                          ? 'bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/20'
                          : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200'}`}>
                        {isLoadingAll ? (
                          <span className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Loading...
                          </span>
                        ) : (
                          `Load All (${totalStories.toLocaleString()})`
                        )}
                      </button>
                    )}
                    {hasLoadedAll && (
                      <span className={`px-2.5 py-1 text-xs rounded-lg ${c('rowBg')}`}>
                        All {totalStories.toLocaleString()} loaded
                      </span>
                    )}
                    <button
                      onClick={() => fetchPage1()}
                      disabled={storiesLoading || isLoadingAll}
                      className={`p-1.5 rounded-lg transition-colors lg-icon-btn disabled:opacity-50`}
                      title="Refresh story list"
                    >
                      <svg className={`w-4 h-4 ${c('textMuted')} ${storiesLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <svg className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${c('textSub')}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={e => setSearchKeyword(e.target.value)}
                    placeholder="Search by title or author..."
                    className={`w-full pl-10 pr-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all ${inputClass}`}
                  />
                </div>
              </div>

              {/* Sort row */}
              <div className={`px-5 py-3 border-b ${c('rowBorder')}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${c('textSub')}`}>Sort:</span>
                  <select
                    value={sortBy}
                    onChange={e => handleSortChange(e.target.value as typeof sortBy)}
                    className={`flex-1 px-3 py-2 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer ${selectClass}`}
                  >
                    <option value="release_date">Latest</option>
                    <option value="recently_updated">Recently Updated</option>
                    <option value="recently_added">Recently Added</option>
                    <option value="popular">Popular</option>
                  </select>
                </div>
              </div>

              {/* Story list */}
              <div className="max-h-[70vh] xl:max-h-[50vh] overflow-y-auto">
                {storiesLoading && (
                  <div className={`flex flex-col items-center justify-center py-16 ${c('textMuted')} text-sm`}>
                    <svg className={`w-8 h-8 mb-3 animate-spin ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Loading stories...
                  </div>
                )}
                {storiesError && (
                  <div className="p-5">
                    <div className={`p-3 rounded-xl text-sm ${isDark
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-red-50 border border-red-200 text-red-600'}`}>
                      {storiesError}
                    </div>
                  </div>
                )}
                {!storiesLoading && !storiesError && filteredStories.length === 0 && (
                  <div className={`flex flex-col items-center justify-center py-16 ${c('textSub')} text-sm`}>
                    <svg className={`w-12 h-12 mb-3 ${c('textSub')}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>No stories found</p>
                  </div>
                )}
                <div className="p-3 space-y-2">
                  {paginatedStories.map(story => (
                    <button
                      key={story.storyId}
                      onClick={() => { setSelectedStory(story); saveSelectedStoryId(story.storyId); }}
                      className={
                        `w-full flex gap-3 p-3 rounded-xl text-left transition-all duration-200 group ` +
                        (selectedStory?.storyId === story.storyId
                          ? (isDark
                              ? 'bg-indigo-600/15 border border-indigo-500/25'
                              : 'bg-indigo-50 border border-indigo-200')
                          : (isDark
                              ? 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04] hover:border-white/[0.05]'
                              : 'bg-[rgba(0,0,0,0.02)] border border-transparent hover:bg-[rgba(0,0,0,0.04)] hover:border-black/5'))
                      }
                    >
                      {story.coverUrl ? (
                        <div className="relative flex-shrink-0">
                          <img
                            src={story.coverUrl}
                            alt={story.title}
                            className={`w-14 h-[4.5rem] object-cover rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-200'}`}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </div>
                      ) : (
                        <div className={`w-14 h-[4.5rem] rounded-xl flex-shrink-0 flex items-center justify-center ${isDark
                          ? 'bg-indigo-600/10'
                          : 'bg-indigo-100'}`}>
                          <svg className={`w-6 h-6 ${c('textMuted')}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className={`text-sm font-medium line-clamp-2 leading-snug ${c('textBodyStrong')}`}>{story.title}</p>
                        <p className={`text-xs mt-1 truncate ${c('textMuted')}`}>{story.author}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${c('rowBg')}`}>
                            {story.chapterCount} ch
                          </span>
                          {story.tags.slice(0, 2).map(tag => (
                            <span key={tag} className={`px-1.5 py-0.5 text-xs rounded ${isDark
                              ? 'bg-indigo-600/15 text-indigo-300/80'
                              : 'bg-indigo-50 text-indigo-700'}`}
                              style={{ maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pagination */}
              <div className={`border-t px-4 py-3 ${c('rowBorder')}`}>
                <div className="flex items-center justify-center gap-0.5 sm:gap-1 flex-wrap">
                  {storiesLoading ? (
                    <div className="flex items-center gap-2">
                      <svg className={`w-4 h-4 animate-spin ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className={`text-xs ${c('textSub')}`}>Loading stories...</span>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-150 ${currentPage <= 1
                          ? `${c('rowBg')} ${c('textSub')} opacity-40 cursor-not-allowed`
                          : `${c('rowBg')} ${c('textBody')} hover:${isDark ? 'bg-white/[0.06]' : 'bg-[rgba(0,0,0,0.06)]'} active:scale-95`}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>

                      {(() => {
                        const total = filteredTotalPages;
                        const cur = currentPage;
                        const pages: (number | '...')[] = [];
                        if (total <= 7) {
                          for (let i = 1; i <= total; i++) pages.push(i);
                        } else {
                          pages.push(1);
                          if (cur > 3) pages.push('...');
                          for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) pages.push(i);
                          if (cur < total - 2) pages.push('...');
                          pages.push(total);
                        }
                        return pages.map((p, i) =>
                          p === '...' ? (
                            <span key={'ellipsis-' + i} className={`w-8 h-8 flex items-center justify-center text-xs ${c('textSub')}`}>...</span>
                          ) : (
                            <button
                              key={p}
                              onClick={() => setCurrentPage(p)}
                              className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-medium transition-all duration-150 ${p === cur
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                                : `${c('rowBg')} ${c('textBody')} hover:${isDark ? 'bg-white/[0.06]' : 'bg-[rgba(0,0,0,0.06)]'} active:scale-95`}`}
                            >
                              {p}
                            </button>
                          )
                        );
                      })()}

                      <button
                        onClick={() => setCurrentPage(p => Math.min(filteredTotalPages, p + 1))}
                        disabled={currentPage >= filteredTotalPages}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-150 ${currentPage >= filteredTotalPages
                          ? `${c('rowBg')} ${c('textSub')} opacity-40 cursor-not-allowed`
                          : `${c('rowBg')} ${c('textBody')} hover:${isDark ? 'bg-white/[0.06]' : 'bg-[rgba(0,0,0,0.06)]'} active:scale-95`}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>

            {/* Right Column: Story Detail + Generation */}
            <div className="space-y-4 lg:sticky lg:top-6">

              {/* Story Details Card */}
              {selectedStory && (
                <section className="lg-glass-card p-5 sm:p-6 space-y-4">
                  <div className="flex items-start gap-4">
                    {selectedStory.coverUrl && (
                      <img
                        src={selectedStory.coverUrl}
                        alt={selectedStory.title}
                        className={`w-20 h-28 object-cover rounded-xl flex-shrink-0 ${isDark ? 'bg-white/5' : 'bg-gray-200'}`}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <h2 className={`text-lg font-semibold ${c('text')}`}>{selectedStory.title}</h2>
                      <p className={`text-sm mt-0.5 ${c('textMuted')}`}>{selectedStory.author}</p>
                      <p className={`text-xs mt-1 ${c('textSub')}`}>{selectedStory.chapterCount} chapters</p>
                      {selectedStory.description && (
                        <p className={`text-sm mt-2 line-clamp-3 ${c('textMuted')}`}>{selectedStory.description}</p>
                      )}
                      {selectedStory.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {selectedStory.tags.slice(0, 5).map(tag => (
                            <span key={tag} className={`px-2 py-0.5 text-xs rounded ${c('rowBg')} ${c('textMuted')}`}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={`border-t ${c('divider')} pt-4`}>
                    <h3 className={`text-sm font-medium ${c('textBody')} mb-3`}>Chapters</h3>
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="chapter-mode" checked={allChapters} onChange={() => setAllChapters(true)} className="accent-indigo-500" />
                        <span className={`text-sm ${c('textMuted')}`}>All chapters</span>
                        <span className={`text-xs ${c('textSub')}`}>({chapters.length})</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="chapter-mode" checked={!allChapters} onChange={() => setAllChapters(false)} className="accent-indigo-500" />
                        <span className={`text-sm ${c('textMuted')}`}>Range</span>
                      </label>
                      {!allChapters && (
                        <div className="flex items-center gap-3 ml-6">
                          <div>
                            <label className={`block text-xs ${c('textSub')} mb-1`}>From</label>
                            <input
                              type="number" min={1} max={rangeEnd} value={rangeStart}
                              onChange={e => setRangeStart(Math.max(1, parseInt(e.target.value) || 1))}
                              className={`w-20 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${inputClass}`}
                            />
                          </div>
                          <span className={`text-xs ${c('textSub')} mt-4`}>to</span>
                          <div>
                            <label className={`block text-xs ${c('textSub')} mb-1`}>To</label>
                            <input
                              type="number" min={rangeStart} max={chapters.length || 999} value={rangeEnd}
                              onChange={e => setRangeEnd(Math.max(rangeStart, parseInt(e.target.value) || rangeStart))}
                              className={`w-20 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${inputClass}`}
                            />
                          </div>
                          <span className={`text-xs ${c('textSub')} mt-4`}>({Math.max(0, rangeEnd - rangeStart + 1)} chapters)</span>
                        </div>
                      )}
                    </div>
                    {chaptersLoading && <p className={`text-xs mt-2 ${c('textSub')}`}>Loading chapters...</p>}
                  </div>
                </section>
              )}

              {/* Voice Settings Card */}
              {selectedStory && (
                <section className="lg-glass-card p-5 sm:p-6 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${isDark
                          ? 'bg-indigo-600/20 text-indigo-400'
                          : 'bg-indigo-100 text-indigo-600'
                        }`}>2</span>
                        <h3 className={`text-base font-semibold ${c('text')}`}>Voice Settings</h3>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm ${c('textMuted')} mb-1.5`}>Language</label>
                      <select
                        value={selectedLang}
                        onChange={e => setSelectedLang(e.target.value)}
                        disabled={isGenerating}
                        className={`w-full px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 ${selectClass}`}
                      >
                        {languages.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm ${c('textMuted')} mb-1.5`}>Voice</label>
                      <select
                        value={selectedVoice}
                        onChange={e => setSelectedVoice(e.target.value)}
                        disabled={isGenerating}
                        className={`w-full px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 ${selectClass}`}
                      >
                        {filteredVoices.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={`text-sm ${c('textMuted')}`}>Speed</label>
                      <span className={`text-sm font-mono ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>{speed.toFixed(2)}x</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range" min={0.25} max={2.0} step={0.05} value={speed}
                        onChange={e => setSpeed(parseFloat(e.target.value))}
                        disabled={isGenerating}
                        className="flex-1 accent-indigo-500"
                      />
                      <input
                        type="number" min={0.25} max={2.0} step={0.01} value={speed}
                        onChange={e => { const val = parseFloat(e.target.value); if (!isNaN(val) && val >= 0.25 && val <= 2.0) setSpeed(val); }}
                        disabled={isGenerating}
                        className={`w-20 px-2 py-1.5 border rounded-xl text-sm text-center font-mono ${inputClass}`}
                      />
                    </div>
                    <div className={`flex justify-between text-xs mt-0.5 ${c('textSub')}`}>
                      <span>0.25x</span><span>1.0x</span><span>2.0x</span>
                    </div>
                  </div>

                  <div>
                    <label className={`block text-sm ${c('textMuted')} mb-1.5`}>Format</label>
                    <div className="flex gap-3">
                      {(['wav', 'mp3'] as const).map(f => (
                        <label key={f} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} disabled={isGenerating} className="accent-indigo-500" />
                          <span className={`text-sm uppercase ${c('textMuted')}`}>{f}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {/* Generate Card */}
              {selectedStory && (
                <section className="lg-glass-card p-5 sm:p-6 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${isDark
                          ? 'bg-indigo-600/20 text-indigo-400'
                          : 'bg-indigo-100 text-indigo-600'
                        }`}>3</span>
                        <h3 className={`text-base font-semibold ${c('text')}`}>Generate Audio</h3>
                      </div>
                      <p className={`text-xs ml-8 ${c('textMuted')}`}>
                        {chaptersToGenerate.length} chapter{chaptersToGenerate.length !== 1 ? 's' : ''} selected
                      </p>
                    </div>
                  </div>

                  {generationError && (
                    <div className={`p-3 rounded-xl text-sm ${isDark
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-red-50 border border-red-200 text-red-600'}`}
                      title={generationError}>
                      <span className="line-clamp-2">{generationError.length > 150 ? generationError.slice(0, 150) + '...' : generationError}</span>
                    </div>
                  )}

                  {chaptersToGenerate.length > 100 && !isGenerating && (
                    <div className={`p-3 rounded-xl text-sm ${isDark
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                      : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                      <strong>Note:</strong> You are about to generate {chaptersToGenerate.length} chapters. This may take a very long time.
                    </div>
                  )}

                  {isGenerating && batchJob && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className={`capitalize ${c('textMuted')}`}>{batchJob.status}</span>
                        <span className={`text-xs ${c('textSub')}`}>{batchJob.chapters.filter(c => c.status === 'completed').length}/{batchJob.chapters.length} chapters</span>
                        <span className={`font-mono ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>{progressPct}%</span>
                      </div>
                      <div className={`h-2.5 rounded-full overflow-hidden ${c('rowBg')}`}>
                        <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>
                  )}

                  {batchJob && !isGenerating && batchJob.status === 'completed' && (
                    <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      All chapters generated successfully!
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap">
                    {!isGenerating && !batchJob && (
                      <button
                        onClick={handleGenerate}
                        disabled={!selectedStory || chaptersToGenerate.length === 0}
                        className={`px-6 py-2.5 text-white font-semibold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg ${!selectedStory || chaptersToGenerate.length === 0
                          ? isDark
                            ? 'bg-white/[0.04] text-white/30 cursor-not-allowed shadow-none border border-white/[0.05]'
                            : 'bg-[rgba(0,0,0,0.04)] text-[rgba(0,0,0,0.3)] cursor-not-allowed shadow-none border border-black/5'
                          : 'bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/30 hover:shadow-xl hover:shadow-indigo-500/40'}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Generate Audio
                      </button>
                    )}
                    {isGenerating && (
                      <button
                        onClick={handleCancel}
                        className="px-6 py-2.5 text-white font-semibold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/30"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                        Cancel
                      </button>
                    )}
                    {hasAnyCompleted && (
                      <button
                        onClick={handleDownloadZip}
                        className={`px-5 py-2.5 font-medium border rounded-xl transition-all duration-200 flex items-center gap-2 ${isDark
                          ? 'text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/10'
                          : 'text-indigo-600 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50'}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download All (ZIP)
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* Chapter Progress Card */}
              {batchJob && batchJob.chapters.length > 0 && (
                <section className="lg-glass-card p-5 sm:p-6 space-y-3">
                  <h3 className={`text-sm font-medium ${c('textBody')}`}>Chapter Progress</h3>
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                    {batchJob.chapters.map(ch => (
                      <div key={ch.chapter_number} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${c('rowBg')}`}>
                        {statusIcon(ch.status)}
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${c('textBody')}`}>Ch. {ch.chapter_number}: {ch.title}</p>
                          {ch.error && <p className={`text-xs text-red-400 truncate max-w-[200px]`} title={ch.error}>{ch.error.length > 80 ? ch.error.slice(0, 80) + '...' : ch.error}</p>}
                        </div>
                        {ch.status === 'completed' && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => handleListenChapter(ch.chapter_number)} title="Listen" className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-600/10' : 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50'}`}>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              </svg>
                            </button>
                            <button onClick={() => handleDownloadChapter(ch.chapter_number)} title="Download" className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-600/10' : 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50'}`}>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Empty State */}
              {!selectedStory && (
                <section className="lg-glass-card p-8 text-center">
                  <svg className={`w-12 h-12 mx-auto mb-4 ${c('textSub')}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  <p className={`text-sm ${c('textMuted')}`}>Select a story from the list to get started.</p>
                </section>
              )}

              {selectedStory && (
                <div className={`text-center ${c('textSub')} text-xs`}>
                  <button onClick={() => navigate('/bedread/jobs')} className={`hover:${isDark ? 'text-indigo-400' : 'text-indigo-600'} underline`}>
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

export default BedReadPage;
