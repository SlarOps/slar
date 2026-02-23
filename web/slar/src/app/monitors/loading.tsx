export default function MonitorsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-32" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-48 mt-2" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-32" />
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-32" />
        </div>
      </div>

      {/* Deployments Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-32" />
              <div className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded-full" />
            </div>
            <div className="space-y-2">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
            </div>
          </div>
        ))}
      </div>

      {/* Monitors Section Skeleton */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-40 mb-4" />

        {/* Monitor Cards Skeleton */}
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="border border-gray-100 dark:border-gray-700 rounded-lg p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 bg-gray-200 dark:bg-gray-700 rounded-full" />
                  <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-48" />
                </div>
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16" />
              </div>

              {/* Uptime Bar Skeleton */}
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded mb-3" />

              {/* Chart Skeleton */}
              <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />

              <div className="flex items-center justify-between mt-3">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
