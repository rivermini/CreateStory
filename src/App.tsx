import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { MobileNav, MobileHeader, MobileDrawer } from './components/MobileNav';
import { ToastContainer } from './components/Toast';

type ThemeMode = 'light' | 'dark';

const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));
const CrawlPage = lazy(() => import('./pages/CrawlPage').then(m => ({ default: m.CrawlPage })));
const ResultPage = lazy(() => import('./pages/ResultPage').then(m => ({ default: m.ResultPage })));
const CrawlHistory = lazy(() => import('./pages/CrawlHistoryPage'));
const BatchPage = lazy(() => import('./pages/BatchPage').then(m => ({ default: m.BatchPage })));
const BedReadPage = lazy(() => import('./pages/BedReadPage').then(m => ({ default: m.BedReadPage })));
const BedReadJobsPage = lazy(() => import('./pages/BedReadJobsPage').then(m => ({ default: m.default })));
const DriveSyncPage = lazy(() => import('./pages/DriveSyncPage').then(m => ({ default: m.DriveSyncPage })));
const DriveSyncHistoryPage = lazy(() => import('./pages/DriveSyncHistoryPage').then(m => ({ default: m.DriveSyncHistoryPage })));
const StoryMgmtPage = lazy(() => import('./pages/StoryMgmtPage').then(m => ({ default: m.StoryMgmtPage })));
const SupportedSitesPage = lazy(() => import('./pages/SupportedSitesPage').then(m => ({ default: m.SupportedSitesPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

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
  const isDark = themeMode === 'dark';
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <Sidebar themeMode={themeMode} onThemeChange={onThemeChange} />

      {/* Mobile Header */}
      <MobileHeader
        isDark={isDark}
      />

      {/* Mobile Bottom Navigation */}
      <MobileNav isDark={isDark} />

      {/* Mobile Drawer */}
      <MobileDrawer
        isOpen={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        isDark={isDark}
      />

      <div
        className={`min-h-screen transition-colors duration-300 ${
          isDark ? 'bg-slate-950' : 'bg-gray-50'
        }`}
      >
        <div className="lg:pl-64 pt-14 lg:pt-0">
          <Suspense fallback={
            <div className={`flex items-center justify-center h-screen ${isDark ? 'bg-slate-950 text-slate-400' : 'bg-gray-50 text-gray-500'}`}>
              Loading...
            </div>
          }>
            <Routes>
              <Route path="/" element={<HomePage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/batch" element={<BatchPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/crawl" element={<CrawlPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/results" element={<ResultPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/results/all" element={<CrawlHistory themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/bedread" element={<BedReadPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/bedread/jobs" element={<BedReadJobsPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/drive-sync" element={<DriveSyncPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/drive-sync/history" element={<DriveSyncHistoryPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/story-mgmt" element={<StoryMgmtPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/settings" element={<SettingsPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/supported-sites" element={<SupportedSitesPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>

      {/* Global Toast Notifications */}
      <ToastContainer />
    </>
  );
}

export default App;
