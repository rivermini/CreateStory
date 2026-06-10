import { useState, type ChangeEvent } from 'react';
import { Icon, appIcons } from '../Shared/Icon';
import { useSiteDetection } from '../../hooks/useSiteDetection';
import type { ThemeMode } from '../../types/theme';

export interface UrlInputProps {
  readonly onSlugDetected?: (slug: string) => void;
  readonly initialUrl?: string;
  readonly themeMode?: ThemeMode;
}

export function UrlInput({ onSlugDetected, initialUrl = '', themeMode = 'dark' }: Readonly<UrlInputProps>) {
  const isDark = themeMode === 'dark';
  const [url, setUrl] = useState(initialUrl);
  const { siteInfo, slug, isValid, isLoading, error, detect } = useSiteDetection();

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUrl(val);
    detect(val);
  };

  const handleBlur = () => {
    if (url.trim()) {
      detect(url);
      if (slug) {
        onSlugDetected?.(slug);
      }
    }
  };

  const inputBase = isDark
    ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-white/18 focus:ring-1 focus:ring-white/12'
    : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-black/18 focus:ring-1 focus:ring-black/8';

  return (
    <div className="space-y-1.5">
      <label htmlFor="url-input" className={`block text-xs font-medium uppercase tracking-[0.14em] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
        Novel URL
      </label>
      <div className="relative">
        <input
          id="url-input"
          type="url"
          value={url}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="https://www.wattpad.com/1284690197-...-chapter-one"
          className={`w-full rounded-lg border px-3.5 py-2.5 text-sm transition-all duration-200 focus:outline-none ${inputBase}`}
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <Icon icon={appIcons.spinner} className="h-4.5 w-4.5 animate-spin" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(17,17,17,0.45)' }} />
          </div>
        )}
      </div>

      {isValid && siteInfo && slug && (
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
          style={{
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(17,17,17,0.1)',
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(17,17,17,0.04)',
          }}
        >
          <Icon
            icon={appIcons.check}
            className="h-4 w-4 flex-shrink-0"
            style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)' }}
          />
          <span className={isDark ? 'text-white/65' : 'text-black/65'}>
            <span className="font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>{siteInfo.site_name}</span>
            {' · '}Slug: <code className={isDark ? 'text-white/72' : 'text-black/72'}>{slug}</code>
          </span>
        </div>
      )}

      {error && (
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
          style={{
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(17,17,17,0.1)',
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(17,17,17,0.04)',
          }}
        >
          <Icon
            icon={appIcons.error}
            className="h-4 w-4 flex-shrink-0"
            style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)' }}
          />
          <span className={isDark ? 'text-white/65' : 'text-black/65'}>{error}</span>
        </div>
      )}
    </div>
  );
}
