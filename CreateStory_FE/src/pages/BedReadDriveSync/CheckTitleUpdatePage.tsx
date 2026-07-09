import { useRef, useState } from 'react';
import {
  batchUpdateTitles,
  checkAllTitles,
  getTitleFolderDetail,
  updateChapterTitle,
  updateFolderTitles,
  type CheckAllTitleResponse,
  type TitleFolderEntry,
} from '../../api/BedReadDriveSync';
import { CheckTitleUpdateTabs } from '../../components/BedReadDriveSync/TitleUpdate/CheckTitleUpdateTabs';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { LoadingAppIcon } from '../../components/BedReadDriveSync/DriveSync/SyncTabShared';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';
import { showToast } from '../../components/Shared/Toast';
import { useDriveSyncConfig } from '../../hooks/useDriveSyncConfig';
import type { ThemeMode } from '../../types/theme';

interface CheckTitleUpdatePageProps {
  readonly themeMode: ThemeMode;
}

export function CheckTitleUpdatePage({ themeMode }: CheckTitleUpdatePageProps) {
  const isDark = themeMode === 'dark';

  const {
    config,
    configLoading,
    configError,
    configInvalid,
    tokenInvalid,
  } = useDriveSyncConfig({
    validateToken: false,
    enableEditing: false,
  });

  const [checkAllData, setCheckAllData] = useState<CheckAllTitleResponse | null>(null);
  const [checkAllLoading, setCheckAllLoading] = useState(false);
  const [checkAllError, setCheckAllError] = useState('');

  // On-demand per-folder chapter details, loaded when the user expands a folder.
  // Summary check-all does NOT include chapter lists, so we fetch them here.
  const [folderDetails, setFolderDetails] = useState<Map<string, TitleFolderEntry>>(new Map());
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const detailLocksRef = useRef<Set<string>>(new Set());

  const [updatingFolderIds, setUpdatingFolderIds] = useState<Set<string>>(new Set());
  const [chapterUpdateVersions, setChapterUpdateVersions] = useState<Map<string, number>>(new Map());
  const updateLocksRef = useRef<Set<string>>(new Set());
  const updateResultVersionRef = useRef(0);

  const pageBackground = 'var(--cs-page)';
  const panelBackground = 'var(--cs-surface-elevated)';
  const panelBorder = 'var(--cs-border)';
  const pageText = 'var(--cs-text)';
  const secondaryText = 'var(--cs-text-soft)';
  const tertiaryText = 'var(--cs-text-faint)';

  const handleRequestDetail = async (folderId: string) => {
    if (detailLocksRef.current.has(folderId)) return;
    // Already loaded — no need to refetch.
    if (folderDetails.has(folderId)) return;
    detailLocksRef.current.add(folderId);
    setLoadingDetailId(folderId);
    try {
      const detail = await getTitleFolderDetail(folderId);
      setFolderDetails((prev) => {
        const next = new Map(prev);
        next.set(folderId, detail);
        return next;
      });
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Failed to load chapter details.',
        'error',
        4000,
        'top-center'
      );
    } finally {
      detailLocksRef.current.delete(folderId);
      setLoadingDetailId((cur) => (cur === folderId ? null : cur));
    }
  };

  const handleCheckAll = async () => {
    setCheckAllData(null);
    setCheckAllLoading(true);
    setCheckAllError('');
    setFolderDetails(new Map());
    setLoadingDetailId(null);
    try {
      const data = await checkAllTitles();
      setCheckAllData(data);
    } catch (e) {
      setCheckAllError(e instanceof Error ? e.message : 'Failed to check title updates.');
    } finally {
      setCheckAllLoading(false);
    }
  };

  const handleChapterUpdate = async (folderId: string, storyId: string, chapterNumber: number) => {
    if (updateLocksRef.current.has(folderId)) return;
    const resultVersion = updateResultVersionRef.current;
    updateLocksRef.current.add(folderId);
    setUpdatingFolderIds((prev) => new Set(prev).add(folderId));

    try {
      const result = await updateChapterTitle(storyId, folderId, chapterNumber);
      if (resultVersion === updateResultVersionRef.current) {
        showToast(
          result.success ? (result.message || `Chapter ${chapterNumber} title update queued.`) : result.message,
          result.success ? 'success' : 'error',
          3000,
          'top-center'
        );
        if (result.success) {
          setChapterUpdateVersions((prev) => {
            const next = new Map(prev);
            next.set(folderId, (prev.get(folderId) ?? 0) + 1);
            return next;
          });
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Chapter update failed.', 'error', 4000, 'top-center');
    } finally {
      updateLocksRef.current.delete(folderId);
      setUpdatingFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  };

  const handleFolderUpdate = async (entry: TitleFolderEntry) => {
    if (!entry.story_id || updateLocksRef.current.has(entry.folder_id)) return;
    const resultVersion = updateResultVersionRef.current;
    updateLocksRef.current.add(entry.folder_id);
    setUpdatingFolderIds((prev) => new Set(prev).add(entry.folder_id));

    try {
      const result = await updateFolderTitles(entry.story_id, entry.folder_id);
      if (resultVersion === updateResultVersionRef.current) {
        const msg = result.stop_reason || `Title update queued for ${entry.story_title || entry.folder_name}.`;
        showToast(msg, result.failed_count > 0 ? 'warning' : 'success', 4000, 'top-center');
        if (result.success_count > 0) {
          updateResultVersionRef.current += 1;
          setChapterUpdateVersions((prev) => {
            const next = new Map(prev);
            next.set(entry.folder_id, (prev.get(entry.folder_id) ?? 0) + 1);
            return next;
          });
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Folder update failed.', 'error', 4000, 'top-center');
    } finally {
      updateLocksRef.current.delete(entry.folder_id);
      setUpdatingFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.folder_id);
        return next;
      });
    }
  };

  const handleBatchUpdateAll = async () => {
    const canUpdateIds = checkAllData?.can_update.map((f) => f.folder_id) ?? [];
    if (canUpdateIds.length === 0) {
      showToast('No folders to update. Run Check Title Update first.', 'info', 3000, 'top-center');
      return;
    }
    const resultVersion = updateResultVersionRef.current;

    try {
      const result = await batchUpdateTitles(canUpdateIds, 2);
      if (resultVersion === updateResultVersionRef.current) {
        let totalFailed = 0;
        for (const folder of result.results) {
          totalFailed += folder.failed_count;
        }
        showToast(
          totalFailed === 0
            ? `Queued ${result.results.length} title update job${result.results.length === 1 ? '' : 's'}.`
            : `Queued title updates with ${totalFailed} folder${totalFailed === 1 ? '' : 's'} skipped.`,
          totalFailed > 0 ? 'warning' : 'success',
          5000,
          'top-center'
        );
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Batch update failed.', 'error', 4000, 'top-center');
    }
  };

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <main className="space-y-4">
          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Sync
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                Chapter title update
              </h1>
              <p className="text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                Compare and update chapter titles between Drive `DONE_`/`EXTENDED_` folders and the main server.
              </p>
            </div>
          </section>

          {config && !configLoading && (
            <div
              className="flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-3"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ background: '#10b981' }} />
                <span className="text-sm font-medium" style={{ color: pageText }}>
                  Ready
                </span>
              </div>
              <div className="hidden h-5 sm:block" style={{ width: '1px', background: panelBorder }} />
              <div className="flex min-w-0 items-center gap-2">
                <Icon icon={appIcons.folder} className="h-4 w-4 shrink-0" style={{ color: tertiaryText }} />
                <span className="truncate text-xs sm:text-sm" style={{ color: tertiaryText }}>
                  {config.folder_id}
                </span>
              </div>
            </div>
          )}

          {configLoading && (
            <div
              className="flex items-center justify-center gap-3 rounded-2xl border p-8"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <LoadingAppIcon isDark={isDark} color={secondaryText} />
              <span className="text-sm" style={{ color: secondaryText }}>
                Loading Drive Sync...
              </span>
            </div>
          )}

          {configError && (
            <div
              className="rounded-xl border p-4 text-sm"
              style={{
                background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
                borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
                color: isDark ? '#f87171' : '#dc2626',
              }}
            >
              {configError}
            </div>
          )}

          <ServerModeBanner
            serverUrl={config?.main_be_api_base_url ?? null}
            isDark={isDark}
            isConfigLoading={configLoading}
            isConfigValid={
              tokenInvalid
                ? undefined
                : configInvalid
                  ? false
                  : configLoading
                    ? undefined
                    : Boolean(config?.main_be_api_base_url && config?.main_be_user_id)
            }
            tokenInvalid={tokenInvalid}
          />

          {config && !configLoading && (
            <CheckTitleUpdateTabs
              checkAllData={checkAllData}
              checkAllLoading={checkAllLoading}
              checkAllError={checkAllError}
              folderDetails={folderDetails}
              loadingDetailId={loadingDetailId}
              updatingFolderIds={updatingFolderIds}
              chapterUpdateVersions={chapterUpdateVersions}
              onCheckAll={handleCheckAll}
              onRequestDetail={handleRequestDetail}
              onChapterUpdate={handleChapterUpdate}
              onFolderUpdate={handleFolderUpdate}
              onBatchUpdateAll={handleBatchUpdateAll}
              themeMode={themeMode}
            />
          )}
        </main>
      </div>
    </div>
  );
}
