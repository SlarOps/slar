'use client';

import { useState, useEffect } from 'react';
import ScheduleManagement from './ScheduleManagement';

export default function SchedulerTab({ groupId, members }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // Hide on screens smaller than 768px (tablet breakpoint)
    };

    // Check on mount
    checkMobile();

    // Add resize listener
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Show mobile message on small screens
  if (isMobile) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Desktop Required
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md mb-4">
          The on-call scheduler feature requires a larger screen for optimal viewing and interaction with the timeline.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Please access this page from a desktop or tablet device (minimum 768px width) to manage schedules.
        </p>
      </div>
    );
  }

  return (
    <ScheduleManagement groupId={groupId} members={members} />
  );
}
