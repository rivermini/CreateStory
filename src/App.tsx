import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import FloatingNewCrawlButton from './components/FloatingNewCrawlButton';

const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));
const CrawlPage = lazy(() => import('./pages/CrawlPage').then(m => ({ default: m.CrawlPage })));
const ResultsPage = lazy(() => import('./pages/ResultsPage').then(m => ({ default: m.ResultsPage })));
const ResultsAllPage = lazy(() => import('./pages/ResultsAllPage'));
const BatchPage = lazy(() => import('./pages/BatchPage').then(m => ({ default: m.BatchPage })));
const DriveSyncPage = lazy(() => import('./pages/DriveSyncPage').then(m => ({ default: m.DriveSyncPage })));
const DriveSyncHistoryPage = lazy(() => import('./pages/DriveSyncHistoryPage').then(m => ({ default: m.DriveSyncHistoryPage })));
const StoryMgmtPage = lazy(() => import('./pages/StoryMgmtPage').then(m => ({ default: m.StoryMgmtPage })));

type ThemeMode = 'light' | 'dark';

const THEME_COOKIE = 'novel_crawler_theme';

function readThemeCookie(): ThemeMode | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return value === 'light' || value === 'dark' ? value : null;
}

function writeThemeCookie(mode: ThemeMode) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${encodeURIComponent(mode)}; path=/; max-age=${maxAge}; samesite=lax`;
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeCookie() ?? 'light');

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeMode;
    root.dataset.themeMode = themeMode;
    root.style.colorScheme = themeMode;
  }, [themeMode]);

  const handleThemeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    writeThemeCookie(mode);
  }, []);

  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Shell themeMode={themeMode} onThemeChange={handleThemeChange} />
    </BrowserRouter>
  );
}

function Shell({ themeMode, onThemeChange }: { themeMode: ThemeMode; onThemeChange: (mode: ThemeMode) => void }) {
  const location = useLocation();

  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-900"><div className="text-slate-400">Loading...</div></div>}>
        <Routes>
          <Route path="/" element={<HomePage themeMode={themeMode} onThemeChange={onThemeChange} />} />
          <Route path="/batch" element={<BatchPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
          <Route path="/crawl" element={<CrawlPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
          <Route path="/results" element={<ResultsPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
          <Route path="/results/all" element={<ResultsAllPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
          <Route path="/bedread" element={<Navigate to="/" replace />} />
          <Route path="/bedread/jobs" element={<Navigate to="/" replace />} />
          <Route path="/drive-sync" element={<DriveSyncPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
          <Route path="/drive-sync/history" element={<DriveSyncHistoryPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
          <Route path="/story-mgmt" element={<StoryMgmtPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      {location.pathname !== '/story-mgmt' && <FloatingNewCrawlButton />}
    </>
  );
}

export default App;
