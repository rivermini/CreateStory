import { useState } from 'react';
import {
  type DriveSyncConfig,
  type UpdatableStoryEntry,
} from '../api/client';
import type { ThemeMode } from '../types/theme';
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
  onCheckReaderFinished: () => void;
  onUpdateSingle: (entry: import('../api/client').UpdatableStoryEntry, chaptersCount?: number) => Promise<string>;
  onUpdateAll: (entries: UpdatableStoryEntry[], chapterInputs: Map<string, number>) => void;
  updatableInvalid: import('../api/client').UpdatableStoryEntry[];
  updatableNoServerMatch?: import('../api/client').DriveFolderEntry[];
  updatableEmptyExtended?: import('../api/client').DriveFolderEntry[];
  storiesNeedingUpdate?: import('../api/client').StoriesNeedingUpdateEntry[];
  noDriveFolder?: import('../api/client').ServerOnlyStoryEntry[];
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
  onCheckReaderFinished,
  onUpdateSingle,
  onUpdateAll,
  updatableInvalid,
  updatableNoServerMatch,
  updatableEmptyExtended,
  storiesNeedingUpdate,
  noDriveFolder,
}: StorySyncTabsProps) {
  const isDark = themeMode === 'dark';

  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const [chapterErrors, setChapterErrors] = useState(false);
  const [pendingChapterErrors, setPendingChapterErrors] = useState<Map<string, string>>(new Map());
  const [pendingUpdateEntries, setPendingUpdateEntries] = useState<UpdatableStoryEntry[]>([]);
  const [pendingChapterInputs, setPendingChapterInputs] = useState<Map<string, number>>(new Map());

  const uploadableCount = uploadableData?.uploadable.length ?? 0;
  const updatableCount = updatableData?.updatable.length ?? 0;

  const handleUploadAll = () => {
    setShowUploadConfirm(false);
    onUploadAll();
  };

  const handleUpdateAll = () => {
    if (chapterErrors) return;
    setShowUpdateConfirm(false);
    setPendingChapterErrors(new Map());
    onUpdateAll(pendingUpdateEntries, pendingChapterInputs);
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
        message={chapterErrors
          ? `Cannot update: there are chapter count validation errors that must be resolved first. Please fix the errors in the Update tab before proceeding.`
          : `You are about to update ${pendingUpdateEntries.length} stories with new chapters from Google Drive. This operation will run in the background and may take a significant amount of time depending on the number and size of updates.`
        }
        itemCount={pendingUpdateEntries.length}
        confirmText="Start Update"
        isDark={isDark}
        disabled={chapterErrors}
        validationMessage={pendingChapterErrors.size > 0
          ? `${pendingChapterErrors.size} story(ies) exceed their available chapter count. Please fix these before updating.`
          : undefined
        }
        onConfirm={handleUpdateAll}
        onCancel={() => {
          setShowUpdateConfirm(false);
          setPendingChapterErrors(new Map());
        }}
      />

      <div className="lg-glass-card overflow-hidden" style={{ borderRadius: 24 }}>
        <div className={`flex items-stretch ${isDark ? 'lg-border-divider' : 'lg-border-divider'}`}>
          <button
            onClick={() => onTabChange('uploadable')}
            className="flex-1 flex items-center justify-center gap-2.5 px-4 sm:px-6 py-4 text-sm font-semibold transition-all duration-200 relative"
            style={{
              color: activeTab === 'uploadable' ? (isDark ? '#818cf8' : '#6366f1') : (isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)'),
              background: activeTab === 'uploadable' ? (isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)') : 'transparent',
            }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Upload to Drive</span>
            {uploadableCount > 0 ? (
              <span className="lg-chip lg-chip-blue" style={activeTab !== 'uploadable' ? (isDark ? { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)' } : { background: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.1)', color: 'rgba(0,0,0,0.35)' }) : undefined}>
                {uploadableCount}
              </span>
            ) : uploadableData ? (
              <span className="lg-chip" style={isDark ? { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' } : { background: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.35)' }}>
                0
              </span>
            ) : null}
            {activeTab === 'uploadable' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }} />
            )}
          </button>

          <div className="w-px" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }} />

          <button
            onClick={() => onTabChange('updatable')}
            className="flex-1 flex items-center justify-center gap-2.5 px-4 sm:px-6 py-4 text-sm font-semibold transition-all duration-200 relative"
            style={{
              color: activeTab === 'updatable' ? (isDark ? '#fbbf24' : '#d97706') : (isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)'),
              background: activeTab === 'updatable' ? (isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.05)') : 'transparent',
            }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <span>Update Chapters</span>
            {updatableCount > 0 ? (
              <span className="lg-chip lg-chip-amber" style={activeTab !== 'updatable' ? (isDark ? { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)' } : { background: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.1)', color: 'rgba(0,0,0,0.35)' }) : undefined}>
                {updatableCount}
              </span>
            ) : updatableData ? (
              <span className="lg-chip" style={isDark ? { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' } : { background: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.35)' }}>
                0
              </span>
            ) : null}
            {activeTab === 'updatable' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, #f59e0b, #ea580c)' }} />
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
              onCheckReaderFinished={onCheckReaderFinished}
              onUpdateSingle={onUpdateSingle}
              onRequestUpdateAll={(entries, chapterInputs, newErrors) => {
                setPendingUpdateEntries(entries);
                setPendingChapterInputs(chapterInputs);
                setPendingChapterErrors(newErrors ?? new Map());
                setChapterErrors(!!newErrors && newErrors.size > 0);
                setShowUpdateConfirm(true);
              }}
              hasChapterErrors={chapterErrors}
              onChapterErrorsChange={setChapterErrors}
              invalid={updatableInvalid}
              noServerMatch={updatableNoServerMatch}
              emptyExtended={updatableEmptyExtended}
              storiesNeedingUpdate={storiesNeedingUpdate}
              noDriveFolder={noDriveFolder}
              themeMode={themeMode}
            />
          )}
        </div>
      </div>
    </>
  );
}
