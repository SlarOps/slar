'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import timeline components to avoid hydration issues
const ScheduleTimeline = dynamic(() => import('./ScheduleTimeline').catch(() => ({ default: () => null })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64 border border-gray-200 dark:border-gray-700 rounded-lg">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading Timeline...</p>
      </div>
    </div>
  )
});

const TimelineControls = dynamic(() => import('./TimelineControls').catch(() => ({ default: () => null })), {
  ssr: false,
  loading: () => (
    <div className="animate-pulse bg-gray-200 dark:bg-gray-700 h-16 rounded-lg"></div>
  )
});

export default function SchedulePreview({ rotations, members: allMembers, selectedMembers }) {
  const [viewMode, setViewMode] = useState('week'); // 'day', 'week', '2-week', 'month'
  const [timeline, setTimeline] = useState(null);
  const [currentOnCall, setCurrentOnCall] = useState(null);
  
  const handleFocusNow = () => {
    if (timeline?.timeline) {
      // Center view on current time without changing zoom level
      timeline.timeline.moveTo(new Date(), { animation: false });
    }
  };

  return (
    <div className="space-y-4">
      {/* Timeline Controls */}
      <TimelineControls
        viewMode={viewMode}
        setViewMode={setViewMode}
        timeline={timeline}
        currentOnCall={currentOnCall}
        onFocusNow={handleFocusNow}
      />

      {/* Timeline Component */}
      <ScheduleTimeline
        rotations={rotations}
        members={allMembers}
        selectedMembers={selectedMembers}
        viewMode={viewMode}
        onTimelineReady={setTimeline}
        onCurrentOnCallChange={setCurrentOnCall}
        isVisible={true}
      />
    </div>
  );
}
