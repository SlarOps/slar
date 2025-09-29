'use client';

import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import './timeline.css';

// Color scheme for different members
const MEMBER_COLORS = [
  '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b',
  '#ef4444', '#6366f1', '#14b8a6', '#f97316'
];

const ScheduleTimeline = forwardRef(({
  rotations,
  members,
  selectedMembers,
  viewMode = 'week',
  onTimelineReady,
  onCurrentOnCallChange,
  isVisible = true // New prop to control visibility
}, ref) => {
  const timelineRef = useRef(null);
  const [timeline, setTimeline] = useState(null);
  const [currentOnCall, setCurrentOnCall] = useState(null);
  const [isClient, setIsClient] = useState(false);
  const [containerReady, setContainerReady] = useState(false);
  const resizeObserverRef = useRef(null);
  const timelineInstanceRef = useRef(null); // Track timeline instance
  const componentIdRef = useRef(`timeline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const [visLibs, setVisLibs] = useState({ Timeline: null, DataSet: null });

  // Set client flag after hydration
  useEffect(() => {
    setIsClient(true);
  }, []);


  // Load vis-timeline and vis-data only on client to avoid SSR issues
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [visTimeline, visData] = await Promise.all([
          import('vis-timeline/standalone'),
          import('vis-data')
        ]);
        if (!cancelled) {
          setVisLibs({ Timeline: visTimeline.Timeline, DataSet: visData.DataSet });
        }
      } catch (e) {
        console.error('Failed to load vis libs:', e);
      }
    };
    if (typeof window !== 'undefined') load();
    return () => { cancelled = true; };
  }, []);

  // Force timeline redraw method (without changing view window)
  const forceTimelineRedraw = () => {
    if (timeline && timelineRef.current) {
      try {
        // Force a redraw without changing the view window
        timeline.redraw();
        console.log('Timeline redrawn without zoom change');
      } catch (error) {
        console.warn('Failed to redraw timeline:', error);
      }
    }
  };

  // Method to fit timeline to view window (only when needed)
  const fitTimelineToWindow = () => {
    if (timeline && timelineRef.current) {
      try {
        timeline.fit();
        timeline.redraw();
        console.log('Timeline fitted to view window');
      } catch (error) {
        console.warn('Failed to fit timeline:', error);
      }
    }
  };

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    // Redraw timeline without changing view window (recommended for data updates)
    forceRedraw: forceTimelineRedraw,

    // Fit timeline to show all data (use sparingly, only when user explicitly requests)
    fitToWindow: fitTimelineToWindow,

    // Get raw timeline instance for advanced operations
    getTimeline: () => timeline,

    // Refresh timeline data without changing view window
    refresh: () => {
      if (timeline) {
        const { items, groups } = generateTimelineData();
        timeline.setItems(items);
        timeline.setGroups(groups);
        // Only redraw, don't change view window when refreshing data
        forceTimelineRedraw();
      }
    }
  }), [timeline]);

  // Setup ResizeObserver to detect when container becomes visible
  useEffect(() => {
    if (!isClient || !timelineRef.current) return;

    const observerCallback = (entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerReady(true);
          // Small delay to ensure DOM is fully rendered
          setTimeout(() => {
            forceTimelineRedraw();
          }, 100);
        }
      }
    };

    resizeObserverRef.current = new ResizeObserver(observerCallback);
    resizeObserverRef.current.observe(timelineRef.current);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [isClient, timeline]);

  // Handle visibility changes (for modal open/close)
  useEffect(() => {
    if (isVisible && timeline && containerReady) {
      console.log(`[${componentIdRef.current}] Handling visibility change - visible: ${isVisible}`);
      // Delay to ensure modal animation completes
      const timer = setTimeout(() => {
        forceTimelineRedraw();
      }, 300);

      return () => clearTimeout(timer);
    } else if (!isVisible && timeline) {
      console.log(`[${componentIdRef.current}] Timeline hidden`);
    }
  }, [isVisible, timeline, containerReady]);

  // Convert schedule data to vis-timeline format
  const generateTimelineData = () => {
    const items = new visLibs.DataSet();
    const groups = new visLibs.DataSet();

    console.log(`[${componentIdRef.current}] generateTimelineData - rotations:`, rotations, 'selectedMembers:', selectedMembers);

    if (!rotations.length || !selectedMembers.length) {
      console.log(`[${componentIdRef.current}] No rotations or selected members`);
      return { items, groups };
    }

    // Create groups for each member
    selectedMembers.forEach((member, index) => {
      groups.add({
        id: member.user_id,
        content: `
          <div class="flex items-center gap-2 px-2 py-1">
            <div class="w-3 h-3 rounded-full" style="background-color: ${MEMBER_COLORS[index % MEMBER_COLORS.length]}"></div>
            <span class="font-medium text-sm">${member.user_name}</span>
          </div>
        `,
        className: 'member-group'
      });
    });

    // Check if data is schedule format (has start_time/end_time) or rotation format (has startDate/shiftLength)
    const isScheduleFormat = rotations[0] && rotations[0].start_time;

    if (isScheduleFormat) {
      // Handle schedule data format
      console.log(`[${componentIdRef.current}] Processing schedule format data`);
      const now = typeof window !== 'undefined' ? new Date() : new Date('2024-01-01');

      rotations.forEach((schedule, scheduleIndex) => {
        const scheduleStart = new Date(schedule.start_time);
        const scheduleEnd = new Date(schedule.end_time);

        // Find member for this schedule
        const member = selectedMembers.find(m => m.user_id === schedule.user_id) ||
                      selectedMembers.find(m => m.user_id === schedule.effective_user_id);

        if (!member) {
          console.warn(`[${componentIdRef.current}] Member not found for schedule:`, schedule);
          return;
        }

        const memberIndex = selectedMembers.findIndex(m => m.user_id === member.user_id);
        const isCurrentShift = typeof window !== 'undefined' && now >= scheduleStart && now < scheduleEnd;

        console.log(`[${componentIdRef.current}] Adding schedule item:`, {
          member: member.user_name,
          start: scheduleStart,
          end: scheduleEnd,
          isCurrent: isCurrentShift
        });

        items.add({
          id: `schedule-${schedule.id || scheduleIndex}`,
          group: member.user_id,
          start: scheduleStart,
          end: scheduleEnd,
          content: `
            <div class="timeline-shift-content">
              <div class="font-medium text-sm">${member.user_name.split(' ')[0]}</div>
            </div>
          `,
          className: `shift-item ${isCurrentShift ? 'current-shift' : ''}`,
          style: `background-color: ${isCurrentShift ? '#f59e0b' : MEMBER_COLORS[memberIndex % MEMBER_COLORS.length]}; color: white; border-radius: 4px; ${isCurrentShift ? 'border: 2px solid #fbbf24; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);' : ''}`
        });

        // Track current on-call member
        if (isCurrentShift) {
          setCurrentOnCall(member);
          if (onCurrentOnCallChange) {
            onCurrentOnCallChange(member);
          }
        }
      });
    } else {
      // Handle rotation format (original logic)
      console.log(`[${componentIdRef.current}] Processing rotation format data`);
      const rotation = rotations[0];
      if (!rotation.startDate || !rotation.shiftLength) {
        console.warn(`[${componentIdRef.current}] Invalid rotation format:`, rotation);
        return { items, groups };
      }

      const startDate = new Date(rotation.startDate);
      const shiftDurationDays = getShiftDurationInDays(rotation.shiftLength);

      // Generate 60 days of schedule data
      const totalDays = 365;
      const totalShifts = Math.ceil(totalDays / shiftDurationDays);

      for (let shiftIndex = 0; shiftIndex < totalShifts; shiftIndex++) {
        const memberIndex = shiftIndex % selectedMembers.length;
        const member = selectedMembers[memberIndex];

        const shiftStart = new Date(startDate);
        shiftStart.setDate(startDate.getDate() + (shiftIndex * shiftDurationDays));

        const shiftEnd = new Date(shiftStart);
        shiftEnd.setDate(shiftStart.getDate() + shiftDurationDays);

        // Don't show shifts that are too far in the past
        const now = typeof window !== 'undefined' ? new Date() : new Date('2024-01-01');
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        if (shiftEnd > oneWeekAgo) {
          const isCurrentShift = typeof window !== 'undefined' && now >= shiftStart && now < shiftEnd;

          items.add({
            id: `shift-${shiftIndex}`,
            group: member.user_id,
            start: shiftStart,
            end: shiftEnd,
            content: `
              <div class="timeline-shift-content">
                <div class="font-medium text-sm">${member.user_name.split(' ')[0]}</div>
              </div>
            `,
            className: `shift-item ${isCurrentShift ? 'current-shift' : ''}`,
            style: `background-color: ${isCurrentShift ? '#f59e0b' : MEMBER_COLORS[memberIndex % MEMBER_COLORS.length]}; color: white; border-radius: 4px; ${isCurrentShift ? 'border: 2px solid #fbbf24; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);' : ''}`
          });

          // Track current on-call member
          if (isCurrentShift) {
            setCurrentOnCall(member);
            if (onCurrentOnCallChange) {
              onCurrentOnCallChange(member);
            }
          }
        }
      }
    }

    console.log(`[${componentIdRef.current}] Generated ${items.length} items and ${groups.length} groups`);
    return { items, groups };
  };

  // Get shift duration in days
  const getShiftDurationInDays = (shiftLength) => {
    switch (shiftLength) {
      case 'one_day':
        return 1;
      case 'one_week':
        return 7;
      case 'two_weeks':
        return 14;
      case 'one_month':
        return 30;
      default:
        return 7;
    }
  };

  // Get timeline options based on view mode
  const getTimelineOptions = () => {
    // Use a stable date for SSR, will be updated on client
    const now = typeof window !== 'undefined' ? new Date() : new Date('2024-01-01');

    let start, end;
    switch (viewMode) {
      case 'day':
        start = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12 hours ago
        end = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 hours ahead
        break;
      case 'week':
        start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
        end = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000); // 4 days ahead
        break;
      case '2-week':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 1 week ago
        end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 1 week ahead
        break;
      case 'month':
        start = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000); // 2 weeks ago
        end = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // 2 weeks ahead
        break;
      default:
        start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        end = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
    }

    return {
      // Current time indicator
      showCurrentTime: true,

      // View configuration
      orientation: 'top',
      stack: false,

      // Time window - fixed window, don't auto-adjust
      start: start,
      end: end,

      // Prevent auto-fitting when data changes
      autoResize: true, // Allow container resize but don't auto-fit data

      // Zoom and pan
      zoomable: true,
      moveable: true,
      zoomMin: 1000 * 60 * 60, // 1 hour
      zoomMax: 1000 * 60 * 60 * 24 * 365, // 1 year

      // Height
      height: '300px',

      // Margins
      margin: {
        item: {
          horizontal: 5,
          vertical: 10
        }
      },

      // Time axis formatting
      format: {
        minorLabels: {
          hour: 'HH:mm',
          day: 'D',
          week: 'w',
          month: 'MMM'
        },
        majorLabels: {
          hour: 'ddd D MMMM',
          day: 'MMMM YYYY',
          week: 'MMMM YYYY',
          month: 'YYYY'
        }
      },

      // Styling
      selectable: true,
      multiselect: false,

      // Group styling
      groupOrder: function (a, b) {
        return a.content.localeCompare(b.content);
      }
    };
  };

  // Initialize timeline - only on client side
  useEffect(() => {
    // Ensure this only runs on client side to avoid hydration mismatch
    if (typeof window === 'undefined' || !timelineRef.current || !isVisible || !visLibs.Timeline || !visLibs.DataSet) return;

    // Prevent duplicate timeline creation
    if (timelineInstanceRef.current) {
      console.log(`[${componentIdRef.current}] Timeline already exists, skipping initialization`);
      return;
    }

    console.log(`[${componentIdRef.current}] Initializing timeline...`);

    // Add a small delay to ensure modal is fully rendered
    const initTimer = setTimeout(() => {
      // Double check timeline doesn't exist
      if (timelineInstanceRef.current) {
        console.log(`[${componentIdRef.current}] Timeline created during timeout, aborting`);
        return;
      }

      const { items, groups } = generateTimelineData();
      const options = getTimelineOptions();

      try {
        const newTimeline = new visLibs.Timeline(timelineRef.current, items, groups, options);
        timelineInstanceRef.current = newTimeline;
        setTimeline(newTimeline);

        console.log(`[${componentIdRef.current}] Timeline created successfully`);

        // Initial render without forcing fit to avoid unwanted zoom changes
        setTimeout(() => {
          if (timelineInstanceRef.current === newTimeline) {
            newTimeline.redraw();
          }
        }, 50);

        // Notify parent component that timeline is ready with redraw method
        if (onTimelineReady) {
          onTimelineReady({
            timeline: newTimeline,
            forceRedraw: () => {
              if (timelineInstanceRef.current === newTimeline) {
                // Only redraw, don't change view window
                newTimeline.redraw();
              }
            }
          });
        }

        // Event handlers
        newTimeline.on('select', (properties) => {
          if (properties.items.length > 0) {
            const item = items.get(properties.items[0]);
            console.log('Selected shift:', item);
          }
        });

        // Real-time updates - only on client side
        const interval = setInterval(() => {
          if (typeof window !== 'undefined' && timelineInstanceRef.current === newTimeline) {
            // Preserve current window to prevent auto-zoom when updating items
            const currentWindow = newTimeline.getWindow();
            newTimeline.setCurrentTime(new Date());

            // Update current on-call member
            const { items: newItems } = generateTimelineData();
            newTimeline.setItems(newItems);

            // Restore window
            newTimeline.setWindow(currentWindow.start, currentWindow.end, { animation: false });
          }
        }, 60000); // Update every minute

        return () => {
          console.log(`[${componentIdRef.current}] Cleaning up timeline`);
          clearInterval(interval);
          if (timelineInstanceRef.current === newTimeline) {
            newTimeline.destroy();
            timelineInstanceRef.current = null;
          }
        };
      } catch (error) {
        console.error(`[${componentIdRef.current}] Failed to initialize timeline:`, error);
        timelineInstanceRef.current = null;
      }
    }, 100);

    return () => {
      clearTimeout(initTimer);
      // Cleanup on unmount
      if (timelineInstanceRef.current) {
        console.log(`[${componentIdRef.current}] Component unmounting, destroying timeline`);
        timelineInstanceRef.current.destroy();
        timelineInstanceRef.current = null;
      }
    };
  }, [rotations, selectedMembers, isVisible, visLibs]);

  // Update timeline items/groups when data changes (without re-initializing)
  useEffect(() => {
    if (!timeline || !visLibs.DataSet) return;
    try {
      const currentWindow = timeline.getWindow();
      const { items, groups } = generateTimelineData();
      timeline.setItems(items);
      timeline.setGroups(groups);
      // Restore previous window to avoid zoom jumps
      timeline.setWindow(currentWindow.start, currentWindow.end, { animation: false });
      timeline.redraw();
      console.log(`[${componentIdRef.current}] Data changed -> items/groups updated`);
    } catch (e) {
      console.warn('Failed to update timeline with new data:', e);
    }
  }, [rotations, selectedMembers, timeline, visLibs]);


  // Update timeline when view mode changes (intentional user action)
  useEffect(() => {
    if (!timeline) return;

    // Apply new window without fitting all items to prevent zoom jumps
    const options = getTimelineOptions();
    const { start, end } = options;
    timeline.setOptions(options);
    timeline.setWindow(start, end, { animation: false });
    console.log(`[${componentIdRef.current}] View mode changed to: ${viewMode}, setWindow applied`);
  }, [viewMode, timeline]);

  // Show loading state during hydration
  if (!isClient) {
    return (
      <div className="schedule-timeline">
        <div className="timeline-loading border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-sm">Loading Timeline...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="schedule-timeline">
      {/* Current On-Call Status */}
      {currentOnCall && (
        <div className="bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  Currently On Call
                </p>
                <p className="text-lg font-bold text-green-900 dark:text-green-100">
                  {currentOnCall.user_name}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-green-600 dark:text-green-400">Live Status</p>
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Active Now
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Container */}
      <div
        ref={timelineRef}
        id={componentIdRef.current}
        className="timeline-container dark:border-gray-700 rounded-lg"
        style={{ width: '100%', minHeight: '300px' }}
        data-timeline-instance={componentIdRef.current}
      />

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Team Members:</span>
        {selectedMembers.map((member, index) => (
          <div key={member.user_id} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded"
              style={{ backgroundColor: MEMBER_COLORS[index % MEMBER_COLORS.length] }}
            ></div>
            <span className="text-sm text-gray-600 dark:text-gray-400">{member.user_name}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

ScheduleTimeline.displayName = 'ScheduleTimeline';

export default ScheduleTimeline;
