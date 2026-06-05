import { useState, useEffect, type JSX } from 'react';
import type { ThemeMode } from '../types/theme';
import { listSites, type SiteInfoResponse } from '../api/client';
import { Icon, appIcons } from '../components/Icon';

interface SupportedSitesPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

const SITE_FEATURES: Record<string, string[]> = {
  wattpad: ['Chapter-based crawling', 'Cover image extraction', 'Author information', 'Chapter metadata'],
  novelworm: ['Chapter-based crawling', 'Cover image extraction', 'Author information', 'Chapter metadata'],
};

const SITE_DESCRIPTIONS: Record<string, string> = {
  wattpad: 'A popular platform for original stories, fanfiction, and creative writing across all genres.',
  novelworm: 'A novel reading platform offering a wide range of stories across multiple genres.',
};

const SITE_ICONS: Record<string, JSX.Element> = {
  wattpad: (
    <Icon icon={appIcons.trends} className="w-6 h-6" />
  ),
  novelworm: (
    <Icon icon={appIcons.book} className="w-6 h-6" />
  ),
};

const FALLBACK_ICON = (
  <Icon icon={appIcons.globe} className="w-6 h-6" />
);

export function SupportedSitesPage({ themeMode }: SupportedSitesPageProps) {
  const isDark = themeMode === 'dark';
  const [sites, setSites] = useState<SiteInfoResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSites()
      .then(setSites)
      .catch(() => {/* ignore */})
      .finally(() => setLoading(false));
  }, []);

  const dynamicSites = sites.map(site => ({
    ...site,
    base_url: site.base_url,
    description: SITE_DESCRIPTIONS[site.config_name] || `A novel platform at ${site.base_url}.`,
    features: SITE_FEATURES[site.config_name] || ['Chapter-based crawling'],
    color: 'indigo',
    icon: SITE_ICONS[site.config_name] || FALLBACK_ICON,
  }));

  const pageBg = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #e8e4f8 0%, #d8e8f8 30%, #f0e8f8 60%, #e0f0f8 100%)';

  const c = (key: string) => {
    const map: Record<string, [string, string]> = {
      text:      ['text-white/90',      'text-[rgba(0,0,0,0.85)]'],
      textMuted: ['text-white/40',       'text-[rgba(0,0,0,0.4)]'],
      textSub:   ['text-white/25',       'text-[rgba(0,0,0,0.25)]'],
      textBody:  ['text-white/70',       'text-[rgba(0,0,0,0.65)]'],
      textBodyStrong: ['text-white/90', 'text-[rgba(0,0,0,0.85)]'],
      glassBg:   ['bg-white/[0.03]',     'bg-white/70'],
      glassBorder: ['border-white/[0.06]','border-black/[0.06]'],
      glassHover:['hover:bg-white/[0.05]','hover:bg-white/80'],
      rowBg:     ['bg-white/[0.04]',     'bg-[rgba(0,0,0,0.04)]'],
      rowBorder:  ['border-white/[0.05]', 'border-black/[0.05]'],
      divider:   ['border-white/[0.06]', 'border-black/[0.06]'],
      glassNav:  ['bg-[#0f0f1e]/90',    'bg-white/80'],
    };
    return map[key]?.[isDark ? 0 : 1] ?? '';
  };

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBg }}>
      <div className="lg-orb lg-orb-1" />
      <div className="lg-orb lg-orb-2" />
      <div className="lg-orb lg-orb-3" />
      <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
        <main className="w-full xl:max-w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* Page Header */}
          <div className="lg-glass-deep px-6 py-5 mb-8">
            <h1 className={`text-2xl sm:text-3xl font-bold ${c('text')}`}>Supported Sites</h1>
            <p className={`mt-1 text-sm sm:text-base ${c('textMuted')}`}>Platforms currently supported for novel crawling</p>
          </div>

          {/* Sites Grid */}
          {loading ? (
            <div className="lg-glass p-8 flex items-center justify-center">
              <Icon icon={appIcons.refresh} className="w-8 h-8 animate-spin text-indigo-400" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {dynamicSites.map((site) => (
                <div key={site.config_name} className="lg-glass-card p-6 space-y-4">
                  {/* Site Header */}
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-xl ${site.color === 'indigo'
                      ? isDark ? 'bg-indigo-600/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'
                      : isDark ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {site.icon}
                    </div>
                    <div className="flex-1">
                      <h3 className={`text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>{site.site_name}</h3>
                      <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{site.base_url.replace('https://', '').replace('http://', '')}</p>
                    </div>
                  </div>
                  {/* Description */}
                  <p className={`text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>{site.description}</p>
                  {/* Features */}
                  {site.features.length > 0 && (
                    <div className="space-y-2">
                      <h4 className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Supported Features</h4>
                      <div className="flex flex-wrap gap-2">
                        {site.features.map((feature) => (
                          <span key={feature} className={`px-2.5 py-1 text-xs rounded-lg font-medium ${isDark
                            ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/40'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}>{feature}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* URL Example */}
                  <div className={`p-3 rounded-xl ${isDark ? 'bg-slate-800/60' : 'bg-gray-50'}`}>
                    <p className={`text-xs mb-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Example URL format</p>
                    <code className={`text-xs font-mono break-all ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{site.base_url}/...</code>
                  </div>
                </div>
              ))}

              {/* More Coming Soon */}
              {dynamicSites.length < 2 && (
                <div className={`rounded-2xl p-6 space-y-4 border ${isDark
                  ? 'bg-slate-900/40 border-slate-800/40 border-dashed'
                  : 'bg-gray-50 border-gray-200 border-dashed'
                }`}>
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-xl ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-500'}`}>
                      <Icon icon={appIcons.add} className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className={`text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>More Coming Soon</h3>
                      <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Additional platforms</p>
                    </div>
                  </div>
                  <p className={`text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>We are continuously adding support for more novel platforms.</p>
                </div>
              )}
            </div>
          )}

          {/* Info Card */}
          <div className={`mt-8 rounded-2xl p-6 border ${isDark
            ? 'bg-slate-900/40 border-slate-800/40'
            : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-start gap-4">
              <div className={`p-2.5 rounded-xl ${isDark ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
                <Icon icon={appIcons.info} className="w-5 h-5" />
              </div>
              <div>
                <h3 className={`text-sm font-semibold mb-1 ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>Need another platform?</h3>
                <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>We are actively working on adding support for more novel platforms. If you need a specific site supported, please let me know.</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
