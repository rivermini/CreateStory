import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DRIVE_SYNC_CONFIG_UPDATED_EVENT,
  FIXED_JSON_PREFIX,
  checkCredentialsExists,
  getDriveSyncConfig,
  initDriveSyncConfig,
  validateMainBeToken,
  type DriveSyncConfig,
} from '../api';
import type { ConfigFormData } from '../components/Shared/DriveConfig';
import { showToast } from '../components/Shared/Toast';

interface UseDriveSyncConfigOptions {
  validateToken?: boolean;
  enableEditing?: boolean;
  showToastOnSave?: boolean;
}

interface UseDriveSyncConfigResult {
  config: DriveSyncConfig | null;
  configLoading: boolean;
  configError: string;
  configInvalid: boolean;
  tokenInvalid: boolean;
  credentialFileExists: boolean;
  isInitialSetup: boolean;
  showConfigModal: boolean;
  configForm: ConfigFormData;
  savingConfig: boolean;
  savingConfigError: string;
  isConfigReady: boolean;
  setShowConfigModal: React.Dispatch<React.SetStateAction<boolean>>;
  handleConfigFormChange: (data: Partial<ConfigFormData>) => void;
  handleSaveConfig: () => Promise<void>;
  reloadConfig: () => Promise<void>;
}

const DEFAULT_CONFIG_FORM: ConfigFormData = {
  folder_id: '',
  service_account_json_name: 'google-service-account.json',
  main_be_api_base_url: '',
  main_be_bearer_token: '',
  main_be_user_id: '',
};

export function useDriveSyncConfig({
  validateToken = true,
  enableEditing = false,
  showToastOnSave = true,
}: UseDriveSyncConfigOptions = {}): UseDriveSyncConfigResult {
  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [configInvalid, setConfigInvalid] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [isInitialSetup, setIsInitialSetup] = useState(false);
  const [credentialFileExists, setCredentialFileExists] = useState(true);
  const [configForm, setConfigForm] = useState<ConfigFormData>(DEFAULT_CONFIG_FORM);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingConfigError, setSavingConfigError] = useState('');

  const reloadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError('');

    try {
      const cfg = await getDriveSyncConfig();
      setConfig(cfg);

      if (cfg) {
        const fullCfg = cfg as DriveSyncConfig & { service_account_json_path?: string };
        const jsonName = fullCfg.service_account_json_path
          ? fullCfg.service_account_json_path.replace(FIXED_JSON_PREFIX, '')
          : cfg.service_account_json_name || 'google-service-account.json';

        setConfigForm(prev => ({
          ...prev,
          folder_id: cfg.folder_id || '',
          service_account_json_name: jsonName,
          main_be_api_base_url: cfg.main_be_api_base_url || '',
          main_be_bearer_token: '',
          main_be_user_id: cfg.main_be_user_id ?? '',
        }));

        const hasBaseUrl = Boolean(cfg.main_be_api_base_url);
        const hasUserId = Boolean(cfg.main_be_user_id);
        setConfigInvalid(!hasBaseUrl || !hasUserId);
        setIsInitialSetup(false);

        if (jsonName) {
          try {
            const exists = await checkCredentialsExists(jsonName);
            setCredentialFileExists(exists);
          } catch {
            setCredentialFileExists(true);
          }
        }

        if (validateToken && hasBaseUrl && hasUserId) {
          try {
            const tokenResult = await validateMainBeToken();
            setTokenInvalid(!tokenResult.valid);
          } catch {
            setTokenInvalid(false);
          }
        } else {
          setTokenInvalid(false);
        }

        setShowConfigModal(false);
      } else {
        setConfigInvalid(true);
        setTokenInvalid(false);
        setCredentialFileExists(true);
        setIsInitialSetup(true);
        setConfigForm(DEFAULT_CONFIG_FORM);
        if (enableEditing) {
          setShowConfigModal(true);
        }
      }
    } catch {
      setConfigError('Failed to load config.');
      setConfigInvalid(true);
      setTokenInvalid(false);
    } finally {
      setConfigLoading(false);
    }
  }, [enableEditing, validateToken]);

  useEffect(() => {
    queueMicrotask(() => {
      void reloadConfig();
    });
  }, [reloadConfig]);

  useEffect(() => {
    const handleConfigUpdated = () => {
      void reloadConfig();
    };
    window.addEventListener(DRIVE_SYNC_CONFIG_UPDATED_EVENT, handleConfigUpdated);
    return () => window.removeEventListener(DRIVE_SYNC_CONFIG_UPDATED_EVENT, handleConfigUpdated);
  }, [reloadConfig]);

  const handleConfigFormChange = useCallback((data: Partial<ConfigFormData>) => {
    setConfigForm(prev => ({ ...prev, ...data }));
  }, []);

  const handleSaveConfig = useCallback(async () => {
    if (!enableEditing) {
      return;
    }

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
      setConfigInvalid(false);
      setTokenInvalid(false);
      setIsInitialSetup(false);
      setShowConfigModal(false);

      if (showToastOnSave) {
        showToast('Drive Sync configuration saved successfully.', 'success', 2000, 'top-center');
      }

    } catch (error) {
      setSavingConfigError(error instanceof Error ? error.message : 'Failed to save config.');
    } finally {
      setSavingConfig(false);
    }
  }, [configForm, enableEditing, showToastOnSave]);

  const isConfigReady = useMemo(
    () => Boolean(config?.main_be_api_base_url && config?.main_be_user_id) && !configInvalid && !tokenInvalid,
    [config, configInvalid, tokenInvalid],
  );

  return {
    config,
    configLoading,
    configError,
    configInvalid,
    tokenInvalid,
    credentialFileExists,
    isInitialSetup,
    showConfigModal,
    configForm,
    savingConfig,
    savingConfigError,
    isConfigReady,
    setShowConfigModal,
    handleConfigFormChange,
    handleSaveConfig,
    reloadConfig,
  };
}
