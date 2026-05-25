import { useState } from 'react';
import {
  type CheckUploadableResponse,
  type CheckUpdatableResponse,
  type DriveFolderEntry,
  type UpdatableStoryEntry,
  type DriveSyncConfig,
} from '../api/client';
import { type ThemeMode } from '../components/ThemeToggle';

function ValidationErrorBadge({ error, isDark }: { error: string; isDark: boolean }) {
  const isFormat = error.startsWith("WRONG FORMAT");
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-lg border ${
      isFormat
        ? isDark
          ? 'bg-red-900/30 text-red-400 border-red-800/40'
          : 'bg-red-100 text-red-700 border-red-200'
        : isDark
          ? 'bg-amber-900/30 text-amber-400 border-amber-800/40'
          : 'bg-amber-100 text-amber-700 border-amber-200'
    }`}>
      <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
      </svg>
      {error}
    </span>
  );
}

function StatusBadge({ prefix, isDark }: { prefix: string; isDark: boolean }) {
  const isDone = prefix === 'DONE' || prefix === 'EXTENDED';
  const isIng = prefix === 'ING';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md border ${
      isDone
        ? isDark
          ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800/40'
          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : isIng
          ? isDark
            ? 'bg-amber-900/40 text-amber-400 border-amber-800/40'
            : 'bg-amber-50 text-amber-700 border-amber-200'
          : isDark
            ? 'bg-slate-700/50 text-slate-400 border-slate-600/40'
            : 'bg-gray-100 text-gray-600 border-gray-300'
    }`}>
      {prefix}
    </span>
  );
}

