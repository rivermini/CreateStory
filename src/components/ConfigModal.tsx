import { useEffect, useRef } from 'react';
import {
  type DriveSyncConfig,
} from '../api/client';

export interface ConfigFormData {
  folder_id: string;
  service_account_json_name: string;
  main_be_bearer_token: string;
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
}

const FIXED_USER_ID = '3b2fae40-e482-4ea1-af7a-96e35ecfbf5f';
const FIXED_BE_URL = 'https://api-novel.santngo.com';
const FIXED_JSON_PREFIX = 'credentials/';

export function ConfigModal({
  isOpen,
  onClose,
  config: _config,
  configForm,
  onFormChange,
  onSave,
  savingConfig,
  savingConfigError,
  isInitialSetup = false,
}: ConfigModalProps) {
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
      <div className="w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-900/50 rounded-lg border border-indigo-700/40">
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">Drive Sync Settings</h2>
              <p className="text-xs text-slate-500">{isInitialSetup ? 'Set up your Drive Sync configuration to get started' : 'Modify your Drive Sync configuration'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* User ID — fixed */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">User ID (x-user-id)</label>
              <input
                type="text"
                value={FIXED_USER_ID}
                readOnly
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg
                           text-slate-400 text-sm cursor-not-allowed font-mono"
              />
            </div>
            {/* Main BE API URL — fixed */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Main BE API URL</label>
              <input
                type="text"
                value={FIXED_BE_URL}
                readOnly
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg
                           text-slate-400 text-sm cursor-not-allowed"
              />
            </div>
            {/* Drive Folder ID */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Drive Folder ID</label>
              <input
                type="text"
                value={configForm.folder_id}
                onChange={e => onFormChange({ folder_id: e.target.value })}
                placeholder="1r6AVDCI4GMETi3piMjSyIxlOEW9CqDEa"
                className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg
                           text-slate-100 placeholder-slate-500 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {/* Service Account JSON */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Service Account JSON{' '}
                <span className="text-slate-600 font-normal">(credentials/ + filename)</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg
                                 text-slate-400 text-sm whitespace-nowrap select-none">
                  {FIXED_JSON_PREFIX}
                </span>
                <input
                  type="text"
                  value={configForm.service_account_json_name}
                  onChange={e => onFormChange({ service_account_json_name: e.target.value })}
                  placeholder="nova-crawler-drive-sync-445ff578305c.json"
                  className="flex-1 min-w-0 px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg
                             text-slate-100 placeholder-slate-500 text-sm font-mono
                             focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            {/* Bearer token */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-400 mb-1">
                Main BE Bearer Token
                <span className="text-slate-600 font-normal"> (for check-uploadable & chapter update features)</span>
              </label>
              <input
                type="password"
                value={configForm.main_be_bearer_token}
                onChange={e => onFormChange({ main_be_bearer_token: e.target.value })}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg
                           text-slate-100 placeholder-slate-500 text-sm font-mono
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-slate-600 mt-1">Required for checking server stories and updating chapter counts.</p>
            </div>
          </div>

          {savingConfigError && (
            <p className="mt-4 text-sm text-red-400 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {savingConfigError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700 bg-slate-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={savingConfig}
            className="px-5 py-2.5 text-white font-semibold bg-indigo-600 hover:bg-indigo-500
                       disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                       rounded-lg transition-colors flex items-center gap-2"
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
