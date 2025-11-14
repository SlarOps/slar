'use client';

import React, { useState, useEffect } from 'react';

const TimelineControls = ({ viewMode, setViewMode, timeline, currentOnCall, onFocusNow }) => {
  const [isClient, setIsClient] = useState(false);

  // Set client flag after hydration
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  const handleViewModeChange = (newMode) => {
    setViewMode(newMode);
    
    // Auto-focus timeline when changing view mode
    if (timeline && onFocusNow) {
      setTimeout(() => {
        onFocusNow();
      }, 100);
    }
  };

  const getNextRotationInfo = () => {
    // This would calculate next rotation time in real implementation
    // For now, showing placeholder
    return {
      nextMember: 'John Doe',
      timeRemaining: '2d 4h'
    };
  };

  const nextRotation = getNextRotationInfo();

  // Show loading state during hydration
  if (!isClient) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="animate-pulse bg-gray-200 dark:bg-gray-700 h-8 w-32 rounded"></div>
          <div className="flex gap-2">
            {[1,2,3,4].map(i => (
              <div key={i} className="animate-pulse bg-gray-200 dark:bg-gray-700 h-8 w-16 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main Controls Row */}
      <div className="flex items-center justify-between">
        {/* Current Status */}
        <div className="flex items-center gap-4">
          {currentOnCall && (
            <div className="flex items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">ON CALL:</span>
                <span className="font-bold text-gray-900 dark:text-white">
                  {currentOnCall.user_name}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* View Mode Selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">View:</span>
          {[
            { value: 'day', label: 'Day', icon: '📅' },
            { value: 'week', label: 'Week', icon: '📆' },
            { value: '2-week', label: '2 Weeks', icon: '🗓️' },
          ].map((mode) => (
            <button
              key={mode.value}
              onClick={() => handleViewModeChange(mode.value)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-1.5 ${
                viewMode === mode.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <span className="text-xs">{mode.icon}</span>
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        {/* Timeline Info */}
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <span>Current Time</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <span>On-Call Shifts</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
            <span>Active Now</span>
          </div>
        </div>
      </div>

      
    </div>
  );
};

export default TimelineControls;
