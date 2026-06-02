import { useEffect, useRef } from 'react';
import {
  type DriveSyncConfig,
  uploadDriveCredentials,
} from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';

export interface ConfigFormData {
  folder_id: string;
  service_account_json_name: string;
  main_be_api_base_url: string;
  main_be_bearer_token: string;
  main_be_user_id: string;
}

export interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: DriveSyncConfig | null;
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

export function ConfigModal({
  isOpen,
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
}: ConfigModalProps) {
  const isDark = themeMode !== 'light';
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleJsonFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        let json = JSON.parse(event.target?.result as string);

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
        // silently ignore parse errors in modal context
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const inputBase = isDark
    ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'
    : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50';

  return (
    <div
      ref={overlayRef}
      className="lg-modal-overlay"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="lg-glass-deep w-full max-w-3xl rounded-2xl overflow-hidden" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 shrink-0 ${isDark ? 'border-b border-white/6' : 'border-b border-black/6'}`}>
          <div className="flex items-center gap-3">
            <div className="lg-icon-btn" style={{ background: isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.08)', color: '#818cf8' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-white/85' : 'text-black/85'}`}>Drive Sync Settings</h2>
              <p className={`text-xs ${isDark ? 'text-white/75' : 'text-black/35'}`}>{isInitialSetup ? 'Set up your Drive Sync configuration to get started' : 'Modify your Drive Sync configuration'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg-icon-btn"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto space-y-5">
          {/* User ID */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-white/75' : 'text-black/45'}`}>User ID (x-user-id)</label>
            <input
              type="text"
              value={configForm.main_be_user_id}
              onChange={e => onFormChange({ main_be_user_id: e.target.value })}
              placeholder="Your user id..."
              className={`w-full px-4 py-3 rounded-xl border text-sm font-mono focus:outline-none ${inputBase}`}
            />
          </div>
          {/* Main BE API URL */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-white/75' : 'text-black/45'}`}>Main BE API URL</label>
            <input
              type="text"
              value={configForm.main_be_api_base_url}
              onChange={e => onFormChange({ main_be_api_base_url: e.target.value })}
              placeholder="https://cnlhzl7bul.execute-api.ap-southeast-1.amazonaws.com"
              className={`w-full px-4 py-3 rounded-xl border text-sm font-mono focus:outline-none ${inputBase}`}
            />
          </div>
          {/* Drive Folder ID */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-white/75' : 'text-black/45'}`}>Drive Folder ID</label>
            <input
              type="text"
              value={configForm.folder_id}
              onChange={e => onFormChange({ folder_id: e.target.value })}
              placeholder="1r6AVDCI4GMETi3piMjSyIxlOEW9CqDEa"
              className={`w-full px-4 py-3 rounded-xl border text-sm font-mono focus:outline-none ${inputBase}`}
            />
          </div>
          {/* Service Account JSON */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-white/75' : 'text-black/45'}`}>
              Service Account JSON File
            </label>
            <div className={`flex items-center gap-3 p-4 rounded-xl border ${isDark ? 'bg-white/6 border-white/12' : 'bg-black/4 border-black/10'}`}>
              <div className="flex-1 min-w-0">
                {configForm.service_account_json_name ? (
                  <p className={`text-sm font-mono truncate ${isDark ? 'text-white/75' : 'text-black/65'}`}>
                    {configForm.service_account_json_name}
                  </p>
                ) : (
                  <p className={`text-sm ${isDark ? 'text-white/55' : 'text-black/30'}`}>
                    No file selected
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {configForm.service_account_json_name && (
                  <span className={`lg-chip ${credentialFileExists ? 'lg-chip-green' : 'lg-chip-red'}`}>
                    {credentialFileExists ? 'Ready' : 'Missing'}
                  </span>
                )}
                <label className="lg-btn-primary cursor-pointer" style={{ padding: '8px 14px', fontSize: '0.8125rem' }}>
                  Choose File
                  <input
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
            <p className={`text-xs mt-1.5 ${isDark ? 'text-white/55' : 'text-black/30'}`}>
              Upload your Google Drive service account JSON file. It will be saved to the server.
            </p>
          </div>
          {/* Bearer token */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-white/75' : 'text-black/45'}`}>
              Main BE Bearer Token
              <span className={`font-normal ${isDark ? 'text-white/55' : 'text-black/30'}`}> (for check-uploadable & chapter update features)</span>
            </label>
            <input
              type="password"
              value={configForm.main_be_bearer_token}
              onChange={e => onFormChange({ main_be_bearer_token: e.target.value })}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className={`w-full px-4 py-3 rounded-xl border text-sm font-mono focus:outline-none ${inputBase}`}
            />
            <p className={`text-xs mt-1.5 ${isDark ? 'text-white/55' : 'text-black/30'}`}>Required for checking server stories and updating chapter counts.</p>
          </div>

          {/* Upload JSON Preset */}
          <div className="flex items-center gap-3">
            <label className={`lg-btn-ghost rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 cursor-pointer`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload JSON Preset
              <input
                type="file"
                accept="application/json"
                onChange={handleJsonFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {savingConfigError && (
            <p className={`text-sm flex items-center gap-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {savingConfigError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end gap-3 px-6 py-4 shrink-0 ${isDark ? 'border-t border-white/6 bg-black/10' : 'border-t border-black/6 bg-black/4'}`}>
          <button
            onClick={onClose}
            className="lg-btn-ghost"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={savingConfig}
            className={savingConfig ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}
          >
            {savingConfig ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ animationDirection: 'reverse' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M5 13l4 4L19 7" />
                </svg>
                Save Config
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
