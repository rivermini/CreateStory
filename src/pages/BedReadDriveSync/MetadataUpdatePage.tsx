import { useRef, useState } from 'react';
import {
  checkMetadataUpdateAll,
  updateMetadata,
  type MetadataCheckAllResponse,
} from '../../api/BedReadDriveSync';
import { MetadataUpdateTabs } from '../../components/BedReadDriveSync/MetadataUpdate/MetadataUpdateTabs';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';
import { showToast } from '../../components/Shared/Toast';
import { useDriveSyncConfig } from '../../hooks/useDriveSyncConfig';
import type { ThemeMode } from '../../types/theme';
import type { MetadataFieldDifference } from '../../api/types';

interface MetadataUpdatePageProps {
  readonly themeMode: ThemeMode;
}

export function MetadataUpdatePage({ themeMode }: MetadataUpdatePageProps) {
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

  const [checkAllData, setCheckAllData] = useState<MetadataCheckAllResponse | null>(null);
  const [checkAllLoading, setCheckAllLoading] = useState(false);
  const [checkAllError, setCheckAllError] = useState('');

  const [updateResults, setUpdateResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const updateLocksRef = useRef<Set<string>>(new Set());
  const updateResultVersionRef = useRef(0);

  const pageBackground = 'var(--cs-page)';
  const panelBackground = 'var(--cs-surface-elevated)';
  const panelBorder = 'var(--cs-border)';
  const pageText = 'var(--cs-text)';
  const secondaryText = 'var(--cs-text-soft)';
  const tertiaryText = 'var(--cs-text-faint)';

  const resetUpdateUiState = () => {
    updateResultVersionRef.current += 1;
    setUpdateResults(new Map());
    setUpdatingIds(new Set());
  };

  const handleCheckAll = async () => {
    setCheckAllData(null);
    setCheckAllLoading(true);
    setCheckAllError('');
    resetUpdateUiState();
    try {
      const data = await checkMetadataUpdateAll();
      setCheckAllData(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to check metadata updates.';
      setCheckAllError(message);
    } finally {
      setCheckAllLoading(false);
    }
  };

  const handleUpdateMetadata = async (folderId: string, storyId: string, differences: MetadataFieldDifference[]) => {
    if (updateLocksRef.current.has(folderId)) return;
    const resultVersion = updateResultVersionRef.current;
    updateLocksRef.current.add(folderId);
    setUpdatingIds((prev) => new Set(prev).add(folderId));

    try {
      const result = await updateMetadata(folderId, storyId, differences);
      if (resultVersion === updateResultVersionRef.current) {
        setUpdateResults((prev) => new Map(prev).set(folderId, { success: result.success, message: result.message }));
      }
      if (result.success) {
        showToast('Metadata updated successfully.', 'success', 2000, 'top-center');
      } else {
        showToast(`Metadata update failed: ${result.message}`, 'error', 4000, 'top-center');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Update failed';
      if (resultVersion === updateResultVersionRef.current) {
        setUpdateResults((prev) => new Map(prev).set(folderId, { success: false, message: message }));
      }
      showToast(`Metadata update failed: ${message}`, 'error', 4000, 'top-center');
    } finally {
      updateLocksRef.current.delete(folderId);
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
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
                Metadata update
              </h1>
              <p className="text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                Compare and update story metadata from Drive `DONE_` and `EXTENDED_` folders.
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
              <Icon icon={appIcons.spinner} className="h-6 w-6 animate-spin" style={{ color: secondaryText }} />
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
            <MetadataUpdateTabs
              checkAllData={checkAllData}
              checkAllLoading={checkAllLoading}
              checkAllError={checkAllError}
              updateResults={updateResults}
              updatingIds={updatingIds}
              onCheckAll={handleCheckAll}
              onUpdateMetadata={handleUpdateMetadata}
              themeMode={themeMode}
            />
          )}
        </main>
      </div>
    </div>
  );
}
