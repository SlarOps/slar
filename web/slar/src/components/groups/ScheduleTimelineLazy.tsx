'use client';

import dynamic from 'next/dynamic';
import { forwardRef } from 'react';

// Loading placeholder for timeline
function TimelineSkeleton() {
  return (
    <div className="schedule-timeline">
      <div className="timeline-loading border border-gray-200 dark:border-gray-700 rounded-lg">
        <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2" />
            <p className="text-sm">Loading Timeline...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Dynamic import with SSR disabled for vis-timeline
const ScheduleTimeline = dynamic(
  () => import('./ScheduleTimeline'),
  {
    loading: () => <TimelineSkeleton />,
    ssr: false, // vis-timeline requires browser APIs
  }
);

export default ScheduleTimeline;
