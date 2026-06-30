import { useState, useEffect } from 'react';
import type { ThemeMode } from '../../types/theme';
import { listSites, type SiteInfoResponse } from '../../api';

interface SupportedSitesPageProps {
  readonly themeMode: ThemeMode;
}

const SITE_FEATURES: Record<string, string[]> = {
  wattpad: ['Chapter-based crawling', 'Cover image extraction', 'Author information', 'Chapter metadata'],
  novelworm: ['Chapter-based crawling', 'Cover image extraction', 'Author information', 'Chapter metadata'],
  novellunar: ['Chapter-based crawling', 'Cover image extraction', 'Author information', 'Genre tags', 'Fast (no browser needed)'],
};

const SITE_DESCRIPTIONS: Record<string, string> = {
  wattpad: 'A popular platform for original stories, fanfiction, and creative writing across genres.',
  novelworm: 'A reading platform with serialized fiction across multiple categories and themes.',
  novellunar: 'A free English web-novel and light-novel reader with translated and original serialized fiction.',
};

export function SupportedSitesPage({ themeMode }: SupportedSitesPageProps) {
  const isDark = themeMode === 'dark';
  const [sites, setSites] = useState<SiteInfoResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSites()
      .then(setSites)
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, []);

  const dynamicSites = sites.map(site => ({
    ...site,
    description: SITE_DESCRIPTIONS[site.config_name] || `A supported novel platform available at ${site.base_url}.`,
    features: SITE_FEATURES[site.config_name] || ['Chapter-based crawling'],
  }));

  const pageBg = 'var(--cs-page)';
  const pageText = 'var(--cs-text)';
  const secondaryText = 'var(--cs-text-soft)';
  const tertiaryText = 'var(--cs-text-faint)';
  const panelBackground = 'var(--cs-surface-elevated)';
  const panelBorder = 'var(--cs-border)';
  const rowHover = 'var(--cs-surface-muted)';
  const mutedSurface = 'var(--cs-surface-muted)';
  const statusBackground = 'var(--cs-surface-muted)';

  return (
    <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBg }}>
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header
          className="rounded-2xl border px-5 py-5 sm:px-6"
          style={{ background: panelBackground, borderColor: panelBorder }}
        >
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
              Library
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
              Supported sites
            </h1>
            <p className="max-w-2xl text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
              A simple list of platforms currently supported for crawling, along with their base URL and available extraction capabilities.
            </p>
          </div>
        </header>

        <main className="mt-5 flex-1">
          <section
            className="overflow-hidden rounded-2xl border"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-3 text-xs uppercase tracking-[0.14em] sm:px-6"
              style={{ borderColor: panelBorder, color: tertiaryText }}
            >
              <span>Available sources</span>
              {!loading && <span>{dynamicSites.length} total</span>}
            </div>

            {loading ? (
              <div className="px-5 py-12 text-sm sm:px-6" style={{ color: secondaryText }}>
                Loading supported sites…
              </div>
            ) : dynamicSites.length === 0 ? (
              <div className="px-5 py-12 text-sm sm:px-6" style={{ color: secondaryText }}>
                No supported sites are available yet.
              </div>
            ) : (
              <div>
                {dynamicSites.map((site, index) => (
                  <article
                    key={site.config_name}
                    className="px-5 py-5 transition-colors sm:px-6"
                    style={{
                      borderTop: index === 0 ? 'none' : `1px solid ${panelBorder}`,
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = rowHover;
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-semibold sm:text-[17px]" style={{ color: pageText }}>
                            {site.site_name}
                          </h2>
                          <span
                            className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                            style={{ background: statusBackground, color: secondaryText }}
                          >
                            {site.config_name}
                          </span>
                        </div>

                        <p className="text-sm leading-6" style={{ color: secondaryText }}>
                          {site.description}
                        </p>

                        <div className="space-y-1.5 text-sm" style={{ color: secondaryText }}>
                          <div>
                            <span style={{ color: tertiaryText }}>Base URL</span>
                            <div className="mt-1 break-all font-mono text-[13px]" style={{ color: pageText }}>
                              {site.base_url}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="w-full max-w-xl lg:w-[42%]">
                        <div
                          className="rounded-xl border px-4 py-3"
                          style={{ background: mutedSurface, borderColor: panelBorder }}
                        >
                          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: tertiaryText }}>
                            Supported features
                          </div>
                          <ul className="space-y-1.5">
                            {site.features.map((feature) => (
                              <li key={feature} className="flex items-start gap-2 text-sm leading-6" style={{ color: secondaryText }}>
                                <span style={{ color: tertiaryText }}>•</span>
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section
            className="mt-5 rounded-2xl border px-5 py-4 text-sm leading-6 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder, color: secondaryText }}
          >
            <p>
              Need support for another platform? Add the crawler config on the backend first, then expose it through the supported sites API to list it here.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
