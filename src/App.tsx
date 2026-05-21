import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { CrawlPage } from './pages/CrawlPage';
import { ResultsPage } from './pages/ResultsPage';
import ResultsAllPage from './pages/ResultsAllPage';
import { BatchPage } from './pages/BatchPage';
import { DriveSyncPage } from './pages/DriveSyncPage';
import { DriveSyncHistoryPage } from './pages/DriveSyncHistoryPage';
import FloatingNewCrawlButton from './components/FloatingNewCrawlButton.tsx';

type ThemeMode = 'system' | 'light' | 'dark';

const THEME_COOKIE = 'novel_crawler_theme';

function readThemeCookie(): ThemeMode | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return value === 'light' || value === 'dark' || value === 'system' ? value : null;
}

function writeThemeCookie(mode: ThemeMode) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${encodeURIComponent(mode)}; path=/; max-age=${maxAge}; samesite=lax`;
}

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeCookie() ?? 'system');

  useEffect(() => {
    const root = document.documentElement;
    const resolved = themeMode === 'system' ? getSystemTheme() : themeMode;
    root.dataset.theme = resolved;
    root.dataset.themeMode = themeMode;
    root.style.colorScheme = resolved;
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme = media.matches ? 'light' : 'dark';
      root.style.colorScheme = media.matches ? 'light' : 'dark';
    };

    media.addEventListener('change', apply);
    apply();
    return () => media.removeEventListener('change', apply);
  }, [themeMode]);

  const handleThemeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    writeThemeCookie(mode);
  }, []);

  return (
    <>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/" element={<HomePage themeMode={themeMode} onThemeChange={handleThemeChange} />} />
          <Route path="/batch" element={<BatchPage themeMode={themeMode} onThemeChange={handleThemeChange} />} />
          <Route path="/crawl" element={<CrawlPage themeMode={themeMode} onThemeChange={handleThemeChange} />} />
          <Route path="/results" element={<ResultsPage themeMode={themeMode} onThemeChange={handleThemeChange} />} />
          <Route path="/results/all" element={<ResultsAllPage themeMode={themeMode} onThemeChange={handleThemeChange} />} />
          <Route path="/bedread" element={<Navigate to="/" replace />} />
          <Route path="/bedread/jobs" element={<Navigate to="/" replace />} />
          <Route path="/drive-sync" element={<DriveSyncPage themeMode={themeMode} onThemeChange={handleThemeChange} />} />
          <Route path="/drive-sync/history" element={<DriveSyncHistoryPage themeMode={themeMode} onThemeChange={handleThemeChange} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <FloatingNewCrawlButton />
      </BrowserRouter>
    </>
  );
}

export default App;
