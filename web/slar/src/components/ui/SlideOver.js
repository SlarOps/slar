'use client';

import { useEffect, useCallback } from 'react';

/**
 * SlideOver - A slide-in panel from the right side
 * Better UX for detailed content that needs more vertical space
 * 
 * @param {boolean} isOpen - Whether the slide-over is open
 * @param {function} onClose - Callback when slide-over should close
 * @param {string} title - Optional title for the slide-over header
 * @param {string} size - Width size: 'md' (448px), 'lg' (512px), 'xl' (640px), '2xl' (768px), 'full' (100%)
 * @param {React.ReactNode} children - Content to display
 */
export default function SlideOver({
    isOpen,
    onClose,
    title,
    size = 'xl',
    children
}) {
    // Handle escape key
    const handleEscape = useCallback((e) => {
        if (e.key === 'Escape') {
            onClose();
        }
    }, [onClose]);

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, handleEscape]);

    if (!isOpen) return null;

    const sizeClasses = {
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-xl',
        '2xl': 'max-w-2xl',
        '3xl': 'max-w-3xl',
        '4xl': 'max-w-4xl',
        full: 'max-w-full'
    };

    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300"
                onClick={onClose}
            />

            {/* Slide-over panel */}
            <div className="fixed inset-y-0 right-0 flex max-w-full">
                <div
                    className={`w-screen ${sizeClasses[size]} transform transition-transform duration-300 ease-out`}
                    style={{
                        animation: 'slideIn 0.3s ease-out'
                    }}
                >
                    <div className="flex h-full flex-col bg-white dark:bg-gray-900 shadow-2xl">
                        {/* Header */}
                        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-4 sm:px-6 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                            {title && (
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                    {title}
                                </h2>
                            )}
                            <button
                                type="button"
                                onClick={onClose}
                                className="ml-auto rounded-md p-2 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <span className="sr-only">Close panel</span>
                                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Content - Scrollable */}
                        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                            {children}
                        </div>
                    </div>
                </div>
            </div>

            <style jsx>{`
                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                    }
                    to {
                        transform: translateX(0);
                    }
                }
            `}</style>
        </div>
    );
}

/**
 * SlideOverSection - A section within the slide-over for organizing content
 */
export function SlideOverSection({ title, children, className = '' }) {
    return (
        <div className={`${className}`}>
            {title && (
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                    {title}
                </h3>
            )}
            {children}
        </div>
    );
}

/**
 * SlideOverFooter - Sticky footer for actions
 */
export function SlideOverFooter({ children }) {
    return (
        <div className="sticky bottom-0 flex items-center justify-end gap-3 px-4 py-4 sm:px-6 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
            {children}
        </div>
    );
}
