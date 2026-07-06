import { useState } from 'react';
import type { FilePreview as FilePreviewType } from '../../api';
import { getFileContent, previewFile } from '../../api';
import { Icon, appIcons } from '../Shared/Icon';

export interface FilePreviewProps {
  readonly crawlId: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly onDownload: () => void;
  readonly accent?: 'emerald' | 'indigo' | 'cyan' | 'none';
  readonly isDark?: boolean;
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

  const panelBackground = isDark ? 'rgba(255,255,255,0.03)' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const codeSurface = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(55,53,47,0.03)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const strongText = isDark ? 'rgba(255,255,255,0.82)' : '#111111';

  const neutralBorder = accent === 'none' ? panelBorder : isDark ? 'rgba(255,255,255,0.12)' : 'rgba(17,17,17,0.12)';
  const neutralTint = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17,17,17,0.04)';

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
    ? { label: '{}', bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)', text: strongText }
    : isMd
      ? { label: 'MD', bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)', text: strongText }
      : isTxt
        ? { label: 'TXT', bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)', text: strongText }
        : { label: 'CSV', bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)', text: strongText };

  return (
    <div className="overflow-hidden rounded-xl border" style={{ background: panelBackground, borderColor: neutralBorder }}>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-semibold"
              style={{ background: typeConfig.bg, color: typeConfig.text, border: `1px solid ${panelBorder}` }}
            >
              {typeConfig.label}
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" style={{ color: pageText }}>{filename}</p>
            <p className="text-[11px]" style={{ color: tertiaryText }}>{formatBytes(sizeBytes)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={handleExpand}
            disabled={loading}
            className="rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50"
            style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}
          >
            {loading ? 'Loading...' : expanded ? 'Collapse' : 'Preview'}
          </button>
          <button
            onClick={handleCopy}
            disabled={copied}
            className="relative flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-default"
            style={{ background: copied ? neutralTint : mutedSurface, borderColor: copied ? neutralBorder : panelBorder, color: copied ? strongText : secondaryText }}
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
            className="rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors"
            style={{ background: neutralTint, borderColor: neutralBorder, color: strongText }}
          >
            Download
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-3 py-3" style={{ borderColor: panelBorder }}>
          {err && <p className="mb-2 text-sm" style={{ color: strongText }}>{err}</p>}
          {preview ? (
            <div className="space-y-1.5">
              <pre className="max-h-60 overflow-x-auto overflow-y-auto rounded-lg border p-3 text-[11px] font-mono" style={{ background: codeSurface, borderColor: panelBorder, color: secondaryText }}>
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
