'use client';

import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { calculateMemberTimes } from '../../services/scheduleTransformer';
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
  isVisible = true, // New prop to control visibility
  onShiftClick // New prop to handle shift clicks
}, ref) => {
  const timelineRef = useRef(null);
  const [timeline, setTimeline] = useState(null);
  const [currentOnCall, setCurrentOnCall] = useState(null);
  const [isClient, setIsClient] = useState(false);
  const [containerReady, setContainerReady] = useState(false);
  const resizeObserverRef = useRef(null);
  const timelineInstanceRef = useRef(null); // Track timeline instance
  const componentIdRef = useRef(null);
  const [visLibs, setVisLibs] = useState({ Timeline: null, DataSet: null });

  // Set client flag after hydration and initialize component ID
  useEffect(() => {
    setIsClient(true);
    // Initialize component ID only on client to avoid hydration mismatch
    if (!componentIdRef.current) {
      componentIdRef.current = `timeline-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }
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
    if (timeline && timelineRef.current && timelineInstanceRef.current) {
      try {
        // Double check redraw method exists
        if (timeline.redraw && typeof timeline.redraw === 'function') {
          timeline.redraw();
          console.log('Timeline redrawn without zoom change');
        }
      } catch (error) {
        console.warn('Failed to redraw timeline:', error);
      }
    }
  };

  // Method to fit timeline to view window (only when needed)
  const fitTimelineToWindow = () => {
    if (timeline && timelineRef.current && timelineInstanceRef.current) {
      try {
        // Double check methods exist
        if (timeline.fit && typeof timeline.fit === 'function') {
          timeline.fit();
        }
        if (timeline.redraw && typeof timeline.redraw === 'function') {
          timeline.redraw();
        }
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
      if (timeline && timelineInstanceRef.current) {
        try {
          const { items, groups } = generateTimelineData();
          // Double check methods exist
          if (timeline.setItems && typeof timeline.setItems === 'function') {
            timeline.setItems(items);
          }
          if (timeline.setGroups && typeof timeline.setGroups === 'function') {
            timeline.setGroups(groups);
          }
          // Only redraw, don't change view window when refreshing data
          forceTimelineRedraw();
        } catch (error) {
          console.warn('Failed to refresh timeline data:', error);
        }
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

    // Track added item IDs to prevent duplicates
    const addedItemIds = new Set();

    // Create groups for each member
    selectedMembers.forEach((member, index) => {
      groups.add({
        id: member.user_id,
        content: `
          <div class="flex items-center gap-2 px-2 py-1">
            <div class="w-3 h-3 rounded-full" style="background-color: ${MEMBER_COLORS[index % MEMBER_COLORS.length]}"></div>
            <span class="font-medium text-sm">${member.user_name[0].toUpperCase()}</span>
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

        // Check if this schedule has an override
        const hasOverride = schedule.is_overridden || schedule.override_id;
        
        // IMPORTANT: Backend swaps user IDs when there's an override!
        // - schedule.user_id = EFFECTIVE user (person actually on-call)
        // - schedule.original_user_id = ORIGINAL user (person originally scheduled)
        const effectiveUserId = schedule.user_id;
        const originalUserId = schedule.original_user_id || schedule.user_id;

        // Find member for this schedule (use effective user for display)
        const member = selectedMembers.find(m => m.user_id === effectiveUserId) ||
                      selectedMembers.find(m => m.user_id === originalUserId);

        if (!member) {
          console.warn(`[${componentIdRef.current}] Member not found for schedule:`, schedule);
          return;
        }

        // Find original member if overridden
        const originalMember = hasOverride && originalUserId !== effectiveUserId
          ? selectedMembers.find(m => m.user_id === originalUserId)
          : null;

        // Use effective user for color assignment
        const memberIndex = selectedMembers.findIndex(m => m.user_id === effectiveUserId);
        const isCurrentShift = typeof window !== 'undefined' && now >= scheduleStart && now < scheduleEnd;

        // Create unique item ID
        const itemId = `schedule-${schedule.id || scheduleIndex}`;
        
        // Skip if already added (prevents duplicate item error)
        if (addedItemIds.has(itemId)) {
          console.warn(`[${componentIdRef.current}] Skipping duplicate item ID: ${itemId}`);
          return;
        }
        addedItemIds.add(itemId);

        console.log(`[${componentIdRef.current}] Adding schedule item:`, {
          id: itemId,
          member: member.user_name,
          hasOverride,
          originalMember: originalMember?.user_name,
          start: scheduleStart,
          end: scheduleEnd,
          isCurrent: isCurrentShift
        });

        // Build tooltip
        const tooltipContent = hasOverride && originalMember
          ? `Override: ${originalMember.user_name} → ${member.user_name}${schedule.override_reason ? `\nReason: ${schedule.override_reason}` : ''}`
          : `${member.user_name}`;

        items.add({
          id: itemId,
          group: effectiveUserId, // Use effective user ID for group assignment
          start: scheduleStart,
          end: scheduleEnd,
          content: `
            <div class="timeline-shift-content" title="${tooltipContent.replace(/\n/g, '&#10;')}">
              <div style="font-weight: 500; font-size: 0.875rem; display: flex; align-items: center; gap: 0.25rem;">
                ${hasOverride && originalMember ? `<span style="text-decoration: line-through; opacity: 0.6; font-size: 0.7em;">${originalMember.user_name.split(' ')[0]} </span> <small>override by </small>` : ''}
                <span>${member.user_name.split(' ')[0]}</span>
                ${hasOverride ? '<span style="font-size: 0.75rem;">✏️</span>' : ''}
              </div>
            </div>
          `,
          className: `shift-item ${isCurrentShift ? 'current-shift' : ''} ${hasOverride ? 'override-shift' : ''}`,
          style: `
            background-color: ${isCurrentShift ? '#f59e0b' : MEMBER_COLORS[memberIndex % MEMBER_COLORS.length]}; 
            color: white; 
            border-radius: 0px; 
            ${isCurrentShift ? 'border: 2px solid #fbbf24; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);' : ''}
            ${hasOverride ? 'background-image: repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,.1) 10px, rgba(255,255,255,.1) 20px); border: 2px dashed rgba(255,255,255,0.5);' : ''}
          `
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
      // Handle rotation format with handoff day/time logic
      console.log(`[${componentIdRef.current}] Processing rotation format data`);
      const rotation = rotations[0];
      if (!rotation.startDate || !rotation.shiftLength) {
        console.warn(`[${componentIdRef.current}] Invalid rotation format:`, rotation);
        return { items, groups };
      }

      const shiftDurationDays = getShiftDurationInDays(rotation.shiftLength);
      const now = typeof window !== 'undefined' ? new Date() : new Date('2024-01-01');
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Generate shifts for the year using handoff logic
      const totalDays = 365;
      const totalShifts = Math.ceil(totalDays / shiftDurationDays);

      for (let shiftIndex = 0; shiftIndex < totalShifts; shiftIndex++) {
        const memberIndex = shiftIndex % selectedMembers.length;
        const member = selectedMembers[memberIndex];

        // Use calculateMemberTimes to get proper handoff times
        const { memberStartTime, memberEndTime } = calculateMemberTimes(rotation, shiftIndex);
        
        const shiftStart = memberStartTime;
        const shiftEnd = memberEndTime;

        // Don't show shifts that are too far in the past
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
    return { items };
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
        start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 4 days ago
        end = new Date(now.getTime() + 11 * 24 * 60 * 60 * 1000); // 10 days ahead
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
      // orientation: 'top',
      stack: true,

      // Time window - fixed window, don't auto-adjust
      start: start,
      end: end,

      // Prevent auto-fitting when data changes
      autoResize: true, // Allow container resize but don't auto-fit data

      // Zoom and pan
      zoomable: true,
      moveable: true,
      zoomMin: 1000 * 60 * 60, // 1 hour
      zoomMax: 1000 * 60 * 60 * 24 * 90, // 1 year

      // Height
      minHeight: '300px',

      // Margins
      margin: {
        item: {
          // horizontal: 5,
          // vertical: 10
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
      editable: {
        add: true,
        remove: true,
        updateGroup: false,
        updateTime: true,
        overrideItems: false,
      },

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
            const itemId = properties.items[0];
            const item = items.get(itemId);
            console.log('Selected shift:', item);
            
            // Find the actual shift data from rotations
            if (onShiftClick) {
              // Extract shift index from item id (e.g., "schedule-123" or "shift-0")
              let shiftData = null;
              
              if (itemId.startsWith('schedule-')) {
                // Schedule format data
                const scheduleId = itemId.replace('schedule-', '');
                shiftData = rotations.find(s => s.id === scheduleId || s.id === parseInt(scheduleId));
              } else if (itemId.startsWith('shift-')) {
                // Rotation format data - need to reconstruct shift info
                const shiftIndex = parseInt(itemId.replace('shift-', ''));
                const rotation = rotations[0];
                if (rotation) {
                  const memberIndex = shiftIndex % selectedMembers.length;
                  const member = selectedMembers[memberIndex];
                  
                  // Get shift times from item
                  shiftData = {
                    id: itemId,
                    user_id: member.user_id,
                    user_name: member.user_name,
                    start_time: item.start,
                    end_time: item.end,
                    start: item.start,
                    end: item.end
                  };
                }
              }
              
              if (shiftData) {
                onShiftClick(shiftData);
              }
            }
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
    if (!timeline || !timelineInstanceRef.current || !visLibs.DataSet) return;

    try {
      // Double check timeline methods exist before calling
      if (!timeline.getWindow || !timeline.setItems || !timeline.setGroups || !timeline.setWindow || !timeline.redraw) {
        console.warn(`[${componentIdRef.current}] Timeline methods not available, skipping update`);
        return;
      }

      const currentWindow = timeline.getWindow();
      const { items, groups } = generateTimelineData();
      timeline.setItems(items);
      timeline.setGroups(groups);
      // Restore previous window to avoid zoom jumps
      timeline.setWindow(currentWindow.start, currentWindow.end, { animation: false });
      timeline.redraw();
      console.log(`[${componentIdRef.current}] Data changed -> items/groups updated`);
    } catch (e) {
      console.warn(`[${componentIdRef.current}] Failed to update timeline with new data:`, e);
    }
  }, [rotations, selectedMembers, timeline, visLibs]);


  // Update timeline when view mode changes (intentional user action)
  useEffect(() => {
    if (!timeline || !timelineInstanceRef.current) return;

    try {
      // Apply new window without fitting all items to prevent zoom jumps
      const options = getTimelineOptions();
      const { start, end } = options;

      // Double check timeline is still valid before calling methods
      if (timeline.setOptions && typeof timeline.setOptions === 'function') {
        timeline.setOptions(options);
      }

      if (timeline.setWindow && typeof timeline.setWindow === 'function') {
        timeline.setWindow(start, end, { animation: false });
      }

      console.log(`[${componentIdRef.current}] View mode changed to: ${viewMode}, setWindow applied`);
    } catch (error) {
      console.warn(`[${componentIdRef.current}] Failed to update timeline view mode:`, error);
    }
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
      {/* Timeline Container */}
      <div
        ref={timelineRef}
        id={componentIdRef.current}
        className="timeline-container dark:border-gray-100 rounded-lg"
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
