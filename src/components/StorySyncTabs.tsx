import { useState } from 'react';
import {
  type DriveSyncConfig,
} from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';
import { BatchConfirmDialog } from './BatchConfirmDialog';
import { UploadTab } from './UploadTab';
import { UpdateTab } from './UpdateTab';

export type StorySyncTab = 'uploadable' | 'updatable';

export interface StorySyncTabsProps {
  config: DriveSyncConfig | null;
  activeTab: StorySyncTab;
  onTabChange: (tab: StorySyncTab) => void;
  themeMode: ThemeMode;
  uploadableData: import('../api/client').CheckUploadableResponse | null;
  uploadableLoading: boolean;
  uploadableError: string;
  uploadResults: Map<string, { success: boolean; message: string }>;
  uploadingIds: Set<string>;
  onCheckUploadable: () => void;
  onUploadSingle: (folder: import('../api/client').DriveFolderEntry) => Promise<string>;
  onUploadAll: () => void;
  updatableData: import('../api/client').CheckUpdatableResponse | null;
  updatableLoading: boolean;
  updatableError: string;
  updateResults: Map<string, { success: boolean; message: string }>;
  updatingIds: Set<string>;
  onCheckUpdatable: () => void;
  onUpdateSingle: (entry: import('../api/client').UpdatableStoryEntry, chaptersCount?: number) => Promise<string>;
  onUpdateAll: () => void;
  updatableInvalid: import('../api/client').UpdatableStoryEntry[];
  updatableNoServerMatch?: import('../api/client').DriveFolderEntry[];
  updatableEmptyExtended?: import('../api/client').DriveFolderEntry[];
}

export function StorySyncTabs({
  activeTab,
  onTabChange,
  themeMode,
  uploadableData,
  uploadableLoading,
  uploadableError,
  uploadResults,
  uploadingIds,
  onCheckUploadable,
  onUploadSingle,
  onUploadAll,
  updatableData,
  updatableLoading,
  updatableError,
  updateResults,
  updatingIds,
  onCheckUpdatable,
  onUpdateSingle,
  onUpdateAll,
  updatableInvalid,
  updatableNoServerMatch,
  updatableEmptyExtended,
}: StorySyncTabsProps) {
  const isDark = themeMode === 'dark';

  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);

  const uploadableCount = uploadableData?.uploadable.length ?? 0;
  const updatableCount = updatableData?.updatable.length ?? 0;

  const handleUploadAll = () => {
    setShowUploadConfirm(false);
    onUploadAll();
  };

  const handleUpdateAll = () => {
    setShowUpdateConfirm(false);
    onUpdateAll();
  };

  return (
    <>
      <BatchConfirmDialog
        isOpen={showUploadConfirm}
        title="Upload All Stories"
        message={`You are about to upload ${uploadableCount} stories to Google Drive. This operation will run in the background and may take a significant amount of time depending on the number and size of files.`}
        itemCount={uploadableCount}
        confirmText="Start Upload"
        isDark={isDark}
        onConfirm={handleUploadAll}
        onCancel={() => setShowUploadConfirm(false)}
      />

      <BatchConfirmDialog
        isOpen={showUpdateConfirm}
        title="Update All Stories"
        message={`You are about to update ${updatableCount} stories with new chapters from Google Drive. This operation will run in the background and may take a significant amount of time depending on the number and size of updates.`}
        itemCount={updatableCount}
        confirmText="Start Update"
        isDark={isDark}
        onConfirm={handleUpdateAll}
        onCancel={() => setShowUpdateConfirm(false)}
      />

      <div className={`rounded-2xl shadow-xl shadow-black/5 ${isDark ? 'bg-slate-900/80 backdrop-blur-sm border border-slate-800/60' : 'bg-white border border-gray-200'}`}>
        <div className={`flex items-stretch ${isDark ? 'bg-slate-900/40 border-b border-slate-800/60' : 'bg-gray-50/80 border-b border-gray-200'}`}>
          <button
            onClick={() => onTabChange('uploadable')}
            className={`flex-1 flex items-center justify-center gap-2.5 px-4 sm:px-6 py-4 text-sm font-semibold transition-all duration-200 relative ${activeTab === 'uploadable'
                ? isDark
                  ? 'text-indigo-400'
                  : 'text-indigo-600'
                : isDark
                  ? 'text-slate-500 hover:text-slate-300'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Upload to Drive</span>
            {uploadableCount > 0 ? (
              <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${activeTab === 'uploadable'
                  ? isDark ? 'bg-indigo-500/30 text-indigo-300' : 'bg-indigo-100 text-indigo-600'
                  : isDark ? 'bg-slate-800 text-slate-400' : 'bg-gray-200 text-gray-500'
                }`}>
                {uploadableCount}
              </span>
            ) : uploadableData ? (
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${isDark ? 'bg-slate-800 text-slate-500' : 'bg-gray-200 text-gray-500'}`}>
                0
              </span>
            ) : null}
            {activeTab === 'uploadable' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 to-violet-500" />
            )}
          </button>

          <div className={`w-px ${isDark ? 'bg-slate-800/60' : 'bg-gray-200'}`} />

          <button
            onClick={() => onTabChange('updatable')}
            className={`flex-1 flex items-center justify-center gap-2.5 px-4 sm:px-6 py-4 text-sm font-semibold transition-all duration-200 relative ${activeTab === 'updatable'
                ? isDark
                  ? 'text-amber-400'
                  : 'text-amber-600'
                : isDark
                  ? 'text-slate-500 hover:text-slate-300'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <span>Update Chapters</span>
            {updatableCount > 0 ? (
              <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${activeTab === 'updatable'
                  ? isDark ? 'bg-amber-500/30 text-amber-300' : 'bg-amber-100 text-amber-600'
                  : isDark ? 'bg-slate-800 text-slate-400' : 'bg-gray-200 text-gray-500'
                }`}>
                {updatableCount}
              </span>
            ) : updatableData ? (
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${isDark ? 'bg-slate-800 text-slate-500' : 'bg-gray-200 text-gray-500'}`}>
                0
              </span>
            ) : null}
            {activeTab === 'updatable' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 to-orange-500" />
            )}
          </button>
        </div>

        <div className="h-[calc(100vh-280px)] sm:min-h-[500px] sm:max-h-[calc(100vh-280px)] overflow-y-auto">
          {activeTab === 'uploadable' && (
            <UploadTab
              data={uploadableData}
              loading={uploadableLoading}
              error={uploadableError}
              uploadResults={uploadResults}
              uploadingIds={uploadingIds}
              onCheck={onCheckUploadable}
              onUploadSingle={onUploadSingle}
              onRequestUploadAll={() => setShowUploadConfirm(true)}
              themeMode={themeMode}
            />
          )}
          {activeTab === 'updatable' && (
            <UpdateTab
              data={updatableData}
              loading={updatableLoading}
              error={updatableError}
              updateResults={updateResults}
              updatingIds={updatingIds}
              onCheck={onCheckUpdatable}
              onUpdateSingle={onUpdateSingle}
              onRequestUpdateAll={() => setShowUpdateConfirm(true)}
              invalid={updatableInvalid}
              noServerMatch={updatableNoServerMatch}
              emptyExtended={updatableEmptyExtended}
              themeMode={themeMode}
            />
          )}
        </div>
      </div>
    </>
  );
}
