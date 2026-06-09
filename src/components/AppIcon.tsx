import faviconLightUrl from '../assets/favicon.svg';
import faviconDarkUrl from '../assets/favicon-dark.svg';

interface AppIconProps {
    size?: 'sm' | 'md' | 'lg' | 'xl';
    className?: string;
}

const sizeMap = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12',
};

export function AppIcon({ size = 'md', className = '' }: AppIconProps) {
    const isDark = document.documentElement.dataset.theme === 'dark';

    return (
        <img
            src={isDark ? faviconDarkUrl : faviconLightUrl}
            alt="Novel Crawler"
            className={`${sizeMap[size]} ${className}`}
        />
    );
}
