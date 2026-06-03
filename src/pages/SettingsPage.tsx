import { useEffect, useState } from 'react';
import {
  getSettings,
  updateSettings,
  getDriveSyncConfig,
  initDriveSyncConfig,
  checkCredentialsExists,
  type SettingsResponse,
  type DriveSyncConfig,
  FIXED_JSON_PREFIX,
} from '../api/client';
import { ConfigModal, type ConfigFormData } from '../components/ConfigModal';
import { type ThemeMode } from '../components/ThemeToggle';
import { showToast } from '../components/Toast';

interface SettingsPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function SettingsPage({ themeMode, onThemeChange }: SettingsPageProps) {
  const isDark = themeMode === 'dark';
  const [, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  const [localTheme, setLocalTheme] = useState<'light' | 'dark'>('light');
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
  const [ttsConcurrency, setTtsConcurrency] = useState<number | null>(null);
  const ttsConcurrencyOptions: Array<number | null> = [null, 1, 2, 3, 4];

  // Drive Sync Config Modal
  const [config, setConfig] = useState<DriveSyncConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [showConfigModal, setShowConfigModal] = useState(false);
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
  const [jsonText, setJsonText] = useState('');

  useEffect(() => {
    setLocalTheme(themeMode === 'dark' ? 'dark' : 'light');
    getSettings()
      .then(s => {
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
        setTtsConcurrency(s.tts_concurrency ?? null);
      })
      .catch(() => setError('Failed to load settings.'))
      .finally(() => setLoading(false));
  }, [themeMode]);

  // Load Drive Sync config
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
          setShowConfigModal(true);
        }
      } catch {
        // ignore
      } finally {
        setConfigLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleConfigFormChange = (data: Partial<ConfigFormData>) => {
    setConfigForm(prev => ({ ...prev, ...data }));
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
      setShowConfigModal(false);
      showToast('Drive Sync configuration saved successfully.', 'success', 2000, 'top-center');
    } catch (e) {
      setSavingConfigError(e instanceof Error ? e.message : 'Failed to save config.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleJsonFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        let json = JSON.parse(event.target?.result as string);
        
        // Handle array - try to get first element
        if (Array.isArray(json)) {
          if (json.length === 0) {
            setUploadError('JSON array is empty');
            return;
          }
          json = json[0];
        }
        
        // Handle nested data structure
        if (json && typeof json === 'object' && !json.folder_id && !json.main_be_api_base_url) {
          if (json.data) json = json.data;
          else if (json.config) json = json.config;
          else if (json.settings) json = json.settings;
          else if (json.attributes) json = json.attributes;
          else if (json.result) json = json.result;
        }
        
        // Handle case where nested value is an array
        if (Array.isArray(json)) {
          json = json[0] || {};
        }
        
        // Validate required fields exist
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
        setShowConfigModal(true);
      } catch (err) {
        setUploadError(`Invalid JSON: ${err instanceof Error ? err.message : 'Parse error'}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleJsonPaste = () => {
    if (!jsonText.trim()) {
      setUploadError('Please paste JSON first');
      return;
    }
    setUploadError('');

    try {
      let json = JSON.parse(jsonText);
      
      // Handle array - try to get first element or use as-is
      if (Array.isArray(json)) {
        if (json.length === 0) {
          setUploadError('JSON array is empty');
          return;
        }
        json = json[0];
      }
      
      // Handle nested data structure
      if (json && typeof json === 'object' && !json.folder_id && !json.main_be_api_base_url) {
        if (json.data) json = json.data;
        else if (json.config) json = json.config;
        else if (json.settings) json = json.settings;
        else if (json.attributes) json = json.attributes;
        else if (json.result) json = json.result;
      }
      
      // Handle case where nested value is an array
      if (Array.isArray(json)) {
        json = json[0] || {};
      }
      
      // Validate required fields exist
      if (!json || typeof json !== 'object') {
        setUploadError('Invalid JSON structure');
        return;
      }
      
      const folderId = json.folder_id || json.folderId || json.folder || '';
      const apiUrl = json.main_be_api_base_url || json.apiBaseUrl || json.apiUrl || json.baseUrl || '';
      
      if (!folderId && !apiUrl) {
        setUploadError('Missing required fields: folder_id or main_be_api_base_url. Received keys: ' + Object.keys(json).join(', '));
        return;
      }
      
      setConfigForm({
        folder_id: folderId,
        service_account_json_name: json.service_account_json_name || json.serviceAccountJsonName || json.serviceAccount || 'google-service-account.json',
        main_be_api_base_url: apiUrl,
        main_be_bearer_token: json.main_be_bearer_token || json.bearerToken || json.token || '',
        main_be_user_id: json.main_be_user_id || json.userId || json.user_id || '',
      });
      setJsonText('');
      setUploadError('');
      setShowConfigModal(true);
    } catch (err) {
      setUploadError(`Invalid JSON: ${err instanceof Error ? err.message : 'Parse error'}`);
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

  if (loading) {
    return (
      <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: isDark ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)' : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)' }}>
        <div className="lg-orb lg-orb-1" />
        <div className="lg-orb lg-orb-2" />
        <div className="lg-orb lg-orb-3" />
        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="flex items-center gap-3" style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)' }}>
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading settings...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: isDark ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)' : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)' }}>
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />

      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

          {/* Page Header */}
          <div className="lg-glass-deep px-6 py-5">
            <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>
              Settings
            </h1>
            <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
              Customize your experience
            </p>
          </div>

        {/* Error */}
        {error && (
          <div className={`flex items-center gap-3 p-4 rounded-2xl text-sm ${isDark
            ? 'bg-red-900/20 border border-red-800/30 text-red-400'
            : 'bg-red-50 border border-red-200 text-red-600'
          }`}>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Theme Section */}
        <section className="lg-glass p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-white/[0.06] text-indigo-400' : 'bg-[rgba(0,0,0,0.04)] text-indigo-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>Appearance</h2>
              <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Toggle between light and dark theme</p>
            </div>
          </div>

          <div className={`flex gap-3 ${isDark ? '' : ''}`}>
            {/* Light option */}
            <button
              onClick={() => setLocalTheme('light')}
              className={`flex-1 p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-2 ${
                localTheme === 'light'
                  ? 'border-indigo-500 bg-indigo-600/10'
                  : isDark
                    ? 'border-white/[0.08] hover:border-white/[0.15] bg-white/[0.03]'
                    : 'border-black/8 hover:border-indigo-200 bg-[rgba(0,0,0,0.02)]'
              }`}
            >
              <svg className={`w-6 h-6 ${localTheme === 'light' ? 'text-indigo-400' : isDark ? 'text-white/35' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span className={`text-sm font-medium ${localTheme === 'light' ? 'text-indigo-300' : isDark ? 'text-white/35' : 'text-gray-500'}`}>Light</span>
            </button>

            {/* Dark option */}
            <button
              onClick={() => setLocalTheme('dark')}
              className={`flex-1 p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-2 ${
                localTheme === 'dark'
                  ? 'border-indigo-500 bg-indigo-600/10'
                  : isDark
                    ? 'border-white/[0.08] hover:border-white/[0.15] bg-white/[0.03]'
                    : 'border-black/8 hover:border-indigo-200 bg-[rgba(0,0,0,0.02)]'
              }`}
            >
              <svg className={`w-6 h-6 ${localTheme === 'dark' ? 'text-indigo-400' : isDark ? 'text-white/35' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span className={`text-sm font-medium ${localTheme === 'dark' ? 'text-indigo-300' : isDark ? 'text-white/35' : 'text-gray-500'}`}>Dark</span>
            </button>
          </div>
        </section>

        {/* Drive Sync Config Section */}
        <section className="lg-glass p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-white/[0.06] text-indigo-400' : 'bg-[rgba(0,0,0,0.04)] text-indigo-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>Drive Sync Configuration</h2>
              <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Configure Google Drive sync and backend API settings</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Configure Button */}
            <button
              onClick={() => setShowConfigModal(true)}
              disabled={configLoading}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                isDark
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
              } disabled:opacity-50`}
            >
              {configLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
              Configure
            </button>

            {/* Upload JSON Button */}
            <label className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 cursor-pointer ${
              isDark
                ? 'bg-white/[0.06] hover:bg-white/[0.08] text-white/70 border border-white/[0.08]'
                : 'bg-[rgba(0,0,0,0.04)] hover:bg-[rgba(0,0,0,0.06)] text-[rgba(0,0,0,0.6)] border border-black/8'
            }`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload JSON Preset
              <input
                type="file"
                accept="application/json"
                onChange={handleJsonFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Paste JSON Option */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <label className={`text-sm font-medium ${isDark ? 'text-white/70' : 'text-[rgba(0,0,0,0.7)]'}`}>
                Or paste JSON preset
              </label>
              <button
                onClick={handleJsonPaste}
                disabled={!jsonText.trim()}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  jsonText.trim()
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    : isDark
                      ? 'bg-white/[0.06] text-white/30 cursor-not-allowed'
                      : 'bg-[rgba(0,0,0,0.04)] text-[rgba(0,0,0,0.3)] cursor-not-allowed'
                }`}
              >
                Apply
              </button>
            </div>
            <textarea
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              placeholder={'{\n  "folder_id": "...",\n  "main_be_api_base_url": "...",\n  ...\n}'}
              rows={5}
              className={`w-full px-3 py-2.5 rounded-xl border text-sm font-mono resize-none
                focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                ${isDark
                  ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder:text-white/30'
                  : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)] placeholder:text-[rgba(0,0,0,0.3)]'
                }`}
            />
          </div>

          {/* Upload Error */}
          {uploadError && (
            <div className={`text-sm ${isDark ? 'text-red-400' : 'text-red-500'} flex items-center gap-2`}>
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {uploadError}
            </div>
          )}

          {/* Current Config Summary */}
          {config && (
            <div className={`mt-4 p-4 rounded-xl ${isDark ? 'bg-white/[0.02]' : 'bg-[rgba(0,0,0,0.02)]'}`}>
              <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-white/70' : 'text-[rgba(0,0,0,0.7)]'}`}>Current Configuration</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className={`${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>API URL:</span>
                  <span className={`ml-2 font-mono text-xs break-all ${isDark ? 'text-white/85' : 'text-[rgba(0,0,0,0.85)]'}`}>
                    {config.main_be_api_base_url || <span className="italic text-gray-400">Not configured</span>}
                  </span>
                </div>
                <div>
                  <span className={`${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>User ID:</span>
                  <span className={`ml-2 font-mono text-xs break-all ${isDark ? 'text-white/85' : 'text-[rgba(0,0,0,0.85)]'}`}>
                    {config.main_be_user_id ? `${config.main_be_user_id.slice(0, 8)}...` : <span className="italic text-gray-400">Not configured</span>}
                  </span>
                </div>
                <div>
                  <span className={`${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Folder ID:</span>
                  <span className={`ml-2 font-mono text-xs break-all ${isDark ? 'text-white/85' : 'text-[rgba(0,0,0,0.85)]'}`}>
                    {config.folder_id ? `${config.folder_id.slice(0, 12)}...` : <span className="italic text-gray-400">Not configured</span>}
                  </span>
                </div>
                <div>
                  <span className={`${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Service Account:</span>
                  <span className={`ml-2 font-mono text-xs ${isDark ? 'text-white/85' : 'text-[rgba(0,0,0,0.85)]'}`}>
                    {config.service_account_json_name || <span className="italic text-gray-400">Not configured</span>}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Crawl Defaults Section */}
        <section className="lg-glass p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-white/[0.06] text-indigo-400' : 'bg-[rgba(0,0,0,0.04)] text-indigo-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>Default Crawl Settings</h2>
              <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Applied automatically on the crawl page</p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className={`flex items-center gap-1 p-1 rounded-xl w-fit ${isDark ? 'bg-white/[0.04]' : 'bg-[rgba(0,0,0,0.04)]'}`}>
            <button
              onClick={() => setCrawlMode('count')}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                crawlMode === 'count'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : isDark
                    ? 'text-white/40 hover:text-white/70'
                    : 'text-[rgba(0,0,0,0.4)] hover:text-[rgba(0,0,0,0.7)]'
              }`}
            >
              Count
            </button>
            <button
              onClick={() => setCrawlMode('range')}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                crawlMode === 'range'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : isDark
                    ? 'text-white/40 hover:text-white/70'
                    : 'text-[rgba(0,0,0,0.4)] hover:text-[rgba(0,0,0,0.7)]'
              }`}
            >
              Range
            </button>
          </div>

          {/* Count input */}
          {crawlMode === 'count' ? (
            <div className="max-w-xs">
              <label className={`block text-sm mb-2 ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                Default chapter count
              </label>
              <input
                type="number"
                min={1}
                max={100000}
                value={count}
                onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                className={`w-full px-4 py-3 border rounded-xl
                  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                  ${isDark
                    ? 'bg-white/[0.05] border-white/[0.08] text-white/90'
                    : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)]'
                  }`}
              />
            </div>
          ) : (
            <div className="flex items-end gap-3 max-w-sm">
              <div className="flex-1">
                <label className={`block text-sm mb-2 ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                  From chapter
                </label>
                <input
                  type="number"
                  min={1}
                  value={rangeFrom}
                  onChange={e => setRangeFrom(Math.max(1, parseInt(e.target.value) || 1))}
                  className={`w-full px-4 py-3 border rounded-xl
                    focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                    ${isDark
                      ? 'bg-white/[0.05] border-white/[0.08] text-white/90'
                      : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)]'
                    }`}
                />
              </div>
              <span className={`pb-3 font-medium ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>to</span>
              <div className="flex-1">
                <label className={`block text-sm mb-2 ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                  To chapter
                </label>
                <input
                  type="number"
                  min={1}
                  value={rangeTo}
                  onChange={e => setRangeTo(Math.max(1, parseInt(e.target.value) || 1))}
                  className={`w-full px-4 py-3 border rounded-xl
                    focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                    ${isDark
                      ? 'bg-white/[0.05] border-white/[0.08] text-white/90'
                      : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)]'
                    }`}
                />
              </div>
            </div>
          )}

          <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
            {crawlMode === 'count'
              ? `Default: crawl up to ${count} chapter${count !== 1 ? 's' : ''}`
              : `Default: crawl chapters ${rangeFrom} to ${rangeTo} (${Math.max(0, rangeTo - rangeFrom + 1)} total)`
            }
          </p>
        </section>

        {/* Auto Audio Settings Section */}
        <section className="lg-glass p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-white/[0.06] text-indigo-400' : 'bg-[rgba(0,0,0,0.04)] text-indigo-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>Auto Audio Settings</h2>
              <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Configure backoff, pipeline window, upload workers, and test story IDs</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl">
            <div>
              <label className={`block text-sm mb-2 ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                Backoff after failed story (seconds)
              </label>
              <input
                type="number"
                min={0}
                max={600}
                value={autoAudioRestSeconds}
                onChange={e => setAutoAudioRestSeconds(Math.max(0, parseInt(e.target.value) || 0))}
                className={`w-full px-4 py-3 border rounded-xl
                  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                  ${isDark
                    ? 'bg-white/[0.05] border-white/[0.08] text-white/90'
                    : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)]'
                  }`}
              />
              <p className={`text-xs mt-1 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                Successful stories continue immediately.
              </p>
            </div>

            <div>
              <label className={`block text-sm mb-2 ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                Upload workers
              </label>
              <div className={`flex flex-wrap items-center gap-2 p-1 rounded-xl w-fit ${isDark ? 'bg-white/[0.04]' : 'bg-[rgba(0,0,0,0.04)]'}`}>
                {[1, 2, 3, 4].map(v => (
                  <button
                    key={v}
                    onClick={() => setAutoAudioUploadWorkers(v)}
                    className={`min-w-10 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                      autoAudioUploadWorkers === v
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                        : isDark
                          ? 'text-white/40 hover:text-white/70'
                          : 'text-[rgba(0,0,0,0.4)] hover:text-[rgba(0,0,0,0.7)]'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <p className={`text-xs mt-2 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                Handles download, compression, and upload in parallel.
              </p>
            </div>

            <div>
              <label className={`block text-sm mb-2 ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                Batch window
              </label>
              <div className={`flex flex-wrap items-center gap-2 p-1 rounded-xl w-fit ${isDark ? 'bg-white/[0.04]' : 'bg-[rgba(0,0,0,0.04)]'}`}>
                {[1, 2].map(v => (
                  <button
                    key={v}
                    onClick={() => setAutoAudioBatchWindow(v)}
                    className={`min-w-10 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                      autoAudioBatchWindow === v
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                        : isDark
                          ? 'text-white/40 hover:text-white/70'
                          : 'text-[rgba(0,0,0,0.4)] hover:text-[rgba(0,0,0,0.7)]'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <p className={`text-xs mt-2 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                Max story batches started or queued at once. Use 2 for one-story lookahead.
              </p>
            </div>
          </div>

          {/* Test Story IDs */}
          <div className="max-w-lg">
            <label className={`block text-sm mb-2 ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
              Test Story IDs
            </label>
            <textarea
              value={autoAudioTestIdsText}
              onChange={e => {
                setAutoAudioTestIdsText(e.target.value);
                const ids = e.target.value
                  .split(/[\n,]/)
                  .map(s => s.trim())
                  .filter(s => s.length > 0);
                setAutoAudioTestStoryIds(ids);
              }}
              placeholder="ce6176c4-aeb5-4ee1-847f-ee56df64a386, 07d59e98-d693-429b-a9d1-53ce2fd89e55"
              rows={3}
              className={`w-full px-4 py-3 border rounded-xl text-sm font-mono resize-none
                focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                ${isDark
                  ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder:text-white/30'
                  : 'bg-[rgba(0,0,0,0.04)] border-black/8 text-[rgba(0,0,0,0.85)] placeholder:text-[rgba(0,0,0,0.3)]'
                }`}
            />
            <p className={`text-xs mt-1 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
              Comma or newline separated story IDs. Used in test mode.
            </p>
          </div>
        </section>

        {/* TTS Concurrency Section */}
        <section className="lg-glass p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-white/[0.06] text-indigo-400' : 'bg-[rgba(0,0,0,0.04)] text-indigo-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>TTS Concurrency</h2>
              <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Number of concurrent voice generation workers</p>
            </div>
          </div>

          <div className="max-w-md">
            <label className={`block text-sm mb-2 ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
              Concurrent workers
            </label>
            <div className={`flex flex-wrap items-center gap-2 p-1 rounded-xl w-fit ${isDark ? 'bg-white/[0.04]' : 'bg-[rgba(0,0,0,0.04)]'}`}>
              {ttsConcurrencyOptions.map(v => (
                <button
                  key={v ?? 'auto'}
                  onClick={() => setTtsConcurrency(v)}
                  className={`min-w-12 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    ttsConcurrency === v
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : isDark
                        ? 'text-white/40 hover:text-white/70'
                        : 'text-[rgba(0,0,0,0.4)] hover:text-[rgba(0,0,0,0.7)]'
                  }`}
                >
                  {v ?? 'Auto'}
                </button>
              ))}
            </div>
            <p className={`text-xs mt-2 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
              Auto chooses a CPU-friendly worker count. Use 1 for stability, 2-4 for faster batch throughput.
            </p>
          </div>
        </section>

        {/* Crawl Auto Settings Section */}
        <section className="lg-glass p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-white/[0.06] text-indigo-400' : 'bg-[rgba(0,0,0,0.04)] text-indigo-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>Crawl Auto Settings</h2>
              <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Auto-fill and range limits for crawl after URL detection</p>
            </div>
          </div>

          {/* Auto fill full chapters toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${isDark ? 'text-white/70' : 'text-[rgba(0,0,0,0.7)]'}`}>
                Auto-fill full available chapters
              </p>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-white/30' : 'text-[rgba(0,0,0,0.3)]'}`}>
                Automatically fill the chapter count to the full number of available chapters after detecting a story URL
              </p>
            </div>
            <button
              onClick={() => setCrawlAutoMaxChapters(m => !m)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                crawlAutoMaxChapters
                  ? 'bg-indigo-600'
                  : isDark ? 'bg-white/10' : 'bg-black/10'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                  crawlAutoMaxChapters ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saveState !== 'idle'}
            className={`px-6 py-3 font-semibold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg ${
              saveState !== 'idle'
                ? saveState === 'saved'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30'
                  : isDark
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30'
            }`}
          >
            {saveState === 'saving' ? (
              <>
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </>
            ) : saveState === 'saved' ? (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Saved!
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                Save Settings
              </>
            )}
          </button>
        </div>

      </main>

      {/* Drive Sync Config Modal */}
      <ConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        config={config}
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
    </div>
  );
}
