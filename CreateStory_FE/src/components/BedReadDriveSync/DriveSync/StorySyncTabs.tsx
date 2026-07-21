import { useState } from 'react';
import {
  type UpdatableStoryEntry,
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type DriveSyncUploadProgress,
  type DriveFolderEntry,
  type StoriesNeedingUpdateEntry,
  type ServerOnlyStoryEntry,
} from '../../../api';
import { BatchConfirmDialog } from '../../Shared/BatchConfirmDialog';
import { Icon, appIcons } from '../../Shared/Icon';
import { UpdateTab } from './UpdateTab';
import { UploadTab } from './UploadTab';
import type { ThemeMode } from '../../../types/theme';

export type StorySyncTab = 'uploadable' | 'updatable';

export interface StorySyncTabsProps {
  readonly activeTab: StorySyncTab;
  readonly onTabChange: (tab: StorySyncTab) => void;
  readonly themeMode: ThemeMode;
  readonly uploadableData: CheckUploadableResponse | null;
  readonly uploadableLoading: boolean;
  readonly uploadableError: string;
  readonly uploadResults: Map<string, { success: boolean; message: string }>;
  readonly uploadingIds: Set<string>;
  readonly uploadProgress: DriveSyncUploadProgress | null;
  readonly uploadPollingError: string;
  readonly processUploadWatermark: boolean;
  readonly onProcessUploadWatermarkChange: (enabled: boolean) => void;
  readonly onCheckUploadable: () => void;
  readonly onUploadSingle: (folder: DriveFolderEntry) => Promise<string>;
  readonly onUploadAll: () => void;
  readonly updatableData: CheckUpdatableResponse | null;
  readonly updatableLoading: boolean;
  readonly updatableError: string;
  readonly updateResults: Map<string, { success: boolean; message: string }>;
  readonly updatingIds: Set<string>;
  readonly onCheckUpdatable: () => void;
  readonly onCheckReaderFinished: () => void;
  readonly onUpdateSingle: (entry: UpdatableStoryEntry, chaptersCount?: number) => Promise<string>;
  readonly onUpdateAll: (entries: UpdatableStoryEntry[], chapterInputs: Map<string, number>, newErrors?: Map<string, string>) => void;
  readonly updatableInvalid: UpdatableStoryEntry[];
  readonly updatableNoServerMatch?: DriveFolderEntry[];
  readonly updatableEmptyExtended?: DriveFolderEntry[];
  readonly storiesNeedingUpdate?: StoriesNeedingUpdateEntry[];
  readonly noDriveFolder?: ServerOnlyStoryEntry[];
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
  uploadProgress,
  uploadPollingError,
  processUploadWatermark,
  onProcessUploadWatermarkChange,
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
    setChapterErrors(false);
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
        message={
          chapterErrors
            ? `Cannot update: there are chapter count validation errors that must be resolved first. Please fix the errors in the Update tab before proceeding.`
            : `You are about to update ${pendingUpdateEntries.length} stories with new chapters from Google Drive. This operation will run in the background and may take a significant amount of time depending on the number and size of updates.`
        }
        itemCount={pendingUpdateEntries.length}
        confirmText="Start Update"
        isDark={isDark}
        disabled={chapterErrors}
        validationMessage={
          pendingChapterErrors.size > 0
            ? `${pendingChapterErrors.size} story(ies) exceed their available chapter count. Please fix these before updating.`
            : undefined
        }
        onConfirm={handleUpdateAll}
        onCancel={() => {
          setShowUpdateConfirm(false);
          setPendingChapterErrors(new Map());
        }}
      />

      <div className="space-y-4">
        <div className="flex border-b border-[var(--cs-border)] bg-transparent">
          <button
            onClick={() => onTabChange('uploadable')}
            className="relative flex items-center gap-2 px-4 py-4 text-sm font-semibold transition-colors hover:text-[var(--cs-primary)]"
            style={{
              color: activeTab === 'uploadable' ? 'var(--cs-primary)' : 'var(--cs-text-soft)',
            }}
          >
            <Icon icon={appIcons.uploadFile} className="h-4.5 w-4.5" />
            <span>Upload to Drive</span>
            {uploadableCount > 0 ? (
              <span className="rounded-full bg-[var(--cs-primary-soft)] text-[var(--cs-primary)] text-[10px] px-1.5 py-0.5 font-bold">
                {uploadableCount}
              </span>
            ) : uploadableData ? (
              <span className="rounded-full bg-[var(--cs-surface-muted)] text-[var(--cs-text-muted)] text-[10px] px-1.5 py-0.5 font-bold">
                0
              </span>
            ) : null}
            {activeTab === 'uploadable' && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: 'var(--cs-primary)' }}
              />
            )}
          </button>

          <button
            onClick={() => onTabChange('updatable')}
            className="relative flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-colors hover:text-[var(--cs-primary)]"
            style={{
              color: activeTab === 'updatable' ? 'var(--cs-primary)' : 'var(--cs-text-soft)',
            }}
          >
            <Icon icon={appIcons.trends} className="h-4.5 w-4.5" />
            <span>Update Chapters</span>
            {updatableCount > 0 ? (
              <span className="rounded-full bg-[var(--cs-primary-soft)] text-[var(--cs-primary)] text-[10px] px-1.5 py-0.5 font-bold">
                {updatableCount}
              </span>
            ) : updatableData ? (
              <span className="rounded-full bg-[var(--cs-surface-muted)] text-[var(--cs-text-muted)] text-[10px] px-1.5 py-0.5 font-bold">
                0
              </span>
            ) : null}
            {activeTab === 'updatable' && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: 'var(--cs-primary)' }}
              />
            )}
          </button>
        </div>

        <div>
          {activeTab === 'uploadable' && (
            <UploadTab
              data={uploadableData}
              loading={uploadableLoading}
              error={uploadableError}
              uploadResults={uploadResults}
              uploadingIds={uploadingIds}
              uploadProgress={uploadProgress}
              uploadPollingError={uploadPollingError}
              processWatermark={processUploadWatermark}
              onProcessWatermarkChange={onProcessUploadWatermarkChange}
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
              onRequestUpdateAll={(
                entries: UpdatableStoryEntry[],
                chapterInputs: ReadonlyMap<string, number>,
                newErrors?: Map<string, string>,
              ) => {
                setPendingUpdateEntries(entries);
                setPendingChapterInputs(new Map(chapterInputs));
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
