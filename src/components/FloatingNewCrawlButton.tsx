import { Link } from 'react-router-dom';

export default function FloatingNewCrawlButton() {
    return (
        <Link
            to="/"
            title="New Crawl"
            className="fixed right-4 bottom-4 sm:right-5 sm:bottom-5 z-50 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/30 flex items-center justify-center transition-all duration-200 active:scale-95 text-decoration-none"
        >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
        </Link>
    );
}
