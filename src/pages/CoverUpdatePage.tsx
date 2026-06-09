import { useEffect, useState, useRef } from 'react';
import {
  getDriveSyncConfig,
  initDriveSyncConfig,
  checkCoverUpdateAll,
  checkCoverUpdateUpdated,
  uploadCoverUpdate,
  FIXED_JSON_PREFIX,
  type DriveSyncConfig,
  type CheckAllResponse,
  type CheckUpdatedResponse,
} from '../api/client';
import type { ThemeMode } from '../types/theme';
import { CoverUpdateTabs } from '../components/CoverUpdateTabs';
import { ConfigModal, type ConfigFormData } from '../components/ConfigModal';
import { Icon, appIcons } from '../components/Icon';
import { ServerModeBanner } from '../components/ServerModeBanner';
import { showToast } from '../components/Toast';

interface CoverUpdatePageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function CoverUpdatePage({ themeMode }: CoverUpdatePageProps) {
  const isDark = themeMode === 'dark';

  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [configInvalid, setConfigInvalid] = useState(false);
  const [tokenInvalid] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [isInitialSetup, setIsInitialSetup] = useState(false);
  const [credentialFileExists, setCredentialFileExists] = useState(true);

  const [configForm, setConfigForm] = useState<ConfigFormData>({
    folder_id: '',
    service_account_json_name: 'google-service-account.json',
    main_be_api_base_url: '',
    main_be_bearer_token: '',
    main_be_user_id: '',
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingConfigError, setSavingConfigError] = useState('');

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

  const resetUploadUiState = () => {
    uploadResultVersionRef.current += 1;
    setUploadResults(new Map());
    setUploadingIds(new Set());
  };

  useEffect(() => {
    async function loadConfig() {
      setConfigLoading(true);
      try {
        const cfg = await getDriveSyncConfig();
        setConfig(cfg);
        if (cfg) {
          const fullCfg = cfg as DriveSyncConfig & { service_account_json_path?: string };
          const jsonName = fullCfg.service_account_json_path
            ? fullCfg.service_account_json_path.replace(FIXED_JSON_PREFIX, '')
            : 'google-service-account.json';
          setConfigForm(f => ({
            ...f,
            folder_id: cfg.folder_id,
            service_account_json_name: jsonName,
            main_be_api_base_url: cfg.main_be_api_base_url,
            main_be_user_id: (cfg as DriveSyncConfig & { main_be_user_id?: string }).main_be_user_id ?? '',
          }));
          const hasBaseUrl = Boolean(cfg.main_be_api_base_url);
          const hasUserId = Boolean(cfg.main_be_user_id);
          setConfigInvalid(!hasBaseUrl || !hasUserId);
          setShowConfigModal(false);
        } else {
          setIsInitialSetup(true);
          setConfigInvalid(true);
          setShowConfigModal(true);
        }
      } catch {
        setConfigError('Failed to load config.');
        setConfigInvalid(true);
      } finally {
        setConfigLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleConfigFormChange = (data: Partial<ConfigFormData>) => {
    setConfigForm(prev => ({ ...prev, ...data }));
  };

  const handleSaveConfig = async () => {
    setSavingConfigError('');
    if (!configForm.folder_id.trim()) {
      setSavingConfigError('Folder ID is required.');
      return;
    }
    setSavingConfig(true);
    try {
      const cfg = await initDriveSyncConfig({
        folder_id: configForm.folder_id.trim(),
        service_account_json_path: FIXED_JSON_PREFIX + configForm.service_account_json_name.trim(),
        main_be_api_base_url: configForm.main_be_api_base_url.trim(),
        main_be_user_id: configForm.main_be_user_id.trim(),
        main_be_bearer_token: configForm.main_be_bearer_token.trim() || undefined,
      });
      setConfig(cfg);
      setShowConfigModal(false);
      setConfigInvalid(false);
      showToast('Drive Sync configuration saved successfully.', 'success', 2000, 'top-center');
    } catch (e) {
      setSavingConfigError(e instanceof Error ? e.message : 'Failed to save config.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCheckAll = async () => {
    setCheckAllData(null);
    setCheckAllLoading(true);
    setCheckAllError('');
    resetUploadUiState();
    try {
      const data = await checkCoverUpdateAll();
      setCheckAllData(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to check cover updates.';
      setCheckAllError(msg);
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
      const msg = e instanceof Error ? e.message : 'Failed to load cover update history.';
      setCheckUpdatedError(msg);
    } finally {
      setCheckUpdatedLoading(false);
    }
  };

  const handleUploadCover = async (folderId: string, storyId: string) => {
    if (uploadLocksRef.current.has(folderId)) return;
    const resultVersion = uploadResultVersionRef.current;
    uploadLocksRef.current.add(folderId);
    setUploadingIds(prev => new Set(prev).add(folderId));

    try {
      const result = await uploadCoverUpdate(folderId, storyId);
      if (resultVersion === uploadResultVersionRef.current) {
        setUploadResults(prev => new Map(prev).set(folderId, { success: result.success, message: result.message }));
      }
      if (result.success) {
        showToast('Cover updated successfully.', 'success', 2000, 'top-center');
      } else {
        showToast(`Cover update failed: ${result.message}`, 'error', 4000, 'top-center');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      if (resultVersion === uploadResultVersionRef.current) {
        setUploadResults(prev => new Map(prev).set(folderId, { success: false, message: msg }));
      }
      showToast(`Cover update failed: ${msg}`, 'error', 4000, 'top-center');
    } finally {
      uploadLocksRef.current.delete(folderId);
      setUploadingIds(prev => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  };

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: isDark ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)' : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)' }}>
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />

      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <header className="relative overflow-hidden">
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-6">
            <div className="lg-glass-deep px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div>
                  <h1 className={`text-2xl sm:text-3xl font-bold tracking-tight ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>
                    Cover Update
                  </h1>
                  <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                    Update story covers from Drive DONE_/EXTENDED_ folders
                  </p>
                </div>
              </div>
            </div>

            {config && !configLoading && (
              <div className="mt-6 mb-1 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 p-4 rounded-2xl lg-glass">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className={`text-sm font-medium ${isDark ? 'text-white/70' : 'text-[rgba(0,0,0,0.7)]'}`}>
                    Ready
                  </span>
                </div>
                <div className={`hidden sm:block w-px h-5 ${isDark ? 'bg-white/6' : 'bg-black/6'}`} />
                <div className="flex items-center gap-2 min-w-0">
                  <Icon icon={appIcons.folder} className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`} />
                  <span className={`text-xs sm:text-sm truncate ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                    {config.folder_id}
                  </span>
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="max-w-7xl my-3 mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-3">
          {configLoading && (
            <div className="lg-glass p-8 flex items-center justify-center gap-4">
              <Icon icon={appIcons.spinner} className="w-6 h-6 animate-spin text-indigo-400" />
              <span className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Loading Drive Sync...</span>
            </div>
          )}

          {configError && (
            <div className={`lg-glass-card p-4 text-sm ${isDark ? 'text-red-400' : 'text-red-500'}`}>
              <span>{configError}</span>
            </div>
          )}

          <ServerModeBanner
            serverUrl={config?.main_be_api_base_url ?? null}
            isDark={isDark}
            isConfigLoading={configLoading}
            isConfigValid={tokenInvalid ? undefined : (configInvalid ? false : (configLoading ? undefined : Boolean(config?.main_be_api_base_url && config?.main_be_user_id)))}
            tokenInvalid={tokenInvalid}
            onConfigure={() => setShowConfigModal(true)}
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
            />
          )}
        </main>
      </div>

      <ConfigModal
        isOpen={showConfigModal}
        onClose={() => {
          if (!config && !configLoading) return;
          setShowConfigModal(false);
        }}
        config={config}
        configForm={configForm}
        onFormChange={handleConfigFormChange}
        onSave={handleSaveConfig}
        savingConfig={savingConfig}
        savingConfigError={savingConfigError}
        isInitialSetup={isInitialSetup}
        themeMode={themeMode}
        credentialFileExists={credentialFileExists}
        onCredentialUploadSuccess={() => setCredentialFileExists(true)}
      />
    </div>
  );
}
