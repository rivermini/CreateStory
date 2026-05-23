import { useState } from 'react';
import {
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type DriveFolderEntry,
  type UpdatableStoryEntry,
  type DriveSyncConfig,
} from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';

// ─── Uploadable Tab ────────────────────────────────────────────────────────────

interface UploadableTabProps {
  data: CheckUploadableResponse | null;
  loading: boolean;
  error: string;
  uploadResults: Map<string, { success: boolean; message: string }>;
  uploadingIds: Set<string>;
  onCheck: () => void;
  onUploadSingle: (folder: DriveFolderEntry) => Promise<string>;
  onUploadAll: () => void;
  themeMode: ThemeMode;
}

function ValidationErrorBadge({ error, isDark }: { error: string; isDark: boolean }) {
  const isFormat = error.startsWith("WRONG FORMAT");
  return (
    <span className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded border ${
      isFormat
        ? isDark
          ? 'bg-red-900/60 text-red-300 border-red-700/50'
          : 'bg-red-100 text-red-700 border-red-300'
        : isDark
          ? 'bg-amber-900/60 text-amber-300 border-amber-700/50'
          : 'bg-amber-100 text-amber-700 border-amber-300'
    }`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
      {error}
    </span>
  );
}

function UploadableTab({
  data,
  loading,
  error,
  uploadResults,
  uploadingIds,
  onCheck,
  onUploadSingle,
  onUploadAll,
  themeMode,
}: UploadableTabProps) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');

  const statusColor = (prefix: string) => {
    if (prefix === 'DONE' || prefix === 'EXTENDED') return isDark
      ? 'bg-emerald-900/50 text-emerald-400 border-emerald-700'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (prefix === 'ING') return isDark
      ? 'bg-amber-900/50 text-amber-400 border-amber-700'
      : 'bg-amber-50 text-amber-700 border-amber-200';
    return isDark
      ? 'bg-slate-700/50 text-slate-400 border-slate-600'
      : 'bg-gray-100 text-gray-600 border-gray-300';
  };

  const q = search.toLowerCase().trim();

  const filteredInvalid = data?.invalid.filter(f =>
    !q || f.display_name.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
  ) ?? [];
  const filteredUploadable = data?.uploadable.filter(f =>
    !q || f.display_name.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
  ) ?? [];
  const filteredAlready = data?.already_on_server.filter(f =>
    !q || f.display_name.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
  ) ?? [];

  const validCount = filteredUploadable.length;
  const allDone = (validCount > 0 && filteredUploadable.every(f => uploadResults.get(f.id)?.success)) ?? false;

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onCheck}
            disabled={loading}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${
              loading
                ? isDark
                  ? 'bg-indigo-900 text-gray-700 cursor-not-allowed'
                  : 'bg-indigo-300 text-indigo-800 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Checking...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Check Uploadable
              </>
            )}
          </button>
          {data && (
            <span className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
              {validCount} new / {data.already_on_server.length} already uploaded
              {filteredInvalid.length > 0 && ` / ${filteredInvalid.length} invalid`}
              {data.drive_folders.length > 0 && ` (from ${data.drive_folders.length} DONE_ folders)`}
            </span>
          )}
        </div>
        {data && validCount > 0 && (
          <button
            onClick={onUploadAll}
            disabled={uploadingIds.size > 0 || allDone}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${
              uploadingIds.size > 0 || allDone
                ? isDark
                  ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
                  : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {uploadingIds.size > 0 ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
            Upload All
            {uploadingIds.size > 0 && ` (${uploadingIds.size})`}
          </button>
        )}
      </div>

      {/* Search */}
      {data && (
        <div className="flex items-center gap-2 flex-shrink-0 my-4 px-1">
          <div className="relative flex-1">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-400'} pointer-events-none`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Filter stories..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`w-full pl-9 pr-8 py-2 border rounded-lg text-sm
                ${isDark
                  ? 'bg-slate-900/70 border-slate-700 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 focus:bg-slate-900'
                  : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500'
                }`}
            />
            {search && (
              <button onClick={() => setSearch('')}
                className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-400 hover:text-gray-600'}`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {search && (
            <span className={`text-xs shrink-0 hidden sm:inline ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
              {filteredUploadable.length + filteredInvalid.length + filteredAlready.length} result{filteredUploadable.length + filteredInvalid.length + filteredAlready.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className={`p-3 rounded-lg text-sm ${isDark ? 'bg-red-900/20 border border-red-800/50 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          {error}
        </div>
      )}

      {data && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {filteredInvalid.length > 0 && (
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                Invalid ({filteredInvalid.length}){q && ` matching "${search}"`}
              </p>
              {filteredInvalid.map(folder => (
                <div key={folder.id} className={`flex items-center gap-3 p-3 rounded-xl border mt-2 ${isDark ? 'bg-red-950/20 border-red-700/40' : 'bg-red-50 border-red-200'}`}>
                  <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(folder.prefix)}`}>
                    {folder.prefix}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-medium truncate ${isDark ? 'text-red-300' : 'text-red-700'}`}>{folder.display_name}</p>
                      {folder.validation_errors.map((err, i) => (
                        <ValidationErrorBadge key={i} error={err} isDark={isDark} />
                      ))}
                    </div>
                    <span className={`text-xs font-mono ${isDark ? 'text-red-400/80' : 'text-red-500'}`}>{folder.name}</span>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-lg whitespace-nowrap ${isDark ? 'text-red-400 bg-red-900/40 border border-red-700/50' : 'text-red-600 bg-red-100 border border-red-200'}`}>
                    Cannot Upload
                  </span>
                </div>
              ))}
            </div>
          )}

          {validCount > 0 && (
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider ${filteredInvalid.length > 0 ? 'mt-5 mb-3' : 'mb-3'} ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                Ready to Upload ({validCount}){q && ` matching "${search}"`}
              </p>
              {filteredUploadable.map(folder => {
                return (
                  <div key={folder.id} className={`flex items-center gap-3 p-3 rounded-xl border mt-2 ${isDark ? 'bg-slate-700/30 border-slate-700/40' : 'bg-gray-50 border-gray-200'}`}>
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(folder.prefix)}`}>
                      {folder.prefix}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>{folder.display_name}</p>
                      </div>
                      <span className={`text-xs font-mono ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{folder.name}</span>
                      {uploadResults.get(folder.id) && (
                        <p className={`text-xs mt-0.5 ${uploadResults.get(folder.id)!.success
                          ? (isDark ? 'text-emerald-400' : 'text-emerald-600')
                          : (isDark ? 'text-red-400' : 'text-red-600')}`}>
                          {uploadResults.get(folder.id)!.message}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => onUploadSingle(folder)}
                      disabled={uploadingIds.has(folder.id) || !!uploadResults.get(folder.id)?.success}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                        uploadingIds.has(folder.id) || !!uploadResults.get(folder.id)?.success
                          ? isDark
                            ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
                            : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                    >
                      {uploadingIds.has(folder.id) ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      ) : uploadResults.get(folder.id)?.success ? (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : null}
                      {uploadingIds.has(folder.id) ? 'Uploading...' : uploadResults.get(folder.id)?.success ? 'Uploaded' : 'Upload'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {filteredAlready.length > 0 && (
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider mt-5 mb-3 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                Already on Server ({filteredAlready.length}){q && ` matching "${search}"`}
              </p>
              {filteredAlready.map(folder => (
                <div key={folder.id} className={`flex items-center gap-3 p-3 rounded-xl mt-2 ${isDark ? 'bg-slate-800/40 border border-slate-700/30 opacity-60' : 'bg-gray-100 border border-gray-200 opacity-60'}`}>
                  <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(folder.prefix)}`}>
                    {folder.prefix}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{folder.display_name}</p>
                    <span className={`text-xs font-mono ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>{folder.name}</span>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-lg ${isDark ? 'text-slate-500 bg-slate-700/50' : 'text-gray-500 bg-gray-200'}`}>Already uploaded</span>
                </div>
              ))}
            </div>
          )}

          {!loading && !data && (
            <p className={`text-sm text-center py-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Click "Check Uploadable" to scan Drive folders against the server.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Updatable Tab ─────────────────────────────────────────────────────────────

interface UpdatableTabProps {
  data: CheckUpdatableResponse | null;
  loading: boolean;
  error: string;
  updateResults: Map<string, { success: boolean; message: string }>;
  updatingIds: Set<string>;
  onCheck: () => void;
  onUpdateSingle: (entry: UpdatableStoryEntry) => Promise<string>;
  onUpdateAll: () => void;
  invalid: UpdatableStoryEntry[];
  themeMode: ThemeMode;
}

function UpdatableTab({
  data,
  loading,
  error,
  updateResults,
  updatingIds,
  onCheck,
  onUpdateSingle,
  onUpdateAll,
  invalid = [],
  themeMode,
}: UpdatableTabProps) {
  const isDark = themeMode === 'dark';
  const [search, setSearch] = useState('');

  const q = search.toLowerCase().trim();

  const filteredUpdatable = data?.updatable.filter(e =>
    !q || e.folder.display_name.toLowerCase().includes(q) || e.server_story.title.toLowerCase().includes(q)
  ) ?? [];
  const filteredInvalid = invalid.filter(e =>
    !q || e.folder.display_name.toLowerCase().includes(q) || e.server_story.title.toLowerCase().includes(q)
  );
  const filteredNoUpdate = data?.no_update_needed.filter(e =>
    !q || e.folder.display_name.toLowerCase().includes(q) || e.server_story.title.toLowerCase().includes(q)
  ) ?? [];

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onCheck}
            disabled={loading}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${
              loading
                ? isDark
                  ? 'bg-indigo-900 text-gray-700 cursor-not-allowed'
                  : 'bg-indigo-300 text-indigo-800 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Checking...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Check Update
              </>
            )}
          </button>
          {data && (
            <span className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
              {filteredUpdatable.length} can update / {filteredNoUpdate.length} up-to-date
              {filteredInvalid.length > 0 && ` / ${filteredInvalid.length} invalid`}
              {data.all_extended_folders?.length ? ` (from ${data.all_extended_folders.length} EXTENDED_ folders)` : ''}
            </span>
          )}
        </div>
        {data && filteredUpdatable.length > 0 && (
          <button
            onClick={onUpdateAll}
            disabled={updatingIds.size > 0}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${
              updatingIds.size > 0
                ? isDark
                  ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
                  : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            {updatingIds.size > 0 ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            )}
            Update All
            {updatingIds.size > 0 && ` (${updatingIds.size})`}
          </button>
        )}
      </div>

      {/* Search */}
      {data && (
        <div className="flex items-center gap-2 flex-shrink-0 my-4 px-1">
          <div className="relative flex-1">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-400'} pointer-events-none`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Filter stories..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`w-full pl-9 pr-8 py-2 border rounded-lg text-sm
                ${isDark
                  ? 'bg-slate-900/70 border-slate-700 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 focus:bg-slate-900'
                  : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500'
                }`}
            />
            {search && (
              <button onClick={() => setSearch('')}
                className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-400 hover:text-gray-600'}`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {search && (
            <span className={`text-xs shrink-0 hidden sm:inline ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
              {filteredUpdatable.length + filteredInvalid.length + filteredNoUpdate.length} result{filteredUpdatable.length + filteredInvalid.length + filteredNoUpdate.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className={`p-3 rounded-lg text-sm ${isDark ? 'bg-red-900/20 border border-red-800/50 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          {error}
        </div>
      )}

      {data && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {filteredUpdatable.length > 0 && (
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                Ready to Update ({filteredUpdatable.length}){q && ` matching "${search}"`}
              </p>
              {filteredUpdatable.map((entry: UpdatableStoryEntry) => {
                const delta = (entry.folder.extended_chapter_count ?? 0) - entry.server_story.maxChapter;
                return (
                  <div key={entry.server_story.id} className={`flex items-center gap-3 p-3 rounded-xl mt-2 ${isDark ? 'bg-slate-700/30 border border-slate-700/40' : 'bg-gray-50 border border-gray-200'}`}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>{entry.folder.display_name}</p>
                      <span className={`text-xs font-mono ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.folder.name}</span>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                          Server: <span className={isDark ? 'text-slate-300' : 'text-gray-700'}>{entry.server_story.maxChapter}</span>
                        </span>
                        <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                        <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                          Drive: <span className={isDark ? 'text-slate-300' : 'text-gray-700'}>{entry.folder.extended_chapter_count ?? 0}</span>
                        </span>
                        {delta > 0 && (
                          <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${isDark ? 'bg-amber-900/60 text-amber-300 border-amber-700/50' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                            Ready to update {delta} chapter{delta > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {updateResults.get(entry.server_story.id) && (
                        <p className={`text-xs mt-0.5 ${updateResults.get(entry.server_story.id)!.success
                          ? (isDark ? 'text-emerald-400' : 'text-emerald-600')
                          : (isDark ? 'text-red-400' : 'text-red-600')}`}>
                          {updateResults.get(entry.server_story.id)!.message}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => onUpdateSingle(entry)}
                      disabled={updatingIds.has(entry.server_story.id) || !!updateResults.get(entry.server_story.id)?.success}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                        updatingIds.has(entry.server_story.id) || !!updateResults.get(entry.server_story.id)?.success
                          ? isDark
                            ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
                            : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                          : 'bg-amber-600 hover:bg-amber-500 text-white'
                      }`}
                    >
                      {updatingIds.has(entry.server_story.id) ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      ) : updateResults.get(entry.server_story.id)?.success ? (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : null}
                      {updatingIds.has(entry.server_story.id) ? 'Updating...' : updateResults.get(entry.server_story.id)?.success ? 'Updated' : 'Ready to Update'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {filteredInvalid.length > 0 && (
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider mt-5 mb-3 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                Invalid ({filteredInvalid.length}){q && ` matching "${search}"`}
              </p>
              {filteredInvalid.map(entry => (
                <div key={entry.server_story.id} className={`flex items-center gap-3 p-3 rounded-xl mt-2 ${isDark ? 'bg-red-950/20 border border-red-700/40' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-medium truncate ${isDark ? 'text-red-300' : 'text-red-700'}`}>{entry.folder.display_name}</p>
                      {entry.folder.validation_errors.map((err, i) => (
                        <ValidationErrorBadge key={i} error={err} isDark={isDark} />
                      ))}
                    </div>
                    <span className={`text-xs font-mono ${isDark ? 'text-red-400/80' : 'text-red-500'}`}>{entry.folder.name}</span>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        Server: <span className={isDark ? 'text-slate-300' : 'text-gray-700'}>{entry.server_story.maxChapter}</span>
                      </span>
                      <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                      <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        Drive: <span className={isDark ? 'text-slate-300' : 'text-gray-700'}>{entry.folder.extended_chapter_count ?? 0}</span>
                      </span>
                    </div>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-lg whitespace-nowrap ${isDark ? 'text-red-400 bg-red-900/40 border border-red-700/50' : 'text-red-600 bg-red-100 border border-red-200'}`}>
                    Cannot Update
                  </span>
                </div>
              ))}
            </div>
          )}

          {filteredNoUpdate.length > 0 && (
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider mt-5 mb-3 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                Up-to-Date ({filteredNoUpdate.length}){q && ` matching "${search}"`}
              </p>
              {filteredNoUpdate.map(entry => (
                <div key={entry.server_story.id} className={`flex items-center gap-3 p-3 rounded-xl mt-2 ${isDark ? 'bg-slate-800/40 border border-slate-700/30 opacity-60' : 'bg-gray-100 border border-gray-200 opacity-60'}`}>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{entry.folder.display_name}</p>
                    <span className={`text-xs font-mono ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>{entry.folder.name}</span>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        Server: <span className={isDark ? 'text-slate-300' : 'text-gray-700'}>{entry.server_story.maxChapter}</span>
                      </span>
                      <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                      <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                        Drive: <span className={isDark ? 'text-slate-300' : 'text-gray-700'}>{entry.folder.extended_chapter_count ?? 0}</span>
                      </span>
                    </div>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-lg ${isDark ? 'text-slate-500 bg-slate-700/50' : 'text-gray-500 bg-gray-200'}`}>Up-to-date</span>
                </div>
              ))}
            </div>
          )}

          {!loading && !data && (
            <p className={`text-sm text-center py-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Click "Check Update" to scan EXTENDED_ folders against the server.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── StorySyncTabs ─────────────────────────────────────────────────────────────

export type StorySyncTab = 'uploadable' | 'updatable';

export interface StorySyncTabsProps {
  config: DriveSyncConfig | null;
  activeTab: StorySyncTab;
  onTabChange: (tab: StorySyncTab) => void;
  themeMode: ThemeMode;
  uploadableData: CheckUploadableResponse | null;
  uploadableLoading: boolean;
  uploadableError: string;
  uploadResults: Map<string, { success: boolean; message: string }>;
  uploadingIds: Set<string>;
  onCheckUploadable: () => void;
  onUploadSingle: (folder: DriveFolderEntry) => Promise<string>;
  onUploadAll: () => void;
  updatableData: CheckUpdatableResponse | null;
  updatableLoading: boolean;
  updatableError: string;
  updateResults: Map<string, { success: boolean; message: string }>;
  updatingIds: Set<string>;
  onCheckUpdatable: () => void;
  onUpdateSingle: (entry: UpdatableStoryEntry) => Promise<string>;
  onUpdateAll: () => void;
  updatableInvalid: UpdatableStoryEntry[];
}

export function StorySyncTabs({
  config: _config,
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
}: StorySyncTabsProps) {
  const isDark = themeMode === 'dark';

  return (
    <section className={`rounded-2xl overflow-hidden flex flex-col ${isDark ? 'bg-slate-800/80 border border-slate-700/50' : 'bg-white border border-gray-200'}`}>
      {/* Tab bar with title and settings */}
      <div className={`px-4 pt-4 pb-0 flex items-center justify-between gap-4 ${isDark ? 'border-b border-slate-700/50' : 'border-b border-gray-200'}`}>
        <div className="flex flex-1 min-w-0">
          <button
            onClick={() => onTabChange('uploadable')}
            className={`px-4 pb-3 text-sm font-medium transition-colors flex items-center gap-2 border-b-2 ${
              activeTab === 'uploadable'
                ? 'text-indigo-600 border-indigo-600'
                : `${isDark ? 'text-slate-400' : 'text-gray-500'} border-transparent hover:${isDark ? 'text-slate-200' : 'text-gray-700'}`
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Check Uploadable
            {uploadableData && (
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                uploadableData.uploadable.length > 0
                  ? isDark ? 'bg-emerald-900/50 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                  : isDark ? 'bg-slate-700 text-slate-400' : 'bg-gray-100 text-gray-500'
              }`}>
                {uploadableData.uploadable.length}
              </span>
            )}
          </button>
          <button
            onClick={() => onTabChange('updatable')}
            className={`px-4 pb-3 text-sm font-medium transition-colors flex items-center gap-2 border-b-2 ${
              activeTab === 'updatable'
                ? 'text-indigo-600 border-indigo-600'
                : `${isDark ? 'text-slate-400' : 'text-gray-500'} border-transparent hover:${isDark ? 'text-slate-200' : 'text-gray-700'}`
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Update Chapters
            {updatableData && (
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                updatableData.updatable.length > 0
                  ? isDark ? 'bg-amber-900/50 text-amber-400' : 'bg-amber-100 text-amber-700'
                  : isDark ? 'bg-slate-700 text-slate-400' : 'bg-gray-100 text-gray-500'
              }`}>
                {updatableData.updatable.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'uploadable' && (
          <UploadableTab
            data={uploadableData}
            loading={uploadableLoading}
            error={uploadableError}
            uploadResults={uploadResults}
            uploadingIds={uploadingIds}
            onCheck={onCheckUploadable}
            onUploadSingle={onUploadSingle}
            onUploadAll={onUploadAll}
            themeMode={themeMode}
          />
        )}
          {activeTab === 'updatable' && (
          <UpdatableTab
            data={updatableData}
            loading={updatableLoading}
            error={updatableError}
            updateResults={updateResults}
            updatingIds={updatingIds}
            onCheck={onCheckUpdatable}
            onUpdateSingle={onUpdateSingle}
            onUpdateAll={onUpdateAll}
            invalid={updatableInvalid}
            themeMode={themeMode}
          />
        )}
      </div>
    </section>
  );
}
