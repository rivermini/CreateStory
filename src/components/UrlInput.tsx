import { useState, type ChangeEvent } from 'react';
import { Icon, appIcons } from './Icon';
import { useSiteDetection } from '../hooks/useSiteDetection';
import type { ThemeMode } from '../types/theme';

export interface UrlInputProps {
  onSlugDetected?: (slug: string) => void;
  initialUrl?: string;
  themeMode?: ThemeMode;
}

export function UrlInput({ onSlugDetected, initialUrl = '', themeMode = 'dark' }: UrlInputProps) {
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
    ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'
    : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50';

  return (
    <div className="space-y-2">
      <label htmlFor="url-input" className={`block text-sm font-medium ${isDark ? 'text-white/45' : 'text-black/45'}`}>
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
          className={`w-full px-4 py-3 rounded-xl border transition-all duration-200 text-sm focus:outline-none ${inputBase}`}
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <Icon icon={appIcons.spinner} className="animate-spin h-5 w-5 text-indigo-400" />
          </div>
        )}
      </div>

      {isValid && siteInfo && slug && (
        <div className="lg-glass flex items-center gap-2 text-sm p-3" style={{ border: isDark ? '1px solid rgba(52,211,153,0.2)' : '1px solid rgba(52,211,153,0.3)', background: isDark ? 'rgba(52,211,153,0.06)' : 'rgba(52,211,153,0.04)' }}>
          <Icon icon={appIcons.check} className="w-4 h-4 flex-shrink-0 text-emerald-400" />
          <span className={isDark ? 'text-white/65' : 'text-black/65'}>
            <span className="font-medium">{siteInfo.site_name}</span>
            {' · '}Slug: <code className={isDark ? 'text-indigo-300' : 'text-indigo-600'}>{slug}</code>
          </span>
        </div>
      )}

      {error && (
        <div className="lg-glass flex items-center gap-2 text-sm p-3" style={{ border: isDark ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(239,68,68,0.3)', background: isDark ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.04)' }}>
          <Icon icon={appIcons.error} className="w-4 h-4 flex-shrink-0 text-red-400" />
          <span className={isDark ? 'text-red-400' : 'text-red-600'}>{error}</span>
        </div>
      )}
    </div>
  );
}
