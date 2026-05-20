import { useState } from 'react';
import type { FilePreview as FilePreviewType } from '../api/client';
import { previewFile, getFileContent } from '../api/client';

export interface FilePreviewProps {
  crawlId: string;
  filename: string;
  sizeBytes: number;
  onDownload: () => void;
  /** Highlight this file with a colored left border (e.g. 'emerald' for combined files) */
  accent?: 'emerald' | 'indigo' | 'cyan' | 'none';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilePreview({ crawlId, filename, sizeBytes, onDownload, accent = 'indigo' }: FilePreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<FilePreviewType | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (preview) {
      setExpanded(true);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const data = await previewFile(crawlId, filename);
      setPreview(data);
      setExpanded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (copied) return;
    setCopied(true);
    setErr('');
    try {
      const data = await getFileContent(crawlId, filename);
      await navigator.clipboard.writeText(data.content);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to copy content');
      setCopied(false);
    }
  };

  const isJson = filename.endsWith('.json');

  const accentBorder: Record<string, string> = {
    emerald: 'border-l-4 border-l-emerald-500',
    indigo: '',
    cyan: 'border-l-4 border-l-cyan-500',
    none: '',
  };

  const accentDownloadBtn: Record<string, string> = {
    emerald: 'bg-emerald-600 hover:bg-emerald-500',
    indigo: 'bg-indigo-600 hover:bg-indigo-500',
    cyan: 'bg-cyan-600 hover:bg-cyan-500',
    none: 'bg-indigo-600 hover:bg-indigo-500',
  };

  return (
    <div className={`border border-slate-700 rounded-lg bg-slate-800 overflow-hidden ${accentBorder[accent]}`}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0">
            {isJson ? (
              <span className="inline-flex items-center justify-center w-8 h-8 bg-indigo-900/50 text-indigo-400 rounded text-xs font-bold">{'{}'}</span>
            ) : filename.endsWith('.txt') || filename.endsWith('.md') ? (
              <span className="inline-flex items-center justify-center w-8 h-8 bg-cyan-900/50 text-cyan-400 rounded text-xs font-bold">TXT</span>
            ) : (
              <span className="inline-flex items-center justify-center w-8 h-8 bg-emerald-900/50 text-emerald-400 rounded text-xs font-bold">CSV</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{filename}</p>
            <p className="text-xs text-slate-500">{formatBytes(sizeBytes)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleExpand}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 hover:bg-slate-600
                       rounded transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : expanded ? 'Collapse' : 'Preview'}
          </button>
          <button
            onClick={handleCopy}
            disabled={copied}
            className={`relative flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium rounded
              transition-colors duration-200
              ${copied ? 'bg-emerald-600 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}
              disabled:cursor-default`}
            title="Copy full file content to clipboard"
            onMouseLeave={() => copied && setCopied(false)}
          >
            {/* Copy icon + label */}
            <span className={`flex items-center gap-1.5 transition-all duration-200
              ${copied ? 'opacity-0 scale-75 absolute' : 'opacity-100'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              <span>Copy</span>
            </span>
            {/* Checkmark icon + label */}
            <span className={`flex items-center gap-1.5 transition-all duration-200
              ${copied ? 'opacity-100' : 'opacity-0 scale-75 absolute'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>Copied</span>
            </span>
          </button>
          <button
            onClick={onDownload}
            className={`px-3 py-1.5 text-xs font-medium text-white ${accentDownloadBtn[accent]}
                       rounded transition-colors`}
          >
            Download
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-700 px-4 py-3">
          {err && <p className="text-red-400 text-sm mb-2">{err}</p>}
          {preview ? (
            <div className="space-y-2">
              <pre className="bg-slate-950 border border-slate-700 rounded p-3 overflow-x-auto text-xs
                              text-slate-300 font-mono max-h-60 overflow-y-auto">
                <code>{preview.preview || '(empty file)'}</code>
              </pre>
              {preview.total_lines > 30 && (
                <p className="text-xs text-slate-500">
                  ... and {preview.total_lines - 30} more lines
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
