import { useEffect, useState } from 'react';
import { Icon, appIcons } from '../../../components/Shared/Icon';
import { showToast } from '../../../components/Shared/Toast';
import {
    clearBackendData,
    getSettings,
    updateSettings,
    updateInkittCookies,
    getStoredAuthUser,
    getDriveSyncConfig,
    initDriveSyncConfig,
    checkCredentialsExists,
    type SettingsResponse,
} from '../../../api';
import { DriveConfig, type ConfigFormData } from '../../../components/Shared/DriveConfig';
import type { ThemeMode } from '../../../types/theme';

type SettingsCategory = 'profile' | 'appearance' | 'crawler' | 'audio' | 'inkitt' | 'driveSync' | 'danger';

interface CategoryItem {
    id: SettingsCategory;
    label: string;
    description: string;
    icon: keyof typeof appIcons;
}

const CATEGORIES: CategoryItem[] = [
    { id: 'appearance', label: 'Appearance', description: 'Theme and display', icon: 'moon' },
    { id: 'crawler', label: 'Crawler', description: 'Default crawl behavior', icon: 'settings' },
    { id: 'audio', label: 'Audio Pipeline', description: 'Auto Audio and TTS', icon: 'music' },
    { id: 'inkitt', label: 'Inkitt Cookies', description: 'Crawler login cookies', icon: 'shield' },
    { id: 'driveSync', label: 'Drive Sync', description: 'Google Drive and API', icon: 'sync' },
    { id: 'danger', label: 'Advanced', description: 'Cleanup actions', icon: 'delete' },
];

interface MobileSettingsPageProps {
    themeMode: ThemeMode;
    onThemeChange: (mode: ThemeMode) => void;
    onClose: () => void;
    onLogout: () => void | Promise<void>;
}

