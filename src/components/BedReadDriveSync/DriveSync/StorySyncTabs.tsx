import { useState } from 'react';
import {
  type DriveSyncConfig,
  type UpdatableStoryEntry,
} from '../../../api/client';
import { BatchConfirmDialog } from '../../Shared/BatchConfirmDialog';
import { Icon, appIcons } from '../../Shared/Icon';
import { UpdateTab } from './UpdateTab';
import { UploadTab } from './UploadTab';
import type { ThemeMode } from '../../../types/theme';

export type StorySyncTab = 'uploadable' | 'updatable';

export interface StorySyncTabsProps {
  config: DriveSyncConfig | null;
  activeTab: StorySyncTab;
  onTabChange: (tab: StorySyncTab) => void;
  themeMode: ThemeMode;
  uploadableData: import('../../../api/client').CheckUploadableResponse | null;
  uploadableLoading: boolean;
  uploadableError: string;
  uploadResults: Map<string, { success: boolean; message: string }>;
  uploadingIds: Set<string>;
  onCheckUploadable: () => void;
  onUploadSingle: (folder: import('../../../api/client').DriveFolderEntry) => Promise<string>;
  onUploadAll: () => void;
  updatableData: import('../../../api/client').CheckUpdatableResponse | null;
  updatableLoading: boolean;
  updatableError: string;
  updateResults: Map<string, { success: boolean; message: string }>;
  updatingIds: Set<string>;
  onCheckUpdatable: () => void;
  onCheckReaderFinished: () => void;
  onUpdateSingle: (entry: import('../../../api/client').UpdatableStoryEntry, chaptersCount?: number) => Promise<string>;
  onUpdateAll: (entries: UpdatableStoryEntry[], chapterInputs: Map<string, number>, newErrors?: Map<string, string>) => void;
  updatableInvalid: import('../../../api/client').UpdatableStoryEntry[];
  updatableNoServerMatch?: import('../../../api/client').DriveFolderEntry[];
  updatableEmptyExtended?: import('../../../api/client').DriveFolderEntry[];
  storiesNeedingUpdate?: import('../../../api/client').StoriesNeedingUpdateEntry[];
  noDriveFolder?: import('../../../api/client').ServerOnlyStoryEntry[];
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

  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

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

      <div
        className="overflow-hidden rounded-2xl border"
        style={{ background: panelBackground, borderColor: panelBorder }}
      >
        <div className="flex">
          <button
            onClick={() => onTabChange('uploadable')}
            className="relative flex flex-1 items-center justify-center gap-2.5 px-4 py-4 text-sm font-semibold transition-colors"
            style={{
              color:
                activeTab === 'uploadable'
                  ? isDark
                    ? '#818cf8'
                    : '#4f46e5'
                  : isDark
                    ? 'rgba(255,255,255,0.5)'
                    : 'rgba(55,53,47,0.55)',
              background:
                activeTab === 'uploadable'
                  ? isDark
                    ? 'rgba(99,102,241,0.08)'
                    : 'rgba(99,102,241,0.06)'
                  : 'transparent',
            }}
          >
            <Icon icon={appIcons.uploadFile} className="h-5 w-5" />
            <span>Upload to Drive</span>
            {uploadableCount > 0 ? (
              <span
                className="rounded-md border px-2 py-0.5 text-xs font-medium"
                style={{
                  background:
                    activeTab !== 'uploadable'
                      ? mutedSurface
                      : isDark
                        ? 'rgba(99,102,241,0.14)'
                        : 'rgba(99,102,241,0.12)',
                  borderColor:
                    activeTab !== 'uploadable'
                      ? panelBorder
                      : isDark
                        ? 'rgba(99,102,241,0.3)'
                        : 'rgba(99,102,241,0.24)',
                  color:
                    activeTab !== 'uploadable'
                      ? isDark
                        ? 'rgba(255,255,255,0.5)'
                        : 'rgba(55,53,47,0.55)'
                      : isDark
                        ? '#818cf8'
                        : '#4f46e5',
                }}
              >
                {uploadableCount}
              </span>
            ) : uploadableData ? (
              <span
                className="rounded-md border px-2 py-0.5 text-xs"
                style={{ background: mutedSurface, borderColor: panelBorder, color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }}
              >
                0
              </span>
            ) : null}
            {activeTab === 'uploadable' && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }}
              />
            )}
          </button>

          <div style={{ width: '1px', background: panelBorder }} />

          <button
            onClick={() => onTabChange('updatable')}
            className="relative flex flex-1 items-center justify-center gap-2.5 px-4 py-4 text-sm font-semibold transition-colors"
            style={{
              color:
                activeTab === 'updatable'
                  ? isDark
                    ? '#fcd34d'
                    : '#b45309'
                  : isDark
                    ? 'rgba(255,255,255,0.5)'
                    : 'rgba(55,53,47,0.55)',
              background:
                activeTab === 'updatable'
                  ? isDark
                    ? 'rgba(245,158,11,0.08)'
                    : 'rgba(245,158,11,0.06)'
                  : 'transparent',
            }}
          >
            <Icon icon={appIcons.trends} className="h-5 w-5" />
            <span>Update Chapters</span>
            {updatableCount > 0 ? (
              <span
                className="rounded-md border px-2 py-0.5 text-xs font-medium"
                style={{
                  background:
                    activeTab !== 'updatable'
                      ? mutedSurface
                      : isDark
                        ? 'rgba(245,158,11,0.14)'
                        : 'rgba(245,158,11,0.12)',
                  borderColor:
                    activeTab !== 'updatable'
                      ? panelBorder
                      : isDark
                        ? 'rgba(245,158,11,0.3)'
                        : 'rgba(245,158,11,0.24)',
                  color:
                    activeTab !== 'updatable'
                      ? isDark
                        ? 'rgba(255,255,255,0.5)'
                        : 'rgba(55,53,47,0.55)'
                      : isDark
                        ? '#fcd34d'
                        : '#b45309',
                }}
              >
                {updatableCount}
              </span>
            ) : updatableData ? (
              <span
                className="rounded-md border px-2 py-0.5 text-xs"
                style={{ background: mutedSurface, borderColor: panelBorder, color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.55)' }}
              >
                0
              </span>
            ) : null}
            {activeTab === 'updatable' && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: 'linear-gradient(90deg, #f59e0b, #ea580c)' }}
              />
            )}
          </button>
        </div>

        <div className="h-[calc(100vh-280px)] overflow-y-auto sm:min-h-[500px] sm:max-h-[calc(100vh-280px)]">
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
              onRequestUpdateAll={(
                entries: UpdatableStoryEntry[],
                chapterInputs: Map<string, number>,
                newErrors?: Map<string, string>,
              ) => {
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
