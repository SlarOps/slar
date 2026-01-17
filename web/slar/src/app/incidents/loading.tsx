export default function IncidentsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-32" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-48 mt-2" />
        </div>
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-36" />
      </div>

      {/* Filters Skeleton */}
      <div className="flex flex-wrap gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-32" />
        ))}
      </div>

      {/* Incidents Table Skeleton */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-6 gap-4 p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>

        {/* Table Rows */}
        {[...Array(10)].map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-6 gap-4 p-4 border-b border-gray-100 dark:border-gray-700 last:border-b-0"
          >
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-gray-200 dark:bg-gray-700 rounded-full" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
            </div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-20" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
          </div>
        ))}
      </div>

      {/* Pagination Skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
        <div className="flex gap-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-8 w-8 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
