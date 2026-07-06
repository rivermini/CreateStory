import { useEffect, useRef } from 'react';
import {
  uploadDriveCredentials,
} from '../../api';
import { Icon, appIcons } from './Icon';
import type { ThemeMode } from '../../types/theme';

export interface ConfigFormData {
  folder_id: string;
  service_account_json_name: string;
  main_be_api_base_url: string;
  main_be_bearer_token: string;
  main_be_user_id: string;
}

export interface DriveConfigProps {
  embedded?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  configForm: ConfigFormData;
  onFormChange: (data: Partial<ConfigFormData>) => void;
  onSave: () => Promise<void>;
  savingConfig: boolean;
  savingConfigError: string;
  isInitialSetup?: boolean;
  themeMode?: ThemeMode;
  credentialFileExists?: boolean;
  onCredentialUploadSuccess?: (filename: string) => void;
}

export function DriveConfig({
  embedded = false,
  isOpen = true,
  onClose,
  configForm,
  onFormChange,
  onSave,
  savingConfig,
  savingConfigError,
  isInitialSetup = false,
  themeMode,
  credentialFileExists = true,
  onCredentialUploadSuccess,
}: Readonly<DriveConfigProps>) {
  const isDark = themeMode === 'dark';
  const overlayRef = useRef<HTMLDivElement>(null);

  const pageText = 'var(--cs-text)';
  const secondaryText = 'var(--cs-text-soft)';
  const tertiaryText = 'var(--cs-text-faint)';
  const panelBorder = 'var(--cs-border)';
  const subtleSurface = 'var(--cs-surface-muted)';
  const inputBackground = 'var(--cs-surface-muted)';
  const inputBorder = 'var(--cs-border)';
  const primaryButton = 'var(--cs-primary)';
  const panelBackground = 'var(--cs-surface-elevated)';
  const sectionClassName = 'rounded-lg border p-4 space-y-4';
  const labelClassName = 'block text-xs mb-1.5 text-inherit opacity-75';
  const fieldClassName = 'w-full rounded-md border px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-inherit placeholder:opacity-40';

  const handleJsonFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let json = JSON.parse(text);

      if (Array.isArray(json)) {
        if (json.length === 0) return;
        json = json[0];
      }

      if (json && typeof json === 'object' && !json.folder_id && !json.main_be_api_base_url) {
        if (json.data) json = json.data;
        else if (json.config) json = json.config;
        else if (json.settings) json = json.settings;
        else if (json.attributes) json = json.attributes;
        else if (json.result) json = json.result;
      }

      if (Array.isArray(json)) {
        json = json[0] || {};
      }

      if (!json || typeof json !== 'object') return;

      const folderId = json.folder_id || json.folderId || json.folder || '';
      const apiUrl = json.main_be_api_base_url || json.apiBaseUrl || json.apiUrl || json.baseUrl || '';
      if (!folderId && !apiUrl) return;

      onFormChange({
        folder_id: folderId,
        service_account_json_name: json.service_account_json_name || json.serviceAccountJsonName || json.serviceAccount || 'google-service-account.json',
        main_be_api_base_url: apiUrl,
        main_be_bearer_token: json.main_be_bearer_token || json.bearerToken || json.beToken || '',
        main_be_user_id: json.main_be_user_id || json.userId || json.main_be_user_id_header || json.xUserId || '',
      });
    } catch {
      // silently ignore parse errors
    }
  };

  useEffect(() => {
    if (embedded || !isOpen || !onClose) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [embedded, isOpen, onClose]);

  const formContent = (
    <>
      {embedded && (
        <div className="space-y-1 mb-1">
          <h2 className="text-sm font-semibold" style={{ color: pageText }}>
            {isInitialSetup ? 'Set up Drive Sync' : 'Modify Drive Sync configuration'}
          </h2>
          <p className="text-xs leading-5" style={{ color: secondaryText }}>
            Fill in the fields below to configure Google Drive sync.
          </p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="drive-user-id" className={labelClassName} style={embedded ? undefined : { color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)' }}>
            User ID (x-user-id)
          </label>
          <input
            id="drive-user-id"
            type="text"
            value={configForm.main_be_user_id}
            onChange={e => onFormChange({ main_be_user_id: e.target.value })}
            placeholder="Your user id..."
            className={embedded ? fieldClassName : `w-full px-4 py-3 rounded-xl border text-sm font-mono focus:outline-none ${isDark ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50' : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'}`}
            style={embedded ? { background: inputBackground, borderColor: inputBorder } : undefined}
          />
        </div>

        <div>
          <label htmlFor="drive-api-url" className={labelClassName} style={embedded ? undefined : { color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)' }}>
            Main BE API URL
          </label>
          <input
            id="drive-api-url"
            type="text"
            value={configForm.main_be_api_base_url}
            onChange={e => onFormChange({ main_be_api_base_url: e.target.value })}
            placeholder="https://cnlhzl7bul.execute-api.ap-southeast-1.amazonaws.com"
            className={embedded ? fieldClassName : `w-full px-4 py-3 rounded-xl border text-sm font-mono focus:outline-none ${isDark ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50' : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'}`}
            style={embedded ? { background: inputBackground, borderColor: inputBorder } : undefined}
          />
        </div>

        <div>
          <label htmlFor="drive-folder-id" className={labelClassName} style={embedded ? undefined : { color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)' }}>
            Drive Folder ID
          </label>
          <input
            id="drive-folder-id"
            type="text"
            value={configForm.folder_id}
            onChange={e => onFormChange({ folder_id: e.target.value })}
            placeholder="1r6AVDCI4GMETi3piMjSyIxlOEW9CqDEa"
            className={embedded ? fieldClassName : `w-full px-4 py-3 rounded-xl border text-sm font-mono focus:outline-none ${isDark ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50' : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'}`}
            style={embedded ? { background: inputBackground, borderColor: inputBorder } : undefined}
          />
        </div>

        <div>
          <label htmlFor="service-account-file" className={labelClassName} style={embedded ? undefined : { color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)' }}>
            Service Account JSON File
          </label>
          <div
            className="flex items-center gap-3 p-3 rounded-md border"
            style={embedded
              ? { borderColor: panelBorder, background: subtleSurface }
              : (isDark ? { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' } : { background: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.10)' })}
          >
            <div className="flex-1 min-w-0">
              {configForm.service_account_json_name ? (
                <p className="text-sm font-mono truncate" style={{ color: pageText }}>
                  {configForm.service_account_json_name}
                </p>
              ) : (
                <p className="text-sm" style={{ color: tertiaryText }}>
                  No file selected
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {configForm.service_account_json_name && (
                <span
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full border"
                  style={{
                    color: credentialFileExists ? (isDark ? 'rgb(74 222 128)' : 'rgb(21 128 61)') : (isDark ? 'rgb(248 113 113)' : 'rgb(220 38 38)'),
                    borderColor: credentialFileExists ? (isDark ? 'rgba(74,222,128,0.35)' : 'rgba(21,128,61,0.3)') : (isDark ? 'rgba(248,113,113,0.35)' : 'rgba(220,38,38,0.3)'),
                    background: credentialFileExists ? (isDark ? 'rgba(74,222,128,0.1)' : 'rgba(21,128,61,0.08)') : (isDark ? 'rgba(248,113,113,0.1)' : 'rgba(220,38,38,0.08)'),
                  }}
                >
                  {credentialFileExists ? 'Ready' : 'Missing'}
                </span>
              )}
              <label className="rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors" style={{ background: primaryButton, color: '#fff' }}>
                {' '}Choose File
                <input
                  id="service-account-file"
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const result = await uploadDriveCredentials(file);
                      onFormChange({ service_account_json_name: result.filename });
                      onCredentialUploadSuccess?.(result.filename);
                    } catch {
                      onFormChange({ service_account_json_name: file.name });
                    }
                  }}
                />
              </label>
            </div>
          </div>
          <p className="text-xs mt-1.5" style={{ color: tertiaryText }}>
            Upload your Google Drive service account JSON file. It will be saved to the server.
          </p>
        </div>

        <div>
          <label htmlFor="drive-bearer-token" className={labelClassName} style={embedded ? undefined : { color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)' }}>
            Main BE Bearer Token <span className="font-normal" style={{ color: tertiaryText }}>(for check-uploadable &amp; chapter update features)</span>
          </label>
          <input
            id="drive-bearer-token"
            type="password"
            value={configForm.main_be_bearer_token}
            onChange={e => onFormChange({ main_be_bearer_token: e.target.value })}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            className={embedded ? fieldClassName : `w-full px-4 py-3 rounded-xl border text-sm font-mono focus:outline-none ${isDark ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50' : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'}`}
            style={embedded ? { background: inputBackground, borderColor: inputBorder } : undefined}
          />
          <p className="text-xs mt-1.5" style={{ color: tertiaryText }}>Required for checking server stories and updating chapter counts.</p>
        </div>

        {savingConfigError && (
          <div className="flex items-center gap-2 text-sm" style={{ color: isDark ? 'rgb(248 113 113)' : 'rgb(220 38 38)' }}>
            <Icon icon={appIcons.error} className="h-4 w-4 flex-shrink-0" />
            {savingConfigError}
          </div>
        )}
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
        {formContent}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onSave}
            disabled={savingConfig}
            className="rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed"
            style={{ background: savingConfig ? subtleSurface : primaryButton, color: savingConfig ? tertiaryText : '#fff' }}
          >
            {savingConfig ? 'Saving...' : 'Save Config'}
          </button>
        </div>
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="lg-modal-overlay"
      aria-hidden="true"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose?.();
      }}
    >
      <div className="lg-glass-deep w-full max-w-3xl rounded-2xl overflow-hidden h-[80vh] flex flex-col justify-between">
        <div className="flex items-center justify-between px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="lg-icon-btn" style={{ background: isDark ? 'rgba(255,91,0,0.2)' : 'rgba(255,91,0,0.08)', color: '#ff7c33' }}>
              <Icon icon={appIcons.settings} className="w-5 h-5" />
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-white/85' : 'text-black/85'}`}>Drive Sync Settings</h2>
              <p className={`text-xs ${isDark ? 'text-white/75' : 'text-black/35'}`}>{isInitialSetup ? 'Set up your Drive Sync configuration to get started' : 'Modify your Drive Sync configuration'}</p>
            </div>
          </div>
          <button onClick={onClose} className="lg-icon-btn">
            <Icon icon={appIcons.close} className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 h-full overflow-y-auto space-y-5">
          {formContent}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 shrink-0">
          <label className="lg-btn-ghost rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 cursor-pointer">
            <Icon icon={appIcons.cloud} className="w-4 h-4" />
            Upload JSON Preset
            <input type="file" accept="application/json" onChange={handleJsonFileUpload} className="hidden" />
          </label>

          <div className="flex items-center gap-3">
            <button onClick={onClose} className="lg-btn-ghost">
              Cancel
            </button>
            <button onClick={onSave} disabled={savingConfig} className={savingConfig ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}>
              {savingConfig ? (
                <>
                  <Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Icon icon={appIcons.check} className="w-4 h-4" />
                  Save Config
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DriveConfig;
