import { useState } from 'react';
import { type CheckAllIntroResponse, type CheckUpdatedIntroResponse } from '../../../api';
import { CheckAllIntroTab } from './CheckAllIntroTab';
import { CheckUpdatedIntroTab } from './CheckUpdatedIntroTab';
import type { ThemeMode } from '../../../types/theme';

export type IntroUpdateTab = 'check-all-intro' | 'check-updated-intro';

export interface IntroUpdateTabsProps {
  checkAllData: CheckAllIntroResponse | null;
  checkAllLoading: boolean;
  checkAllError: string;
  checkUpdatedData: CheckUpdatedIntroResponse | null;
  checkUpdatedLoading: boolean;
  checkUpdatedError: string;
  uploadResults: Map<string, { success: boolean; message: string }>;
  uploadingIds: Set<string>;
  onCheckAll: () => void;
  onCheckUpdated: () => void;
  onUploadIntro: (folderId: string, storyId: string) => Promise<void>;
  themeMode: ThemeMode;
  introFilename?: string;
}

export function IntroUpdateTabs({
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
  onUploadIntro,
  themeMode,
  introFilename = 'intro1',
}: Readonly<IntroUpdateTabsProps>) {
  const isDark = themeMode === 'dark';
  const [activeTab, setActiveTab] = useState<IntroUpdateTab>('check-all-intro');

  const canUpdateCount = checkAllData?.can_update.length ?? 0;
  const historyCount = checkUpdatedData?.entries.length ?? 0;
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ background: panelBackground, borderColor: panelBorder }}
    >
      <div className="flex">
        <button
          onClick={() => setActiveTab('check-all-intro')}
          className="relative flex flex-1 items-center justify-center gap-2.5 px-4 py-4 text-sm font-semibold transition-colors"
          style={{
            color:
              activeTab === 'check-all-intro'
                ? isDark
                  ? '#34d399'
                  : '#047857'
                : isDark
                  ? 'rgba(255,255,255,0.5)'
                  : 'rgba(55,53,47,0.55)',
            background:
              activeTab === 'check-all-intro'
                ? isDark
                  ? 'rgba(16,185,129,0.08)'
                  : 'rgba(16,185,129,0.06)'
                : 'transparent',
          }}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Check Intro Update</span>
          {canUpdateCount > 0 ? (
            <span
              className="rounded-md border px-2 py-0.5 text-xs font-medium"
              style={{
                background:
                  activeTab === 'check-all-intro'
                    ? mutedSurface
                    : isDark
                      ? 'rgba(16,185,129,0.14)'
                      : 'rgba(16,185,129,0.12)',
                borderColor:
                  activeTab === 'check-all-intro'
                    ? panelBorder
                    : isDark
                      ? 'rgba(16,185,129,0.3)'
                      : 'rgba(16,185,129,0.24)',
                color:
                  activeTab === 'check-all-intro'
                    ? isDark
                      ? 'rgba(255,255,255,0.5)'
                      : 'rgba(55,53,47,0.55)'
                    : isDark
                      ? '#34d399'
                      : '#047857',
              }}
            >
              {canUpdateCount}
            </span>
          ) : checkAllData ? (
            <span
              className="rounded-md border px-2 py-0.5 text-xs"
              style={{ background: mutedSurface, borderColor: panelBorder, color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }}
            >
              0
            </span>
          ) : null}
          {activeTab === 'check-all-intro' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
          )}
        </button>

        <div style={{ width: '1px', background: panelBorder }} />

        <button
          onClick={() => setActiveTab('check-updated-intro')}
          className="relative flex flex-1 items-center justify-center gap-2.5 px-4 py-4 text-sm font-semibold transition-colors"
          style={{
            color:
              activeTab === 'check-updated-intro'
                ? isDark
                  ? '#34d399'
                  : '#047857'
                : isDark
                  ? 'rgba(255,255,255,0.5)'
                  : 'rgba(55,53,47,0.55)',
            background:
              activeTab === 'check-updated-intro'
                ? isDark
                  ? 'rgba(16,185,129,0.08)'
                  : 'rgba(16,185,129,0.06)'
                : 'transparent',
          }}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Check Updated Intro</span>
          {historyCount > 0 ? (
            <span
              className="rounded-md border px-2 py-0.5 text-xs font-medium"
              style={{
                background:
                  activeTab === 'check-updated-intro'
                    ? mutedSurface
                    : isDark
                      ? 'rgba(16,185,129,0.14)'
                      : 'rgba(16,185,129,0.12)',
                borderColor:
                  activeTab === 'check-updated-intro'
                    ? panelBorder
                    : isDark
                      ? 'rgba(16,185,129,0.3)'
                      : 'rgba(16,185,129,0.24)',
                color:
                  activeTab === 'check-updated-intro'
                    ? isDark
                      ? 'rgba(255,255,255,0.5)'
                      : 'rgba(55,53,47,0.55)'
                    : isDark
                      ? '#34d399'
                      : '#047857',
              }}
            >
              {historyCount}
            </span>
          ) : checkUpdatedData ? (
            <span
              className="rounded-md border px-2 py-0.5 text-xs"
              style={{ background: mutedSurface, borderColor: panelBorder, color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }}
            >
              0
            </span>
          ) : null}
          {activeTab === 'check-updated-intro' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
          )}
        </button>
      </div>

      <div className="h-[calc(100vh-280px)] overflow-y-auto sm:min-h-[500px] sm:max-h-[calc(100vh-280px)]">
        {activeTab === 'check-all-intro' && (
          <CheckAllIntroTab
            data={checkAllData}
            loading={checkAllLoading}
            error={checkAllError}
            uploadResults={uploadResults}
            uploadingIds={uploadingIds}
            onCheck={onCheckAll}
            onUploadIntro={onUploadIntro}
            themeMode={themeMode}
            introFilename={introFilename}
          />
        )}
        {activeTab === 'check-updated-intro' && (
          <CheckUpdatedIntroTab
            data={checkUpdatedData}
            loading={checkUpdatedLoading}
            error={checkUpdatedError}
            uploadResults={uploadResults}
            uploadingIds={uploadingIds}
            onCheck={onCheckUpdated}
            onUploadIntro={onUploadIntro}
            themeMode={themeMode}
            introFilename={introFilename}
          />
        )}
      </div>
    </div>
  );
}
