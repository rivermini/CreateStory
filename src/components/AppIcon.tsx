import faviconUrl from '../assets/favicon.svg';

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
    return (
        <img
            src={faviconUrl}
            alt="Novel Crawler"
            className={`${sizeMap[size]} ${className}`}
        />
    );
}
