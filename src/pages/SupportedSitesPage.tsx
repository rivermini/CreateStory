import { useState, useEffect, type JSX } from 'react';
import { type ThemeMode } from '../components/ThemeToggle';
import { listSites, type SiteInfoResponse } from '../api/client';

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
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
    </svg>
  ),
  novelworm: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
    </svg>
  ),
};

const FALLBACK_ICON = (
  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
  </svg>
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

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
      <main className="w-full xl:w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            Supported Sites
          </h1>
          <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            Platforms currently supported for novel crawling
          </p>
        </div>

        {/* Sites Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {dynamicSites.map((site) => (
              <div
                key={site.config_name}
                className={`rounded-2xl p-6 space-y-4 border ${
                  isDark
                    ? 'bg-slate-900/60 border-slate-800/60'
                    : 'bg-white border-gray-200'
                }`}
              >
                {/* Site Header */}
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-xl ${
                    site.color === 'indigo'
                      ? isDark ? 'bg-indigo-600/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'
                      : isDark ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {site.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className={`text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                      {site.site_name}
                    </h3>
                    <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                      {site.base_url.replace('https://', '').replace('http://', '')}
                    </p>
                  </div>
                </div>

                {/* Description */}
                <p className={`text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                  {site.description}
                </p>

                {/* Features */}
                {site.features.length > 0 && (
                  <div className="space-y-2">
                    <h4 className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                      Supported Features
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {site.features.map((feature) => (
                        <span
                          key={feature}
                          className={`px-2.5 py-1 text-xs rounded-lg font-medium ${
                            isDark
                              ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/40'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* URL Example */}
                <div className={`p-3 rounded-xl ${
                  isDark ? 'bg-slate-800/60' : 'bg-gray-50'
                }`}>
                  <p className={`text-xs mb-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                    Example URL format
                  </p>
                  <code className={`text-xs font-mono break-all ${
                    isDark ? 'text-indigo-400' : 'text-indigo-600'
                  }`}>
                    {site.base_url}/...
                  </code>
                </div>
              </div>
            ))}

            {/* "More Coming Soon" card when there are fewer than 2 sites */}
            {dynamicSites.length < 2 && (
              <div className={`rounded-2xl p-6 space-y-4 border ${
                isDark
                  ? 'bg-slate-900/40 border-slate-800/40 border-dashed'
                  : 'bg-gray-50 border-gray-200 border-dashed'
              }`}>
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-xl ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-500'}`}>
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className={`text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                      More Coming Soon
                    </h3>
                    <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                      Additional platforms
                    </p>
                  </div>
                </div>
                <p className={`text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                  We are continuously adding support for more novel platforms.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Info Card */}
        <div className={`mt-8 rounded-2xl p-6 border ${
          isDark
            ? 'bg-slate-900/40 border-slate-800/40'
            : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-start gap-4">
            <div className={`p-2.5 rounded-xl ${
              isDark ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-100 text-blue-600'
            }`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className={`text-sm font-semibold mb-1 ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>
                Need another platform?
              </h3>
              <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                We are actively working on adding support for more novel platforms. If you need a specific site supported, please let me know.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
