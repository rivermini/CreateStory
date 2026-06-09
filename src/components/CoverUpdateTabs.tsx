import { useState } from 'react';
import { type CheckAllResponse, type CheckUpdatedResponse } from '../api/client';
import type { ThemeMode } from '../types/theme';
import { CheckAllTab } from './CheckAllTab';
import { CheckUpdatedCoverTab } from './CheckUpdatedCoverTab';

export type CoverUpdateTab = 'check-all' | 'check-updated';

export interface CoverUpdateTabsProps {
  checkAllData: CheckAllResponse | null;
  checkAllLoading: boolean;
  checkAllError: string;
  checkUpdatedData: CheckUpdatedResponse | null;
  checkUpdatedLoading: boolean;
  checkUpdatedError: string;
  uploadResults: Map<string, { success: boolean; message: string }>;
  uploadingIds: Set<string>;
  onCheckAll: () => void;
  onCheckUpdated: () => void;
  onUploadCover: (folderId: string, storyId: string) => Promise<void>;
  themeMode: ThemeMode;
}

export function CoverUpdateTabs({
  checkAllData,
  checkAllLoading,
  checkAllError,
  checkUpdatedData,
  checkUpdatedLoading,
  checkUpdatedError,
  uploadResults,
  uploadingIds,
  onCheckAll,
  onCheckUpdated,
  onUploadCover,
  themeMode,
}: CoverUpdateTabsProps) {
  const isDark = themeMode === 'dark';
  const [activeTab, setActiveTab] = useState<CoverUpdateTab>('check-all');

  const canUpdateCount = checkAllData?.can_update.length ?? 0;
  const historyCount = checkUpdatedData?.entries.length ?? 0;

  return (
    <div className="lg-glass-card overflow-hidden" style={{ borderRadius: 24 }}>
      <div className={`flex items-stretch ${isDark ? 'lg-border-divider' : 'lg-border-divider'}`}>
        <button
          onClick={() => setActiveTab('check-all')}
          className="flex-1 flex items-center justify-center gap-2.5 px-4 sm:px-6 py-4 text-sm font-semibold transition-all duration-200 relative"
          style={{
            color: activeTab === 'check-all' ? (isDark ? '#818cf8' : '#6366f1') : (isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)'),
            background: activeTab === 'check-all' ? (isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)') : 'transparent',
          }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Check Cover Update</span>
          {canUpdateCount > 0 ? (
            <span className="lg-chip lg-chip-blue" style={activeTab !== 'check-all' ? (isDark ? { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)' } : { background: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.1)', color: 'rgba(0,0,0,0.35)' }) : undefined}>
              {canUpdateCount}
            </span>
          ) : checkAllData ? (
            <span className="lg-chip" style={isDark ? { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' } : { background: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.35)' }}>
              0
            </span>
          ) : null}
          {activeTab === 'check-all' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }} />
          )}
        </button>

        <div className="w-px" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }} />

        <button
          onClick={() => setActiveTab('check-updated')}
          className="flex-1 flex items-center justify-center gap-2.5 px-4 sm:px-6 py-4 text-sm font-semibold transition-all duration-200 relative"
          style={{
            color: activeTab === 'check-updated' ? (isDark ? '#818cf8' : '#6366f1') : (isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)'),
            background: activeTab === 'check-updated' ? (isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)') : 'transparent',
          }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Check Updated Cover</span>
          {historyCount > 0 ? (
            <span className="lg-chip" style={activeTab !== 'check-updated' ? (isDark ? { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)' } : { background: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.1)', color: 'rgba(0,0,0,0.35)' }) : undefined}>
              {historyCount}
            </span>
          ) : checkUpdatedData ? (
            <span className="lg-chip" style={isDark ? { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' } : { background: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.35)' }}>
              0
            </span>
          ) : null}
          {activeTab === 'check-updated' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }} />
          )}
        </button>
      </div>

      <div className="h-[calc(100vh-280px)] sm:min-h-[500px] sm:max-h-[calc(100vh-280px)] overflow-y-auto">
        {activeTab === 'check-all' && (
          <CheckAllTab
            data={checkAllData}
            loading={checkAllLoading}
            error={checkAllError}
            uploadResults={uploadResults}
            uploadingIds={uploadingIds}
            onCheck={onCheckAll}
            onUploadCover={onUploadCover}
            themeMode={themeMode}
          />
        )}
        {activeTab === 'check-updated' && (
          <CheckUpdatedCoverTab
            data={checkUpdatedData}
            loading={checkUpdatedLoading}
            error={checkUpdatedError}
            uploadResults={uploadResults}
            uploadingIds={uploadingIds}
            onCheck={onCheckUpdated}
            onUploadCover={onUploadCover}
            themeMode={themeMode}
          />
        )}
      </div>
    </div>
  );
}
