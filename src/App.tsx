import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { MobileSidebar } from './components/MobileSidebar';
import { ToastContainer } from './components/Toast';
import { getAutoAudioStatus, type AutoAudioSession } from './api/client';

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
const ChapterContentUpdatePage = lazy(() => import('./pages/ChapterContentUpdatePage').then(m => ({ default: m.ChapterContentUpdatePage })));
const AutoAudioPage = lazy(() => import('./pages/AutoAudioPage').then(m => ({ default: m.AutoAudioPage })));
const AutoAudioHistoryPage = lazy(() => import('./pages/AutoAudioHistoryPage').then(m => ({ default: m.AutoAudioHistoryPage })));
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

const SESSION_STORAGE_KEY = 'autoaudio_last_session';

function Shell({ themeMode, onThemeChange }: { themeMode: ThemeMode; onThemeChange: (mode: ThemeMode) => void }) {
  const isDark = themeMode === 'dark';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [autoAudioSession, setAutoAudioSession] = useState<AutoAudioSession | null>(() => {
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const loadAutoAudioStatus = useCallback(async () => {
    try {
      const data = await getAutoAudioStatus({ compact: true });
      if (data) {
        setAutoAudioSession(data);
        if (data.status === 'completed' || data.status === 'error' || data.status === 'stopped') {
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
        } else {
          localStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } else if (data === null) {
        const stored = localStorage.getItem(SESSION_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const isDone = parsed.status === 'completed' || parsed.status === 'error' || parsed.status === 'stopped';
          if (isDone) {
            setAutoAudioSession(parsed);
          } else {
            localStorage.removeItem(SESSION_STORAGE_KEY);
            setAutoAudioSession(null);
          }
        } else {
          setAutoAudioSession(null);
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadAutoAudioStatus();
    const interval = setInterval(loadAutoAudioStatus, 5000);
    return () => clearInterval(interval);
  }, [loadAutoAudioStatus]);

  return (
    <>
      <Sidebar
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        autoAudioSession={autoAudioSession}
      />

      <MobileSidebar
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        isOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        autoAudioSession={autoAudioSession}
      />

      {/* Mobile header */}
      <header className={`lg:hidden fixed top-0 left-0 right-0 z-30 safe-area-top ${
        isDark
          ? 'bg-slate-950/95 border-b border-slate-800/80 backdrop-blur-xl'
          : 'bg-gray-50/95 border-b border-gray-200/80 backdrop-blur-xl shadow-sm'
      }`}>
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className={`p-2 rounded-lg transition-colors ${
              isDark
                ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/80'
            }`}
            title="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className={`text-base font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            Novel Crawler
          </h1>
        </div>
      </header>

      <div
        className={`min-h-screen transition-colors duration-300 ${
          isDark ? 'bg-slate-950' : 'bg-gray-50'
        }`}
      >
        <div className={`pt-14 lg:pt-0 ${sidebarCollapsed ? 'pl-[72px] lg:pl-[72px]' : 'pl-0 lg:pl-[248px]'} min-h-screen transition-all duration-300`}>
          <Suspense fallback={
            <div className={`flex items-center justify-center h-screen ${isDark ? 'bg-slate-950 text-slate-400' : 'bg-gray-50 text-gray-500'}`}>
              Loading...
            </div>
          }>
            <Routes>
              <Route path="/" element={<HomePage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/batch" element={<BatchPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/crawl" element={<CrawlPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/results" element={<ResultPage themeMode={themeMode} />} />
              <Route path="/results/all" element={<CrawlHistory themeMode={themeMode} />} />
              <Route path="/bedread" element={<BedReadPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/bedread/jobs" element={<BedReadJobsPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/drive-sync" element={<DriveSyncPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/drive-sync/content-update" element={<ChapterContentUpdatePage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/drive-sync/history" element={<DriveSyncHistoryPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/auto-audio" element={<AutoAudioPage themeMode={themeMode} onThemeChange={onThemeChange} autoAudioSession={autoAudioSession} onAutoAudioSessionUpdate={setAutoAudioSession} />} />
              <Route path="/auto-audio/history" element={<AutoAudioHistoryPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
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
