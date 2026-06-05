import { useState } from 'react';
import {
  type CheckUploadableResponse,
  type DriveFolderEntry,
} from '../api/client';
import { Icon, appIcons } from './Icon';
import type { ThemeMode } from '../types/theme';
import { ValidationErrorBadge, StatusBadge, EmptyState } from './SyncTabShared';

interface UploadTabProps {
  data: CheckUploadableResponse | null;
  loading: boolean;
  error: string;
  uploadResults: Map<string, { success: boolean; message: string }>;
  uploadingIds: Set<string>;
  onCheck: () => void;
  onUploadSingle: (folder: DriveFolderEntry) => Promise<string>;
  onRequestUploadAll: () => void;
  themeMode: ThemeMode;
}

export function UploadTab({
  data,
  loading,
  error,
  uploadResults,
  uploadingIds,
  onCheck,
  onUploadSingle,
  onRequestUploadAll,
  themeMode,
}: UploadTabProps) {
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
  const invalidLabel = `Invalid (${filteredInvalid.length})`;
  const readyLabel = `Ready to Upload (${validCount})`;
  const alreadyLabel = `Already on Server (${filteredAlready.length})`;

  const inputBase = isDark
    ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-indigo-500 focus:ring-0'
    : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-indigo-500 focus:ring-0';

  return (
    <div className="flex flex-col min-h-[400px] h-full">
      <div className="lg-glass flex flex-col sm:flex-row gap-3 p-4 sticky top-0 z-10" style={{ borderRadius: 0 }}>
        <div className="relative flex-1 min-w-0">
          <Icon icon={appIcons.search} className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-white/50' : 'text-black/30'}`} />
          <input
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition-colors ${inputBase}`}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${isDark ? 'text-white/50 hover:text-white/80' : 'text-black/30 hover:text-black/60'}`}>
              <Icon icon={appIcons.close} className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onCheck}
            disabled={loading}
            className={loading ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}
          >
            {loading ? (
              <>
                <Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Icon icon={appIcons.search} className="w-4 h-4" />
                Scan Drive
              </>
            )}
          </button>

          {data && validCount > 0 && (
            <button
              onClick={onRequestUploadAll}
              disabled={isUploadingAny || allDone}
              className={isUploadingAny || allDone ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : 'lg-btn-primary'}
            >
              {isUploadingAny ? (
                <>
                  <Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />
                  Uploading ({isUploadingAny})
                </>
              ) : allDone ? (
                <>
                  <Icon icon={appIcons.check} className="w-4 h-4" />
                  All Uploaded
                </>
              ) : (
                <>
                  <Icon icon={appIcons.uploadFile} className="w-4 h-4" />
                  Upload All ({validCount})
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 flex items-center gap-3 p-3 lg-glass" style={{ border: isDark ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(239,68,68,0.3)', background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)' }}>
          <Icon icon={appIcons.error} className="w-5 h-5 flex-shrink-0 text-red-400" />
          {error}
        </div>
      )}

      {data && (
        <div className={`flex items-center gap-1 px-4 py-2 ${isDark ? 'bg-black/20 border-b border-white/6' : 'bg-black/5 border-b border-black/6'}`}>
          <FilterChip label="All" count={filteredUploadable.length + filteredInvalid.length + filteredAlready.length} active={filterSection === 'all'} onClick={() => setFilterSection('all')} isDark={isDark} />
          <FilterChip label="Ready" count={validCount} active={filterSection === 'ready'} onClick={() => setFilterSection('ready')} variant="green" isDark={isDark} />
          <FilterChip label="Invalid" count={filteredInvalid.length} active={filterSection === 'invalid'} onClick={() => setFilterSection('invalid')} variant="red" isDark={isDark} />
          <FilterChip label="Uploaded" count={filteredAlready.length} active={filterSection === 'uploaded'} onClick={() => setFilterSection('uploaded')} isDark={isDark} />
        </div>
      )}

      {data && !loading && (
        <div className={`mx-4 mt-3 flex flex-wrap items-center gap-3 px-4 py-2 rounded-xl text-xs ${isDark ? 'bg-black/10' : 'bg-black/5'}`}>
          {data.drive_folders.length > 0 && (
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-white/75' : 'text-black/45'}`}>
            <Icon icon={appIcons.check} className="w-3.5 h-3.5 text-emerald-400" />
            {data.drive_folders.length} DONE_
          </div>
          )}
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-white/75' : 'text-black/45'}`}>
            <Icon icon={appIcons.add} className="w-3.5 h-3.5 text-indigo-400" />
            {validCount} ready to upload
          </div>
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-white/75' : 'text-black/45'}`}>
            <Icon icon={appIcons.trends} className="w-3.5 h-3.5 text-amber-400" />
            {filteredAlready.length} uploaded
          </div>
          {filteredInvalid.length > 0 && (
            <div className={`flex items-center gap-1.5 ${isDark ? 'text-white/75' : 'text-black/45'}`}>
              <Icon icon={appIcons.close} className="w-3.5 h-3.5 text-red-400" />
              {filteredInvalid.length} invalid
            </div>
          )}
          {successCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-emerald-400">
              <Icon icon={appIcons.check} className="w-3.5 h-3.5" />
              {successCount} successful
            </div>
          )}
          {failedCount > 0 && (
            <div className={`ml-auto flex items-center gap-1.5 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              <Icon icon={appIcons.close} className="w-3.5 h-3.5" />
              {failedCount} failed
            </div>
          )}
        </div>
      )}

      <div className="p-4 flex-1">
        {!loading && !data && (
          <EmptyState
            isDark={isDark}
            message="Click 'Scan Drive' to check for stories ready to upload to your Google Drive."
            icon={
              <Icon icon={appIcons.shield} className={`w-8 h-8 ${isDark ? 'text-white/40' : 'text-black/20'}`} />
            }
          />
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 w-full h-full"> 
            <div className="lg-glass w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <Icon icon={appIcons.spinner} className="w-8 h-8 animate-spin text-indigo-400" />
            </div>
            <p className={`text-sm ${isDark ? 'text-white/65' : 'text-black/45'}`}>Scanning your Drive folders...</p>
          </div>
        )}

        {data && filterSection === 'all' && (
          <>
            {filteredInvalid.length > 0 && (
              <div className="mb-4">
                <SectionHeader label={invalidLabel} color="#f87171" icon={<Icon icon={appIcons.error} className="w-4 h-4 text-red-400" />} />
                <div className="space-y-2">
                  {filteredInvalid.map(folder => (
                    <InvalidUploadCard key={folder.id} folder={folder} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {validCount > 0 && (
              <div className="mb-4">
                <SectionHeader label={readyLabel} color="#34d399" icon={<Icon icon={appIcons.cloud} className="w-4 h-4 text-emerald-400" />} />
                <div className="space-y-2">
                  {filteredUploadable.map(folder => {
                    const result = uploadResults.get(folder.id);
                    const isUploading = uploadingIds.has(folder.id);
                    const isSuccess = result?.success;
                    const isFailed = result && !result.success;
                    return (
                      <UploadCard key={folder.id} folder={folder} result={result} isUploading={isUploading} isSuccess={isSuccess} isFailed={isFailed} onUpload={() => onUploadSingle(folder)} isDark={isDark} />
                    );
                  })}
                </div>
              </div>
            )}

            {filteredAlready.length > 0 && (
              <div>
                <SectionHeader label={alreadyLabel} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.25)'} icon={<Icon icon={appIcons.check} className={isDark ? "w-4 h-4 text-white/55" : "w-4 h-4 text-black/25"} />} />
                <div className="space-y-2">
                  {filteredAlready.map(folder => (
                    <AlreadyCard key={folder.id} folder={folder} isDark={isDark} />
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
                <UploadCard key={folder.id} folder={folder} result={result} isUploading={isUploading} isSuccess={isSuccess} isFailed={false} onUpload={() => onUploadSingle(folder)} isDark={isDark} />
              );
            })}
          </div>
        )}

        {data && filterSection === 'invalid' && filteredInvalid.length > 0 && (
          <div className="space-y-2">
            {filteredInvalid.map(folder => (
              <InvalidUploadCard key={folder.id} folder={folder} isDark={isDark} />
            ))}
          </div>
        )}

        {data && filterSection === 'uploaded' && filteredAlready.length > 0 && (
          <div className="space-y-2">
            {filteredAlready.map(folder => (
              <AlreadyCard key={folder.id} folder={folder} isDark={isDark} />
            ))}
          </div>
        )}

        {data && (
          ((filterSection === 'ready' && validCount === 0) ||
            (filterSection === 'invalid' && filteredInvalid.length === 0) ||
            (filterSection === 'uploaded' && filteredAlready.length === 0)) && (
            <div className={`text-center py-8 ${isDark ? 'text-white/75' : 'text-black/35'}`}>
              <Icon icon={appIcons.checkCircle} className={`w-8 h-8 mx-auto mb-2 ${isDark ? 'text-white/40' : 'text-black/15'}`} />
              <p className="text-sm">No items in this section</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick, variant, isDark }: { label: string; count: number; active: boolean; onClick: () => void; variant?: 'green' | 'amber' | 'red'; isDark: boolean }) {
  const colors = variant === 'green' ? { active: 'rgba(52,211,153,0.15)', activeText: isDark ? '#34d399' : '#059669', inactive: isDark ? 'text-white/75' : 'text-black/30' }
    : variant === 'red' ? { active: 'rgba(248,113,113,0.15)', activeText: isDark ? '#f87171' : '#b91c1c', inactive: isDark ? 'text-white/75' : 'text-black/30' }
    : { active: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', activeText: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)', inactive: isDark ? 'text-white/75' : 'text-black/30' };

  return (
    <button onClick={onClick} className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200"
      style={{ background: active ? colors.active : 'transparent', color: active ? colors.activeText : colors.inactive }}>
      {label} ({count})
    </button>
  );
}

function SectionHeader({ label, color, icon }: { label: string; color: string; icon: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color }}>{icon}{label}</h3>
  );
}

function UploadCard({ folder, result, isUploading, isSuccess, isFailed, onUpload, isDark }: any) {
  return (
    <div className="lg-glass-card p-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge prefix={folder.prefix} isDark={isDark} />
            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-white/85' : 'text-black/85'}`}>{folder.display_name}</h4>
          </div>
          <p className={`text-xs font-mono ${isDark ? 'text-white/50' : 'text-black/30'}`}>{folder.name}</p>
          {result && (
            <p className={`text-xs mt-1.5 flex items-center gap-1 ${isSuccess ? 'text-emerald-400' : isFailed ? 'text-red-400' : ''}`}>
              {isSuccess && <Icon icon={appIcons.check} className="w-3.5 h-3.5" />}
              {isFailed && <Icon icon={appIcons.close} className="w-3.5 h-3.5" />}
              {result.message}
            </p>
          )}
        </div>
        <button
          onClick={onUpload}
          disabled={isUploading || isSuccess}
          className={isUploading ? 'lg-btn-ghost opacity-50 cursor-not-allowed' : isSuccess ? 'lg-chip lg-chip-green' : 'lg-btn-primary'}
        >
          {isUploading ? <><Icon icon={appIcons.spinner} className="w-4 h-4 animate-spin" />Uploading...</> : isSuccess ? <><Icon icon={appIcons.check} className="w-4 h-4" />Uploaded</> : <><Icon icon={appIcons.uploadFile} className="w-4 h-4" />Upload</>}
        </button>
      </div>
    </div>
  );
}

function InvalidUploadCard({ folder, isDark }: any) {
  return (
    <div className="lg-glass-card p-4" style={{ border: isDark ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(239,68,68,0.25)', background: isDark ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.03)' }}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge prefix={folder.prefix} isDark={isDark} />
            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-red-300' : 'text-red-700'}`}>{folder.display_name}</h4>
          </div>
          <p className={`text-xs font-mono mb-2 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>{folder.name}</p>
          <div className="flex flex-wrap gap-1.5">
            {folder.validation_errors.map((err: string, i: number) => <ValidationErrorBadge key={i} error={err} isDark={isDark} />)}
          </div>
        </div>
        <span className="lg-chip lg-chip-red self-start">Cannot Upload</span>
      </div>
    </div>
  );
}

function AlreadyCard({ folder, isDark }: any) {
  return (
    <div className="lg-glass-card p-4" style={{ opacity: 0.7 }}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge prefix={folder.prefix} isDark={isDark} />
            <h4 className={`text-sm font-medium truncate ${isDark ? 'text-white/65' : 'text-black/45'}`}>{folder.display_name}</h4>
          </div>
          <p className={`text-xs font-mono ${isDark ? 'text-white/40' : 'text-black/25'}`}>{folder.name}</p>
        </div>
        <span className="lg-chip" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)' }}>Already uploaded</span>
      </div>
    </div>
  );
}
