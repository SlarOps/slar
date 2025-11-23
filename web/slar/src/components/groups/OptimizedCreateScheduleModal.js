'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from '../ui';
// Import extracted components
import RotationCard from './RotationCard';
import MembersList from './MembersList';
import SchedulePreview from './SchedulePreview';
import { DEFAULT_ROTATION } from './scheduleConstants';

// Helper: Transform shifts back to rotation format for editing
const transformShiftsToRotations = (shifts) => {
  if (!shifts || shifts.length === 0) {
    return [{
      ...DEFAULT_ROTATION,
      id: 1,
      startDate: new Date().toISOString().split('T')[0],
      startTime: '00:04'
    }];
  }

  // Sort shifts by start time
  const sortedShifts = [...shifts].sort((a, b) =>
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  // Get the first shift to extract common rotation settings
  const firstShift = sortedShifts[0];
  const startDate = new Date(firstShift.start_time).toISOString().split('T')[0];
  const startTime = new Date(firstShift.start_time).toISOString().split('T')[1].substring(0, 5);

  // Calculate shift duration
  const shiftStart = new Date(firstShift.start_time);
  const shiftEnd = new Date(firstShift.end_time);
  const shiftDurationMs = shiftEnd.getTime() - shiftStart.getTime();
  const shiftDurationHours = Math.round(shiftDurationMs / (1000 * 60 * 60));

  // Get rotation days for logic below
  const rotationDays = firstShift.rotation_days || 7;

  // For rotation schedules, endTime is usually the same as startTime (handoff time)
  // Unless it's a partial day shift
  let endTime = startTime; // Default: handoff at same time

  // If shift is less than 1 day, calculate actual end time
  if (rotationDays < 1 || shiftDurationHours < 24) {
    endTime = new Date(shiftEnd).toISOString().split('T')[1].substring(0, 5);
  } else {
    // For multi-day rotations, check if end time is different from start
    const endTimeOfDay = new Date(shiftEnd).toISOString().split('T')[1].substring(0, 5);
    // If end time is midnight (00:00), use start time instead (typical for rotation handoff)
    if (endTimeOfDay === '00:00') {
      endTime = startTime;
    } else {
      endTime = endTimeOfDay;
    }
  }

  // Determine shift length from rotation_days
  let shiftLength = 'one_week'; // default

  if (rotationDays === 1) {
    shiftLength = 'one_day';
  } else if (rotationDays === 7) {
    shiftLength = 'one_week';
  } else if (rotationDays === 14) {
    shiftLength = 'two_weeks';
  } else if (rotationDays === 30 || rotationDays === 31) {
    shiftLength = 'one_month';
  }

  // Determine handoff day from END time of first shift (not start!)
  const firstShiftEndDate = new Date(firstShift.end_time);
  const handoffDayOfWeek = firstShiftEndDate.getUTCDay(); // 0 = Sunday, 1 = Monday, etc
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const handoffDay = dayNames[handoffDayOfWeek];

  // Extract handoff time from END time of first shift (not start!)
  const handoffTime = new Date(firstShift.end_time).toISOString().split('T')[1].substring(0, 5);

  // Check if there's an end date by looking at the last shift
  const lastShift = sortedShifts[sortedShifts.length - 1];
  const lastEndDate = new Date(lastShift.end_time);

  // Calculate expected end date based on rotation pattern
  // If last shift end is significantly in the future, we have an end date
  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const hasEndDate = lastEndDate < oneYearFromNow && sortedShifts.length > 1;

  const endDate = hasEndDate ? lastEndDate.toISOString().split('T')[0] : '';

  // Extract all unique participants in rotation order
  // Group shifts by member and find their first occurrence
  const memberFirstShift = new Map();

  sortedShifts.forEach(shift => {
    if (!memberFirstShift.has(shift.user_id)) {
      memberFirstShift.set(shift.user_id, {
        user_id: shift.user_id,
        user_name: shift.user_name,
        start_time: new Date(shift.start_time)
      });
    }
  });

  // Sort members by their first shift start time to get rotation order
  const participants = Array.from(memberFirstShift.values())
    .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
    .map(m => ({
      user_id: m.user_id,
      user_name: m.user_name
    }));

  // Create single rotation with all participants
  return [{
    id: 1,
    name: 'Rotation',
    shiftLength,
    handoffDay,
    handoffTime,
    startDate,
    startTime,
    hasEndDate,
    endDate,
    endTime,
    participants
  }];
};

// Helper: Extract selected members from shifts, deduping by email (preferred) or id, and accounting for overrides
const extractSelectedMembers = (shifts) => {
  if (!Array.isArray(shifts) || shifts.length === 0) return [];

  // Use email as the primary dedupe key (stable across overrides). Fallback to id.
  const unique = new Map();

  const add = ({ user_id, user_name, user_email, user_team }) => {
    const key = (user_email && user_email.trim().toLowerCase()) || user_id;
    if (!key) return;
    if (!unique.has(key)) {
      unique.set(key, {
        user_id: user_id || user_email || user_name || key,
        user_name: user_name || user_email || 'Unknown',
        user_email: user_email || '',
        user_team: user_team || ''
      });
    }
  };

  for (const s of shifts) {
    // 1) Effective assignee (who actually carried the shift window)
    if (s.effective_user_id) {
      add({
        user_id: s.effective_user_id,
        user_name: s.user_name,       // Often mirrors effective user in your data
        user_email: s.user_email,
        user_team: s.user_team
      });
    }

    // 2) Original assignee (pre‑override). These fields reliably carry the original person.
    if (s.original_user_email || s.original_user_name || s.original_user_team) {
      add({
        // original_user_id may not exist; fall back to email as stable key
        user_id: s.original_user_id || s.user_id,
        user_name: s.original_user_name,
        user_email: s.original_user_email,
        user_team: s.original_user_team
      });
    } else {
      // 3) If there was no override metadata, include the scheduled user as well
      add({
        user_id: s.user_id,
        user_name: s.user_name,
        user_email: s.user_email,
        user_team: s.user_team
      });
    }
  }

  return Array.from(unique.values());
};

export default function OptimizedCreateScheduleModal({
  isOpen,
  onClose,
  members,
  groupId,
  session,
  onSubmit,
  existingSchedules = [],
  schedulerData = null, // NEW: For edit mode
  mode = 'create' // NEW: 'create' or 'edit'
}) {
  const [formData, setFormData] = useState({
    name: '',
    rotations: [],
    conditions: [],
    selectedMembers: []
  });

  // Loading states for better UX
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState('');

  // Track if form has been modified (to switch from Live View to Preview)
  const [isDirty, setIsDirty] = useState(false);

  // Initialize with default rotation or edit data
  useEffect(() => {
    if (isOpen) {
      // Reset dirty state when opening
      setIsDirty(false);

      if (mode === 'edit' && schedulerData) {
        // Skip initialization if still loading
        if (schedulerData.loading) {
          console.log('⏳ Waiting for scheduler data to load...');
          return;
        }

        // Edit mode: populate form with existing scheduler data
        console.log('📝 Edit mode - Loading scheduler data:', schedulerData);

        // Transform scheduler shifts back to rotation format
        const rotations = transformShiftsToRotations(schedulerData.shifts || []);

        setFormData({
          name: schedulerData.display_name || schedulerData.name || '',
          rotations: rotations,
          conditions: [],
          selectedMembers: extractSelectedMembers(schedulerData.shifts || [])
        });
      } else if (formData.rotations.length === 0) {
        // Create mode: default rotation
        const today = new Date();
        setFormData(prev => ({
          ...prev,
          name: `Datajet - New Schedule - ${today.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })} am`,
          rotations: [{
            ...DEFAULT_ROTATION,
            id: 1,
            startDate: today.toISOString().split('T')[0],
            startTime: '00:04'
          }]
        }));
      }
    }
  }, [isOpen, mode, schedulerData, formData.rotations.length]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
      setSubmitProgress('');
      setIsDirty(false);
    }
  }, [isOpen]);

  const updateRotation = useCallback((id, updatedRotation) => {
    setIsDirty(true);
    setFormData(prev => ({
      ...prev,
      rotations: prev.rotations.map(rotation =>
        rotation.id === id ? updatedRotation : rotation
      )
    }));
  }, []);

  const deleteRotation = useCallback((id) => {
    setIsDirty(true);
    setFormData(prev => ({
      ...prev,
      rotations: prev.rotations.filter(rotation => rotation.id !== id)
    }));
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (isSubmitting) return; // Prevent double submission

    setIsSubmitting(true);
    setSubmitProgress('Preparing schedule data...');

    try {
      // Add small delay to show progress
      await new Promise(resolve => setTimeout(resolve, 300));

      if (mode === 'edit') {
        setSubmitProgress('Updating scheduler...');
      } else {
        setSubmitProgress('Creating scheduler...');
      }

      // Convert to API format with scheduler information
      const scheduleData = {
        name: formData.name,
        rotations: formData.rotations,
        members: formData.selectedMembers,
        // Scheduler information
        schedulerName: formData.name || 'default',
        schedulerDisplayName: formData.name,
        description: `Scheduler for ${formData.name}`,
        rotationType: 'manual',
        // For edit mode
        schedulerId: mode === 'edit' ? schedulerData?.id : undefined
      };

      setSubmitProgress('Saving to database...');

      // Call the onSubmit prop (parent handles create vs edit)
      await onSubmit(scheduleData);

      // Success handled by parent component

    } catch (error) {
      console.error(`Failed to ${mode === 'edit' ? 'update' : 'create'} schedule:`, error);
      toast.error(error.message || `Failed to ${mode === 'edit' ? 'update' : 'create'} schedule`);
    } finally {
      setIsSubmitting(false);
      setSubmitProgress('');
    }
  }, [formData, isSubmitting, onSubmit, mode, schedulerData]);

  // Helper to handle member changes
  const handleMembersChange = (members) => {
    setIsDirty(true);
    setFormData(prev => ({ ...prev, selectedMembers: members }));
  };

  // Determine what to show in preview
  // In Edit Mode + Not Dirty -> Show actual shifts (Live View with Overrides)
  // Otherwise -> Show rotation preview (Configuration View)
  const previewData = (mode === 'edit' && !isDirty && schedulerData?.shifts)
    ? schedulerData.shifts
    : formData.rotations;

  // Prevent closing modal while submitting
  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      onClose();
    }
  }, [isSubmitting, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 w-full max-w-7xl max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
            {mode === 'edit' ? 'Edit schedule' : 'New schedule'}
          </h3>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Loading Data Overlay (when fetching scheduler data for edit) */}
        {mode === 'edit' && schedulerData?.loading && (
          <div className="absolute inset-0 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-xl border border-gray-200 dark:border-gray-700">
              <div className="flex flex-col items-center space-y-4">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-600"></div>
                <div className="text-center">
                  <div className="text-base font-medium text-gray-900 dark:text-white">
                    Loading scheduler data...
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Please wait a moment
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading Overlay (when submitting) */}
        {isSubmitting && (
          <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {mode === 'edit' ? 'Updating Schedule...' : 'Creating Schedule...'}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {submitProgress}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left Panel - Configuration */}
          <div className="w-1/3 p-4 overflow-y-auto border-r border-gray-200 dark:border-gray-700">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  disabled={isSubmitting}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                  required
                />
              </div>

              {/* Schedule Rotations */}
              <div>
                <div className="space-y-4">
                  {formData.rotations.map(rotation => (
                    <RotationCard
                      key={rotation.id}
                      rotation={rotation}
                      onUpdate={updateRotation}
                      onDelete={deleteRotation}
                      members={members}
                      disabled={isSubmitting}
                    />
                  ))}
                </div>
              </div>

              {/* Members */}
              <MembersList
                members={members}
                selectedMembers={formData.selectedMembers}
                onMembersChange={handleMembersChange}
                disabled={isSubmitting}
              />
            </form>
          </div>

          {/* Right Panel - Preview */}
          <div className="w-2/3 p-6 overflow-y-auto bg-gray-50 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {mode === 'edit' && !isDirty ? 'Live Schedule (Current)' : 'Schedule Preview (New Configuration)'}
              </h4>
              {mode === 'edit' && !isDirty && (
                <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-800">
                  Showing actual shifts including overrides
                </span>
              )}
            </div>
            <SchedulePreview
              rotations={previewData}
              members={members}
              selectedMembers={formData.selectedMembers}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!formData.name || !formData.selectedMembers.length || isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            {isSubmitting
              ? (mode === 'edit' ? 'Updating...' : 'Creating...')
              : (mode === 'edit' ? 'Update Schedule' : 'Create Schedule')
            }
          </button>
        </div>
      </div>
    </div>
  );
}
