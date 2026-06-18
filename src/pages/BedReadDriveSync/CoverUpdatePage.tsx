import { useRef, useState } from 'react';
import {
  checkCoverUpdateAll,
  checkCoverUpdateUpdated,
  uploadCoverUpdate,
  type CheckAllResponse,
  type CheckUpdatedResponse,
} from '../../api/BedReadDriveSync';
import { CoverUpdateTabs } from '../../components/BedReadDriveSync/CoverUpdate/CoverUpdateTabs';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';
import { showToast } from '../../components/Shared/Toast';
import { useDriveSyncConfig } from '../../hooks/useDriveSyncConfig';
import type { ThemeMode } from '../../types/theme';

interface CoverUpdatePageProps {
  readonly themeMode: ThemeMode;
}

export function CoverUpdatePage({ themeMode }: CoverUpdatePageProps) {
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

  const [checkAllData, setCheckAllData] = useState<CheckAllResponse | null>(null);
  const [checkAllLoading, setCheckAllLoading] = useState(false);
  const [checkAllError, setCheckAllError] = useState('');

  const [coverNumber, setCoverNumber] = useState('1');
  const [savedCoverNumber, setSavedCoverNumber] = useState('1');
  const [coverEdited, setCoverEdited] = useState(false);

  const handleCoverNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    setCoverNumber(raw || '1');
    setCoverEdited(raw !== savedCoverNumber);
  };

  const handleSaveCoverFilename = () => {
    setSavedCoverNumber(coverNumber);
    setCoverEdited(false);
    showToast(`Cover filename saved: cover${coverNumber}.jpg`, 'success', 2000, 'top-center');
  };

  const savedCoverFilename = `cover${savedCoverNumber}.jpg`;
  const coverFilenameBase = savedCoverFilename.replace(/\.[^/.]+$/, '');

  const [checkUpdatedData, setCheckUpdatedData] = useState<CheckUpdatedResponse | null>(null);
  const [checkUpdatedLoading, setCheckUpdatedLoading] = useState(false);
  const [checkUpdatedError, setCheckUpdatedError] = useState('');

  const [uploadResults, setUploadResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const uploadLocksRef = useRef<Set<string>>(new Set());
  const uploadResultVersionRef = useRef(0);

  const pageBackground = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';

  const resetUploadUiState = () => {
    uploadResultVersionRef.current += 1;
    setUploadResults(new Map());
    setUploadingIds(new Set());
  };

  const handleCheckAll = async () => {
    setCheckAllData(null);
    setCheckAllLoading(true);
    setCheckAllError('');
    resetUploadUiState();
    try {
      const data = await checkCoverUpdateAll(savedCoverFilename);
      setCheckAllData(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to check cover updates.';
      setCheckAllError(message);
    } finally {
      setCheckAllLoading(false);
    }
  };

  const handleCheckUpdated = async () => {
    setCheckUpdatedData(null);
    setCheckUpdatedLoading(true);
    setCheckUpdatedError('');
    resetUploadUiState();
    try {
      const data = await checkCoverUpdateUpdated();
      setCheckUpdatedData(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load cover update history.';
      setCheckUpdatedError(message);
    } finally {
      setCheckUpdatedLoading(false);
    }
  };

  const handleUploadCover = async (folderId: string, storyId: string) => {
    if (uploadLocksRef.current.has(folderId)) return;
    const resultVersion = uploadResultVersionRef.current;
    uploadLocksRef.current.add(folderId);
    setUploadingIds((prev) => new Set(prev).add(folderId));

    try {
      const result = await uploadCoverUpdate(folderId, storyId, savedCoverFilename);
      if (resultVersion === uploadResultVersionRef.current) {
        setUploadResults((prev) => new Map(prev).set(folderId, { success: result.success, message: result.message }));
      }
      if (result.success) {
        showToast('Cover updated successfully.', 'success', 2000, 'top-center');
      } else {
        showToast(`Cover update failed: ${result.message}`, 'error', 4000, 'top-center');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed';
      if (resultVersion === uploadResultVersionRef.current) {
        setUploadResults((prev) => new Map(prev).set(folderId, { success: false, message }));
      }
      showToast(`Cover update failed: ${message}`, 'error', 4000, 'top-center');
    } finally {
      uploadLocksRef.current.delete(folderId);
      setUploadingIds((prev) => {
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
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 space-y-2 min-w-[200px]">
                <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                  Sync
                </div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                  Cover update
                </h1>
                <p className="text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                  Update story covers from Drive `DONE_` and `EXTENDED_` folders.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm" style={{ color: tertiaryText }}>Cover:</label>
                <span className="text-sm font-mono" style={{ color: tertiaryText }}>cover</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={coverNumber}
                  onChange={handleCoverNumberChange}
                  placeholder="1"
                  className="w-16 rounded-md border px-3 py-1.5 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-sky-500"
                  style={{ 
                    background: isDark ? '#232323' : '#fff', 
                    borderColor: coverEdited ? '#f59e0b' : panelBorder, 
                    color: pageText 
                  }}
                />
                <span className="text-sm font-mono" style={{ color: tertiaryText }}>.jpg</span>
                {coverEdited ? (
                  <button
                    onClick={handleSaveCoverFilename}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
                    style={{ background: '#f59e0b', borderColor: '#f59e0b', color: '#fff' }}
                  >
                    <Icon icon={appIcons.save} className="h-4 w-4" />
                    Save
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium" style={{ background: 'rgba(52,211,153,0.15)', borderColor: 'rgba(52,211,153,0.3)', color: isDark ? '#34d399' : '#059669' }}>
                    <Icon icon={appIcons.check} className="h-4 w-4" />
                    Saved
                  </span>
                )}
              </div>
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
            <CoverUpdateTabs
              checkAllData={checkAllData}
              checkAllLoading={checkAllLoading}
              checkAllError={checkAllError}
              checkUpdatedData={checkUpdatedData}
              checkUpdatedLoading={checkUpdatedLoading}
              checkUpdatedError={checkUpdatedError}
              uploadResults={uploadResults}
              uploadingIds={uploadingIds}
              onCheckAll={handleCheckAll}
              onCheckUpdated={handleCheckUpdated}
              onUploadCover={handleUploadCover}
              themeMode={themeMode}
              coverFilename={coverFilenameBase}
            />
          )}
        </main>
      </div>
    </div>
  );
}
