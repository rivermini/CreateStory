import { useState } from 'react';
import type { FilePreview as FilePreviewType } from '../api/client';
import { previewFile, getFileContent } from '../api/client';

export interface FilePreviewProps {
  crawlId: string;
  filename: string;
  sizeBytes: number;
  onDownload: () => void;
  accent?: 'emerald' | 'indigo' | 'cyan' | 'none';
  isDark?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilePreview({ crawlId, filename, sizeBytes, onDownload, accent = 'indigo', isDark = true }: FilePreviewProps) {
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

  const accentColors = accent === 'emerald'
    ? { border: 'border-l-emerald-500', bg: isDark ? 'bg-emerald-900/20' : 'bg-emerald-50' }
    : accent === 'cyan'
    ? { border: 'border-l-cyan-500', bg: isDark ? 'bg-cyan-900/20' : 'bg-cyan-50' }
    : { border: '', bg: '' };

  return (
    <div className={`border rounded-2xl overflow-hidden ${isDark
      ? 'border-slate-800/60 bg-slate-900/60'
      : 'border-gray-200 bg-white'
    } ${accentColors.border} border-l-4`}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0">
            {isJson ? (
              <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-xs font-bold ${isDark
                ? 'bg-indigo-900/40 text-indigo-400'
                : 'bg-indigo-100 text-indigo-600'
              }`}>{'{}'}</span>
            ) : filename.endsWith('.md') ? (
              <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-xs font-bold ${isDark
                ? 'bg-cyan-900/40 text-cyan-400'
                : 'bg-cyan-100 text-cyan-600'
              }`}>MD</span>
            ) : filename.endsWith('.txt') ? (
              <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-xs font-bold ${isDark
                ? 'bg-cyan-900/40 text-cyan-400'
                : 'bg-cyan-100 text-cyan-600'
              }`}>TXT</span>
            ) : (
              <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-xs font-bold ${isDark
                ? 'bg-emerald-900/40 text-emerald-400'
                : 'bg-emerald-100 text-emerald-600'
              }`}>CSV</span>
            )}
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>{filename}</p>
            <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{formatBytes(sizeBytes)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleExpand}
            disabled={loading}
            className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all duration-200 disabled:opacity-50 ${isDark
              ? 'text-slate-300 bg-slate-800/60 hover:bg-slate-800'
              : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
            }`}
          >
            {loading ? 'Loading...' : expanded ? 'Collapse' : 'Preview'}
          </button>
          <button
            onClick={handleCopy}
            disabled={copied}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl
              transition-all duration-200 disabled:cursor-default bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30
              ${copied ? 'bg-emerald-600 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
            title="Copy full file content to clipboard"
            onMouseLeave={() => copied && setCopied(false)}
          >
            <span className={`flex items-center gap-1.5 transition-all duration-200 ${copied ? 'opacity-0 scale-75 absolute' : 'opacity-100'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              <span>Copy</span>
            </span>
            <span className={`flex items-center gap-1.5 transition-all duration-200 ${copied ? 'opacity-100' : 'opacity-0 scale-75 absolute'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>Copied</span>
            </span>
          </button>
          <button
            onClick={onDownload}
            className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all duration-200 text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/30`}
          >
            Download
          </button>
        </div>
      </div>

      {expanded && (
        <div className={`border-t px-4 py-4 ${isDark ? 'border-slate-800/60' : 'border-gray-200'}`}>
          {err && <p className={`text-sm mb-3 ${isDark ? 'text-red-400' : 'text-red-600'}`}>{err}</p>}
          {preview ? (
            <div className="space-y-2">
              <pre className={`border rounded-xl p-4 overflow-x-auto text-xs font-mono max-h-60 overflow-y-auto ${isDark
                ? 'bg-slate-950 border-slate-800/60 text-slate-300'
                : 'bg-gray-50 border-gray-200 text-gray-700'
              }`}>
                <code>{preview.preview || '(empty file)'}</code>
              </pre>
              {preview.total_lines > 30 && (
                <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
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
