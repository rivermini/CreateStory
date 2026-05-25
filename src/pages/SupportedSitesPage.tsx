import { type ThemeMode } from '../components/ThemeToggle';

interface SupportedSitesPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

const SITES = [
  {
    name: 'Wattpad',
    domain: 'wattpad.com',
    url: 'https://www.wattpad.com',
    description: 'A popular platform for original stories, fanfiction, and creative writing across all genres.',
    features: ['Chapter-based crawling', 'Cover image extraction', 'Author information', 'Chapter metadata', 'Comments extraction'],
    color: 'indigo',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    ),
  },
  {
    name: 'More Coming Soon',
    domain: 'Additional platforms',
    url: null,
    description: 'We are continuously adding support for more novel platforms.',
    features: [],
    color: 'slate',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    ),
  },
];

export function SupportedSitesPage({ themeMode }: SupportedSitesPageProps) {
  const isDark = themeMode === 'dark';

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SITES.map((site) => (
            <div
              key={site.domain}
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
                    {site.name}
                  </h3>
                  <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                    {site.domain}
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
              {site.url && (
                <div className={`p-3 rounded-xl ${
                  isDark ? 'bg-slate-800/60' : 'bg-gray-50'
                }`}>
                  <p className={`text-xs mb-1 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                    Example URL format
                  </p>
                  <code className={`text-xs font-mono break-all ${
                    isDark ? 'text-indigo-400' : 'text-indigo-600'
                  }`}>
                    {site.url}/1284690197-...-chapter-one
                  </code>
                </div>
              )}
            </div>
          ))}
        </div>

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
