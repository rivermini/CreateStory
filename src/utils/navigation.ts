export function navActive(locationPath: string, expect: string): boolean {
    if (expect === '/results/all') {
        return locationPath.startsWith('/results');
    }
    if (expect === '/') return locationPath === '/';
    if (expect === '/bedread' && locationPath.startsWith('/bedread/')) return false;
    if (expect === '/drive-sync' && locationPath.startsWith('/drive-sync/')) return false;
    if (expect === '/auto-audio' && locationPath.startsWith('/auto-audio/')) return false;
    return locationPath === expect || locationPath.startsWith(expect + '/') || locationPath.startsWith(expect + '?');
}

interface NavItem {
    to: string;
    label: string;
    iconKey: string;
}

interface NavSection {
    label: string;
    items: NavItem[];
}

const NAV_ITEMS_CRAWL: NavItem[] = [
    { to: '/', label: 'New Crawl', iconKey: '/' },
    { to: '/results/all', label: 'Crawl History', iconKey: '/results/all' },
];

const NAV_ITEMS_AUDIO: NavItem[] = [
    { to: '/bedread', label: 'BedReads', iconKey: '/bedread' },
    { to: '/bedread/jobs', label: 'Audio Jobs', iconKey: '/bedread/jobs' },
];

const NAV_ITEMS_BEDREADS: NavItem[] = [
    { to: '/drive-sync', label: 'Drive Sync', iconKey: '/drive-sync' },
    { to: '/drive-sync/cover-update', label: 'Cover Update', iconKey: '/drive-sync/cover-update' },
    { to: '/drive-sync/banner-update', label: 'Banner Update', iconKey: '/drive-sync/banner-update' },
    { to: '/drive-sync/intro-update', label: 'Intro Update', iconKey: '/drive-sync/intro-update' },
    { to: '/drive-sync/metadata-update', label: 'Metadata Update', iconKey: '/drive-sync/metadata-update' },
    { to: '/drive-sync/content-update', label: 'Content Update', iconKey: '/drive-sync/content-update' },
    { to: '/drive-sync/title-update', label: 'Title Update', iconKey: '/drive-sync/title-update' },
    { to: '/drive-sync/history', label: 'Sync History', iconKey: '/drive-sync/history' },
];

const NAV_ITEMS_AUTO_AUDIO: NavItem[] = [
    { to: '/auto-audio', label: 'Auto Audio', iconKey: '/auto-audio' },
    { to: '/auto-audio/history', label: 'Auto History', iconKey: '/auto-audio/history' },
];

const NAV_ITEMS_SYSTEM: NavItem[] = [
    { to: '/supported-sites', label: 'Supported Sites', iconKey: '/supported-sites' },
];

export const NAV_SECTIONS: NavSection[] = [
    { label: 'Novel Crawler', items: NAV_ITEMS_CRAWL },
    { label: 'Audio', items: NAV_ITEMS_AUDIO },
    { label: 'DriveSync', items: NAV_ITEMS_BEDREADS },
    { label: 'Auto Audio', items: NAV_ITEMS_AUTO_AUDIO },
    { label: 'System', items: NAV_ITEMS_SYSTEM },
];
