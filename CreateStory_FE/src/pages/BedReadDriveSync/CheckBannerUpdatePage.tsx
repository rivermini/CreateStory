import { useRef, useState } from 'react';
import {
  checkBannerUpdateAll,
  checkBannerUpdateUpdated,
  uploadBannerUpdate,
  type CheckAllResponse,
  type CheckUpdatedResponse,
} from '../../api/BedReadDriveSync';
import { BannerUpdateTabs } from '../../components/BedReadDriveSync/BannerUpdate/BannerUpdateTabs';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { LoadingAppIcon } from '../../components/BedReadDriveSync/DriveSync/SyncTabShared';
import { ServerModeBanner } from '../../components/Shared/ServerModeBanner';
import { showToast } from '../../components/Shared/Toast';
import { useDriveSyncConfig } from '../../hooks/useDriveSyncConfig';
import type { ThemeMode } from '../../types/theme';

interface CheckBannerUpdatePageProps {
  readonly themeMode: ThemeMode;
}

export function CheckBannerUpdatePage({ themeMode }: CheckBannerUpdatePageProps) {
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

  const [bannerNumber, setBannerNumber] = useState<string>('');
  const [savedBannerNumber, setSavedBannerNumber] = useState<string>('');
  const [bannerExtension, setBannerExtension] = useState<'jpg' | 'png'>('jpg');
  const [savedBannerExtension, setSavedBannerExtension] = useState<'jpg' | 'png'>('jpg');
  const [bannerEdited, setBannerEdited] = useState(false);

  const handleBannerNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    setBannerNumber(raw);
    setBannerEdited(raw !== savedBannerNumber);
  };

  const handleBannerExtensionChange = (ext: 'jpg' | 'png') => {
    setBannerExtension(ext);
    setBannerEdited(ext !== savedBannerExtension || bannerNumber !== savedBannerNumber);
  };

  const handleSaveBannerFilename = () => {
    setSavedBannerNumber(bannerNumber);
    setSavedBannerExtension(bannerExtension);
    setBannerEdited(false);
    const preview = bannerNumber ? `banner${bannerNumber}.${bannerExtension}` : `banner.${bannerExtension}`;
    showToast(`Banner filename saved: ${preview}`, 'success', 2000, 'top-center');
  };

  const savedBannerFilename = savedBannerNumber
    ? `banner${savedBannerNumber}.${savedBannerExtension}`
    : `banner.${savedBannerExtension}`;
  const bannerFilenameBase = savedBannerNumber ? `banner${savedBannerNumber}` : 'banner';
  const isBannerEdited = bannerEdited;
  const [checkAllData, setCheckAllData] = useState<CheckAllResponse | null>(null);
  const [checkAllLoading, setCheckAllLoading] = useState(false);
  const [checkAllError, setCheckAllError] = useState('');

  const [checkUpdatedData, setCheckUpdatedData] = useState<CheckUpdatedResponse | null>(null);
  const [checkUpdatedLoading, setCheckUpdatedLoading] = useState(false);
  const [checkUpdatedError, setCheckUpdatedError] = useState('');

  const [uploadResults, setUploadResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const uploadLocksRef = useRef<Set<string>>(new Set());
  const uploadResultVersionRef = useRef(0);

  const pageBackground = 'var(--cs-page)';
  const panelBackground = 'var(--cs-surface-elevated)';
  const panelBorder = 'var(--cs-border)';
  const pageText = 'var(--cs-text)';
  const secondaryText = 'var(--cs-text-soft)';
  const tertiaryText = 'var(--cs-text-faint)';

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
      const data = await checkBannerUpdateAll(savedBannerFilename);
      setCheckAllData(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to check banner updates.';
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
      const data = await checkBannerUpdateUpdated();
      setCheckUpdatedData(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load banner update history.';
      setCheckUpdatedError(message);
    } finally {
      setCheckUpdatedLoading(false);
    }
  };

  const handleUploadBanner = async (folderId: string, storyId: string) => {
    if (uploadLocksRef.current.has(folderId)) return;
    const resultVersion = uploadResultVersionRef.current;
    uploadLocksRef.current.add(folderId);
    setUploadingIds((prev) => new Set(prev).add(folderId));

    try {
      const result = await uploadBannerUpdate(folderId, storyId, savedBannerFilename);
      if (resultVersion === uploadResultVersionRef.current) {
        setUploadResults((prev) => new Map(prev).set(folderId, { success: result.success, message: result.message }));
      }
      if (result.success) {
        showToast(result.message || 'Banner update queued.', 'success', 2000, 'top-center');
      } else {
        showToast(`Banner update failed: ${result.message}`, 'error', 4000, 'top-center');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed';
      if (resultVersion === uploadResultVersionRef.current) {
        setUploadResults((prev) => new Map(prev).set(folderId, { success: false, message }));
      }
      showToast(`Banner update failed: ${message}`, 'error', 4000, 'top-center');
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
                  Banner update
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm" style={{ color: tertiaryText }}>Banner:</label>
                <span className="text-sm font-mono" style={{ color: tertiaryText }}>banner</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={bannerNumber}
                  onChange={handleBannerNumberChange}
                  className="w-16 rounded-md border px-3 py-1.5 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-sky-500"
                  style={{ 
                    background: isDark ? '#232323' : '#fff', 
                    borderColor: isBannerEdited ? '#f59e0b' : panelBorder, 
                    color: pageText 
                  }}
                />
                <div className="flex items-center rounded-md border overflow-hidden" style={{ borderColor: bannerExtension !== savedBannerExtension ? '#f59e0b' : panelBorder }}>
                  <button
                    type="button"
                    onClick={() => handleBannerExtensionChange('jpg')}
                    className="px-2.5 py-1.5 text-xs font-mono font-medium transition-colors"
                    style={{
                      background: bannerExtension === 'jpg' ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.12)') : 'transparent',
                      color: bannerExtension === 'jpg' ? (isDark ? '#93c5fd' : '#2563eb') : tertiaryText,
                    }}
                  >
                    .jpg
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBannerExtensionChange('png')}
                    className="px-2.5 py-1.5 text-xs font-mono font-medium transition-colors"
                    style={{
                      background: bannerExtension === 'png' ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.12)') : 'transparent',
                      color: bannerExtension === 'png' ? (isDark ? '#93c5fd' : '#2563eb') : tertiaryText,
                    }}
                  >
                    .png
                  </button>
                </div>
                {isBannerEdited ? (
                  <button
                    onClick={handleSaveBannerFilename}
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
            <BannerUpdateTabs
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
              onUploadBanner={handleUploadBanner}
              themeMode={themeMode}
              bannerFilename={bannerFilenameBase}
            />
          )}
        </main>
      </div>
    </div>
  );
}
