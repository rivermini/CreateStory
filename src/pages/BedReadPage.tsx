import { useEffect, useRef, useState } from 'react';
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

interface BedReadPageProps {
  themeMode: 'light' | 'dark';
  onThemeChange: (mode: 'light' | 'dark') => void;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

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

function loadStoredSort(): 'release_date' | 'title' | 'chapter_count' | 'popular' {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SORT);
    if (stored === 'title' || stored === 'chapter_count' || stored === 'popular') return stored;
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
  const [, setAllStoriesLoaded] = useState(false);
  const [storiesError, setStoriesError] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<'release_date' | 'title' | 'chapter_count' | 'popular'>(loadStoredSort);
  const [pageLimit] = useState(20);
  const [allLoadedStories, setAllLoadedStories] = useState<BedReadStory[]>(loadStoredStories);

  const [selectedStory, setSelectedStory] = useState<BedReadStory | null>(() => {
    const storedId = loadStoredSelectedId();
    const stories = loadStoredStories();
    return stories.find(s => s.storyId === storedId) || null;
  });
  const [chapters, setChapters] = useState<BedReadChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [bedReadUserId, setBedReadUserId] = useState<string | null>(null);

  const [allChapters, setAllChapters] = useState(true);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);

  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [languages, setLanguages] = useState<TTSLanguage[]>([]);
  const [selectedLang, setSelectedLang] = useState('en-us');
  const [selectedVoice, setSelectedVoice] = useState('af_heart');
  const [speed, setSpeed] = useState(0.69);
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');
  const [previewing, setPreviewing] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');

  const fetchPage1 = () => {
    setStoriesLoading(true);
    setStoriesError('');

    searchBedReadStories({ sort: sortBy, page: 1, limit: 20 })
      .then((res: BedReadStorySearchResponse) => {
        setAllLoadedStories(res.stories);
        saveStories(res.stories);
        setCurrentPage(1);
        const totalPg = Math.max(1, Math.ceil(res.total / 20));
        const pageRequests: Promise<BedReadStorySearchResponse>[] = [];
        for (let p = 2; p <= totalPg; p++) {
          pageRequests.push(searchBedReadStories({ sort: sortBy, page: p, limit: 20 }));
        }
        Promise.all(pageRequests).then(responses => {
          const seen = new Set<string>();
          const allStories: BedReadStory[] = [res, ...responses].flatMap(r => r.stories)
            .filter(s => {
              if (seen.has(s.storyId)) return false;
              seen.add(s.storyId);
              return true;
            });
          setAllLoadedStories(allStories);
          saveStories(allStories);
          setAllStoriesLoaded(true);
        }).catch(() => {});
      })
      .catch(() => setStoriesError('Failed to load stories. Is the backend running?'))
      .finally(() => setStoriesLoading(false));
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
    setAllStoriesLoaded(false);
    fetchPage1();
  }, [sortBy]);

  const handleSortChange = (newSort: 'release_date' | 'title' | 'chapter_count' | 'popular') => {
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
    }).catch(() => {});
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

  const handlePreview = async () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setPreviewing(true);
    try {
      const res = await fetch(`${BASE_URL}/api/tts/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: selectedVoice, lang: selectedLang, speed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => { setPreviewing(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPreviewing(false); URL.revokeObjectURL(url); };
      await audio.play();
    } catch { setPreviewing(false); }
  };

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
    const colorClass = isDark ? 'text-emerald-400' : 'text-emerald-600';
    const spinnerColor = isDark ? 'text-indigo-400' : 'text-indigo-600';
    const dotColor = isDark ? 'border-slate-600' : 'border-gray-300';
    switch (status) {
      case 'completed':
        return (
          <svg className={'w-4 h-4 ' + colorClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <svg className={'w-4 h-4 animate-spin ' + spinnerColor} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      default:
        return <div className={'w-4 h-4 rounded-full border ' + dotColor} />;
    }
  };

  const bg = isDark ? 'bg-slate-950' : 'bg-gray-50';
  const bg800 = isDark ? 'bg-slate-800' : 'bg-white';
  const bg800_80 = isDark ? 'bg-slate-800/80' : 'bg-white/80';
  const border700 = isDark ? 'border-slate-700/50' : 'border-gray-200';
  const border700_solid = isDark ? 'border-slate-700' : 'border-gray-200';
  const text100 = isDark ? 'text-slate-100' : 'text-gray-900';
  const text200 = isDark ? 'text-slate-200' : 'text-gray-800';
  const text300 = isDark ? 'text-slate-300' : 'text-gray-700';
  const text400 = isDark ? 'text-slate-400' : 'text-gray-500';
  const text500 = isDark ? 'text-slate-500' : 'text-gray-400';
  const text600 = isDark ? 'text-slate-600' : 'text-gray-300';
  const bg700 = isDark ? 'bg-slate-700' : 'bg-gray-100';
  const bg700_30 = isDark ? 'bg-slate-700/30' : 'bg-gray-100';
  const bg700_50 = isDark ? 'bg-slate-700/50' : 'bg-gray-200';
  const bg700_60 = isDark ? 'bg-slate-700/60' : 'bg-gray-100';
  const border600 = isDark ? 'border-slate-600' : 'border-gray-300';
  const border600_30 = isDark ? 'border-slate-600/30' : 'border-gray-300/30';
  const border600_50 = isDark ? 'border-slate-600/50' : 'border-gray-300/50';
  const textIndigo = isDark ? 'text-indigo-400' : 'text-indigo-600';
  const textIndigo300 = isDark ? 'text-indigo-300' : 'text-indigo-700';
  const bgIndigo900_30 = isDark ? 'bg-indigo-900/30' : 'bg-indigo-50';
  const bgIndigo900_50 = isDark ? 'bg-indigo-900/50' : 'bg-indigo-100';
  const borderIndigo600 = isDark ? 'border-indigo-600/50' : 'border-indigo-300';
  const shadowIndigo = isDark ? 'shadow-indigo-900/20' : 'shadow-indigo-200';

  return (
    <div className={'min-h-screen pb-20 lg:pb-0 ' + bg}>
      <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-8">
          <h1 className={'text-2xl sm:text-3xl font-bold ' + text100}>BedReads</h1>
          <p className={'mt-1 text-sm sm:text-base ' + text400}>Novel TTS Reader — batch audio from web novels</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Column: Story List */}
          <div className="lg:w-[420px] lg:flex-shrink-0 space-y-4">
            <section className={bg800_80 + ' border ' + border700 + ' rounded-2xl overflow-hidden ' + (isDark ? 'shadow-xl shadow-black/20' : 'shadow-sm shadow-gray-200')}>
              <div className={"px-4 pt-4 pb-3 border-b " + border700}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className={'text-base font-semibold ' + text100 + ' flex items-center gap-2'}>
                    <svg className={'w-5 h-5 ' + textIndigo} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Library
                  </h2>
                  <div className="flex items-center gap-2">
                    <span className={'text-xs ' + text500}>{filteredStories.length.toLocaleString()} stories</span>
                    <button
                      onClick={() => fetchPage1()}
                      disabled={storiesLoading}
                      className={'p-1 rounded-lg ' + bg700_50 + ' hover:' + bg700_60 + ' disabled:opacity-50 transition-colors'}
                      title="Refresh story list"
                    >
                      <svg className={'w-4 h-4 ' + text400 + (storiesLoading ? ' animate-spin' : '')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <svg className={'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ' + text500} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={searchKeyword}
                      onChange={e => setSearchKeyword(e.target.value)}
                      placeholder="Search by title or author..."
                      className={'w-full pl-9 pr-3 py-2 ' + bg700_60 + ' border ' + border600_50 + ' rounded-xl ' + text100 + ' placeholder-' + text500 + ' text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all'}
                    />
                  </div>
                </div>
              </div>

              <div className={'px-4 py-2 border-b ' + border700 + ' ' + bg700_30}>
                <div className="flex items-center gap-2">
                  <span className={'text-xs ' + text500}>Sort:</span>
                  <select
                    value={sortBy}
                    onChange={e => handleSortChange(e.target.value as typeof sortBy)}
                    className={'flex-1 px-2 py-1.5 ' + bg700_50 + ' border ' + border600_30 + ' rounded-lg ' + text300 + ' text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer'}
                  >
                    <option value="release_date">Latest</option>
                    <option value="title">Title A-Z</option>
                    <option value="chapter_count">Most Chapters</option>
                    <option value="popular">Popular</option>
                  </select>
                </div>
              </div>

              <div className="max-h-[55vh] overflow-y-auto">
                {storiesLoading && (
                  <div className={'flex flex-col items-center justify-center py-12 ' + text500 + ' text-sm'}>
                    <svg className={'w-8 h-8 mb-3 animate-spin ' + textIndigo} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Loading stories...
                  </div>
                )}
                {storiesError && (
                  <div className="p-4">
                    <div className={'p-3 ' + (isDark ? 'bg-red-900/20 border-red-800/50' : 'bg-red-50 border-red-200') + ' rounded-xl text-sm text-red-400'}>
                      {storiesError}
                    </div>
                  </div>
                )}
                {!storiesLoading && !storiesError && filteredStories.length === 0 && (
                  <div className={'flex flex-col items-center justify-center py-12 ' + text500 + ' text-sm'}>
                    <svg className={'w-12 h-12 mb-3 ' + text600} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>No stories found</p>
                  </div>
                )}
                <div className="p-2 space-y-2">
                  {paginatedStories.map(story => (
                    <button
                      key={story.storyId}
                      onClick={() => { setSelectedStory(story); saveSelectedStoryId(story.storyId); }}
                      className={
                        'w-full flex gap-3 p-3 rounded-xl text-left transition-all duration-200 group ' +
                        (selectedStory?.storyId === story.storyId
                          ? bgIndigo900_50 + ' border ' + borderIndigo600 + ' shadow-lg ' + shadowIndigo
                          : bg700_30 + ' border border-transparent hover:' + bg700_50 + ' hover:border' + border600_30)
                      }
                    >
                      {story.coverUrl ? (
                        <div className="relative flex-shrink-0">
                          <img
                            src={story.coverUrl}
                            alt={story.title}
                            className={"w-14 h-18 object-cover rounded-xl " + (isDark ? 'bg-slate-600' : 'bg-gray-200')}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </div>
                      ) : (
                        <div className={'w-14 h-18 rounded-xl ' + (isDark ? 'bg-gradient-to-br from-slate-600 to-slate-700' : 'bg-gradient-to-br from-gray-200 to-gray-300') + ' flex-shrink-0 flex items-center justify-center'}>
                          <svg className={'w-6 h-6 ' + text500} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className={'text-sm font-medium ' + text200 + ' line-clamp-2 leading-snug'}>{story.title}</p>
                        <p className={'text-xs ' + text400 + ' mt-1 truncate'}>{story.author}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ' + (isDark ? 'bg-slate-600/50 text-slate-400' : 'bg-gray-200 text-gray-500')}>
                            {story.chapterCount} ch
                          </span>
                          {story.tags.slice(0, 2).map(tag => (
                            <span key={tag} className={'px-1.5 py-0.5 text-xs rounded ' + bgIndigo900_30 + ' ' + (isDark ? 'text-indigo-300/80' : 'text-indigo-700')} style={{ maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className={'border-t ' + border700 + ' ' + bg700_30}>
                <div className="px-4 py-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {storiesLoading ? (
                      <>
                        <svg className={'w-4 h-4 animate-spin ' + textIndigo} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span className={'text-xs ' + text500}>Loading...</span>
                      </>
                    ) : (
                      <div className={'text-xs ' + text500}>
                        Page {currentPage} of {filteredTotalPages}
                      </div>
                    )}
                  </div>
                  {filteredTotalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage <= 1 || storiesLoading}
                        className={'p-1.5 rounded-lg ' + bg700_50 + ' ' + text400 + ' disabled:opacity-30 disabled:cursor-not-allowed transition-colors'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className={'text-xs ' + text500}>{currentPage}/{filteredTotalPages}</span>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(filteredTotalPages, p + 1))}
                        disabled={currentPage >= filteredTotalPages || storiesLoading}
                        className={'p-1.5 rounded-lg ' + bg700_50 + ' ' + text400 + ' disabled:opacity-30 disabled:cursor-not-allowed transition-colors'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Story Detail + Generation */}
          <div className="flex-1 space-y-4 lg:sticky lg:top-6">
            {selectedStory && (
              <section className={bg800 + ' border ' + border700_solid + ' rounded-xl p-4 sm:p-6 space-y-4'}>
                <div className="flex gap-4">
                  {selectedStory.coverUrl && (
                    <img
                      src={selectedStory.coverUrl}
                      alt={selectedStory.title}
                      className={"w-20 h-28 object-cover rounded-xl flex-shrink-0 " + (isDark ? 'bg-slate-700' : 'bg-gray-200')}
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className={'text-lg font-semibold ' + text100}>{selectedStory.title}</h2>
                    <p className={'text-sm ' + text400 + ' mt-0.5'}>{selectedStory.author}</p>
                    <p className={'text-xs ' + text500 + ' mt-1'}>{selectedStory.chapterCount} chapters</p>
                    {selectedStory.description && (
                      <p className={'text-sm ' + text400 + ' mt-2 line-clamp-3'}>{selectedStory.description}</p>
                    )}
                    {selectedStory.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {selectedStory.tags.slice(0, 5).map(tag => (
                          <span key={tag} className={'px-2 py-0.5 text-xs rounded ' + bg700 + ' ' + text400}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className={'border-t ' + border700_solid + ' pt-4'}>
                  <h3 className={'text-sm font-medium ' + text300 + ' mb-3'}>Chapters</h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="chapter-mode" checked={allChapters} onChange={() => setAllChapters(true)} className="accent-indigo-500" />
                      <span className={'text-sm ' + text300}>All chapters</span>
                      <span className={'text-xs ' + text500}>({chapters.length})</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="chapter-mode" checked={!allChapters} onChange={() => setAllChapters(false)} className="accent-indigo-500" />
                      <span className={'text-sm ' + text300}>Range</span>
                    </label>
                    {!allChapters && (
                      <div className="flex items-center gap-2 ml-6">
                        <div>
                          <label className={'block text-xs ' + text500 + ' mb-1'}>From</label>
                          <input
                            type="number" min={1} max={rangeEnd} value={rangeStart}
                            onChange={e => setRangeStart(Math.max(1, parseInt(e.target.value) || 1))}
                            className={'w-20 px-2 py-1.5 ' + bg700 + ' border ' + border600 + ' rounded-lg text-sm ' + text100 + ' focus:outline-none focus:ring-2 focus:ring-indigo-500'}
                          />
                        </div>
                        <span className={'text-xs ' + text500 + ' mt-4'}>to</span>
                        <div>
                          <label className={'block text-xs ' + text500 + ' mb-1'}>To</label>
                          <input
                            type="number" min={rangeStart} max={chapters.length || 999} value={rangeEnd}
                            onChange={e => setRangeEnd(Math.max(rangeStart, parseInt(e.target.value) || rangeStart))}
                            className={'w-20 px-2 py-1.5 ' + bg700 + ' border ' + border600 + ' rounded-lg text-sm ' + text100 + ' focus:outline-none focus:ring-2 focus:ring-indigo-500'}
                          />
                        </div>
                        <span className={'text-xs ' + text500 + ' mt-4 ml-2'}>({Math.max(0, rangeEnd - rangeStart + 1)} chapters)</span>
                      </div>
                    )}
                  </div>
                  {chaptersLoading && <p className={'text-xs ' + text500 + ' mt-2'}>Loading chapters...</p>}
                </div>
              </section>
            )}

            {selectedStory && (
              <section className={bg800 + ' border ' + border700_solid + ' rounded-xl p-4 sm:p-6 space-y-4'}>
                <h3 className={'text-base font-medium ' + text200}>Voice Settings</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={'block text-sm ' + text400 + ' mb-1.5'}>Language</label>
                    <select
                      value={selectedLang}
                      onChange={e => setSelectedLang(e.target.value)}
                      disabled={isGenerating}
                      className={'w-full px-3 py-2.5 ' + bg700 + ' border ' + border600 + ' rounded-xl ' + text100 + ' focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50'}
                    >
                      {languages.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={'text-sm ' + text400}>Voice</label>
                      <button
                        onClick={handlePreview}
                        disabled={previewing || filteredVoices.length === 0}
                        className={'text-xs ' + textIndigo + ' hover:' + textIndigo300 + ' disabled:opacity-40 flex items-center gap-1 transition-colors'}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        {previewing ? 'Playing...' : 'Preview'}
                      </button>
                    </div>
                    <select
                      value={selectedVoice}
                      onChange={e => setSelectedVoice(e.target.value)}
                      disabled={isGenerating}
                      className={'w-full px-3 py-2.5 ' + bg700 + ' border ' + border600 + ' rounded-xl ' + text100 + ' focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50'}
                    >
                      {filteredVoices.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={'text-sm ' + text400}>Speed</label>
                    <span className={'text-sm ' + textIndigo300 + ' font-mono'}>{speed.toFixed(2)}x</span>
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
                      className={'w-20 px-2 py-1 ' + bg + ' border ' + border600 + ' rounded-lg ' + text200 + ' text-sm text-center font-mono'}
                    />
                  </div>
                  <div className={'flex justify-between text-xs ' + text600 + ' mt-0.5'}>
                    <span>0.25x</span><span>1.0x</span><span>2.0x</span>
                  </div>
                </div>

                <div>
                  <label className={'block text-sm ' + text400 + ' mb-1.5'}>Format</label>
                  <div className="flex gap-3">
                    {(['wav', 'mp3'] as const).map(f => (
                      <label key={f} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} disabled={isGenerating} className="accent-indigo-500" />
                        <span className={'text-sm ' + text300 + ' uppercase'}>{f}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {selectedStory && (
              <section className={bg800 + ' border ' + border700_solid + ' rounded-xl p-4 sm:p-6 space-y-4'}>
                {generationError && (
                  <div className={'p-3 ' + (isDark ? 'bg-red-900/30 border-red-800' : 'bg-red-50 border-red-200') + ' rounded-xl text-sm text-red-400'} title={generationError}>
                    <span className="line-clamp-2">{generationError.length > 150 ? generationError.slice(0, 150) + '...' : generationError}</span>
                  </div>
                )}

                {chaptersToGenerate.length > 100 && !isGenerating && (
                  <div className={'p-3 ' + (isDark ? 'bg-amber-900/30 border-amber-800' : 'bg-amber-50 border-amber-200') + ' rounded-xl text-sm ' + (isDark ? 'text-amber-400' : 'text-amber-700')}>
                    <strong>Note:</strong> You are about to generate {chaptersToGenerate.length} chapters. This may take a very long time.
                  </div>
                )}

                {isGenerating && batchJob && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className={'capitalize ' + text300}>{batchJob.status}</span>
                      <span className={'text-sm ' + text500}>{batchJob.chapters.filter(c => c.status === 'completed').length}/{batchJob.chapters.length} chapters</span>
                      <span className={'font-mono ' + textIndigo300}>{progressPct}%</span>
                    </div>
                    <div className={'h-2.5 rounded-full overflow-hidden ' + bg700}>
                      <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                )}

                {batchJob && !isGenerating && batchJob.status === 'completed' && (
                  <div className={'flex items-center gap-2 text-emerald-400 text-sm'}>
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
                      className={'px-6 py-2.5 text-white font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:' + bg700 + ' disabled:' + text500 + ' disabled:cursor-not-allowed rounded-xl transition-colors flex items-center gap-2'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate Audio ({chaptersToGenerate.length} chapters)
                    </button>
                  )}
                  {isGenerating && (
                    <button
                      onClick={handleCancel}
                      className="px-6 py-2.5 text-white font-semibold bg-red-600 hover:bg-red-500 rounded-xl transition-colors flex items-center gap-2"
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
                      className={'px-5 py-2.5 font-medium border border-indigo-600/40 hover:bg-indigo-600/10 rounded-xl transition-colors flex items-center gap-2 ' + textIndigo300}
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

            {batchJob && batchJob.chapters.length > 0 && (
              <section className={bg800 + ' border ' + border700_solid + ' rounded-xl p-4 sm:p-6 space-y-3'}>
                <h3 className={'text-sm font-medium ' + text300}>Chapter Progress</h3>
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                  {batchJob.chapters.map(ch => (
                    <div key={ch.chapter_number} className={'flex items-center gap-3 px-3 py-2 rounded-xl ' + bg700_50}>
                      {statusIcon(ch.status)}
                      <div className="flex-1 min-w-0">
                        <p className={'text-xs font-medium ' + text300 + ' truncate'}>Ch. {ch.chapter_number}: {ch.title}</p>
                        {ch.error && <p className={'text-xs text-red-400 truncate max-w-[200px]'} title={ch.error}>{ch.error.length > 80 ? ch.error.slice(0, 80) + '...' : ch.error}</p>}
                      </div>
                      {ch.status === 'completed' && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => handleListenChapter(ch.chapter_number)} title="Listen" className={'p-1.5 ' + textIndigo + ' hover:' + textIndigo300 + ' transition-colors'}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            </svg>
                          </button>
                          <button onClick={() => handleDownloadChapter(ch.chapter_number)} title="Download" className={'p-1.5 ' + textIndigo + ' hover:' + textIndigo300 + ' transition-colors'}>
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

            {!selectedStory && (
              <section className={bg800 + ' border ' + border700_solid + ' rounded-xl p-8 text-center'}>
                <svg className={'w-12 h-12 mx-auto ' + text600 + ' mb-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <p className={'text-sm ' + text400}>Select a story from the list to get started.</p>
              </section>
            )}

            {selectedStory && (
              <div className={'text-center ' + text500 + ' text-xs'}>
                <button onClick={() => navigate('/bedread/jobs')} className={'hover:' + textIndigo + ' underline'}>
                  View all TTS jobs
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default BedReadPage;