function EmptyState({ message, icon, isDark }: { message: string; icon: React.ReactNode; isDark: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 rounded-2xl ${isDark ? 'bg-slate-900/40' : 'bg-gray-50'}`}>
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${isDark ? 'bg-slate-800/60' : 'bg-white border border-gray-200'}`}>
        {icon}
      </div>
      <p className={`text-sm text-center max-w-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{message}</p>
    </div>
  );
}

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
  const [filterSection, setFilterSection] = useState<'all' | 'ready' | 'invalid' | 'uploaded'>('all');

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
  const isUploadingAny = uploadingIds.size > 0;
  const successCount = Array.from(uploadResults.values()).filter(r => r.success).length;
  const failedCount = Array.from(uploadResults.values()).filter(r => !r.success).length;

  return (
    <div className="flex flex-col min-h-[400px]">
      {/* Toolbar - Sticky at top */}
      <div className={`flex flex-col sm:flex-row gap-3 p-4 sticky top-0 z-10 ${isDark ? 'bg-slate-900/95 backdrop-blur-sm border-b border-slate-800/60' : 'bg-white/95 backdrop-blur-sm border-b border-gray-200'}`}>
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition-colors
              ${isDark
                ? 'bg-slate-800/60 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'
                : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'
              }`}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-400 hover:text-gray-600'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onCheck}
            disabled={loading}
            className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
              loading
                ? isDark
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : isDark
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
            }`}
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Scanning...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Scan Drive
              </>
            )}
          </button>

          {data && validCount > 0 && (
            <button
              onClick={onUploadAll}
              disabled={isUploadingAny || allDone}
              className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                isUploadingAny || allDone
                  ? isDark
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : isDark
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
              }`}
            >
              {isUploadingAny ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Uploading ({isUploadingAny})
                </>
              ) : allDone ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  All Uploaded
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload All ({validCount})
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className={`mx-4 mt-4 flex items-center gap-3 p-3 rounded-xl text-sm ${isDark ? 'bg-red-900/20 border border-red-800/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {error}
        </div>
      )}

      {/* Filter tabs */}
      {data && (
        <div className={`flex items-center gap-1 px-4 py-2 ${isDark ? 'bg-slate-900/60 border-b border-slate-800/60' : 'bg-gray-50/50 border-b border-gray-200'}`}>
          <button
            onClick={() => setFilterSection('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterSection === 'all'
                ? isDark ? 'bg-slate-800 text-slate-200' : 'bg-white text-gray-700 shadow-sm'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            All ({filteredUploadable.length + filteredInvalid.length + filteredAlready.length})
          </button>
          <button
            onClick={() => setFilterSection('ready')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterSection === 'ready'
                ? isDark ? 'bg-emerald-900/40 text-emerald-400' : 'bg-emerald-50 text-emerald-700'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Ready ({validCount})
          </button>
          <button
            onClick={() => setFilterSection('invalid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterSection === 'invalid'
                ? isDark ? 'bg-red-900/40 text-red-400' : 'bg-red-50 text-red-700'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Invalid ({filteredInvalid.length})
          </button>
          <button
            onClick={() => setFilterSection('uploaded')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterSection === 'uploaded'
                ? isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-700'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Uploaded ({filteredAlready.length})
          </button>
        </div>
      )}

      {/* Results summary */}
      {data && !loading && (
        <div className={`mx-4 mt-3 flex flex-wrap items-center gap-3 px-4 py-2 rounded-xl text-xs ${isDark ? 'bg-slate-900/60' : 'bg-white border border-gray-200'}`}>
          {data.drive_folders.length > 0 && (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {data.drive_folders.length} DONE_
            </div>
          )}
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
            <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {validCount} ready to upload
          </div>
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
            <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            {filteredAlready.length} uploaded
          </div>
          {filteredInvalid.length > 0 && (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {filteredInvalid.length} invalid
            </div>
          )}
          {successCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-emerald-500">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {successCount} successful
            </div>
          )}
          {failedCount > 0 && (
            <div className={`ml-auto flex items-center gap-1.5 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {failedCount} failed
            </div>
          )}
        </div>
      )}

      {/* Content - Scrollable item list */}
      <div className="flex-1 overflow-y-auto p-4">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Scan Drive' to check for stories ready to upload to your Google Drive."
            icon={
              <svg className={`w-8 h-8 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            }
          />
        )}

        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-slate-900/60' : 'bg-gray-100'}`}>
              <svg className="w-8 h-8 animate-spin text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Scanning your Drive folders...</p>
          </div>
        )}

        {data && filterSection === 'all' && (
          <>
            {filteredInvalid.length > 0 && (
              <div className="mb-4">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Invalid ({filteredInvalid.length})
                </h3>
                <div className="space-y-2">
                  {filteredInvalid.map(folder => (
                    <div key={folder.id} className={`p-4 rounded-xl border ${isDark ? 'bg-red-950/20 border-red-800/30' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge prefix={folder.prefix} isDark={isDark} />
                            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-red-300' : 'text-red-700'}`}>{folder.display_name}</h4>
                          </div>
                          <p className={`text-xs font-mono mb-2 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>{folder.name}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {folder.validation_errors.map((err, i) => (
                              <ValidationErrorBadge key={i} error={err} isDark={isDark} />
                            ))}
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-lg self-start ${isDark ? 'text-red-400 bg-red-900/40 border border-red-800/40' : 'text-red-600 bg-red-100 border border-red-200'}`}>
                          Cannot Upload
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {validCount > 0 && (
              <div className="mb-4">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Ready to Upload ({validCount})
                </h3>
                <div className="space-y-2">
                  {filteredUploadable.map(folder => {
                    const result = uploadResults.get(folder.id);
                    const isUploading = uploadingIds.has(folder.id);
                    const isSuccess = result?.success;
                    const isFailed = result && !result.success;

                    return (
                      <div key={folder.id} className={`p-4 rounded-xl border transition-colors ${isDark ? 'bg-slate-900/40 border-slate-800/60' : 'bg-white border-gray-200'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <StatusBadge prefix={folder.prefix} isDark={isDark} />
                              <h4 className={`text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>{folder.display_name}</h4>
                            </div>
                            <p className={`text-xs font-mono ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{folder.name}</p>
                            {result && (
                              <p className={`text-xs mt-1.5 flex items-center gap-1 ${isSuccess ? 'text-emerald-500' : isFailed ? 'text-red-500' : ''}`}>
                                {isSuccess && (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    {result.message}
                                  </>
                                )}
                                {isFailed && (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    {result.message}
                                  </>
                                )}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => onUploadSingle(folder)}
                            disabled={isUploading || isSuccess}
                            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                              isUploading
                                ? isDark
                                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                : isSuccess
                                  ? isDark
                                    ? 'bg-emerald-900/40 text-emerald-400 cursor-default'
                                    : 'bg-emerald-50 text-emerald-600 cursor-default'
                                  : isDark
                                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                            }`}
                          >
                            {isUploading ? (
                              <>
                                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Uploading...
                              </>
                            ) : isSuccess ? (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Uploaded
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Upload
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {filteredAlready.length > 0 && (
              <div>
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Already on Server ({filteredAlready.length})
                </h3>
                <div className="space-y-2">
                  {filteredAlready.map(folder => (
                    <div key={folder.id} className={`p-4 rounded-xl ${isDark ? 'bg-slate-900/20 border border-slate-800/40' : 'bg-gray-50 border border-gray-200'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge prefix={folder.prefix} isDark={isDark} />
                            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{folder.display_name}</h4>
                          </div>
                          <p className={`text-xs font-mono ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>{folder.name}</p>
                        </div>
                        <span className={`px-3 py-1 text-xs font-medium rounded-lg ${isDark ? 'text-slate-500 bg-slate-800/60' : 'text-gray-500 bg-gray-200'}`}>
                          Already uploaded
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {data && filterSection === 'ready' && validCount > 0 && (
          <div className="space-y-2">
            {filteredUploadable.map(folder => {
              const result = uploadResults.get(folder.id);
              const isUploading = uploadingIds.has(folder.id);
              const isSuccess = result?.success;

              return (
                <div key={folder.id} className={`p-4 rounded-xl border ${isDark ? 'bg-slate-900/40 border-slate-800/60' : 'bg-white border-gray-200'}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge prefix={folder.prefix} isDark={isDark} />
                        <h4 className={`text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>{folder.display_name}</h4>
                      </div>
                      <p className={`text-xs font-mono ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{folder.name}</p>
                      {result && (
                        <p className={`text-xs mt-1.5 ${isSuccess ? 'text-emerald-500' : 'text-red-500'}`}>
                          {result.message}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => onUploadSingle(folder)}
                      disabled={isUploading || isSuccess}
                      className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                        isUploading
                          ? isDark
                            ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                            : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                          : isSuccess
                            ? isDark
                              ? 'bg-emerald-900/40 text-emerald-400 cursor-default'
                              : 'bg-emerald-50 text-emerald-600 cursor-default'
                            : isDark
                              ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                      }`}
                    >
                      {isUploading ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Uploading...
                        </>
                      ) : isSuccess ? (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Uploaded
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                          Upload
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data && filterSection === 'invalid' && filteredInvalid.length > 0 && (
          <div className="space-y-2">
            {filteredInvalid.map(folder => (
              <div key={folder.id} className={`p-4 rounded-xl border ${isDark ? 'bg-red-950/20 border-red-800/30' : 'bg-red-50 border-red-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge prefix={folder.prefix} isDark={isDark} />
                      <h4 className={`text-sm font-medium truncate ${isDark ? 'text-red-300' : 'text-red-700'}`}>{folder.display_name}</h4>
                    </div>
                    <p className={`text-xs font-mono mb-2 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>{folder.name}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {folder.validation_errors.map((err, i) => (
                        <ValidationErrorBadge key={i} error={err} isDark={isDark} />
                      ))}
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-lg self-start ${isDark ? 'text-red-400 bg-red-900/40 border border-red-800/40' : 'text-red-600 bg-red-100 border border-red-200'}`}>
                    Cannot Upload
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && filterSection === 'uploaded' && filteredAlready.length > 0 && (
          <div className="space-y-2">
            {filteredAlready.map(folder => (
              <div key={folder.id} className={`p-4 rounded-xl ${isDark ? 'bg-slate-900/20 border border-slate-800/40' : 'bg-gray-50 border border-gray-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge prefix={folder.prefix} isDark={isDark} />
                      <h4 className={`text-sm font-medium truncate ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{folder.display_name}</h4>
                    </div>
                    <p className={`text-xs font-mono ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>{folder.name}</p>
                  </div>
                  <span className={`px-3 py-1 text-xs font-medium rounded-lg ${isDark ? 'text-slate-500 bg-slate-800/60' : 'text-gray-500 bg-gray-200'}`}>
                    Already uploaded
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && (
          ((filterSection === 'ready' && validCount === 0) ||
           (filterSection === 'invalid' && filteredInvalid.length === 0) ||
           (filterSection === 'uploaded' && filteredAlready.length === 0)) && (
            <div className={`text-center py-8 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
              <svg className={`w-8 h-8 mx-auto mb-2 ${isDark ? 'text-slate-700' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm">No items in this section</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

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
  const [filterSection, setFilterSection] = useState<'all' | 'ready' | 'invalid' | 'uptodate'>('all');

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

  const updateCount = filteredUpdatable.length;
  const isUpdatingAny = updatingIds.size > 0;
  const successCount = Array.from(updateResults.values()).filter(r => r.success).length;
  const failedCount = Array.from(updateResults.values()).filter(r => !r.success).length;

  return (
    <div className="flex flex-col min-h-[400px]">
      {/* Toolbar - Sticky at top */}
      <div className={`flex flex-col sm:flex-row gap-3 p-4 sticky top-0 z-10 ${isDark ? 'bg-slate-900/95 backdrop-blur-sm border-b border-slate-800/60' : 'bg-white/95 backdrop-blur-sm border-b border-gray-200'}`}>
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition-colors
              ${isDark
                ? 'bg-slate-800/60 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'
                : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'
              }`}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-400 hover:text-gray-600'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onCheck}
            disabled={loading}
            className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
              loading
                ? isDark
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : isDark
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
            }`}
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Scanning...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Check Updates
              </>
            )}
          </button>

          {data && updateCount > 0 && (
            <button
              onClick={onUpdateAll}
              disabled={isUpdatingAny}
              className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                isUpdatingAny
                  ? isDark
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : isDark
                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                    : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
              }`}
            >
              {isUpdatingAny ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Updating ({isUpdatingAny})
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Update All ({updateCount})
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      {data && (
        <div className={`flex items-center gap-1 px-4 py-2 ${isDark ? 'bg-slate-900/60 border-b border-slate-800/60' : 'bg-gray-50/50 border-b border-gray-200'}`}>
py          <button
            onClick={() => setFilterSection('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterSection === 'all'
                ? isDark ? 'bg-slate-800 text-slate-200' : 'bg-white text-gray-700 shadow-sm'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            All ({filteredUpdatable.length + filteredInvalid.length + filteredNoUpdate.length})
          </button>
          <button
            onClick={() => setFilterSection('ready')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterSection === 'ready'
                ? isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-50 text-amber-700'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Can Update ({updateCount})
          </button>
          <button
            onClick={() => setFilterSection('invalid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterSection === 'invalid'
                ? isDark ? 'bg-red-900/40 text-red-400' : 'bg-red-50 text-red-700'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Invalid ({filteredInvalid.length})
          </button>
          <button
            onClick={() => setFilterSection('uptodate')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterSection === 'uptodate'
                ? isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-700'
                : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Up-to-date ({filteredNoUpdate.length})
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className={`mx-4 mt-3 flex items-center gap-3 p-3 rounded-xl text-sm ${isDark ? 'bg-red-900/20 border border-red-800/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {error}
        </div>
      )}

      {/* Results summary */}
      {data && !loading && (
        <div className={`mx-4 mt-3 flex flex-wrap items-center gap-3 px-4 py-2 rounded-xl text-xs ${isDark ? 'bg-slate-900/60' : 'bg-white border border-gray-200'}`}>
          {data.all_extended_folders?.length ? (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {data.all_extended_folders.length} EXTENDED_
            </div>
          ) : null}
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
            <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            {updateCount} can update
          </div>
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
            <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {filteredNoUpdate.length} up-to-date
          </div>
          {filteredInvalid.length > 0 && (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
              <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {filteredInvalid.length} invalid
            </div>
          )}
          {successCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-emerald-500">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {successCount} updated
            </div>
          )}
          {failedCount > 0 && (
            <div className={`ml-auto flex items-center gap-1.5 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {failedCount} failed
            </div>
          )}
        </div>
      )}

      {/* Content - Scrollable item list */}
      <div className="flex-1 overflow-y-auto p-4">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Check Updates' to scan for stories with new chapters to sync."
            icon={
              <svg className={`w-8 h-8 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
          />
        )}

        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-slate-900/60' : 'bg-gray-100'}`}>
              <svg className="w-8 h-8 animate-spin text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Checking for updates...</p>
          </div>
        )}

        {data && filterSection === 'all' && (
          <>
            {updateCount > 0 && (
              <div className="mb-4">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Ready to Update ({updateCount})
                </h3>
                <div className="space-y-2">
                  {filteredUpdatable.map((entry: UpdatableStoryEntry) => {
                    const delta = (entry.folder.extended_chapter_count ?? 0) - entry.server_story.maxChapter;
                    const result = updateResults.get(entry.server_story.id);
                    const isUpdating = updatingIds.has(entry.server_story.id);
                    const isSuccess = result?.success;
                    const isFailed = result && !result.success;

                    return (
                      <div key={entry.server_story.id} className={`p-4 rounded-xl border ${isDark ? 'bg-slate-900/40 border-slate-800/60' : 'bg-white border-gray-200'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className={`text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>{entry.folder.display_name}</h4>
                              {delta > 0 && (
                                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>
                                  +{delta} ch
                                </span>
                              )}
                            </div>
                            <p className={`text-xs font-mono mb-2 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.folder.name}</p>
                            <div className="flex items-center gap-3 text-xs">
                              <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                                <span>Server:</span>
                                <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                              </div>
                              <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                              </svg>
                              <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                                <span>Drive:</span>
                                <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                              </div>
                            </div>
                            {result && (
                              <p className={`text-xs mt-1.5 flex items-center gap-1 ${isSuccess ? 'text-emerald-500' : isFailed ? 'text-red-500' : ''}`}>
                                {isSuccess && (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    {result.message}
                                  </>
                                )}
                                {isFailed && (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    {result.message}
                                  </>
                                )}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => onUpdateSingle(entry)}
                            disabled={isUpdating || isSuccess}
                            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                              isUpdating
                                ? isDark
                                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                : isSuccess
                                  ? isDark
                                    ? 'bg-emerald-900/40 text-emerald-400 cursor-default'
                                    : 'bg-emerald-50 text-emerald-600 cursor-default'
                                  : isDark
                                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                                    : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                            }`}
                          >
                            {isUpdating ? (
                              <>
                                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Updating...
                              </>
                            ) : isSuccess ? (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Updated
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                                Update
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {filteredInvalid.length > 0 && (
              <div className="mb-4">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Invalid ({filteredInvalid.length})
                </h3>
                <div className="space-y-2">
                  {filteredInvalid.map(entry => (
                    <div key={entry.server_story.id} className={`p-4 rounded-xl border ${isDark ? 'bg-red-950/20 border-red-800/30' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-red-300' : 'text-red-700'}`}>{entry.folder.display_name}</h4>
                          </div>
                          <p className={`text-xs font-mono mb-2 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>{entry.folder.name}</p>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {entry.folder.validation_errors.map((err, i) => (
                              <ValidationErrorBadge key={i} error={err} isDark={isDark} />
                            ))}
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                              <span>Server:</span>
                              <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                            </div>
                            <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                            </svg>
                            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                              <span>Drive:</span>
                              <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-lg self-start ${isDark ? 'text-red-400 bg-red-900/40 border border-red-800/40' : 'text-red-600 bg-red-100 border border-red-200'}`}>
                          Cannot Update
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filteredNoUpdate.length > 0 && (
              <div>
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Up-to-Date ({filteredNoUpdate.length})
                </h3>
                <div className="space-y-2">
                  {filteredNoUpdate.map(entry => (
                    <div key={entry.server_story.id} className={`p-4 rounded-xl ${isDark ? 'bg-slate-900/20 border border-slate-800/40' : 'bg-gray-50 border border-gray-200'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-sm font-medium truncate mb-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.folder.display_name}</h4>
                          <p className={`text-xs font-mono ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>{entry.folder.name}</p>
                          <div className="flex items-center gap-3 text-xs mt-1.5">
                            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-500' : 'text-gray-600'}`}>
                              <span>Server:</span>
                              <span className={`font-semibold ${isDark ? 'text-slate-400' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                            </div>
                            <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                            </svg>
                            <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-500' : 'text-gray-600'}`}>
                              <span>Drive:</span>
                              <span className={`font-semibold ${isDark ? 'text-slate-400' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`px-3 py-1 text-xs font-medium rounded-lg ${isDark ? 'text-slate-500 bg-slate-800/60' : 'text-gray-500 bg-gray-200'}`}>
                          Up-to-date
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {data && filterSection === 'ready' && updateCount > 0 && (
          <div className="space-y-2">
            {filteredUpdatable.map((entry: UpdatableStoryEntry) => {
              const delta = (entry.folder.extended_chapter_count ?? 0) - entry.server_story.maxChapter;
              const result = updateResults.get(entry.server_story.id);
              const isUpdating = updatingIds.has(entry.server_story.id);
              const isSuccess = result?.success;

              return (
                <div key={entry.server_story.id} className={`p-4 rounded-xl border ${isDark ? 'bg-slate-900/40 border-slate-800/60' : 'bg-white border-gray-200'}`}>
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className={`text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>{entry.folder.display_name}</h4>
                        {delta > 0 && (
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>
                            +{delta} ch
                          </span>
                        )}
                      </div>
                      <p className={`text-xs font-mono mb-2 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.folder.name}</p>
                      <div className="flex items-center gap-3 text-xs">
                        <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                          <span>Server:</span>
                          <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                        </div>
                        <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                        <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                          <span>Drive:</span>
                          <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                        </div>
                      </div>
                      {result && (
                        <p className={`text-xs mt-1.5 ${isSuccess ? 'text-emerald-500' : 'text-red-500'}`}>
                          {result.message}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => onUpdateSingle(entry)}
                      disabled={isUpdating || isSuccess}
                      className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                        isUpdating
                          ? isDark
                            ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                            : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                          : isSuccess
                            ? isDark
                              ? 'bg-emerald-900/40 text-emerald-400 cursor-default'
                              : 'bg-emerald-50 text-emerald-600 cursor-default'
                            : isDark
                              ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                              : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20'
                      }`}
                    >
                      {isUpdating ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Updating...
                        </>
                      ) : isSuccess ? (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Updated
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                          </svg>
                          Update
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data && filterSection === 'invalid' && filteredInvalid.length > 0 && (
          <div className="space-y-2">
            {filteredInvalid.map(entry => (
              <div key={entry.server_story.id} className={`p-4 rounded-xl border ${isDark ? 'bg-red-950/20 border-red-800/30' : 'bg-red-50 border-red-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {entry.folder.validation_errors.map((err, i) => (
                        <ValidationErrorBadge key={i} error={err} isDark={isDark} />
                      ))}
                    </div>
                    <h4 className={`text-sm font-medium truncate mb-1 ${isDark ? 'text-red-300' : 'text-red-700'}`}>{entry.folder.display_name}</h4>
                    <p className={`text-xs font-mono ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>{entry.folder.name}</p>
                    <div className="flex items-center gap-3 text-xs mt-1.5">
                      <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                        <span>Server:</span>
                        <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                      </div>
                      <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                      <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                        <span>Drive:</span>
                        <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                      </div>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-lg self-start ${isDark ? 'text-red-400 bg-red-900/40 border border-red-800/40' : 'text-red-600 bg-red-100 border border-red-200'}`}>
                    Cannot Update
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && filterSection === 'uptodate' && filteredNoUpdate.length > 0 && (
          <div className="space-y-2">
            {filteredNoUpdate.map(entry => (
              <div key={entry.server_story.id} className={`p-4 rounded-xl ${isDark ? 'bg-slate-900/20 border border-slate-800/40' : 'bg-gray-50 border border-gray-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className={`text-sm font-medium truncate mb-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{entry.folder.display_name}</h4>
                    <p className={`text-xs font-mono ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>{entry.folder.name}</p>
                    <div className="flex items-center gap-3 text-xs mt-1.5">
                      <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-500' : 'text-gray-600'}`}>
                        <span>Server:</span>
                        <span className={`font-semibold ${isDark ? 'text-slate-400' : 'text-gray-700'}`}>{entry.server_story.maxChapter}</span>
                      </div>
                      <svg className={`w-3 h-3 ${isDark ? 'text-slate-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                      <div className={`flex items-center gap-1.5 ${isDark ? 'text-slate-500' : 'text-gray-600'}`}>
                        <span>Drive:</span>
                        <span className={`font-semibold ${isDark ? 'text-slate-400' : 'text-gray-700'}`}>{entry.folder.extended_chapter_count ?? 0}</span>
                      </div>
                    </div>
                  </div>
                  <span className={`px-3 py-1 text-xs font-medium rounded-lg ${isDark ? 'text-slate-500 bg-slate-800/60' : 'text-gray-500 bg-gray-200'}`}>
                    Up-to-date
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && (
          ((filterSection === 'ready' && updateCount === 0) ||
           (filterSection === 'invalid' && filteredInvalid.length === 0) ||
           (filterSection === 'uptodate' && filteredNoUpdate.length === 0)) && (
            <div className={`text-center py-8 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
              <svg className={`w-8 h-8 mx-auto mb-2 ${isDark ? 'text-slate-700' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">No items in this section</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

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

  const uploadableCount = uploadableData?.uploadable.length ?? 0;
  const updatableCount = updatableData?.updatable.length ?? 0;

  return (
    <div className={`rounded-2xl shadow-xl shadow-black/5 ${isDark ? 'bg-slate-900/80 backdrop-blur-sm border border-slate-800/60' : 'bg-white border border-gray-200'}`}>
      {/* Tab bar */}
      <div className={`flex items-stretch ${isDark ? 'bg-slate-900/40 border-b border-slate-800/60' : 'bg-gray-50/80 border-b border-gray-200'}`}>
        <button
          onClick={() => onTabChange('uploadable')}
          className={`flex-1 flex items-center justify-center gap-2.5 px-4 sm:px-6 py-4 text-sm font-semibold transition-all duration-200 relative ${
            activeTab === 'uploadable'
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
            <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
              activeTab === 'uploadable'
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
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 to-violet-500`} />
          )}
        </button>

        <div className={`w-px ${isDark ? 'bg-slate-800/60' : 'bg-gray-200'}`} />

        <button
          onClick={() => onTabChange('updatable')}
          className={`flex-1 flex items-center justify-center gap-2.5 px-4 sm:px-6 py-4 text-sm font-semibold transition-all duration-200 relative ${
            activeTab === 'updatable'
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
            <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
              activeTab === 'updatable'
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
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 to-orange-500`} />
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="h-[calc(100vh-280px)] sm:min-h-[500px] sm:max-h-[calc(100vh-280px)] overflow-y-auto">
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
    </div>
  );
}
