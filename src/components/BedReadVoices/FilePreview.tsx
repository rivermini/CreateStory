import { useState } from 'react';
import type { FilePreview as FilePreviewType } from '../../api/client';
import { getFileContent, previewFile } from '../../api/client';
import { Icon, appIcons } from '../Shared/Icon';

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

  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const codeSurface = isDark ? 'rgba(0,0,0,0.18)' : 'rgba(55,53,47,0.03)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';

  const accentConfig = accent === 'emerald'
    ? { border: '#10b981', tint: isDark ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.06)' }
    : accent === 'cyan'
      ? { border: '#06b6d4', tint: isDark ? 'rgba(6,182,212,0.12)' : 'rgba(6,182,212,0.06)' }
      : accent === 'none'
        ? { border: panelBorder, tint: mutedSurface }
        : { border: '#6366f1', tint: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)' };

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
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to load preview');
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
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to copy content');
      setCopied(false);
    }
  };

  const isJson = filename.endsWith('.json');
  const isMd = filename.endsWith('.md');
  const isTxt = filename.endsWith('.txt');

  const typeConfig = isJson
    ? { label: '{}', bg: isDark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)', text: isDark ? '#a5b4fc' : '#4338ca' }
    : isMd
      ? { label: 'MD', bg: isDark ? 'rgba(6,182,212,0.14)' : 'rgba(6,182,212,0.08)', text: isDark ? '#67e8f9' : '#0e7490' }
      : isTxt
        ? { label: 'TXT', bg: isDark ? 'rgba(6,182,212,0.14)' : 'rgba(6,182,212,0.08)', text: isDark ? '#67e8f9' : '#0e7490' }
        : { label: 'CSV', bg: isDark ? 'rgba(16,185,129,0.14)' : 'rgba(16,185,129,0.08)', text: isDark ? '#6ee7b7' : '#047857' };

  return (
    <div className="overflow-hidden rounded-2xl border" style={{ background: panelBackground, borderColor: accent === 'none' ? panelBorder : accentConfig.border }}>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0">
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold"
              style={{ background: typeConfig.bg, color: typeConfig.text, border: `1px solid ${accent === 'none' ? panelBorder : accentConfig.border}` }}
            >
              {typeConfig.label}
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" style={{ color: pageText }}>{filename}</p>
            <p className="text-xs" style={{ color: tertiaryText }}>{formatBytes(sizeBytes)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleExpand}
            disabled={loading}
            className="rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}
          >
            {loading ? 'Loading...' : expanded ? 'Collapse' : 'Preview'}
          </button>
          <button
            onClick={handleCopy}
            disabled={copied}
            className="relative flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-default"
            style={{ background: copied ? 'rgba(16,185,129,0.14)' : mutedSurface, borderColor: copied ? 'rgba(16,185,129,0.24)' : panelBorder, color: copied ? (isDark ? '#6ee7b7' : '#047857') : secondaryText }}
            title="Copy full file content to clipboard"
            onMouseLeave={() => copied && setCopied(false)}
          >
            <span className={`absolute flex items-center gap-1.5 transition-all duration-200 ${copied ? 'scale-75 opacity-0' : 'opacity-100'}`}>
              <Icon icon={appIcons.file} className="h-3.5 w-3.5" />
              <span>Copy</span>
            </span>
            <span className={`flex items-center gap-1.5 transition-all duration-200 ${copied ? 'opacity-100' : 'scale-75 opacity-0'}`}>
              <Icon icon={appIcons.check} className="h-3.5 w-3.5" />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </span>
          </button>
          <button
            onClick={onDownload}
            className="rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ background: accentConfig.tint, borderColor: accent === 'none' ? panelBorder : accentConfig.border, color: accent === 'emerald' ? (isDark ? '#6ee7b7' : '#047857') : accent === 'cyan' ? (isDark ? '#67e8f9' : '#0e7490') : isDark ? '#a5b4fc' : '#4338ca' }}
          >
            Download
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-4" style={{ borderColor: panelBorder }}>
          {err && <p className="mb-3 text-sm" style={{ color: isDark ? '#f87171' : '#dc2626' }}>{err}</p>}
          {preview ? (
            <div className="space-y-2">
              <pre className="max-h-60 overflow-x-auto overflow-y-auto rounded-xl border p-4 text-xs font-mono" style={{ background: codeSurface, borderColor: panelBorder, color: secondaryText }}>
                <code>{preview.preview || '(empty file)'}</code>
              </pre>
              {preview.total_lines > 30 && (
                <p className="text-xs" style={{ color: tertiaryText }}>
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
