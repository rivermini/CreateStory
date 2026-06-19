import { useEffect, useMemo, useState } from 'react';
import {
  clearBackendData,
  updateInkittCookies,
  updateScribblehubCookies,
  checkScribblehubCookies,
  getSettings,
  updateSettings,
  getDriveSyncConfig,
  initDriveSyncConfig,
  checkCredentialsExists,
  getStoredAuthUser,
  type SettingsResponse,
  type DriveSyncConfig,
  FIXED_JSON_PREFIX,
} from '../../api';
import { DriveConfig, type ConfigFormData } from '../../components/Shared/DriveConfig';
import { Icon, appIcons } from '../../components/Shared/Icon';
import type { ThemeMode } from '../../types/theme';
import { showToast } from '../../components/Shared/Toast';

type SettingsCategory = 'profile' | 'appearance' | 'driveSync' | 'inkitt' | 'scribblehub' | 'crawler' | 'audio' | 'danger';

interface SettingsPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onClose: () => void;
  onLogout: () => void | Promise<void>;
}

interface CategoryItem {
  id: SettingsCategory;
  label: string;
  description: string;
  icon: keyof typeof appIcons;
}

const CATEGORY_ITEMS: CategoryItem[] = [
  { id: 'profile', label: 'Profile', description: 'Account information', icon: 'user' },
  { id: 'appearance', label: 'Appearance', description: 'Theme and display', icon: 'moon' },
  { id: 'driveSync', label: 'Drive Sync', description: 'Google Drive and API', icon: 'sync' },
  { id: 'inkitt', label: 'Inkitt Cookies', description: 'Crawler login cookies', icon: 'shield' },
  { id: 'scribblehub', label: 'ScribbleHub Cookies', description: 'Cloudflare bypass cookies', icon: 'shield' },
  { id: 'crawler', label: 'Crawler', description: 'Default crawl behavior', icon: 'settings' },
  { id: 'audio', label: 'Audio Pipeline', description: 'Auto Audio and TTS', icon: 'music' },
  { id: 'danger', label: 'Advanced', description: 'Cleanup actions', icon: 'delete' },
];

function SectionTitle({
  title,
  description,
  pageText,
  secondaryText,
}: Readonly<{
  title: string;
  description: string;
  pageText: string;
  secondaryText: string;
}>) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold" style={{ color: pageText }}>{title}</h2>
      <p className="text-xs leading-5" style={{ color: secondaryText }}>{description}</p>
    </div>
  );
}

