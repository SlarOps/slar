'use client';

import dynamic from 'next/dynamic';

// Loading placeholder for chart
function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center"
      style={{ height: `${height}px` }}
    >
      <div className="text-center">
        <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <span className="text-sm text-gray-400">Loading chart...</span>
      </div>
    </div>
  );
}

// Dynamic import with SSR disabled for Chart.js
const ResponseTimeChart = dynamic(
  () => import('./ResponseTimeChart'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false, // Chart.js requires browser APIs
  }
);

export default ResponseTimeChart;
