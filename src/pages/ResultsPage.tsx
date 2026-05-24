import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCrawlResult, getCombinedResult, getDownloadUrl, getDownloadCombinedUrl, getDownloadAllUrl, type CrawlSessionSummary } from '../api/client';
import { FilePreview } from '../components/FilePreview';
import { type ThemeMode } from '../components/ThemeToggle';

interface ResultsPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function ResultsPage({ themeMode }: ResultsPageProps) {
  const isDark = themeMode === 'dark';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const crawlId = searchParams.get('session');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CrawlSessionSummary | null>(null);
  const [combinedFilename, setCombinedFilename] = useState('');
  const [files, setFiles] = useState<{ filename: string; size_bytes: number; chapter_number: number }[]>([]);

  const fetchResult = useCallback(() => {
    if (!crawlId) return;

    Promise.all([
      getCrawlResult(crawlId).catch(() => null),
      getCombinedResult(crawlId, 30000).catch(() => null),
    ]).then(([individualResult, combinedResult]) => {
      if (!individualResult && !combinedResult) {
        setError('Failed to load crawl results.');
        return;
      }

      if (individualResult) {
        setResult({
          crawl_id: individualResult.crawl_id,
          status: individualResult.status,
          spider_name: individualResult.spider_name,
          novel_name: individualResult.novel_name || '',
          chapters_crawled: individualResult.chapters_crawled,
          chapters_total: individualResult.chapters_total,
          started_at: individualResult.started_at,
          finished_at: individualResult.finished_at,
          error_message: individualResult.error_message,
          output_files: individualResult.output_files,
          novel_metadata: individualResult.novel_metadata || undefined,
          combined_file: '',
          combined_txt_file: '',
          source_url: (individualResult as { source_url?: string }).source_url || '',
        });

        const allFiles = individualResult.output_files
          .map(f => ({
            filename: f.filename,
            size_bytes: f.size_bytes,
            chapter_number: f.chapter_number,
          }))
          .sort((a, b) => a.chapter_number - b.chapter_number);

        setFiles(allFiles);
      }

      if (combinedResult) {
        const txtFile = combinedResult.combined_txt_file;
        const jsonFile = combinedResult.output_files?.[0]?.filename;
        setCombinedFilename(txtFile || jsonFile || '');
      }
    }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load crawl results.');
    }).finally(() => {
      setIsLoading(false);
    });
  }, [crawlId]);

  useEffect(() => {
    if (!crawlId) {
      navigate('/');
      return;
    }
    setIsLoading(true);
    fetchResult();
  }, [crawlId, navigate, fetchResult]);

  useEffect(() => {
    if (!result || result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled') return;
    const interval = setInterval(fetchResult, 3000);
    return () => clearInterval(interval);
  }, [result?.status, fetchResult]);

  if (!crawlId) return null;

  if (isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-slate-950 text-slate-400' : 'bg-gray-50 text-gray-500'}`}>
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Loading results...</span>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
        <div className="text-center space-y-4">
          <div className={`flex items-center justify-center gap-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error || 'Results not found'}</span>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors text-sm font-medium shadow-lg shadow-indigo-600/30"
          >
            Start New Crawl
          </button>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    completed: isDark ? 'text-emerald-400' : 'text-emerald-600',
    failed:    isDark ? 'text-red-400'    : 'text-red-600',
    cancelled: isDark ? 'text-amber-400'  : 'text-amber-600',
    running:   isDark ? 'text-blue-400'   : 'text-blue-600',
  };

  const statusLabels: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    running: 'Running',
  };

  const meta = result.novel_metadata;
  const nonCombinedFiles = files.filter(f => f.filename !== combinedFilename);

  const handleDownload = (filename: string) => {
    const a = document.createElement('a');
    a.href = getDownloadUrl(result.crawl_id, filename);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadCombined = () => {
    if (!combinedFilename) return;
    const a = document.createElement('a');
    a.href = getDownloadCombinedUrl(result.crawl_id, combinedFilename);
    a.download = combinedFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
      <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* Page Header */}
        <div className="mb-2">
          <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            Crawl Results
          </h1>
          <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            {result.novel_name || 'Crawl Session'}
          </p>
        </div>

        {/* Summary Card */}
        <section className={`rounded-2xl p-5 sm:p-6 space-y-4 ${isDark
          ? 'bg-slate-900/60 border border-slate-800/60'
          : 'bg-white border border-gray-200'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              {meta?.author_fullname && (
                <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>by {meta.author_fullname}</p>
              )}
              <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                {result.spider_name || 'Unknown site'} &middot;{' '}
                <span className={statusColors[result.status] ?? (isDark ? 'text-slate-400' : 'text-gray-600')}>
                  {statusLabels[result.status] ?? result.status}
                </span>
                {result.chapters_crawled > 0 && (
                  <> &middot; {result.chapters_crawled} chapter{result.chapters_crawled !== 1 ? 's' : ''}</>
                )}
              </p>
              {result.source_url && (
                <p className={`text-xs mt-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                  <span className="font-medium">Source:</span>{' '}
                  <a
                    href={result.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`underline hover:no-underline ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'}`}
                  >
                    {result.source_url}
                  </a>
                </p>
              )}
            </div>
            {files.length > 0 && (
              <button
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = getDownloadAllUrl(result.crawl_id);
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
                className="px-4 py-2 text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all text-sm font-medium shadow-lg shadow-indigo-600/30"
              >
                Download All
              </button>
            )}
          </div>

          {meta && (
            <div className={`flex flex-wrap gap-2 items-center text-xs ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
              {meta.views != null && <span>{meta.views.toLocaleString()} views</span>}
              {meta.stars != null && <span>{meta.stars.toLocaleString()} stars</span>}
              {meta.chapter_count != null && <span>{meta.chapter_count} parts</span>}
              {meta.completed === true && (
                <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>Completed</span>
              )}
              {meta.mature === true && (
                <span className={`px-2 py-0.5 rounded-lg text-xs font-medium border ${isDark ? 'bg-amber-900/40 text-amber-400 border-amber-800/40' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>18+</span>
              )}
              {meta.is_paywalled === true && (
                <span className={`px-2 py-0.5 rounded-lg text-xs font-medium border ${isDark ? 'bg-red-900/40 text-red-400 border-red-800/40' : 'bg-red-100 text-red-700 border-red-200'}`}>Locked chapters present</span>
              )}
            </div>
          )}

          {meta?.tags && meta.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {meta.tags.map(tag => (
                <span key={tag} className={`px-2 py-0.5 text-xs rounded-lg ${isDark ? 'bg-slate-800/60 text-slate-300 border border-slate-700/50' : 'bg-gray-100 text-gray-700'}`}>{tag}</span>
              ))}
            </div>
          )}

          {meta?.description && (
            <p className={`text-sm line-clamp-2 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{meta.description}</p>
          )}

          {result.error_message && (
            <div className={`p-3 rounded-xl text-sm ${isDark
              ? 'bg-red-900/20 border border-red-800/30 text-red-400'
              : 'bg-red-50 border border-red-200 text-red-600'
            }`}>
              <strong>Error:</strong> {result.error_message}
            </div>
          )}
        </section>

        {/* File List */}
        {nonCombinedFiles.length > 0 || combinedFilename ? (
          <section className="space-y-4">
            <h2 className={`text-lg font-semibold ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>
              Chapters ({nonCombinedFiles.length})
            </h2>

            {combinedFilename && (
              <FilePreview
                crawlId={result.crawl_id}
                filename={combinedFilename}
                sizeBytes={files.find(f => f.filename === combinedFilename)?.size_bytes || 0}
                onDownload={handleDownloadCombined}
                accent="emerald"
                isDark={isDark}
              />
            )}

            {nonCombinedFiles.length > 0 && (
              <>
                {combinedFilename && (
                  <p className={`text-xs uppercase tracking-wider font-semibold pt-2 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                    Individual Chapters
                  </p>
                )}
                <div className="space-y-3">
                  {nonCombinedFiles.map(file => (
                    <FilePreview
                      key={file.filename}
                      crawlId={result.crawl_id}
                      filename={file.filename}
                      sizeBytes={file.size_bytes}
                      onDownload={() => handleDownload(file.filename)}
                      isDark={isDark}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        ) : (
          <section className={`rounded-2xl p-8 text-center ${isDark
            ? 'bg-slate-900/60 border border-slate-800/60 text-slate-500'
            : 'bg-white border border-gray-200 text-gray-400'
          }`}>
            No output files found for this crawl session.
          </section>
        )}

        {/* Phase 2 placeholder */}
        <section className={`rounded-2xl p-6 space-y-3 ${isDark
          ? 'bg-slate-900/60 border border-slate-800/60'
          : 'bg-white border border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isDark ? 'bg-slate-800 text-slate-500' : 'bg-gray-100 text-gray-400'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </div>
            <h2 className={`text-base font-medium ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>Send to Company Backend</h2>
          </div>
          <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
            This feature will POST crawled chapter content to the company NestJS/Java backend.
            It will be enabled in Phase 2 once the API endpoint details are confirmed.
          </p>
          <button
            disabled
            className={`px-4 py-2 text-sm rounded-xl cursor-not-allowed ${isDark
              ? 'text-slate-400 bg-slate-800 border border-slate-700'
              : 'text-gray-400 bg-gray-100 border border-gray-300'
            }`}
          >
            Send to Company BE (Phase 2)
          </button>
        </section>
      </main>
    </div>
  );
}
