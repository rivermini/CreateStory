import { useState } from 'react';
import type { FilePreview as FilePreviewType } from '../api/client';
import { previewFile, getFileContent } from '../api/client';
import { Icon, appIcons } from './Icon';

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
  const isMd = filename.endsWith('.md');
  const isTxt = filename.endsWith('.txt');

  const typeConfig = isJson
    ? { label: '{}', bg: isDark ? 'bg-indigo-500/20' : 'bg-indigo-50', text: isDark ? 'text-indigo-400' : 'text-indigo-600' }
    : isMd
    ? { label: 'MD', bg: isDark ? 'bg-cyan-500/20' : 'bg-cyan-50', text: isDark ? 'text-cyan-400' : 'text-cyan-600' }
    : isTxt
    ? { label: 'TXT', bg: isDark ? 'bg-cyan-500/20' : 'bg-cyan-50', text: isDark ? 'text-cyan-400' : 'text-cyan-600' }
    : { label: 'CSV', bg: isDark ? 'bg-emerald-500/20' : 'bg-emerald-50', text: isDark ? 'text-emerald-400' : 'text-emerald-600' };

  const copyBtnBase = isDark
    ? 'text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/30'
    : 'text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/30';

  return (
    <div className={`lg-glass-card overflow-hidden ${accent === 'emerald' ? 'border-l-4 border-l-emerald-500' : accent === 'cyan' ? 'border-l-4 border-l-cyan-500' : ''}`}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0">
            <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-xs font-bold ${typeConfig.bg} ${typeConfig.text}`}>
              {typeConfig.label}
            </span>
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-medium truncate ${isDark ? 'text-white/85' : 'text-black/80'}`}>{filename}</p>
            <p className={`text-xs ${isDark ? 'text-white/35' : 'text-black/40'}`}>{formatBytes(sizeBytes)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleExpand}
            disabled={loading}
            className={`lg-btn-ghost px-3 py-1.5 text-xs font-medium rounded-xl transition-all duration-200 disabled:opacity-50`}
          >
            {loading ? 'Loading...' : expanded ? 'Collapse' : 'Preview'}
          </button>
          <button
            onClick={handleCopy}
            disabled={copied}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-all duration-200 disabled:cursor-default ${copyBtnBase} ${copied ? '' : ''}`}
            title="Copy full file content to clipboard"
            onMouseLeave={() => copied && setCopied(false)}
          >
            <span className={`flex items-center gap-1.5 transition-all duration-200 ${copied ? 'opacity-0 scale-75 absolute' : 'opacity-100'}`}>
              <Icon icon={appIcons.file} className="w-3.5 h-3.5" />
              <span>Copy</span>
            </span>
            <span className={`flex items-center gap-1.5 transition-all duration-200 ${copied ? 'opacity-100' : 'opacity-0 scale-75 absolute'}`}>
              <Icon icon={appIcons.check} className="w-3.5 h-3.5" />
              <span>Copied</span>
            </span>
          </button>
          <button
            onClick={onDownload}
            className={`lg-btn-primary px-3 py-1.5 text-xs font-medium rounded-xl transition-all duration-200`}
          >
            Download
          </button>
        </div>
      </div>

      {expanded && (
        <div className={`border-t px-4 py-4 ${isDark ? 'border-white/8' : 'border-black/8'}`}>
          {err && <p className={`text-sm mb-3 ${isDark ? 'text-red-400' : 'text-red-600'}`}>{err}</p>}
          {preview ? (
            <div className="space-y-2">
              <pre className={`border rounded-xl p-4 overflow-x-auto text-xs font-mono max-h-60 overflow-y-auto ${isDark
                ? 'bg-black/20 border-white/8 text-white/65'
                : 'bg-black/4 border-black/8 text-black/70'
              }`}>
                <code>{preview.preview || '(empty file)'}</code>
              </pre>
              {preview.total_lines > 30 && (
                <p className={`text-xs ${isDark ? 'text-white/35' : 'text-black/35'}`}>
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
