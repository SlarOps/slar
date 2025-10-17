'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { calculateMemberTimes } from '../../services/scheduleTransformer';

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
  const [showClassicView, setShowClassicView] = useState(false);
  const [timelineError, setTimelineError] = useState(false);
  
  const generatePreviewData = () => {
    if (!rotations.length || !selectedMembers.length) return [];
    
    const rotation = rotations[0]; // Use first rotation for preview
    const previewData = [];
    
    // Determine number of days to generate based on view mode
    let daysToGenerate;
    switch (viewMode) {
      case 'day':
        daysToGenerate = 1;
        break;
      case 'week':
        daysToGenerate = 7;
        break;
      case '2-week':
        daysToGenerate = 14;
        break;
      case 'month':
        daysToGenerate = 30;
        break;
      default:
        daysToGenerate = 14;
    }
    
    // Calculate enough shifts to cover the entire preview period
    const startDate = new Date(rotation.startDate);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + daysToGenerate);
    
    // Generate shifts until we cover the entire preview period
    const allShifts = [];
    let shiftIndex = 0;
    let lastShiftEnd = new Date(startDate);
    
    while (lastShiftEnd < endDate) {
      const memberIndex = shiftIndex % selectedMembers.length;
      const member = selectedMembers[memberIndex];
      const { memberStartTime, memberEndTime } = calculateMemberTimes(rotation, shiftIndex);
      
      allShifts.push({
        member,
        startTime: memberStartTime,
        endTime: memberEndTime
      });
      
      lastShiftEnd = memberEndTime;
      shiftIndex++;
    }
    
    console.log('Preview shifts generated:', allShifts.map(s => ({
      member: s.member.user_name,
      start: s.startTime.toISOString(),
      end: s.endTime.toISOString()
    })));
    
    // Generate preview data for each day
    for (let i = 0; i < daysToGenerate; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      date.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues
      
      // Find which member is on-call for this day
      let currentMember = null;
      for (const shift of allShifts) {
        if (date >= shift.startTime && date < shift.endTime) {
          currentMember = shift.member;
          break;
        }
      }
      
      previewData.push({
        date: date.toISOString().split('T')[0],
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNumber: date.getDate(),
        member: currentMember || selectedMembers[0] // Fallback to first member
      });
    }
    
    return previewData;
  };

  const previewData = generatePreviewData();
  
  const getDateRangeLabel = () => {
    if (!previewData.length) return '';
    
    const startDate = new Date(previewData[0].date);
    const endDate = new Date(previewData[previewData.length - 1].date);
    
    const startMonth = startDate.toLocaleDateString('en-US', { month: 'long' });
    const endMonth = endDate.toLocaleDateString('en-US', { month: 'long' });
    const startDay = startDate.getDate();
    const endDay = endDate.getDate();
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    
    if (viewMode === 'day') {
      return `${startMonth} ${startDay}, ${startYear}`;
    } else if (startMonth === endMonth && startYear === endYear) {
      return `${startMonth} ${startDay} - ${endDay}, ${startYear}`;
    } else if (startYear === endYear) {
      return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${startYear}`;
    } else {
      return `${startMonth} ${startDay}, ${startYear} - ${endMonth} ${endDay}, ${endYear}`;
    }
  };

  const getLayoutColumns = () => {
    switch (viewMode) {
      case 'day':
        return 1;
      case 'week':
        return 7;
      case '2-week':
        return 7;
      case 'month':
        return 7;
      default:
        return 7;
    }
  };

  const renderPreviewLayout = () => {
    const columns = getLayoutColumns();
    
    if (viewMode === 'day') {
      // Single day view
      const day = previewData[0];
      if (!day) return null;
      
      return (
        <>
          <div className="text-center text-xs text-gray-500 mb-2">
            {day.dayName} {day.dayNumber}
          </div>
          <div className="mt-2">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-4 h-4 bg-blue-500 rounded"></div>
              <span className="text-xs text-gray-600 dark:text-gray-400">Rotation 1</span>
            </div>
            <div className="h-16 rounded text-sm flex items-center justify-center text-white bg-blue-400">
              {day.member?.user_name || 'No member assigned'}
            </div>
          </div>
        </>
      );
    }
    
    if (viewMode === '2-week') {
      // 2-week view - show as 2 rows of 7 days
      return (
        <>
          {/* Week 1 */}
          <div className="grid grid-cols-7 gap-1 text-xs mb-2">
            {previewData.slice(0, 7).map((day, index) => (
              <div key={index} className="text-center">
                <div className="text-gray-500 mb-1">{day.dayName} {day.dayNumber}</div>
              </div>
            ))}
          </div>
          
          <div className="mt-2 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-4 h-4 bg-blue-500 rounded"></div>
              <span className="text-xs text-gray-600 dark:text-gray-400">Rotation 1 - Week 1</span>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {previewData.slice(0, 7).map((day, index) => (
                <div key={index} className="h-8 rounded text-xs flex items-center justify-center text-white bg-blue-400">
                  {day.member?.user_name.split(' ').map(n => n[0]).join('') || ''}
                </div>
              ))}
            </div>
          </div>

          {/* Week 2 */}
          <div className="grid grid-cols-7 gap-1 text-xs mb-2">
            {previewData.slice(7, 14).map((day, index) => (
              <div key={index} className="text-center">
                <div className="text-gray-500 mb-1">{day.dayName} {day.dayNumber}</div>
              </div>
            ))}
          </div>
          
          <div className="mt-2">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-4 h-4 bg-green-500 rounded"></div>
              <span className="text-xs text-gray-600 dark:text-gray-400">Rotation 1 - Week 2</span>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {previewData.slice(7, 14).map((day, index) => (
                <div key={index} className="h-8 rounded text-xs flex items-center justify-center text-white bg-green-400">
                  {day.member?.user_name.split(' ').map(n => n[0]).join('') || ''}
                </div>
              ))}
            </div>
          </div>
        </>
      );
    }
    
    if (viewMode === 'month') {
      // Month view - show weeks vertically
      const weeks = [];
      for (let i = 0; i < previewData.length; i += 7) {
        weeks.push(previewData.slice(i, i + 7));
      }
      
      return (
        <>
          <div className="grid grid-cols-7 gap-1 text-xs mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-gray-500 font-medium">{day}</div>
            ))}
          </div>
          
          <div className="mt-2">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-4 h-4 bg-blue-500 rounded"></div>
              <span className="text-xs text-gray-600 dark:text-gray-400">Rotation 1</span>
            </div>
            <div className="space-y-1">
              {weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="grid grid-cols-7 gap-1">
                  {week.map((day, dayIndex) => (
                    <div key={dayIndex} className="h-6 rounded text-xs flex items-center justify-center text-white bg-blue-400">
                      {day?.member?.user_name.split(' ').map(n => n[0]).join('') || ''}
                    </div>
                  ))}
                  {/* Fill empty cells for incomplete weeks */}
                  {Array.from({ length: 7 - week.length }, (_, i) => (
                    <div key={`empty-${i}`} className="h-6"></div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      );
    }
    
    // Default week view
    return (
      <>
        <div className="grid grid-cols-7 gap-1 text-xs">
          {previewData.slice(0, 7).map((day, index) => (
            <div key={index} className="text-center">
              <div className="text-gray-500 mb-1">{day.dayName} {day.dayNumber}</div>
            </div>
          ))}
        </div>
        
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-4 h-4 bg-blue-500 rounded"></div>
            <span className="text-xs text-gray-600 dark:text-gray-400">Rotation 1</span>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {previewData.slice(0, 7).map((day, index) => (
              <div key={index} className="h-8 rounded text-xs flex items-center justify-center text-white bg-blue-400">
                {day.member?.user_name.split(' ').map(n => n[0]).join('') || ''}
              </div>
            ))}
          </div>
        </div>
      </>
    );
  };
  
  const handleFocusNow = () => {
    if (timeline?.timeline) {
      // Center view on current time without changing zoom level
      timeline.timeline.moveTo(new Date(), { animation: false });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        
        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">View:</span>
          <button
            onClick={() => setShowClassicView(!showClassicView)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              showClassicView
                ? 'bg-gray-500 text-white'
                : 'bg-blue-600 text-white'
            }`}
          >
            {showClassicView ? '📋 Classic' : '📊 Timeline'}
          </button>
        </div>
      </div>

      {/* Timeline View */}
      {!showClassicView ? (
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
            isVisible={!showClassicView}
          />
        </div>
      ) : (
        /* Classic Grid View */
        <div className="space-y-6">
          {/* Schedule Rotations */}
          <div>
            <h5 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Schedule Rotations</h5>
            <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-700">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-500">{getDateRangeLabel()}</span>
                <div className="flex gap-1">
                  {[
                    { value: 'day', label: 'Day' },
                    { value: 'week', label: 'Week' },
                    { value: '2-week', label: '2 Weeks' },
                    { value: 'month', label: 'Month' }
                  ].map((mode) => (
                    <button
                      key={mode.value}
                      onClick={() => setViewMode(mode.value)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        viewMode === mode.value
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
              
              {renderPreviewLayout()}
            </div>
          </div>

          {/* Final Schedule */}
          <div>
            <h5 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Final Schedule</h5>
            <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-700">
              {renderPreviewLayout()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
