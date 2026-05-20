import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCrawlResult, getCombinedResult, getDownloadUrl, getDownloadCombinedUrl, getDownloadAllUrl, type CrawlSessionSummary } from '../api/client';
import { FilePreview } from '../components/FilePreview';
import Header from '../components/Header';
import { type ThemeMode } from '../components/ThemeToggle';

interface ResultsPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function ResultsPage({ themeMode, onThemeChange }: ResultsPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const crawlId = searchParams.get('session');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CrawlSessionSummary | null>(null);
  const [combinedFilename, setCombinedFilename] = useState('');
  const [files, setFiles] = useState<{ filename: string; size_bytes: number; chapter_number: number }[]>([]);
  const [lastRefresh, setLastRefresh] = useState(new Date());

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
      setLastRefresh(new Date());
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

  // Poll while crawl is still running
  useEffect(() => {
    if (!result || result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled') return;
    const interval = setInterval(fetchResult, 3000);
    return () => clearInterval(interval);
  }, [result?.status, fetchResult]);

  if (!crawlId) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-red-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error || 'Results not found'}</span>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
          >
            Start New Crawl
          </button>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    completed: 'text-emerald-400',
    failed: 'text-red-400',
    cancelled: 'text-amber-400',
    running: 'text-blue-400',
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
    <div className="min-h-screen bg-slate-900">
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title={meta?.title || result.novel_name || 'Crawl Results'}
        subtitle={<span className="font-mono hidden sm:block">refreshed {lastRefresh.toLocaleTimeString()}</span>}
      />

      <main className="w-full max-w-none mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* Summary Card */}
        <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 sm:p-6 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              {meta?.author_fullname && (
                <p className="text-sm text-slate-400">by {meta.author_fullname}</p>
              )}
              <p className="text-sm text-slate-400">
                {result.spider_name || 'Unknown site'} &middot;{' '}
                <span className={statusColors[result.status] ?? 'text-slate-400'}>
                  {statusLabels[result.status] ?? result.status}
                </span>
                {result.chapters_crawled > 0 && (
                  <> &middot; {result.chapters_crawled} chapter{result.chapters_crawled !== 1 ? 's' : ''}</>
                )}
              </p>
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
                className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
              >
                Download All
              </button>
            )}
          </div>

          {/* Novel metadata */}
          {meta && (
            <div className="flex flex-wrap gap-2 items-center text-xs text-slate-300">
              {meta.views != null && <span>Views: {meta.views.toLocaleString()}</span>}
              {meta.stars != null && <span>Stars: {meta.stars.toLocaleString()}</span>}
              {meta.chapter_count != null && <span>Parts: {meta.chapter_count}</span>}
              {meta.completed === true && <span className="text-emerald-400">Completed</span>}
              {meta.mature === true && <span className="px-2 py-0.5 bg-amber-900/50 text-amber-400 rounded text-xs">18+</span>}
              {meta.is_paywalled === true && <span className="px-2 py-0.5 bg-red-900/50 text-red-400 rounded text-xs">Locked chapters present</span>}
            </div>
          )}

          {/* Tags */}
          {meta?.tags && meta.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {meta.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 text-xs bg-slate-700 text-slate-300 rounded">{tag}</span>
              ))}
            </div>
          )}

          {/* Description */}
          {meta?.description && (
            <p className="text-sm text-slate-400 line-clamp-2">{meta.description}</p>
          )}

          {/* Error */}
          {result.error_message && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
              <strong>Error:</strong> {result.error_message}
            </div>
          )}
        </section>

        {/* File List */}
        {nonCombinedFiles.length > 0 || combinedFilename ? (
          <section className="space-y-3">
            <h2 className="text-base font-medium text-slate-200">
              Chapters ({nonCombinedFiles.length})
            </h2>

            {/* Combined file — separated at top */}
            {combinedFilename && (
              <FilePreview
                crawlId={result.crawl_id}
                filename={combinedFilename}
                sizeBytes={files.find(f => f.filename === combinedFilename)?.size_bytes || 0}
                onDownload={handleDownloadCombined}
                accent="emerald"
              />
            )}

            {/* Individual chapter files */}
            {nonCombinedFiles.length > 0 && (
              <>
                {combinedFilename && (
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold pt-2">
                    Individual Chapters
                  </p>
                )}
                <div className="space-y-2">
                  {nonCombinedFiles.map(file => (
                    <FilePreview
                      key={file.filename}
                      crawlId={result.crawl_id}
                      filename={file.filename}
                      sizeBytes={file.size_bytes}
                      onDownload={() => handleDownload(file.filename)}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        ) : (
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-500">
            No output files found for this crawl session.
          </section>
        )}

        {/* Phase 2 placeholder */}
        <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            <h2 className="text-base font-medium text-slate-300">Send to Company Backend</h2>
          </div>
          <p className="text-sm text-slate-400">
            This feature will POST crawled chapter content to the company NestJS/Java backend.
            It will be enabled in Phase 2 once the API endpoint details are confirmed.
          </p>
          <button
            disabled
            className="px-4 py-2 text-sm text-slate-400 bg-slate-700 border border-slate-600 rounded-lg cursor-not-allowed"
          >
            Send to Company BE (Phase 2)
          </button>
        </section>
      </main>
    </div>
  );
}
