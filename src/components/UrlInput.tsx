import { useState, type ChangeEvent } from 'react';
import { useSiteDetection } from '../hooks/useSiteDetection';
import { type ThemeMode } from './ThemeToggle';

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

  return (
    <div className="space-y-2">
      <label htmlFor="url-input" className={`block text-sm font-medium ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
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
          className={`w-full px-4 py-3 rounded-xl border transition-all duration-200
                     text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                     ${isDark
                       ? 'bg-slate-800/60 border-slate-700 text-slate-100 placeholder-slate-500'
                       : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'
                     }`}
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <svg className="animate-spin h-5 w-5 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>

      {isValid && siteInfo && slug && (
        <div className={`flex items-center gap-2 text-sm rounded-xl p-3 ${isDark
          ? 'bg-emerald-900/20 border border-emerald-800/30'
          : 'bg-emerald-50 border border-emerald-200'
        }`}>
          <svg className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className={isDark ? 'text-slate-200' : 'text-gray-800'}>
            <span className="font-medium">{siteInfo.site_name}</span>
            {' · '}Slug: <code className={isDark ? 'text-indigo-300' : 'text-indigo-600'}>{slug}</code>
          </span>
        </div>
      )}

      {error && (
        <div className={`flex items-center gap-2 text-sm rounded-xl p-3 ${isDark
          ? 'bg-red-900/20 border border-red-800/30'
          : 'bg-red-50 border border-red-200'
        }`}>
          <svg className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-red-400' : 'text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className={isDark ? 'text-red-400' : 'text-red-600'}>{error}</span>
        </div>
      )}
    </div>
  );
}
