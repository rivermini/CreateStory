import {
  type CheckAllTitleResponse,
  type TitleFolderEntry,
} from '../../../api';
import { CheckTitleUpdateTabContent } from './CheckTitleUpdateTabContent';
import type { ThemeMode } from '../../../types/theme';

export interface CheckTitleUpdateTabsProps {
  checkAllData: CheckAllTitleResponse | null;
  checkAllLoading: boolean;
  checkAllError: string;
  folderDetails: Map<string, TitleFolderEntry>;
  loadingDetailId: string | null;
  updatingFolderIds: Set<string>;
  chapterUpdateVersions: Map<string, number>;
  onCheckAll: () => void;
  onRequestDetail: (folderId: string) => void;
  onChapterUpdate: (folderId: string, storyId: string, chapterNumber: number) => void;
  onFolderUpdate: (entry: TitleFolderEntry) => void;
  onBatchUpdateAll: () => void;
  themeMode: ThemeMode;
}

export function CheckTitleUpdateTabs({
  checkAllData,
  checkAllLoading,
  checkAllError,
  folderDetails,
  loadingDetailId,
  updatingFolderIds,
  chapterUpdateVersions,
  onCheckAll,
  onRequestDetail,
  onChapterUpdate,
  onFolderUpdate,
  onBatchUpdateAll,
  themeMode,
}: Readonly<CheckTitleUpdateTabsProps>) {
  const isDark = themeMode === 'dark';
  const canUpdateCount = checkAllData?.can_update.length ?? 0;
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
          className="relative flex flex-1 items-center justify-center gap-2.5 px-4 py-4 text-sm font-semibold transition-colors"
          style={{
            color: isDark ? '#34d399' : '#047857',
            background: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)',
          }}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
          <span>Check Title Update</span>
          {canUpdateCount > 0 ? (
            <span
              className="rounded-md border px-2 py-0.5 text-xs font-medium"
              style={{
                background: mutedSurface,
                borderColor: panelBorder,
                color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)',
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
          <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
        </button>
      </div>

      <div className="h-[calc(100vh-280px)] overflow-y-auto sm:min-h-[500px] sm:max-h-[calc(100vh-280px)]">
        <CheckTitleUpdateTabContent
          data={checkAllData}
          loading={checkAllLoading}
          error={checkAllError}
          folderDetails={folderDetails}
          loadingDetailId={loadingDetailId}
          updatingFolderIds={updatingFolderIds}
          chapterUpdateVersions={chapterUpdateVersions}
          onCheckAll={onCheckAll}
          onRequestDetail={onRequestDetail}
          onChapterUpdate={onChapterUpdate}
          onFolderUpdate={onFolderUpdate}
          onBatchUpdateAll={onBatchUpdateAll}
          themeMode={themeMode}
        />
      </div>
    </div>
  );
}
