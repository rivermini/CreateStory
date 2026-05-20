import { useEffect, useRef, useState } from 'react';
import {
  cancelBatchJob,
  getBedReadChapters,
  getBatchJob,
  getChapterAudioUrl,
  getBatchZipUrl,
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
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface BedReadPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export function BedReadPage({ themeMode, onThemeChange }: BedReadPageProps) {
  // Stories
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [allStoriesLoaded, setAllStoriesLoaded] = useState(false);
  const [storiesError, setStoriesError] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<'release_date' | 'title' | 'chapter_count' | 'popular'>('release_date');
  const [pageLimit] = useState(20);
  const [allLoadedStories, setAllLoadedStories] = useState<BedReadStory[]>([]);

  // Selected story
  const [selectedStory, setSelectedStory] = useState<BedReadStory | null>(null);
  const [chapters, setChapters] = useState<BedReadChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);

  // Chapter selection
  const [allChapters, setAllChapters] = useState(true);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);

  // Voice controls
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [languages, setLanguages] = useState<TTSLanguage[]>([]);
  const [selectedLang, setSelectedLang] = useState('en-us');
  const [selectedVoice, setSelectedVoice] = useState('af_heart');
  const [speed, setSpeed] = useState(0.69);
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');
  const [previewing, setPreviewing] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Batch job
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');

  // Fetch page 1 only (fast initial load)
  const fetchPage1 = () => {
    setStoriesLoading(true);
    setStoriesError('');

    searchBedReadStories({ sort: sortBy, page: 1, limit: 20 })
      .then((res: BedReadStorySearchResponse) => {
        setAllLoadedStories(res.stories);
        setCurrentPage(1);
        // Continue loading remaining pages silently in background
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
          setAllStoriesLoaded(true);
        }).catch(() => {}); // silent fail for background load
      })
      .catch(() => setStoriesError('Failed to load stories. Is the backend running?'))
      .finally(() => setStoriesLoading(false));
  };

  // Client-side filtered & paginated stories
  const filteredStories = allLoadedStories.filter(s =>
    s.title.toLowerCase().includes(searchKeyword.toLowerCase()) ||
    s.author.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  const paginatedStories = filteredStories.slice(
    (currentPage - 1) * pageLimit,
    currentPage * pageLimit
  );

  const filteredTotalPages = Math.max(1, Math.ceil(filteredStories.length / pageLimit));

  // Initial load
  useEffect(() => {
    fetchPage1();

    getVoices()
      .then(setVoices)
      .catch(() => setVoices([]));
    getLanguages()
      .then(setLanguages)
      .catch(() => setLanguages([]));
  }, []);

  // Re-fetch page 1 when sort changes
  useEffect(() => {
    setAllStoriesLoaded(false);
    fetchPage1();
  }, [sortBy]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchKeyword]);

  // Auto-select first voice when language changes
  useEffect(() => {
    const langVoices = voices.filter(v => v.lang === selectedLang);
    if (langVoices.length > 0 && !langVoices.find(v => v.id === selectedVoice)) {
      setSelectedVoice(langVoices[0].id);
    }
  }, [selectedLang, voices, selectedVoice]);

  // Load chapters when story is selected; reset any active generation
  useEffect(() => {
    setBatchId(null);
    setBatchJob(null);
    setIsGenerating(false);
    setGenerationError('');
    if (!selectedStory) return;
    setChaptersLoading(true);
    getBedReadChapters(selectedStory.storyId)
      .then(ch => {
        setChapters(ch);
        const maxChapter = Math.max(...ch.map(c => c.chapterNumber), 1);
        setRangeEnd(maxChapter);
      })
      .catch(() => setChapters([]))
      .finally(() => setChaptersLoading(false));
  }, [selectedStory]);

  // Poll batch job while running
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
        // ignore poll errors
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [batchId]);

  // Filter voices by language
  const filteredVoices = voices.filter(v => v.lang === selectedLang);

  // Determine chapters to generate
  const chaptersToGenerate = allChapters
    ? chapters.map(c => c.chapterNumber)
    : Array.from({ length: rangeEnd - rangeStart + 1 }, (_, i) => rangeStart + i)
        .filter(n => n >= 1 && n <= Math.max(...chapters.map(c => c.chapterNumber), 0));

  // Preview voice
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
      audio.onended = () => {
        setPreviewing(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPreviewing(false);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch {
      setPreviewing(false);
    }
  };

  // Start batch generation
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
      });
      setBatchId(res.batch_id);
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : 'Failed to start batch job.');
      setIsGenerating(false);
    }
  };

  // Cancel generation
  const handleCancel = async () => {
    if (!batchId) return;
    try {
      await cancelBatchJob(batchId);
    } catch {
      // ignore
    }
    setIsGenerating(false);
  };

  // Download chapter
  const handleDownloadChapter = (chapterNum: number) => {
    if (!batchId) return;
    const a = document.createElement('a');
    a.href = getChapterAudioUrl(batchId, chapterNum);
    a.download = `chapter_${chapterNum}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Download zip
  const handleDownloadZip = () => {
    if (!batchId) return;
    const a = document.createElement('a');
    a.href = getBatchZipUrl(batchId);
    a.download = `bedread_${batchId}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Listen chapter
  const handleListenChapter = (chapterNum: number) => {
    if (!batchId) return;
    const a = document.createElement('a');
    a.href = getChapterAudioUrl(batchId, chapterNum);
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const hasAnyCompleted = batchJob?.chapters.some(c => c.status === 'completed') ?? false;
  const progressPct = batchJob?.progress_pct ?? 0;

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <svg className="w-4 h-4 text-indigo-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      default:
        return (
          <div className="w-4 h-4 rounded-full border border-slate-600" />
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title="BedReads"
        subtitle="Novel TTS Reader — batch audio from web novels"
      />

      <main className="w-full xl:w-[70vw] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col lg:flex-row gap-6">

          {/* ── Left Column: Story List ───────────────────────────── */}
          <div className="lg:w-[420px] lg:flex-shrink-0 space-y-4">
            <section className="bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden shadow-xl shadow-black/20">
              {/* Header */}
              <div className="px-4 pt-4 pb-3 border-b border-slate-700/50">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Library
                  </h2>
                  <span className="text-xs text-slate-500">{filteredStories.length.toLocaleString()} stories</span>
                </div>

                {/* Search */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={searchKeyword}
                      onChange={e => setSearchKeyword(e.target.value)}
                      placeholder="Search by title or author..."
                      className="w-full pl-9 pr-3 py-2 bg-slate-700/60 border border-slate-600/50 rounded-lg
                                 text-slate-100 placeholder-slate-500 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                                 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Sort & Filters */}
              <div className="px-4 py-2 border-b border-slate-700/50 bg-slate-800/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as typeof sortBy)}
                    className="flex-1 px-2 py-1.5 bg-slate-700/50 border border-slate-600/30 rounded-md
                               text-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500
                               cursor-pointer"
                  >
                    <option value="release_date">Latest</option>
                    <option value="title">Title A-Z</option>
                    <option value="chapter_count">Most Chapters</option>
                    <option value="popular">Popular</option>
                  </select>
                </div>
              </div>

              {/* Story list */}
              <div className="max-h-[55vh] overflow-y-auto">
                {storiesLoading && (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm">
                    <svg className="w-8 h-8 mb-3 animate-spin text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Loading stories...
                  </div>
                )}

                {storiesError && (
                  <div className="p-4">
                    <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg text-sm text-red-400 flex items-center gap-2">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      {storiesError}
                    </div>
                  </div>
                )}

                {!storiesLoading && !storiesError && filteredStories.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm">
                    <svg className="w-12 h-12 mb-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>No stories found</p>
                    <p className="text-xs text-slate-600 mt-1">Try a different search term</p>
                  </div>
                )}

                <div className="p-2 space-y-2">
                  {paginatedStories.map(story => (
                    <button
                      key={story.storyId}
                      onClick={() => setSelectedStory(story)}
                      className={
                        'w-full flex gap-3 p-3 rounded-xl text-left transition-all duration-200 group ' +
                        (selectedStory?.storyId === story.storyId
                          ? 'bg-gradient-to-r from-indigo-900/50 to-slate-800/80 border border-indigo-600/50 shadow-lg shadow-indigo-900/20'
                          : 'bg-slate-700/30 border border-transparent hover:bg-slate-700/50 hover:border-slate-600/30')
                      }
                    >
                      {story.coverUrl ? (
                        <div className="relative flex-shrink-0">
                          <img
                            src={story.coverUrl}
                            alt={story.title}
                            className="w-14 h-18 object-cover rounded-lg bg-slate-600"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <div className="absolute inset-0 rounded-lg bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      ) : (
                        <div className="w-14 h-18 rounded-lg bg-gradient-to-br from-slate-600 to-slate-700 flex-shrink-0 flex items-center justify-center">
                          <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="text-sm font-medium text-slate-200 line-clamp-2 leading-snug">{story.title}</p>
                        <p className="text-xs text-slate-400 mt-1 truncate">{story.author}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-slate-600/50 text-slate-400">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            {story.chapterCount}
                          </span>
                          {story.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 text-xs rounded bg-indigo-900/30 text-indigo-300/80 truncate max-w-[60px]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      {/* Selection indicator */}
                      <div className={`flex-shrink-0 self-center transition-all duration-200 ${selectedStory?.storyId === story.storyId ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                        <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pagination */}
              <div className="border-t border-slate-700/50 bg-slate-800/50">
                {(storiesLoading || !allStoriesLoaded) && (
                  <div className="px-4 py-2 flex items-center gap-2 text-xs text-slate-500">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {storiesLoading ? 'Loading stories...' : 'Loading all stories for search...'}
                  </div>
                )}
                {filteredTotalPages > 1 && (
                  <div className="px-4 py-3 flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">
                      Page {currentPage} of {filteredTotalPages} ({filteredStories.length} results)
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        className="p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200
                                   disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Previous page"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>

                      {/* Page numbers */}
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, filteredTotalPages) }, (_, i) => {
                          let pageNum: number;
                          if (filteredTotalPages <= 5) {
                            pageNum = i + 1;
                          } else if (currentPage <= 3) {
                            pageNum = i + 1;
                          } else if (currentPage >= filteredTotalPages - 2) {
                            pageNum = filteredTotalPages - 4 + i;
                          } else {
                            pageNum = currentPage - 2 + i;
                          }
                          return (
                            <button
                              key={pageNum}
                              onClick={() => setCurrentPage(pageNum)}
                              className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                                currentPage === pageNum
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                              }`}
                            >
                              {pageNum}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        onClick={() => setCurrentPage(p => Math.min(filteredTotalPages, p + 1))}
                        disabled={currentPage >= filteredTotalPages}
                        className="p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200
                                   disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Next page"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* ── Right Column: Story Detail + Generation ───────────── */}
          <div className="flex-1 space-y-4 lg:sticky lg:top-20">

            {/* Story detail (only when selected) */}
            {selectedStory && (
              <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-4">
                <div className="flex gap-4">
                  {selectedStory.coverUrl && (
                    <img
                      src={selectedStory.coverUrl}
                      alt={selectedStory.title}
                      className="w-20 h-28 object-cover rounded-lg flex-shrink-0 bg-slate-700"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-slate-100">{selectedStory.title}</h2>
                    <p className="text-sm text-slate-400 mt-0.5">{selectedStory.author}</p>
                    <p className="text-xs text-slate-500 mt-1">{selectedStory.chapterCount} chapters</p>
                    {selectedStory.description && (
                      <p className="text-sm text-slate-400 mt-2 line-clamp-3">{selectedStory.description}</p>
                    )}
                    {selectedStory.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {selectedStory.tags.slice(0, 5).map(tag => (
                          <span key={tag} className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-400">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Chapter selection */}
                <div className="border-t border-slate-700 pt-4">
                  <h3 className="text-sm font-medium text-slate-300 mb-3">Chapters</h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="chapter-mode"
                        checked={allChapters}
                        onChange={() => setAllChapters(true)}
                        className="accent-indigo-500"
                      />
                      <span className="text-sm text-slate-300">All chapters</span>
                      <span className="text-xs text-slate-500">({chapters.length})</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="chapter-mode"
                        checked={!allChapters}
                        onChange={() => setAllChapters(false)}
                        className="accent-indigo-500"
                      />
                      <span className="text-sm text-slate-300">Range</span>
                    </label>
                    {!allChapters && (
                      <div className="flex items-center gap-2 ml-6">
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">From</label>
                          <input
                            type="number"
                            min={1}
                            max={rangeEnd}
                            value={rangeStart}
                            onChange={e => setRangeStart(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-20 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm
                                       text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <span className="text-slate-500 mt-4">to</span>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">To</label>
                          <input
                            type="number"
                            min={rangeStart}
                            max={chapters.length || 999}
                            value={rangeEnd}
                            onChange={e => setRangeEnd(Math.max(rangeStart, parseInt(e.target.value) || rangeStart))}
                            className="w-20 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm
                                       text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <span className="text-xs text-slate-500 mt-4 ml-2">
                          ({Math.max(0, rangeEnd - rangeStart + 1)} chapters)
                        </span>
                      </div>
                    )}
                  </div>
                  {chaptersLoading && (
                    <p className="text-xs text-slate-500 mt-2">Loading chapters...</p>
                  )}
                </div>
              </section>
            )}

            {/* Voice + Speed + Format controls */}
            {selectedStory && (
              <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-4">
                <h3 className="text-base font-medium text-slate-200">Voice Settings</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Language */}
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5">Language</label>
                    <select
                      value={selectedLang}
                      onChange={e => setSelectedLang(e.target.value)}
                      disabled={isGenerating}
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg
                                 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500
                                 disabled:opacity-50"
                    >
                      {languages.map(l => (
                        <option key={l.code} value={l.code}>{l.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Voice */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm text-slate-400">Voice</label>
                      <button
                        onClick={handlePreview}
                        disabled={previewing || filteredVoices.length === 0}
                        className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40
                                   flex items-center gap-1 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        {previewing ? 'Playing...' : 'Preview'}
                      </button>
                    </div>
                    <select
                      value={selectedVoice}
                      onChange={e => setSelectedVoice(e.target.value)}
                      disabled={isGenerating}
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg
                                 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500
                                 disabled:opacity-50"
                    >
                      {filteredVoices.map(v => (
                        <option key={v.id} value={v.id}>{v.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Speed */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm text-slate-400">Speed</label>
                    <span className="text-sm text-indigo-300 font-mono">{speed.toFixed(2)}x</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0.25}
                      max={2.0}
                      step={0.05}
                      value={speed}
                      onChange={e => setSpeed(parseFloat(e.target.value))}
                      disabled={isGenerating}
                      className="flex-1 accent-indigo-500"
                    />
                    <input
                      type="number"
                      min={0.25}
                      max={2.0}
                      step={0.01}
                      value={speed}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val >= 0.25 && val <= 2.0) {
                          setSpeed(val);
                        }
                      }}
                      disabled={isGenerating}
                      className="w-20 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-200 text-sm text-center font-mono"
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                    <span>0.25x</span>
                    <span>1.0x</span>
                    <span>2.0x</span>
                  </div>
                </div>

                {/* Format */}
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Format</label>
                  <div className="flex gap-3">
                    {(['wav', 'mp3'] as const).map(f => (
                      <label key={f} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="format"
                          value={f}
                          checked={format === f}
                          onChange={() => setFormat(f)}
                          disabled={isGenerating}
                          className="accent-indigo-500"
                        />
                        <span className="text-sm text-slate-300 uppercase">{f}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Generate button */}
            {selectedStory && (
              <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-4">
                {generationError && (
                  <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
                    {generationError}
                  </div>
                )}

                {chaptersToGenerate.length > 100 && !isGenerating && (
                  <div className="p-3 bg-amber-900/30 border border-amber-800 rounded-lg text-sm text-amber-400">
                    <strong>Note:</strong> You are about to generate {chaptersToGenerate.length} chapters.
                    This may take a very long time. Consider using a smaller range for testing.
                  </div>
                )}

                {/* Progress bar */}
                {isGenerating && batchJob && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300 capitalize">{batchJob.status}</span>
                      <span className="text-slate-500">
                        {batchJob.chapters.filter(c => c.status === 'completed').length}/{batchJob.chapters.length} chapters
                      </span>
                      <span className="text-indigo-300 font-mono">{progressPct}%</span>
                    </div>
                    <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Completed status */}
                {batchJob && !isGenerating && batchJob.status === 'completed' && (
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    All chapters generated successfully!
                  </div>
                )}

                {batchJob && !isGenerating && batchJob.status === 'failed' && (
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {batchJob.error || 'Some chapters failed'}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-3 flex-wrap">
                  {!isGenerating && !batchJob && (
                    <button
                      onClick={handleGenerate}
                      disabled={!selectedStory || chaptersToGenerate.length === 0}
                      className="px-6 py-2.5 text-white font-semibold bg-indigo-600 hover:bg-indigo-500
                                 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                                 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate Audio ({chaptersToGenerate.length} chapters)
                    </button>
                  )}

                  {isGenerating && (
                    <button
                      onClick={handleCancel}
                      className="px-6 py-2.5 text-white font-semibold bg-red-600 hover:bg-red-500
                                 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                      </svg>
                      Cancel
                    </button>
                  )}

                  {hasAnyCompleted && (
                    <button
                      onClick={handleDownloadZip}
                      className="px-5 py-2.5 text-indigo-300 font-medium border border-indigo-600/40
                                 hover:bg-indigo-600/10 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download All (ZIP)
                    </button>
                  )}
                </div>
              </section>
            )}

            {/* Chapter progress list */}
            {batchJob && batchJob.chapters.length > 0 && (
              <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-3">
                <h3 className="text-sm font-medium text-slate-300">Chapter Progress</h3>
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                  {batchJob.chapters.map(ch => (
                    <div
                      key={ch.chapter_number}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-700/50"
                    >
                      {statusIcon(ch.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-300 truncate">
                          Ch. {ch.chapter_number}: {ch.title}
                        </p>
                        {ch.error && (
                          <p className="text-xs text-red-400 truncate">{ch.error}</p>
                        )}
                      </div>
                      {ch.status === 'completed' && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleListenChapter(ch.chapter_number)}
                            title="Listen"
                            className="p-1.5 text-indigo-400 hover:text-indigo-300 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDownloadChapter(ch.chapter_number)}
                            title="Download"
                            className="p-1.5 text-indigo-400 hover:text-indigo-300 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Empty state */}
            {!selectedStory && (
              <section className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center">
                <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <p className="text-slate-400 text-sm">Select a story from the list to get started.</p>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
