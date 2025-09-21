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
          
          {/* Next Rotation Info */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>Next:</span>
            <span className="font-medium">{nextRotation.nextMember}</span>
            <span>in {nextRotation.timeRemaining}</span>
          </div>
        </div>

        {/* View Mode Selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">View:</span>
          {[
            { value: 'day', label: 'Day', icon: '📅' },
            { value: 'week', label: 'Week', icon: '📆' },
            { value: '2-week', label: '2 Weeks', icon: '🗓️' },
            { value: 'month', label: 'Month', icon: '📋' }
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

      {/* Timeline Navigation Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Quick Navigation */}
          <button
            onClick={onFocusNow}
            className="px-3 py-1.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors flex items-center gap-1.5"
          >
            <span>📍</span>
            Focus Now
          </button>

          <button
            onClick={() => timeline?.timeline?.fit?.()}
            className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            🔍 Fit All
          </button>
        </div>

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

      {/* Timeline Statistics */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
            {timeline ? '24/7' : '--'}
          </div>
          <div className="text-xs text-blue-500 dark:text-blue-300">Coverage</div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
          <div className="text-lg font-bold text-green-600 dark:text-green-400">
            {timeline ? '7d' : '--'}
          </div>
          <div className="text-xs text-green-500 dark:text-green-300">Avg Shift</div>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
          <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
            {timeline ? '4' : '--'}
          </div>
          <div className="text-xs text-purple-500 dark:text-purple-300">Team Size</div>
        </div>
      </div>
    </div>
  );
};

export default TimelineControls;
