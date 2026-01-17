'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to error reporting service
    console.error('Global application error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="font-sans antialiased bg-gray-50 dark:bg-gray-950">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="text-center space-y-6 max-w-md">
            {/* Error Icon */}
            <div className="flex justify-center">
              <div className="h-20 w-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <svg
                  className="h-10 w-10 text-red-600 dark:text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            {/* Error Message */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Application Error
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                A critical error occurred. Please refresh the page or try again later.
              </p>
              {error.digest && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 font-mono">
                  Error ID: {error.digest}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                onClick={reset}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors font-medium"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