export function MobileSettingsPage({
    themeMode,
    onThemeChange,
    onClose,
    onLogout,
}: Readonly<MobileSettingsPageProps>) {
    const isDark = themeMode === 'dark';
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance');
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

    const [localTheme, setLocalTheme] = useState<'light' | 'dark'>(themeMode === 'dark' ? 'dark' : 'light');
    const [crawlMode, setCrawlMode] = useState<'count' | 'range'>('count');
    const [count, setCount] = useState(10);
    const [rangeFrom, setRangeFrom] = useState(1);
    const [rangeTo, setRangeTo] = useState(10);
    const [crawlAutoMaxChapters, setCrawlAutoMaxChapters] = useState(false);
    const [autoAudioRestSeconds, setAutoAudioRestSeconds] = useState(0);
    const [autoAudioUploadWorkers, setAutoAudioUploadWorkers] = useState(3);
    const [autoAudioBatchWindow, setAutoAudioBatchWindow] = useState(2);
    const [autoAudioTestStoryIds, setAutoAudioTestStoryIds] = useState<string[]>([]);
    const [autoAudioTestIdsText, setAutoAudioTestIdsText] = useState('');
    const [ttsConcurrency, setTtsConcurrency] = useState(1);
    const [inkittUserCredentials, setInkittUserCredentials] = useState('');
    const [inkittCfClearance, setInkittCfClearance] = useState('');
    const [savingInkittCookies, setSavingInkittCookies] = useState(false);
    const [inkittCookieError, setInkittCookieError] = useState('');
    const [inkittCookieMessage, setInkittCookieMessage] = useState('');
    const [clearState, setClearState] = useState<'idle' | 'clearing'>('idle');
    const [clearConfirm, setClearConfirm] = useState('');
    const authUser = getStoredAuthUser();
    const isAdmin = authUser?.role === 'admin';

    // Drive Sync config state
    const [isInitialSetup, setIsInitialSetup] = useState(false);
    const [configForm, setConfigForm] = useState<ConfigFormData>({
        folder_id: '',
        service_account_json_name: 'google-service-account.json',
        main_be_api_base_url: '',
        main_be_bearer_token: '',
        main_be_user_id: '',
    });
    const [savingConfig, setSavingConfig] = useState(false);
    const [savingConfigError, setSavingConfigError] = useState('');
    const [credentialFileExists, setCredentialFileExists] = useState(true);

    const bg = isDark ? '#0f0f0f' : '#f8f8f7';
    const cardBg = isDark ? '#1c1c1c' : '#ffffff';
    const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
    const textPrimary = isDark ? 'rgba(255,255,255,0.92)' : 'rgba(15,15,15,0.92)';
    const textSecondary = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(15,15,15,0.5)';
    const textTertiary = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(15,15,15,0.3)';
    const inputBg = isDark ? '#242424' : '#ffffff';
    const inputBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';
    const primary = '#2563eb';
    const danger = '#dc2626';
    const success = '#16a34a';

    const inputCls = `w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow ${isDark ? 'bg-[#242424] border-white/10 text-white/90 placeholder:text-white/25' : 'bg-white border-black/10 text-[rgba(15,15,15,0.92)] placeholder:text-black/30'}`;
    const labelCls = `block text-xs font-medium mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`;
    const sectionCard = `rounded-2xl border p-4 space-y-4`;

    useEffect(() => {
        getSettings()
            .then((s: SettingsResponse) => {
                setLocalTheme(s.theme === 'dark' ? 'dark' : 'light');
                setCrawlMode(s.crawl_mode as 'count' | 'range');
                setCount(s.crawl_default_count);
                setRangeFrom(s.crawl_default_range_from);
                setRangeTo(s.crawl_default_range_to);
                setCrawlAutoMaxChapters(s.crawl_auto_max_chapters ?? false);
                setAutoAudioRestSeconds(s.auto_audio_rest_seconds ?? 0);
                setAutoAudioUploadWorkers(s.auto_audio_upload_workers ?? 3);
                setAutoAudioBatchWindow(s.auto_audio_batch_window ?? 2);
                setAutoAudioTestStoryIds(s.auto_audio_test_story_ids ?? []);
                setAutoAudioTestIdsText((s.auto_audio_test_story_ids ?? []).join(', '));
                setTtsConcurrency(Math.min(2, Math.max(1, s.tts_concurrency ?? 1)));
            })
            .catch(() => setError('Failed to load settings.'))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    // Load Drive Sync config
    useEffect(() => {
        async function loadDriveConfig() {
            try {
                const cfg = await getDriveSyncConfig();
                const exists = await checkCredentialsExists('google-service-account.json');
                setCredentialFileExists(exists);
                setConfigForm({
                    folder_id: cfg?.folder_id || '',
                    service_account_json_name: cfg?.service_account_json_name || 'google-service-account.json',
                    main_be_api_base_url: cfg?.main_be_api_base_url || '',
                    main_be_bearer_token: cfg?.main_be_bearer_token || '',
                    main_be_user_id: cfg?.main_be_user_id || '',
                });
                setIsInitialSetup(!cfg?.folder_id);
            } catch {
                // silently ignore
            }
        }
        loadDriveConfig();
    }, []);

    const handleConfigFormChange = (data: Partial<ConfigFormData>) => {
        setConfigForm(prev => ({ ...prev, ...data }));
    };

    const handleSaveConfig = async () => {
        setSavingConfig(true);
        setSavingConfigError('');
        try {
            await initDriveSyncConfig({
                folder_id: configForm.folder_id,
                service_account_json_path: configForm.service_account_json_name,
                main_be_api_base_url: configForm.main_be_api_base_url,
                main_be_user_id: configForm.main_be_user_id,
                main_be_bearer_token: configForm.main_be_bearer_token || undefined,
            });
            setIsInitialSetup(false);
            showToast('Drive Sync configuration saved.', 'success', 2000, 'top-center');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to save Drive Sync config.';
            setSavingConfigError(msg);
            showToast(msg, 'error', 3000, 'top-center');
        } finally {
            setSavingConfig(false);
        }
    };

    const handleSave = async () => {
        setSaveState('saving');
        setError('');
        try {
            await updateSettings({
                theme: localTheme,
                crawl_mode: crawlMode,
                crawl_default_count: count,
                crawl_default_range_from: rangeFrom,
                crawl_default_range_to: rangeTo,
                crawl_auto_max_chapters: crawlAutoMaxChapters,
                auto_audio_rest_seconds: autoAudioRestSeconds,
                auto_audio_upload_workers: autoAudioUploadWorkers,
                auto_audio_batch_window: autoAudioBatchWindow,
                auto_audio_test_story_ids: autoAudioTestStoryIds,
                tts_concurrency: ttsConcurrency,
            });
            onThemeChange(localTheme === 'dark' ? 'dark' : 'light');
            setSaveState('saved');
            showToast('Changes are saved.', 'success', 2000, 'top-center');
            setTimeout(() => setSaveState('idle'), 2000);
        } catch {
            setError('Failed to save settings.');
            setSaveState('idle');
        }
    };

    const handleClearBackendData = async () => {
        if (clearConfirm.trim() !== 'CLEAR_BACKEND_DATA') {
            showToast('Type CLEAR_BACKEND_DATA before clearing.', 'warning', 2200, 'top-center');
            return;
        }
        setClearState('clearing');
        setError('');
        try {
            const result = await clearBackendData();
            setClearConfirm('');
            showToast(
                `Cleared ${result.cleared_tables.length} tables, deleted ${result.deleted_paths.length} paths.`,
                'success', 3500, 'top-center',
            );
            globalThis.setTimeout(() => globalThis.location.assign('/'), 600);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to clear backend data.');
            showToast('Failed to clear backend data.', 'error', 3000, 'top-center');
        } finally {
            setClearState('idle');
        }
    };

    const handleSaveInkittCookies = async () => {
        const userCredentials = inkittUserCredentials.replace(/\s+/g, '').trim();
        const cfClearance = inkittCfClearance.replace(/\s+/g, '').trim();
        if (!userCredentials || !cfClearance) {
            setInkittCookieError('Paste both user_credentials and cf_clearance before saving.');
            setInkittCookieMessage('');
            return;
        }
        setSavingInkittCookies(true);
        setInkittCookieError('');
        setInkittCookieMessage('');
        try {
            const result = await updateInkittCookies(`user_credentials=${userCredentials}; cf_clearance=${cfClearance}`);
            const message = `Saved ${result.cookie_count} Inkitt cookie${result.cookie_count === 1 ? '' : 's'}.`;
            setInkittCookieMessage(message);
            setInkittUserCredentials('');
            setInkittCfClearance('');
            showToast(message, 'success', 2200, 'top-center');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update Inkitt cookies.';
            setInkittCookieError(message);
            showToast('Failed to update Inkitt cookies.', 'error', 2500, 'top-center');
        } finally {
            setSavingInkittCookies(false);
        }
    };

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Icon icon={appIcons.spinner} className="h-5 w-5 animate-spin" style={{ color: textSecondary }} />
                    <p className="text-sm" style={{ color: textSecondary }}>Loading settings...</p>
                </div>
            );
        }

        switch (activeCategory) {
            case 'profile':
                return (
                    <div className={`${sectionCard}`} style={{ background: cardBg, borderColor: cardBorder }}>
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider" style={{ color: textTertiary }}>Email</p>
                            <p className="mt-1 text-sm" style={{ color: textPrimary }}>{authUser?.email || 'Unknown user'}</p>
                        </div>
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider" style={{ color: textTertiary }}>Role</p>
                            <p className="mt-1 text-sm capitalize" style={{ color: textPrimary }}>{authUser?.role || 'unknown'}</p>
                        </div>
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={async () => { await onLogout(); onClose(); }}
                                className="w-full rounded-xl py-2.5 text-sm font-semibold"
                                style={{ background: isDark ? 'rgba(220,38,38,0.15)' : 'rgba(220,38,38,0.06)', color: '#dc2626' }}
                            >
                                Sign out
                            </button>
                        </div>
                    </div>
                );
            case 'appearance':
                return (
                    <div className={`${sectionCard}`} style={{ background: cardBg, borderColor: cardBorder }}>
                        <div>
                            <p className={`text-sm font-semibold mb-0.5`} style={{ color: textPrimary }}>Theme</p>
                            <p className="text-xs" style={{ color: textSecondary }}>Choose how the app looks.</p>
                        </div>
                        <div className="flex gap-2">
                            {(['light', 'dark'] as const).map((mode) => {
                                const active = localTheme === mode;
                                return (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => setLocalTheme(mode)}
                                        className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all"
                                        style={{
                                            background: active ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)') : 'transparent',
                                            border: `1.5px solid ${active ? (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)') : cardBorder}`,
                                            color: active ? textPrimary : textSecondary,
                                        }}
                                    >
                                        <Icon icon={appIcons[mode === 'light' ? 'themeLight' : 'themeDark']} className="h-4 w-4" />
                                        <span className="capitalize">{mode}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            case 'crawler':
                return (
                    <div className="space-y-3">
                        <div className={`${sectionCard}`} style={{ background: cardBg, borderColor: cardBorder }}>
                            <p className={`text-sm font-semibold mb-0.5`} style={{ color: textPrimary }}>Default Chapters</p>
                            <p className="text-xs mb-3" style={{ color: textSecondary }}>Applied when starting a new crawl.</p>
                            <div className="flex rounded-xl p-1" style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
                                <button onClick={() => setCrawlMode('count')} className="flex-1 rounded-lg py-2 text-sm font-medium transition-all" style={{ background: crawlMode === 'count' ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent', color: textPrimary }}>Count</button>
                                <button onClick={() => setCrawlMode('range')} className="flex-1 rounded-lg py-2 text-sm font-medium transition-all" style={{ background: crawlMode === 'range' ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent', color: textPrimary }}>Range</button>
                            </div>
                            {crawlMode === 'count' ? (
                                <div>
                                    <label htmlFor="mob-crawl-count" className={labelCls}>Chapter count</label>
                                    <input id="mob-crawl-count" type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Number.parseInt(e.target.value, 10) || 1))} className={inputCls} style={{ background: inputBg, borderColor: inputBorder }} />
                                    <p className="mt-1.5 text-xs" style={{ color: textSecondary }}>Crawl up to {count} chapter{count === 1 ? '' : 's'}.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label htmlFor="mob-crawl-from" className={labelCls}>From</label>
                                        <input id="mob-crawl-from" type="number" min={1} value={rangeFrom} onChange={(e) => setRangeFrom(Math.max(1, Number.parseInt(e.target.value, 10) || 1))} className={inputCls} style={{ background: inputBg, borderColor: inputBorder }} />
                                    </div>
                                    <div>
                                        <label htmlFor="mob-crawl-to" className={labelCls}>To</label>
                                        <input id="mob-crawl-to" type="number" min={1} value={rangeTo} onChange={(e) => setRangeTo(Math.max(1, Number.parseInt(e.target.value, 10) || 1))} className={inputCls} style={{ background: inputBg, borderColor: inputBorder }} />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className={`${sectionCard}`} style={{ background: cardBg, borderColor: cardBorder }}>
                            <div className="flex items-center justify-between">
                                <div className="pr-4">
                                    <p className={`text-sm font-medium mb-0.5`} style={{ color: textPrimary }}>Auto-fill chapters</p>
                                    <p className="text-xs" style={{ color: textSecondary }}>Fill to max available after URL detection.</p>
                                </div>
                                <button
                                    onClick={() => setCrawlAutoMaxChapters((v) => !v)}
                                    className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors flex-shrink-0"
                                    style={{ background: crawlAutoMaxChapters ? primary : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)') }}
                                >
                                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${crawlAutoMaxChapters ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                );
            case 'audio':
                return (
                    <div className="space-y-3">
                        <div className={`${sectionCard}`} style={{ background: cardBg, borderColor: cardBorder }}>
                            <p className={`text-sm font-semibold mb-0.5`} style={{ color: textPrimary }}>Auto Audio</p>
                            <p className="text-xs mb-4" style={{ color: textSecondary }}>Pipeline backoff and upload workers.</p>
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="mob-audio-rest" className={labelCls}>Backoff after failed story (seconds)</label>
                                    <input id="mob-audio-rest" type="number" min={0} max={600} value={autoAudioRestSeconds} onChange={(e) => setAutoAudioRestSeconds(Math.max(0, Number.parseInt(e.target.value, 10) || 0))} className={inputCls} style={{ background: inputBg, borderColor: inputBorder }} />
                                </div>
                                <div>
                                    <p className={`${labelCls} mb-2`}>Upload workers</p>
                                    <div className="flex gap-2">
                                        {[1, 2, 3, 4].map((v) => (
                                            <button key={v} onClick={() => setAutoAudioUploadWorkers(v)} className="flex-1 rounded-xl py-2.5 text-sm font-medium" style={{ background: autoAudioUploadWorkers === v ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)') : 'transparent', border: `1.5px solid ${autoAudioUploadWorkers === v ? cardBorder : 'transparent'}`, color: textPrimary }}>{v}</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className={`${labelCls} mb-2`}>Batch window</p>
                                    <div className="flex gap-2">
                                        {[1, 2].map((v) => (
                                            <button key={v} onClick={() => setAutoAudioBatchWindow(v)} className="flex-1 rounded-xl py-2.5 text-sm font-medium" style={{ background: autoAudioBatchWindow === v ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)') : 'transparent', border: `1.5px solid ${autoAudioBatchWindow === v ? cardBorder : 'transparent'}`, color: textPrimary }}>{v}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className={`${sectionCard}`} style={{ background: cardBg, borderColor: cardBorder }}>
                            <div>
                                <label htmlFor="mob-test-ids" className={labelCls}>Test Story IDs</label>
                                <textarea id="mob-test-ids" value={autoAudioTestIdsText} onChange={(e) => { setAutoAudioTestIdsText(e.target.value); setAutoAudioTestStoryIds(e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)); }} rows={3} className={`${inputCls} resize-none font-mono text-xs`} style={{ background: inputBg, borderColor: inputBorder }} />
                            </div>
                        </div>
                        <div className={`${sectionCard}`} style={{ background: cardBg, borderColor: cardBorder }}>
                            <p className={`${labelCls} mb-2`}>TTS Concurrency</p>
                            <div className="flex gap-2">
                                {[1, 2].map((v) => (
                                    <button key={v} onClick={() => setTtsConcurrency(v)} className="flex-1 rounded-xl py-2.5 text-sm font-medium" style={{ background: ttsConcurrency === v ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)') : 'transparent', border: `1.5px solid ${ttsConcurrency === v ? cardBorder : 'transparent'}`, color: textPrimary }}>{v}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'inkitt':
                return (
                    <div className={`${sectionCard}`} style={{ background: cardBg, borderColor: cardBorder }}>
                        <div>
                            <p className={`text-sm font-semibold mb-0.5`} style={{ color: textPrimary }}>Inkitt Cookies</p>
                            <p className="text-xs" style={{ color: textSecondary }}>Login cookies for Inkitt chapter crawling.</p>
                        </div>
                        <div>
                            <label htmlFor="mob-inkitt-user" className={labelCls}>user_credentials</label>
                            <textarea id="mob-inkitt-user" value={inkittUserCredentials} onChange={(e) => { setInkittUserCredentials(e.target.value); setInkittCookieError(''); setInkittCookieMessage(''); }} rows={3} className={`${inputCls} min-h-[90px] resize-y font-mono text-xs`} style={{ background: inputBg, borderColor: inputBorder }} />
                        </div>
                        <div>
                            <label htmlFor="mob-inkitt-cf" className={labelCls}>cf_clearance</label>
                            <textarea id="mob-inkitt-cf" value={inkittCfClearance} onChange={(e) => { setInkittCfClearance(e.target.value); setInkittCookieError(''); setInkittCookieMessage(''); }} rows={3} className={`${inputCls} min-h-[90px] resize-y font-mono text-xs`} style={{ background: inputBg, borderColor: inputBorder }} />
                        </div>
                        <button
                            type="button"
                            onClick={handleSaveInkittCookies}
                            disabled={savingInkittCookies || !inkittUserCredentials.trim() || !inkittCfClearance.trim()}
                            className="w-full rounded-xl py-3 text-sm font-semibold disabled:cursor-not-allowed"
                            style={{ background: savingInkittCookies || !inkittUserCredentials.trim() || !inkittCfClearance.trim() ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)') : primary, color: savingInkittCookies || !inkittUserCredentials.trim() || !inkittCfClearance.trim() ? textTertiary : '#fff' }}
                        >
                            {savingInkittCookies ? 'Saving...' : 'Save Cookies'}
                        </button>
                        <p className="text-xs" style={{ color: textTertiary }}>Get these from Chrome DevTools → Application → Cookies for inkitt.com.</p>
                        {inkittCookieMessage && <p className="text-sm" style={{ color: success }}>{inkittCookieMessage}</p>}
                        {inkittCookieError && <p className="text-sm" style={{ color: danger }}>{inkittCookieError}</p>}
                    </div>
                );
            case 'driveSync':
                return (
                    <div className="space-y-4">
                        <DriveConfig
                            embedded
                            configForm={configForm}
                            onFormChange={handleConfigFormChange}
                            onSave={handleSaveConfig}
                            savingConfig={savingConfig}
                            savingConfigError={savingConfigError}
                            isInitialSetup={isInitialSetup}
                            themeMode={themeMode}
                            credentialFileExists={credentialFileExists}
                            onCredentialUploadSuccess={() => setCredentialFileExists(true)}
                        />
                    </div>
                );
            case 'danger':
                return (
                    <div className={`${sectionCard}`} style={{ background: cardBg, borderColor: isDark ? 'rgba(220,38,38,0.2)' : 'rgba(220,38,38,0.12)' }}>
                        <p className={`text-sm font-semibold mb-0.5`} style={{ color: danger }}>Advanced Cleanup</p>
                        <p className="text-xs mb-3" style={{ color: textSecondary }}>Clear runtime histories, outputs, sessions, jobs, logs, settings, and Drive credentials.</p>
                        {isAdmin ? (
                            <>
                                <div className="mb-3">
                                    <label htmlFor="mob-clear-confirm" className={labelCls}>Type CLEAR_BACKEND_DATA to confirm</label>
                                    <input
                                        id="mob-clear-confirm"
                                        type="text"
                                        value={clearConfirm}
                                        onChange={(e) => setClearConfirm(e.target.value)}
                                        placeholder="CLEAR_BACKEND_DATA"
                                        className={`${inputCls} font-mono text-sm`}
                                        style={{ background: inputBg, borderColor: inputBorder }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleClearBackendData}
                                    disabled={clearState === 'clearing' || clearConfirm.trim() !== 'CLEAR_BACKEND_DATA'}
                                    className="w-full rounded-xl py-3 text-sm font-semibold disabled:cursor-not-allowed"
                                    style={{ background: clearState === 'clearing' || clearConfirm.trim() !== 'CLEAR_BACKEND_DATA' ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)') : danger, color: clearState === 'clearing' || clearConfirm.trim() !== 'CLEAR_BACKEND_DATA' ? textTertiary : '#fff' }}
                                >
                                    {clearState === 'clearing' ? 'Clearing...' : 'Clear Backend Data'}
                                </button>
                            </>
                        ) : (
                            <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: cardBorder, background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: textSecondary }}>
                                Admin access is required.
                            </div>
                        )}
                    </div>
                );
            default:
                return null;
        }
    };

    const activeCategoryItem = CATEGORIES.find((c) => c.id === activeCategory);

    return (
        <div className="fixed inset-0 z-[90] flex flex-col lg:hidden" style={{ background: bg }}>
            {/* Header */}
            <header
                className="flex items-center gap-3 px-4 pt-3 pb-3"
                style={{ borderBottom: `1px solid ${cardBorder}`, paddingTop: `max(env(safe-area-inset-top), 12px)` }}
            >
                {activeCategory !== 'profile' && (
                    <button
                        type="button"
                        onClick={() => setActiveCategory('profile')}
                        className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
                        style={{ color: textSecondary, background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
                        aria-label="Back"
                    >
                        <Icon icon={appIcons.chevronLeft} className="h-5 w-5" />
                    </button>
                )}
                {activeCategory === 'profile' && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
                        style={{ color: textSecondary, background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
                        aria-label="Close settings"
                    >
                        <Icon icon={appIcons.close} className="h-4 w-4" />
                    </button>
                )}
                <div className="flex-1 min-w-0">
                    <h1 className="text-base font-semibold truncate" style={{ color: textPrimary }}>
                        Settings
                    </h1>
                    {activeCategory !== 'profile' && (
                        <p className="text-xs truncate" style={{ color: textSecondary }}>
                            {activeCategoryItem?.label}
                        </p>
                    )}
                </div>
                {activeCategory !== 'profile' && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
                        style={{ color: textSecondary, background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
                        aria-label="Close"
                    >
                        <Icon icon={appIcons.close} className="h-4 w-4" />
                    </button>
                )}
            </header>

            {activeCategory === 'profile' ? (
                /* Category list */
                <div className="flex-1 overflow-y-auto px-4 py-3">
                    <div className="space-y-2 pb-4">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat.id}
                                type="button"
                                onClick={() => setActiveCategory(cat.id)}
                                className="w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors"
                                style={{ background: cardBg, borderColor: cardBorder }}
                            >
                                <span
                                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                                    style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', color: textSecondary }}
                                >
                                    <Icon icon={appIcons[cat.icon]} className="h-5 w-5" />
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-medium" style={{ color: textPrimary }}>{cat.label}</span>
                                    <span className="block text-xs" style={{ color: textSecondary }}>{cat.description}</span>
                                </span>
                                <Icon icon={appIcons.chevronRight} className="h-4 w-4 flex-shrink-0" style={{ color: textTertiary }} />
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                /* Category content */
                <div className="flex-1 overflow-y-auto px-4 py-4">
                    {error && (
                        <div className="mb-3 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: isDark ? 'rgba(220,38,38,0.3)' : 'rgba(220,38,38,0.2)', background: isDark ? 'rgba(220,38,38,0.08)' : 'rgba(254,242,242,0.95)', color: isDark ? 'rgb(252,165,165)' : 'rgb(185,28,28)' }}>
                            {error}
                        </div>
                    )}
                    {renderContent()}
                </div>
            )}

            {/* Save footer */}
            {activeCategory !== 'profile' && (
                <div
                    className="px-4 py-3"
                    style={{ borderTop: `1px solid ${cardBorder}`, paddingBottom: `max(env(safe-area-inset-bottom), 12px)`, background: bg }}
                >
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saveState === 'saving' || saveState === 'saved'}
                        className="w-full rounded-xl py-3 text-sm font-semibold"
                        style={{
                            background: saveState === 'saved' ? success : saveState === 'saving' ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)') : primary,
                            color: saveState === 'saved' ? '#fff' : saveState === 'saving' ? textTertiary : '#fff',
                        }}
                    >
                        {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : 'Save Changes'}
                    </button>
                </div>
            )}
        </div>
    );
}

export default MobileSettingsPage;