export function SettingsPage({ themeMode, onThemeChange, onClose, onLogout }: Readonly<SettingsPageProps>) {
  const isDark = themeMode === 'dark';
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance');

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
  const ttsConcurrencyOptions = [1, 2];
  const [clearState, setClearState] = useState<'idle' | 'clearing'>('idle');
  const [clearConfirm, setClearConfirm] = useState('');
  const authUser = getStoredAuthUser();
  const isAdmin = authUser?.role === 'admin';

  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.48)' : 'rgba(55,53,47,0.64)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.32)' : 'rgba(55,53,47,0.46)';
  const shellBackground = isDark ? '#191919' : '#fbfbfa';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const subtleSurface = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(55,53,47,0.05)';
  const subtleSurfaceHover = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(55,53,47,0.08)';
  const activeSurface = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(55,53,47,0.1)';
  const inputBackground = isDark ? '#232323' : '#ffffff';
  const inputBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.16)';
  const primaryButton = '#2f80ed';

  const sectionClassName = 'rounded-lg border p-4 space-y-4';
  const labelClassName = `block text-xs mb-1.5 ${isDark ? 'text-white/55' : 'text-[rgba(55,53,47,0.68)]'}`;
  const fieldClassName = `w-full rounded-md border px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent ${isDark ? 'text-white/90 placeholder:text-white/25' : 'text-[rgba(55,53,47,0.92)] placeholder:text-[rgba(55,53,47,0.35)]'}`;

  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
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
  const [uploadError, setUploadError] = useState('');
  const [inkittUserCredentials, setInkittUserCredentials] = useState('');
  const [inkittCfClearance, setInkittCfClearance] = useState('');
  const [savingInkittCookies, setSavingInkittCookies] = useState(false);
  const [inkittCookieError, setInkittCookieError] = useState('');
  const [inkittCookieMessage, setInkittCookieMessage] = useState('');
  const [inkittJsonText, setInkittJsonText] = useState('');
  const [scribblehubCookies, setScribblehubCookies] = useState('');
  const [scribblehubUserAgent, setScribblehubUserAgent] = useState('');
  const [savingScribblehubCookies, setSavingScribblehubCookies] = useState(false);
  const [checkingScribblehubCookies, setCheckingScribblehubCookies] = useState(false);
  const [scribblehubCookieError, setScribblehubCookieError] = useState('');
  const [scribblehubCookieMessage, setScribblehubCookieMessage] = useState('');

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
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
  }, [themeMode, setSettings]);

  useEffect(() => {
    async function loadConfig() {
      try {
        const cfg = await getDriveSyncConfig();
        setConfig(cfg);
        if (cfg) {
          const jsonName = cfg.service_account_json_name || 'google-service-account.json';
          setConfigForm({
            folder_id: cfg.folder_id || '',
            service_account_json_name: jsonName,
            main_be_api_base_url: cfg.main_be_api_base_url || '',
            main_be_bearer_token: cfg.main_be_bearer_token || '',
            main_be_user_id: cfg.main_be_user_id || '',
          });
          const exists = await checkCredentialsExists(jsonName);
          setCredentialFileExists(exists);
        } else {
          setIsInitialSetup(true);
        }
      } catch {
        // ignore
      }
    }
    loadConfig();
  }, []);

  const handleClose = onClose;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    document.body.style.overflow = 'hidden';
    globalThis.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      globalThis.removeEventListener('keydown', onKeyDown);
    };
  }, [handleClose]);

  const categories = useMemo(() => CATEGORY_ITEMS, []);

  const handleConfigFormChange = (data: Partial<ConfigFormData>) => {
    setConfigForm((prev) => ({ ...prev, ...data }));
  };

  const handleSaveConfig = async () => {
    setSavingConfigError('');
    if (!configForm.folder_id.trim()) {
      setSavingConfigError('Folder ID is required.');
      return;
    }
    setSavingConfig(true);

    try {
      const cfg = await initDriveSyncConfig({
        folder_id: configForm.folder_id,
        service_account_json_path: FIXED_JSON_PREFIX + configForm.service_account_json_name,
        main_be_api_base_url: configForm.main_be_api_base_url,
        main_be_bearer_token: configForm.main_be_bearer_token,
        main_be_user_id: configForm.main_be_user_id,
      });
      setConfig(cfg);
      showToast('Drive Sync configuration saved successfully.', 'success', 2000, 'top-center');
    } catch (e) {
      setSavingConfigError(e instanceof Error ? e.message : 'Failed to save config.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleJsonFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');

    try {
      let json = JSON.parse(await file.text());
      if (Array.isArray(json)) {
        if (json.length === 0) {
          setUploadError('JSON array is empty');
          return;
        }
        json = json[0];
      }
      if (json && typeof json === 'object' && !json.folder_id && !json.main_be_api_base_url) {
        if (json.data) json = json.data;
        else if (json.config) json = json.config;
        else if (json.settings) json = json.settings;
        else if (json.attributes) json = json.attributes;
        else if (json.result) json = json.result;
      }
      if (Array.isArray(json)) {
        json = json[0] || {};
      }
      if (!json || typeof json !== 'object') {
        setUploadError('Invalid JSON structure');
        return;
      }

      const folderId = json.folder_id || json.folderId || json.folder || '';
      const apiUrl = json.main_be_api_base_url || json.apiBaseUrl || json.apiUrl || json.baseUrl || '';
      if (!folderId && !apiUrl) {
        setUploadError('Missing required fields. Received keys: ' + Object.keys(json).join(', '));
        return;
      }

      setConfigForm({
        folder_id: folderId,
        service_account_json_name: json.service_account_json_name || json.serviceAccountJsonName || json.serviceAccount || 'google-service-account.json',
        main_be_api_base_url: apiUrl,
        main_be_bearer_token: json.main_be_bearer_token || json.bearerToken || json.token || '',
        main_be_user_id: json.main_be_user_id || json.userId || json.user_id || '',
      });
      setUploadError('');
    } catch (err) {
      setUploadError(`Invalid JSON: ${err instanceof Error ? err.message : 'Parse error'}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    setSaveState('saving');
    setError('');
    try {
      const updated = await updateSettings({
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
      setSettings(updated);
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
        `Cleared ${result.cleared_tables.length} tables, deleted ${result.deleted_paths.length} paths, and cleared ${result.cleared_logs.length} logs.`,
        'success',
        3500,
        'top-center',
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

  const handleInkittJsonFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let json = JSON.parse(await file.text());
      if (Array.isArray(json)) json = json[0] || {};
      if (json.data) json = json.data;
      else if (json.config) json = json.config;
      else if (json.attributes) json = json.attributes;

      const userCred = json.user_credentials || json.userCredentials || json.user_credentials_cookie || '';
      const cfClear = json.cf_clearance || json.cfClearance || '';
      if (!userCred || !cfClear) {
        setInkittCookieError('Missing user_credentials or cf_clearance in JSON. Received keys: ' + Object.keys(json).join(', '));
        return;
      }

      setInkittUserCredentials(userCred);
      setInkittCfClearance(cfClear);
      setInkittCookieError('');
      showToast('Inkitt cookie values loaded from file.', 'success', 2000, 'top-center');
    } catch (err) {
      setInkittCookieError(`Invalid JSON: ${err instanceof Error ? err.message : 'Parse error'}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleInkittJsonPaste = () => {
    if (!inkittJsonText.trim()) {
      setInkittCookieError('Please paste JSON first.');
      return;
    }

    try {
      let json = JSON.parse(inkittJsonText);
      if (Array.isArray(json)) json = json[0] || {};
      if (json.data) json = json.data;
      else if (json.config) json = json.config;
      else if (json.attributes) json = json.attributes;

      const userCred = json.user_credentials || json.userCredentials || json.user_credentials_cookie || '';
      const cfClear = json.cf_clearance || json.cfClearance || '';
      if (!userCred || !cfClear) {
        setInkittCookieError('Missing user_credentials or cf_clearance in JSON. Received keys: ' + Object.keys(json).join(', '));
        return;
      }

      setInkittUserCredentials(userCred);
      setInkittCfClearance(cfClear);
      setInkittJsonText('');
      setInkittCookieError('');
      showToast('Inkitt cookie values loaded.', 'success', 2000, 'top-center');
    } catch (err) {
      setInkittCookieError(`Invalid JSON: ${err instanceof Error ? err.message : 'Parse error'}`);
    }
  };

  const handleSaveScribblehubCookies = async () => {
    const cookies = scribblehubCookies.trim();
    const userAgent = scribblehubUserAgent.trim();
    if (!cookies) {
      setScribblehubCookieError('Paste your ScribbleHub cookies (at least cf_clearance) before saving.');
      setScribblehubCookieMessage('');
      return;
    }
    if (!userAgent) {
      setScribblehubCookieError('Paste your browser User-Agent — cf_clearance only works with the matching User-Agent.');
      setScribblehubCookieMessage('');
      return;
    }

    setSavingScribblehubCookies(true);
    setScribblehubCookieError('');
    setScribblehubCookieMessage('');
    try {
      const result = await updateScribblehubCookies(cookies, userAgent);
      if (!result.has_cf_clearance) {
        setScribblehubCookieError('Saved, but no cf_clearance cookie was found — crawling will still be blocked by Cloudflare.');
      } else {
        const message = `Saved ${result.cookie_count} ScribbleHub cookie${result.cookie_count === 1 ? '' : 's'}.`;
        setScribblehubCookieMessage(message);
        showToast(message, 'success', 2200, 'top-center');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update ScribbleHub cookies.';
      setScribblehubCookieError(message);
      showToast('Failed to update ScribbleHub cookies.', 'error', 2500, 'top-center');
    } finally {
      setSavingScribblehubCookies(false);
    }
  };

  const handleCheckScribblehubCookies = async () => {
    setCheckingScribblehubCookies(true);
    setScribblehubCookieError('');
    setScribblehubCookieMessage('');
    try {
      const result = await checkScribblehubCookies();
      if (result.valid) {
        setScribblehubCookieMessage(result.message);
        showToast('ScribbleHub cookies are working.', 'success', 2200, 'top-center');
      } else {
        setScribblehubCookieError(result.message);
      }
    } catch (err) {
      setScribblehubCookieError(err instanceof Error ? err.message : 'Failed to test ScribbleHub cookies.');
    } finally {
      setCheckingScribblehubCookies(false);
    }
  };

  const handleScribblehubJsonFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let json = JSON.parse(text);
      if (json && !Array.isArray(json) && (json.cookies || json.data)) json = json.cookies || json.data;
      // Array of cookie objects (Selenium / EditThisCookie export) → keep as JSON for the backend parser.
      if (Array.isArray(json)) {
        setScribblehubCookies(JSON.stringify(json));
        const uaEntry = json.find((c) => (c?.name || '').toLowerCase() === 'user-agent');
        if (uaEntry?.value) setScribblehubUserAgent(String(uaEntry.value));
      } else if (json && typeof json === 'object') {
        const cf = json.cf_clearance || json.cfClearance || '';
        if (cf) setScribblehubCookies(`cf_clearance=${cf}`);
        const ua = json.user_agent || json.userAgent || json['User-Agent'] || '';
        if (ua) setScribblehubUserAgent(String(ua));
        if (!cf) setScribblehubCookies(text.trim());
      }
      setScribblehubCookieError('');
      showToast('ScribbleHub cookie values loaded from file.', 'success', 2000, 'top-center');
    } catch (err) {
      setScribblehubCookieError(`Invalid JSON: ${err instanceof Error ? err.message : 'Parse error'}`);
    } finally {
      e.target.value = '';
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex min-h-[420px] items-center justify-center text-sm" style={{ color: secondaryText }}>
          <div className="flex items-center gap-3">
            <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin" />
            <span>Loading settings...</span>
          </div>
        </div>
      );
    }

    switch (activeCategory) {
      case 'profile':
        return (
          <section className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
            <SectionTitle title="Profile" description="Basic account information for this workspace session." pageText={pageText} secondaryText={secondaryText} />
            <div className="rounded-lg border px-4 py-3" style={{ borderColor: panelBorder, background: subtleSurface }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em]" style={{ color: tertiaryText }}>Email</p>
                  <p className="mt-1 text-sm font-medium break-all" style={{ color: pageText }}>{authUser?.email || 'Unknown user'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em]" style={{ color: tertiaryText }}>Role</p>
                  <p className="mt-1 text-sm font-medium capitalize" style={{ color: pageText }}>{authUser?.role || 'unknown'}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3" style={{ borderColor: panelBorder, background: subtleSurface }}>
              <div>
                <p className="text-sm font-medium" style={{ color: pageText }}>Session</p>
                <p className="text-xs" style={{ color: tertiaryText }}>Sign out of this account on this device.</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await onLogout();
                  handleClose();
                }}
                className="rounded-md px-3 py-2 text-sm font-medium"
                style={{ background: isDark ? 'rgba(239,68,68,0.14)' : 'rgba(220,38,38,0.08)', color: isDark ? 'rgb(252 165 165)' : 'rgb(220 38 38)' }}
              >
                Logout
              </button>
            </div>
          </section>
        );
      case 'appearance':
        return (
          <section className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
            <SectionTitle title="Appearance" description="Choose the theme used across the app." pageText={pageText} secondaryText={secondaryText} />
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5" style={{ borderColor: panelBorder, background: subtleSurface }}>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: pageText }}>Theme</p>
                <p className="text-xs" style={{ color: tertiaryText }}>Switch between light and dark mode.</p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-full p-0.5" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(55,53,47,0.06)' }}>
                {(['light', 'dark'] as const).map((mode) => {
                  const active = localTheme === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setLocalTheme(mode)}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors"
                      style={{
                        background: active ? activeSurface : 'transparent',
                        color: active ? pageText : tertiaryText,
                        boxShadow: active ? (isDark ? '0 1px 2px rgba(0,0,0,0.35)' : '0 1px 2px rgba(15,23,42,0.08)') : 'none',
                      }}
                    >
                      <Icon icon={appIcons[mode === 'light' ? 'themeLight' : 'themeDark']} className="h-3.5 w-3.5" />
                      <span className="capitalize">{mode}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        );
      case 'driveSync':
        return (
          <section className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
            <SectionTitle title="Drive Sync Configuration" description="Configure Google Drive sync and backend API connection details." pageText={pageText} secondaryText={secondaryText} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: panelBorder, background: subtleSurface, color: pageText }}>
                <span>Upload JSON</span>
                <input type="file" accept="application/json" onChange={handleJsonFileUpload} className="hidden" />
              </label>
            </div>
            {uploadError && <div className="text-sm" style={{ color: isDark ? 'rgb(248 113 113)' : 'rgb(220 38 38)' }}>{uploadError}</div>}
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
            {config && (
              <div className="rounded-lg border p-4" style={{ borderColor: panelBorder, background: subtleSurface }}>
                <h3 className="mb-3 text-sm font-medium" style={{ color: pageText }}>Current configuration</h3>
                <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div><span style={{ color: tertiaryText }}>API URL:</span><span className="ml-2 break-all font-mono text-xs" style={{ color: pageText }}>{config.main_be_api_base_url || 'Not configured'}</span></div>
                  <div><span style={{ color: tertiaryText }}>User ID:</span><span className="ml-2 break-all font-mono text-xs" style={{ color: pageText }}>{config.main_be_user_id ? `${config.main_be_user_id.slice(0, 8)}...` : 'Not configured'}</span></div>
                  <div><span style={{ color: tertiaryText }}>Folder ID:</span><span className="ml-2 break-all font-mono text-xs" style={{ color: pageText }}>{config.folder_id ? `${config.folder_id.slice(0, 12)}...` : 'Not configured'}</span></div>
                  <div><span style={{ color: tertiaryText }}>Service Account:</span><span className="ml-2 font-mono text-xs" style={{ color: pageText }}>{config.service_account_json_name || 'Not configured'}</span></div>
                </div>
              </div>
            )}
          </section>
        );
      case 'inkitt':
        return (
          <section className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
            <SectionTitle title="Inkitt Cookies" description="Update login cookies for Inkitt chapter crawling." pageText={pageText} secondaryText={secondaryText} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label htmlFor="settings-inkitt-user-credentials" className={labelClassName}>`user_credentials` value</label>
                <textarea id="settings-inkitt-user-credentials" value={inkittUserCredentials} onChange={(e) => { setInkittUserCredentials(e.target.value); setInkittCookieError(''); setInkittCookieMessage(''); }} rows={4} className={`${fieldClassName} min-h-[110px] resize-y font-mono text-xs`} style={{ background: inputBackground, borderColor: inputBorder }} />
              </div>
              <div>
                <label htmlFor="settings-inkitt-cf-clearance" className={labelClassName}>`cf_clearance` value</label>
                <textarea id="settings-inkitt-cf-clearance" value={inkittCfClearance} onChange={(e) => { setInkittCfClearance(e.target.value); setInkittCookieError(''); setInkittCookieMessage(''); }} rows={4} className={`${fieldClassName} min-h-[110px] resize-y font-mono text-xs`} style={{ background: inputBackground, borderColor: inputBorder }} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleSaveInkittCookies} disabled={savingInkittCookies || !inkittUserCredentials.trim() || !inkittCfClearance.trim()} className="rounded-lg px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed" style={{ background: savingInkittCookies || !inkittUserCredentials.trim() || !inkittCfClearance.trim() ? subtleSurface : primaryButton, color: savingInkittCookies || !inkittUserCredentials.trim() || !inkittCfClearance.trim() ? tertiaryText : '#fff' }}>
                {savingInkittCookies ? 'Saving...' : 'Save Cookies'}
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: panelBorder, background: subtleSurface, color: pageText }}>
                <span>Upload Cookies JSON</span>
                <input type="file" accept="application/json" onChange={handleInkittJsonFileUpload} className="hidden" />
              </label>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <textarea value={inkittJsonText} onChange={(e) => setInkittJsonText(e.target.value)} rows={2} placeholder={'{\n  "user_credentials": "...",\n  "cf_clearance": "..."\n}'} className={`${fieldClassName} min-w-0 flex-1 resize-none font-mono text-xs`} style={{ background: inputBackground, borderColor: inputBorder }} />
              <button onClick={handleInkittJsonPaste} disabled={!inkittJsonText.trim()} className="rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed" style={{ background: inkittJsonText.trim() ? primaryButton : subtleSurface, color: inkittJsonText.trim() ? '#fff' : tertiaryText }}>Apply</button>
            </div>
            <p className="text-xs" style={{ color: tertiaryText }}>Copy these from Chrome DevTools under Application → Cookies for `https://www.inkitt.com`.</p>
            {inkittCookieMessage && <div className="text-sm" style={{ color: isDark ? 'rgb(74 222 128)' : 'rgb(21 128 61)' }}>{inkittCookieMessage}</div>}
            {inkittCookieError && <div className="text-sm" style={{ color: isDark ? 'rgb(248 113 113)' : 'rgb(220 38 38)' }}>{inkittCookieError}</div>}
          </section>
        );
      case 'scribblehub':
        return (
          <section className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
            <SectionTitle title="ScribbleHub Cookies" description="ScribbleHub is behind a Cloudflare challenge. Paste a browser session cookie (cf_clearance) and its matching User-Agent so the crawler can read pages directly." pageText={pageText} secondaryText={secondaryText} />
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label htmlFor="settings-scribblehub-cookies" className={labelClassName}>Cookies — `cf_clearance=...`, a full Cookie header, or a JSON cookie array</label>
                <textarea id="settings-scribblehub-cookies" value={scribblehubCookies} onChange={(e) => { setScribblehubCookies(e.target.value); setScribblehubCookieError(''); setScribblehubCookieMessage(''); }} rows={4} className={`${fieldClassName} min-h-[110px] resize-y font-mono text-xs`} placeholder={'cf_clearance=AbCd...'} style={{ background: inputBackground, borderColor: inputBorder }} />
              </div>
              <div>
                <label htmlFor="settings-scribblehub-ua" className={labelClassName}>Browser User-Agent (run `navigator.userAgent` in the DevTools console)</label>
                <textarea id="settings-scribblehub-ua" value={scribblehubUserAgent} onChange={(e) => { setScribblehubUserAgent(e.target.value); setScribblehubCookieError(''); setScribblehubCookieMessage(''); }} rows={2} className={`${fieldClassName} resize-y font-mono text-xs`} placeholder={'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/... Safari/537.36'} style={{ background: inputBackground, borderColor: inputBorder }} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleSaveScribblehubCookies} disabled={savingScribblehubCookies || !scribblehubCookies.trim() || !scribblehubUserAgent.trim()} className="rounded-lg px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed" style={{ background: savingScribblehubCookies || !scribblehubCookies.trim() || !scribblehubUserAgent.trim() ? subtleSurface : primaryButton, color: savingScribblehubCookies || !scribblehubCookies.trim() || !scribblehubUserAgent.trim() ? tertiaryText : '#fff' }}>
                {savingScribblehubCookies ? 'Saving...' : 'Save Cookies'}
              </button>
              <button type="button" onClick={handleCheckScribblehubCookies} disabled={checkingScribblehubCookies} className="rounded-lg border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed" style={{ borderColor: panelBorder, background: subtleSurface, color: pageText }}>
                {checkingScribblehubCookies ? 'Testing...' : 'Test Cookies'}
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: panelBorder, background: subtleSurface, color: pageText }}>
                <span>Upload Cookies JSON</span>
                <input type="file" accept="application/json" onChange={handleScribblehubJsonFileUpload} className="hidden" />
              </label>
            </div>
            <p className="text-xs" style={{ color: tertiaryText }}>In Chrome at `https://www.scribblehub.com`: DevTools → Application → Cookies → copy `cf_clearance`. cf_clearance is tied to your IP + User-Agent, so the crawler must run on this machine and the User-Agent must match. It expires every ~30–60 min — re-paste when crawls start failing.</p>
            {scribblehubCookieMessage && <div className="text-sm" style={{ color: isDark ? 'rgb(74 222 128)' : 'rgb(21 128 61)' }}>{scribblehubCookieMessage}</div>}
            {scribblehubCookieError && <div className="text-sm" style={{ color: isDark ? 'rgb(248 113 113)' : 'rgb(220 38 38)' }}>{scribblehubCookieError}</div>}
          </section>
        );
      case 'crawler':
        return (
          <div className="space-y-4">
            <section className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
              <SectionTitle title="Default Crawl Settings" description="Applied automatically on the crawl page." pageText={pageText} secondaryText={secondaryText} />
              <div className="inline-flex items-center gap-1 rounded-md p-0.5" style={{ background: subtleSurface }}>
                <button onClick={() => setCrawlMode('count')} className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: crawlMode === 'count' ? activeSurface : 'transparent', color: pageText }}>Count</button>
                <button onClick={() => setCrawlMode('range')} className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: crawlMode === 'range' ? activeSurface : 'transparent', color: pageText }}>Range</button>
              </div>
              {crawlMode === 'count' ? (
                <div className="max-w-xs">
                  <label htmlFor="settings-default-chapter-count" className={labelClassName}>Default chapter count</label>
                  <input id="settings-default-chapter-count" type="number" min={1} max={100000} value={count} onChange={(e) => setCount(Math.max(1, Number.parseInt(e.target.value, 10) || 1))} className={fieldClassName} style={{ background: inputBackground, borderColor: inputBorder }} />
                </div>
              ) : (
                <div className="flex max-w-sm items-end gap-3">
                  <div className="flex-1">
                    <label htmlFor="settings-range-from" className={labelClassName}>From chapter</label>
                    <input id="settings-range-from" type="number" min={1} value={rangeFrom} onChange={(e) => setRangeFrom(Math.max(1, Number.parseInt(e.target.value, 10) || 1))} className={fieldClassName} style={{ background: inputBackground, borderColor: inputBorder }} />
                  </div>
                  <span className="pb-3 text-sm font-medium" style={{ color: tertiaryText }}>to</span>
                  <div className="flex-1">
                    <label htmlFor="settings-range-to" className={labelClassName}>To chapter</label>
                    <input id="settings-range-to" type="number" min={1} value={rangeTo} onChange={(e) => setRangeTo(Math.max(1, Number.parseInt(e.target.value, 10) || 1))} className={fieldClassName} style={{ background: inputBackground, borderColor: inputBorder }} />
                  </div>
                </div>
              )}
              <p className="text-sm" style={{ color: secondaryText }}>{crawlMode === 'count' ? `Default: crawl up to ${count} chapter${count === 1 ? '' : 's'}` : `Default: crawl chapters ${rangeFrom} to ${rangeTo} (${Math.max(0, rangeTo - rangeFrom + 1)} total)`}</p>
              {settings && (
                <p className="text-xs" style={{ color: tertiaryText }}>
                  Saved mode: {settings.crawl_mode === 'count' ? 'Count' : 'Range'}
                </p>
              )}
            </section>
            <section className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
              <SectionTitle title="Crawl Auto Settings" description="Auto-fill and range limits for crawl after URL detection." pageText={pageText} secondaryText={secondaryText} />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium" style={{ color: pageText }}>Auto-fill full available chapters</p>
                  <p className="mt-0.5 text-xs" style={{ color: tertiaryText }}>Automatically fill the chapter count to the full number of available chapters after detecting a story URL.</p>
                </div>
                <button onClick={() => setCrawlAutoMaxChapters((value) => !value)} className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors" style={{ background: crawlAutoMaxChapters ? primaryButton : subtleSurfaceHover }}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${crawlAutoMaxChapters ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </section>
          </div>
        );
      case 'audio':
        return (
          <div className="space-y-4">
            <section className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
              <SectionTitle title="Auto Audio Settings" description="Configure backoff, pipeline window, upload workers, and test story IDs." pageText={pageText} secondaryText={secondaryText} />
              <div className="grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label htmlFor="settings-audio-rest-seconds" className={labelClassName}>Backoff after failed story (seconds)</label>
                  <input id="settings-audio-rest-seconds" type="number" min={0} max={600} value={autoAudioRestSeconds} onChange={(e) => setAutoAudioRestSeconds(Math.max(0, Number.parseInt(e.target.value, 10) || 0))} className={fieldClassName} style={{ background: inputBackground, borderColor: inputBorder }} />
                </div>
                <fieldset>
                  <legend className={labelClassName}>Upload workers</legend>
                  <div className="inline-flex flex-wrap items-center gap-1 rounded-md p-0.5" style={{ background: subtleSurface }}>
                    {[1, 2, 3, 4].map((v) => (
                      <button key={v} onClick={() => setAutoAudioUploadWorkers(v)} className="min-w-10 rounded-md px-3 py-2 text-sm font-medium" style={{ background: autoAudioUploadWorkers === v ? activeSurface : 'transparent', color: pageText }}>{v}</button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className={labelClassName}>Batch window</legend>
                  <div className="inline-flex flex-wrap items-center gap-1 rounded-md p-0.5" style={{ background: subtleSurface }}>
                    {[1, 2].map((v) => (
                      <button key={v} onClick={() => setAutoAudioBatchWindow(v)} className="min-w-10 rounded-md px-3 py-2 text-sm font-medium" style={{ background: autoAudioBatchWindow === v ? activeSurface : 'transparent', color: pageText }}>{v}</button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="max-w-lg">
                <label htmlFor="settings-audio-test-story-ids" className={labelClassName}>Test Story IDs</label>
                <textarea id="settings-audio-test-story-ids" value={autoAudioTestIdsText} onChange={(e) => { setAutoAudioTestIdsText(e.target.value); const ids = e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean); setAutoAudioTestStoryIds(ids); }} rows={3} className={`${fieldClassName} resize-none font-mono text-sm`} style={{ background: inputBackground, borderColor: inputBorder }} />
              </div>
            </section>
            <section className={sectionClassName} style={{ background: panelBackground, borderColor: panelBorder }}>
              <SectionTitle title="TTS Concurrency" description="Number of concurrent voice generation workers." pageText={pageText} secondaryText={secondaryText} />
              <div className="inline-flex flex-wrap items-center gap-1 rounded-md p-0.5" style={{ background: subtleSurface }}>
                {ttsConcurrencyOptions.map((v) => (
                  <button key={v} onClick={() => setTtsConcurrency(v)} className="min-w-12 rounded-md px-4 py-2 text-sm font-medium" style={{ background: ttsConcurrency === v ? activeSurface : 'transparent', color: pageText }}>{v}</button>
                ))}
              </div>
            </section>
          </div>
        );
      case 'danger':
        return (
          <section className={sectionClassName} style={{ background: panelBackground, borderColor: isDark ? 'rgba(248,113,113,0.25)' : 'rgba(220,38,38,0.18)' }}>
            <SectionTitle title="Development Cleanup" description="Clear runtime histories, outputs, sessions, jobs, logs, settings, Drive credentials, and saved tokens." pageText={pageText} secondaryText={secondaryText} />
            {isAdmin ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="max-w-md flex-1">
                  <label htmlFor="settings-clear-confirmation" className={labelClassName}>Confirmation</label>
                  <input id="settings-clear-confirmation" type="text" value={clearConfirm} onChange={(e) => setClearConfirm(e.target.value)} placeholder="CLEAR_BACKEND_DATA" className={`${fieldClassName} font-mono text-sm`} style={{ background: inputBackground, borderColor: inputBorder }} />
                </div>
                <button type="button" onClick={handleClearBackendData} disabled={clearState === 'clearing' || clearConfirm.trim() !== 'CLEAR_BACKEND_DATA'} className="rounded-lg px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed" style={{ background: clearState === 'clearing' || clearConfirm.trim() !== 'CLEAR_BACKEND_DATA' ? subtleSurface : '#dc2626', color: clearState === 'clearing' || clearConfirm.trim() !== 'CLEAR_BACKEND_DATA' ? tertiaryText : '#fff' }}>
                  {clearState === 'clearing' ? 'Clearing...' : 'Clear Backend Data'}
                </button>
              </div>
            ) : (
              <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: panelBorder, background: subtleSurface, color: secondaryText }}>Admin access is required.</div>
            )}
          </section>
        );
      default:
        return null;
    }
  };

  return (
    <div className="hidden lg:block">
      <button
        type="button"
        aria-label="Close settings"
        className="fixed inset-0 z-[70]"
        style={{ background: 'rgba(15, 23, 42, 0.28)', backdropFilter: 'blur(6px)' }}
        onClick={handleClose}
      />
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4 lg:p-6">
        <dialog
          open
          className="flex h-[min(82vh,760px)] w-full max-w-[80vw] overflow-hidden rounded-2xl border shadow-2xl"
          style={{ background: shellBackground, borderColor: panelBorder, color: pageText }}
        >
          <aside className="hidden w-[208px] shrink-0 border-r md:flex md:flex-col" style={{ borderColor: panelBorder, background: isDark ? '#1b1b1b' : '#f7f6f3' }}>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
              {categories.map((category) => {
                const active = category.id === activeCategory;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setActiveCategory(category.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors"
                    style={{ background: active ? activeSurface : 'transparent', color: active ? pageText : secondaryText }}
                  >
                    <Icon icon={appIcons[category.icon]} className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="text-sm font-medium">{category.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col" style={{ background: shellBackground }}>
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-2.5 md:px-5" style={{ borderColor: panelBorder }}>
              <p className="text-sm font-semibold md:text-base" style={{ color: pageText }}>{categories.find((item) => item.id === activeCategory)?.label}</p>
              <button onClick={handleClose} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: subtleSurface, color: secondaryText }}>
                <Icon icon={appIcons.close} className="h-4 w-4" />
              </button>
            </div>

            {/* Mobile: horizontal scrollable category tabs */}
            <div className="flex md:hidden border-b overflow-x-auto" style={{ borderColor: panelBorder, scrollbarWidth: 'none' }}>
              <div className="flex">
                {categories.map((category) => {
                  const active = category.id === activeCategory;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setActiveCategory(category.id)}
                      className="flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-medium transition-colors"
                      style={{
                        borderColor: active ? primaryButton : 'transparent',
                        color: active ? primaryButton : secondaryText,
                      }}
                    >
                      <Icon icon={appIcons[category.icon]} className="h-3.5 w-3.5 flex-shrink-0" />
                      {category.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-4 rounded-lg border px-4 py-3 text-sm md:mx-5" style={{ borderColor: isDark ? 'rgba(248,113,113,0.28)' : 'rgba(220,38,38,0.2)', background: isDark ? 'rgba(127,29,29,0.18)' : 'rgba(254,242,242,0.95)', color: isDark ? 'rgb(252 165 165)' : 'rgb(185 28 28)' }}>
                {error}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-4">
              <div className="mx-auto w-full max-w-[60%]">
                {renderContent()}
              </div>
            </div>

            <div className="flex items-center justify-between border-t px-4 py-2.5 md:px-5" style={{ borderColor: panelBorder, background: isDark ? '#1b1b1b' : '#fafafa' }}>
              <p className="text-xs" style={{ color: tertiaryText }}>Changes apply to this workspace after saving.</p>
              <button onClick={handleSave} disabled={saveState === 'saving' || saveState === 'saved'} className="rounded-md px-4 py-2 text-sm font-semibold transition-colors" style={{ background: saveState === 'saving' || saveState === 'saved' ? (saveState === 'saved' ? '#16a34a' : subtleSurface) : primaryButton, color: saveState === 'saving' || saveState === 'saved' ? (saveState === 'saved' ? '#fff' : tertiaryText) : '#fff' }}>
                {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : 'Save Settings'}
              </button>
            </div>
          </div>
        </dialog>
      </div>
    </div>
  );
}

export default SettingsPage;
