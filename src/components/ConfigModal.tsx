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
}: ConfigModalProps) {
  const isDark = themeMode !== 'light';
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className={`w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-gray-200'}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 ${isDark ? 'border-b border-slate-800' : 'border-b border-gray-200'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl flex-shrink-0 ${isDark ? 'bg-indigo-900/40' : 'bg-indigo-50'}`}>
              <svg className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>Drive Sync Settings</h2>
              <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{isInitialSetup ? 'Set up your Drive Sync configuration to get started' : 'Modify your Drive Sync configuration'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-xl transition-colors flex-shrink-0 ${isDark
              ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto space-y-5">
          {/* User ID */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>User ID (x-user-id)</label>
            <input
              type="text"
              value={configForm.main_be_user_id}
              onChange={e => onFormChange({ main_be_user_id: e.target.value })}
              placeholder="Your user id..."
              className={`w-full px-4 py-3 rounded-xl border text-sm font-mono
                focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                ${isDark
                  ? 'bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-600'
                  : 'bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400'
                }`}
            />
          </div>
          {/* Main BE API URL */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>Main BE API URL</label>
            <input
              type="text"
              value={configForm.main_be_api_base_url}
              onChange={e => onFormChange({ main_be_api_base_url: e.target.value })}
              placeholder="https://cnlhzl7bul.execute-api.ap-southeast-1.amazonaws.com"
              className={`w-full px-4 py-3 rounded-xl border text-sm
                focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                ${isDark
                  ? 'bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-600'
                  : 'bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400'
                }`}
            />
          </div>
          {/* Drive Folder ID */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>Drive Folder ID</label>
            <input
              type="text"
              value={configForm.folder_id}
              onChange={e => onFormChange({ folder_id: e.target.value })}
              placeholder="1r6AVDCI4GMETi3piMjSyIxlOEW9CqDEa"
              className={`w-full px-4 py-3 rounded-xl border text-sm font-mono
                focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                ${isDark
                  ? 'bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-600'
                  : 'bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400'
                }`}
            />
          </div>
          {/* Service Account JSON */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              Service Account JSON File
            </label>
            <div className={`flex items-center gap-3 p-4 rounded-xl border text-sm ${isDark
              ? 'bg-slate-800/60 border-slate-700'
              : 'bg-gray-50 border-gray-300'
            }`}>
              <div className="flex-1 min-w-0">
                {configForm.service_account_json_name ? (
                  <p className={`font-mono truncate ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                    {configForm.service_account_json_name}
                  </p>
                ) : (
                  <p className={isDark ? 'text-slate-600' : 'text-gray-400'}>
                    No file selected
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {configForm.service_account_json_name && (
                  <span className={`text-xs px-2 py-1 rounded-full ${isDark ? 'bg-emerald-900/40 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                    Ready
                  </span>
                )}
                <label
                  className={`px-3 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                    isDark
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
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
                      } catch {
                        onFormChange({ service_account_json_name: file.name });
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            <p className={`text-xs mt-1.5 ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>
              Upload your Google Drive service account JSON file. It will be saved to the server.
            </p>
          </div>
          {/* Bearer token */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              Main BE Bearer Token
              <span className={`font-normal ${isDark ? 'text-slate-600' : 'text-gray-400'}`}> (for check-uploadable & chapter update features)</span>
            </label>
            <input
              type="password"
              value={configForm.main_be_bearer_token}
              onChange={e => onFormChange({ main_be_bearer_token: e.target.value })}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className={`w-full px-4 py-3 rounded-xl border text-sm font-mono
                focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                ${isDark
                  ? 'bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-600'
                  : 'bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400'
                }`}
            />
            <p className={`text-xs mt-1.5 ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>Required for checking server stories and updating chapter counts.</p>
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
        <div className={`flex items-center justify-end gap-3 px-6 py-4 ${isDark ? 'border-t border-slate-800 bg-slate-900/50' : 'border-t border-gray-200 bg-gray-50'}`}>
          <button
            onClick={onClose}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${isDark
              ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={savingConfig}
            className={`px-5 py-2.5 font-semibold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg ${
              savingConfig
                ? isDark
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
            }`}
          >
            {savingConfig ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
