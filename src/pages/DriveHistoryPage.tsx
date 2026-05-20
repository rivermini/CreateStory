import { useCallback, useEffect, useState } from 'react';
import {
  getHistory,
  deleteHistoryEntries,
  type HistoryEntry,
} from '../api/client';
import Header from '../components/Header';
import { ActionHistoryPanel } from '../components/ActionHistoryPanel';
import { type ThemeMode } from '../components/ThemeToggle';

interface DriveHistoryPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function DriveHistoryPage({ themeMode, onThemeChange }: DriveHistoryPageProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const loadHistoryFromBE = useCallback(async () => {
    try {
      const data = await getHistory(200, 0);
      setHistory(data.entries);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    loadHistoryFromBE();
  }, [loadHistoryFromBE]);

  const handleDeleteHistory = useCallback(async (ids: string[]) => {
    try {
      await deleteHistoryEntries(ids);
      await loadHistoryFromBE();
    } catch {
      setHistory(prev => prev.filter(e => !ids.includes(e.id)));
    }
  }, [loadHistoryFromBE]);

  const handleClearAllHistory = useCallback(async () => {
    try {
      await deleteHistoryEntries([]);
      await loadHistoryFromBE();
    } catch {
      setHistory([]);
    }
  }, [loadHistoryFromBE]);

  const handleRetry = useCallback((_entry: HistoryEntry) => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <Header
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        title="Drive Sync — History"
        subtitle="View past Drive Sync actions"
      />

      <main className="w-full px-4 sm:px-6 py-6 sm:py-8 flex flex-col flex-1 max-w-5xl mx-auto">
        <ActionHistoryPanel
          entries={history}
          onDelete={handleDeleteHistory}
          onClearAll={handleClearAllHistory}
          onRetry={handleRetry}
        />
      </main>
    </div>
  );
}
