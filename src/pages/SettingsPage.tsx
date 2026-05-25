import { useEffect, useState } from 'react';
import { getSettings, updateSettings, type SettingsResponse } from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';

interface SettingsPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function SettingsPage({ themeMode, onThemeChange }: SettingsPageProps) {
  const isDark = themeMode === 'dark';
  const [, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  const [localTheme, setLocalTheme] = useState<'light' | 'dark'>('light');
  const [crawlMode, setCrawlMode] = useState<'count' | 'range'>('count');
  const [count, setCount] = useState(10);
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(10);

  useEffect(() => {
    setLocalTheme(themeMode === 'dark' ? 'dark' : 'light');
    getSettings()
      .then(s => {
        setSettings(s);
        setLocalTheme(s.theme === 'dark' ? 'dark' : 'light');
        setCrawlMode(s.crawl_mode as 'count' | 'range');
        setCount(s.crawl_default_count);
        setRangeFrom(s.crawl_default_range_from);
        setRangeTo(s.crawl_default_range_to);
      })
      .catch(() => setError('Failed to load settings.'))
      .finally(() => setLoading(false));
  }, [themeMode]);

  const handleSave = async () => {
    setSaveState('saving');
    setError('');
    try {
      const updated = await updateSettings({
        theme: localTheme,
        crawl_mode: crawlMode,
        crawl_default_count: count,
        crawl_default_range_from: rangeFrom,
        crawl_default_range_to: rangeTo,
      });
      setSettings(updated);
      onThemeChange(localTheme === 'dark' ? 'dark' : 'light');
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setError('Failed to save settings.');
      setSaveState('idle');
    }
  };

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-slate-950 text-slate-400' : 'bg-gray-50 text-gray-500'}`}>
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
      <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* Page Header */}
        <div className="mb-2">
          <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            Settings
          </h1>
          <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            Customize your experience
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className={`flex items-center gap-3 p-4 rounded-2xl text-sm ${isDark
            ? 'bg-red-900/20 border border-red-800/30 text-red-400'
            : 'bg-red-50 border border-red-200 text-red-600'
          }`}>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Theme Section */}
        <section className={`rounded-2xl p-5 sm:p-6 space-y-4 ${isDark
          ? 'bg-slate-900/60 border border-slate-800/60'
          : 'bg-white border border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-slate-800 text-indigo-400' : 'bg-gray-100 text-indigo-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>Appearance</h2>
              <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Toggle between light and dark theme</p>
            </div>
          </div>

          <div className={`flex gap-3 ${isDark ? '' : ''}`}>
            {/* Light option */}
            <button
              onClick={() => setLocalTheme('light')}
              className={`flex-1 p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-2 ${
                localTheme === 'light'
                  ? 'border-indigo-500 bg-indigo-600/10'
                  : isDark
                    ? 'border-slate-700 hover:border-slate-600 bg-slate-800/40'
                    : 'border-gray-200 hover:border-gray-300 bg-gray-50'
              }`}
            >
              <svg className={`w-6 h-6 ${localTheme === 'light' ? 'text-indigo-400' : isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span className={`text-sm font-medium ${localTheme === 'light' ? 'text-indigo-300' : isDark ? 'text-slate-400' : 'text-gray-500'}`}>Light</span>
            </button>

            {/* Dark option */}
            <button
              onClick={() => setLocalTheme('dark')}
              className={`flex-1 p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-2 ${
                localTheme === 'dark'
                  ? 'border-indigo-500 bg-indigo-600/10'
                  : isDark
                    ? 'border-slate-700 hover:border-slate-600 bg-slate-800/40'
                    : 'border-gray-200 hover:border-gray-300 bg-gray-50'
              }`}
            >
              <svg className={`w-6 h-6 ${localTheme === 'dark' ? 'text-indigo-400' : isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span className={`text-sm font-medium ${localTheme === 'dark' ? 'text-indigo-300' : isDark ? 'text-slate-400' : 'text-gray-500'}`}>Dark</span>
            </button>
          </div>
        </section>

        {/* Crawl Defaults Section */}
        <section className={`rounded-2xl p-5 sm:p-6 space-y-5 ${isDark
          ? 'bg-slate-900/60 border border-slate-800/60'
          : 'bg-white border border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-slate-800 text-indigo-400' : 'bg-gray-100 text-indigo-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>Default Crawl Settings</h2>
              <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Applied automatically on the crawl page</p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className={`flex items-center gap-1 p-1 rounded-xl w-fit ${isDark ? 'bg-slate-800/80' : 'bg-gray-100'}`}>
            <button
              onClick={() => setCrawlMode('count')}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                crawlMode === 'count'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : isDark
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Count
            </button>
            <button
              onClick={() => setCrawlMode('range')}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                crawlMode === 'range'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : isDark
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Range
            </button>
          </div>

          {/* Count input */}
          {crawlMode === 'count' ? (
            <div className="max-w-xs">
              <label className={`block text-sm mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                Default chapter count
              </label>
              <input
                type="number"
                min={1}
                max={100000}
                value={count}
                onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                className={`w-full px-4 py-3 border rounded-xl
                  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                  ${isDark
                    ? 'bg-slate-800/60 border-slate-700 text-slate-100'
                    : 'bg-gray-50 border-gray-300 text-gray-900'
                  }`}
              />
            </div>
          ) : (
            <div className="flex items-end gap-3 max-w-sm">
              <div className="flex-1">
                <label className={`block text-sm mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                  From chapter
                </label>
                <input
                  type="number"
                  min={1}
                  value={rangeFrom}
                  onChange={e => setRangeFrom(Math.max(1, parseInt(e.target.value) || 1))}
                  className={`w-full px-4 py-3 border rounded-xl
                    focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                    ${isDark
                      ? 'bg-slate-800/60 border-slate-700 text-slate-100'
                      : 'bg-gray-50 border-gray-300 text-gray-900'
                    }`}
                />
              </div>
              <span className={`pb-3 font-medium ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>to</span>
              <div className="flex-1">
                <label className={`block text-sm mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                  To chapter
                </label>
                <input
                  type="number"
                  min={1}
                  value={rangeTo}
                  onChange={e => setRangeTo(Math.max(1, parseInt(e.target.value) || 1))}
                  className={`w-full px-4 py-3 border rounded-xl
                    focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                    ${isDark
                      ? 'bg-slate-800/60 border-slate-700 text-slate-100'
                      : 'bg-gray-50 border-gray-300 text-gray-900'
                    }`}
                />
              </div>
            </div>
          )}

          <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            {crawlMode === 'count'
              ? `Default: crawl up to ${count} chapter${count !== 1 ? 's' : ''}`
              : `Default: crawl chapters ${rangeFrom} to ${rangeTo} (${Math.max(0, rangeTo - rangeFrom + 1)} total)`
            }
          </p>
        </section>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saveState !== 'idle'}
            className={`px-6 py-3 font-semibold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg ${
              saveState !== 'idle'
                ? saveState === 'saved'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30'
                  : isDark
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30'
            }`}
          >
            {saveState === 'saving' ? (
              <>
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </>
            ) : saveState === 'saved' ? (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Saved!
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                Save Settings
              </>
            )}
          </button>
        </div>

      </main>
    </div>
  );
}
