export default function AIAgentLoading() {
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Main content area */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <svg
              className="animate-spin h-12 w-12 text-blue-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
              Loading AI Agent...
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Preparing your assistant
            </p>
          </div>
        </div>
      </div>

      {/* Input area skeleton */}
      <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
