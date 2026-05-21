import { useState } from 'react';
import {
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type DriveFolderEntry,
  type UpdatableStoryEntry,
  type DriveSyncConfig,
} from '../api/client';

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
}

function ValidationErrorBadge({ error }: { error: string }) {
  const isFormat = error.startsWith("WRONG FORMAT");
  return (
    <span className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded border ${
      isFormat
        ? 'bg-red-900/60 text-red-300 border-red-700/50'
        : 'bg-amber-900/60 text-amber-300 border-amber-700/50'
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
}: UploadableTabProps) {
  const [search, setSearch] = useState('');

  const statusColor = (prefix: string) => {
    if (prefix === 'DONE' || prefix === 'EXTENDED') return 'bg-emerald-900/50 text-emerald-400 border-emerald-700';
    if (prefix === 'ING') return 'bg-amber-900/50 text-amber-400 border-amber-700';
    return 'bg-slate-700/50 text-slate-400 border-slate-600';
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
            className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500
                       disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                       text-white rounded-lg transition-colors flex items-center gap-2"
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
            <span className="text-sm text-slate-400">
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
            className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500
                       disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                       text-white rounded-lg transition-colors flex items-center gap-2"
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
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Filter stories..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-900/70 border border-slate-700 text-slate-200
                         rounded-lg text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 focus:bg-slate-900"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 rounded">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {search && (
            <span className="text-xs text-slate-500 shrink-0 hidden sm:inline">
              {filteredUploadable.length + filteredInvalid.length + filteredAlready.length} result{filteredUploadable.length + filteredInvalid.length + filteredAlready.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {data && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {filteredInvalid.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">
                Invalid ({filteredInvalid.length}){q && ` matching "${search}"`}
              </p>
              {filteredInvalid.map(folder => (
                <div key={folder.id} className="flex items-center gap-3 p-3 rounded-xl border bg-red-950/20 border-red-700/40">
                  <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(folder.prefix)}`}>
                    {folder.prefix}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-red-300 truncate">{folder.display_name}</p>
                      {folder.validation_errors.map((err, i) => (
                        <ValidationErrorBadge key={i} error={err} />
                      ))}
                    </div>
                    <span className="text-xs font-mono text-red-400/80">{folder.name}</span>
                  </div>
                  <span className="px-2 py-1 text-xs text-red-400 rounded-lg bg-red-900/40 border border-red-700/50 whitespace-nowrap">
                    Cannot Upload
                  </span>
                </div>
              ))}
            </div>
          )}

          {validCount > 0 && (
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider ${filteredInvalid.length > 0 ? 'mt-5 mb-3' : 'mb-3'} text-emerald-400`}>
                Ready to Upload ({validCount}){q && ` matching "${search}"`}
              </p>
              {filteredUploadable.map(folder => {
                return (
                  <div key={folder.id} className="flex items-center gap-3 p-3 rounded-xl border bg-slate-700/30 border-slate-700/40">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(folder.prefix)}`}>
                      {folder.prefix}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-200 truncate">{folder.display_name}</p>
                      </div>
                      <span className="text-xs font-mono text-slate-500">{folder.name}</span>
                      {uploadResults.get(folder.id) && (
                        <p className={`text-xs mt-0.5 ${uploadResults.get(folder.id)!.success ? 'text-emerald-400' : 'text-red-400'}`}>
                          {uploadResults.get(folder.id)!.message}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => onUploadSingle(folder)}
                      disabled={uploadingIds.has(folder.id) || !!uploadResults.get(folder.id)?.success}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap
                                 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white"
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
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-5 mb-3">
                Already on Server ({filteredAlready.length}){q && ` matching "${search}"`}
              </p>
              {filteredAlready.map(folder => (
                <div key={folder.id} className="flex items-center gap-3 p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl opacity-60">
                  <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${statusColor(folder.prefix)}`}>
                    {folder.prefix}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-400 font-medium truncate">{folder.display_name}</p>
                    <span className="text-xs text-slate-500 font-mono">{folder.name}</span>
                  </div>
                  <span className="px-2 py-1 text-xs text-slate-500 rounded-lg bg-slate-700/50">Already uploaded</span>
                </div>
              ))}
            </div>
          )}

          {!loading && !data && (
            <p className="text-sm text-slate-500 text-center py-4">Click "Check Uploadable" to scan Drive folders against the server.</p>
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
}: UpdatableTabProps) {
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
            className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500
                       disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                       text-white rounded-lg transition-colors flex items-center gap-2"
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
            <span className="text-sm text-slate-400">
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
            className="px-4 py-2 text-sm font-semibold bg-amber-600 hover:bg-amber-500
                       disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                       text-white rounded-lg transition-colors flex items-center gap-2"
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
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Filter stories..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-900/70 border border-slate-700 text-slate-200
                         rounded-lg text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 focus:bg-slate-900"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 rounded">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {search && (
            <span className="text-xs text-slate-500 shrink-0 hidden sm:inline">
              {filteredUpdatable.length + filteredInvalid.length + filteredNoUpdate.length} result{filteredUpdatable.length + filteredInvalid.length + filteredNoUpdate.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {data && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {filteredUpdatable.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">
                Ready to Update ({filteredUpdatable.length}){q && ` matching "${search}"`}
              </p>
              {filteredUpdatable.map((entry: UpdatableStoryEntry) => {
                const delta = (entry.folder.extended_chapter_count ?? 0) - entry.server_story.maxChapter;
                return (
                  <div key={entry.server_story.id} className="flex items-center gap-3 p-3 bg-slate-700/30 border border-slate-700/40 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 font-medium truncate">{entry.folder.display_name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-slate-500">
                          Server: <span className="text-slate-300">{entry.server_story.maxChapter}</span>
                        </span>
                        <svg className="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                        <span className="text-xs text-slate-500">
                          Drive: <span className="text-slate-300">{entry.folder.extended_chapter_count ?? 0}</span>
                        </span>
                        {delta > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded border bg-amber-900/60 text-amber-300 border-amber-700/50">
                            Ready to update {delta} chapter{delta > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {updateResults.get(entry.server_story.id) && (
                        <p className={`text-xs mt-0.5 ${updateResults.get(entry.server_story.id)!.success ? 'text-emerald-400' : 'text-red-400'}`}>
                          {updateResults.get(entry.server_story.id)!.message}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => onUpdateSingle(entry)}
                      disabled={updatingIds.has(entry.server_story.id) || !!updateResults.get(entry.server_story.id)?.success}
                      className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500
                                 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                                 text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
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
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mt-5 mb-3">
                Invalid ({filteredInvalid.length}){q && ` matching "${search}"`}
              </p>
              {filteredInvalid.map(entry => (
                <div key={entry.server_story.id} className="flex items-center gap-3 p-3 bg-red-950/20 border border-red-700/40 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-red-300 truncate">{entry.folder.display_name}</p>
                      {entry.folder.validation_errors.map((err, i) => (
                        <ValidationErrorBadge key={i} error={err} />
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-slate-500">
                        Server: <span className="text-slate-300">{entry.server_story.maxChapter}</span>
                      </span>
                      <svg className="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                      <span className="text-xs text-slate-500">
                        Drive: <span className="text-slate-300">{entry.folder.extended_chapter_count ?? 0}</span>
                      </span>
                    </div>
                  </div>
                  <span className="px-2 py-1 text-xs text-red-400 rounded-lg bg-red-900/40 border border-red-700/50 whitespace-nowrap">
                    Cannot Update
                  </span>
                </div>
              ))}
            </div>
          )}

          {filteredNoUpdate.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-5 mb-3">
                Up-to-Date ({filteredNoUpdate.length}){q && ` matching "${search}"`}
              </p>
              {filteredNoUpdate.map(entry => (
                <div key={entry.server_story.id} className="flex items-center gap-3 p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl opacity-60">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-400 font-medium truncate">{entry.folder.display_name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-slate-500">
                        Server: <span className="text-slate-300">{entry.server_story.maxChapter}</span>
                      </span>
                      <svg className="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                      <span className="text-xs text-slate-500">
                        Drive: <span className="text-slate-300">{entry.folder.extended_chapter_count ?? 0}</span>
                      </span>
                    </div>
                  </div>
                  <span className="px-2 py-1 text-xs text-slate-500 rounded-lg bg-slate-700/50">Up-to-date</span>
                </div>
              ))}
            </div>
          )}

          {!loading && !data && (
            <p className="text-sm text-slate-500 text-center py-4">Click "Check Update" to scan EXTENDED_ folders against the server.</p>
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
  onOpenSettings: () => void;
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
  onOpenSettings,
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
  return (
    <section className="bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden flex flex-col">
      {/* Tab bar with title and settings */}
      <div className="px-4 pt-4 pb-0 border-b border-slate-700/50 flex items-center justify-between gap-4">
        <div className="flex flex-1 min-w-0">
          <button
            onClick={() => onTabChange('uploadable')}
            className={`px-4 pb-3 text-sm font-medium transition-colors flex items-center gap-2 border-b-2 ${
              activeTab === 'uploadable'
                ? 'text-indigo-400 border-indigo-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Check Uploadable
            {uploadableData && (
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                uploadableData.uploadable.length > 0 ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-700 text-slate-400'
              }`}>
                {uploadableData.uploadable.length}
              </span>
            )}
          </button>
          <button
            onClick={() => onTabChange('updatable')}
            className={`px-4 pb-3 text-sm font-medium transition-colors flex items-center gap-2 border-b-2 ${
              activeTab === 'updatable'
                ? 'text-indigo-400 border-indigo-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Update Chapters
            {updatableData && (
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                updatableData.updatable.length > 0 ? 'bg-amber-900/50 text-amber-400' : 'bg-slate-700 text-slate-400'
              }`}>
                {updatableData.updatable.length}
              </span>
            )}
          </button>
        </div>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-colors mb-1"
          title="Drive Sync Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
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
          />
        )}
      </div>
    </section>
  );
}
