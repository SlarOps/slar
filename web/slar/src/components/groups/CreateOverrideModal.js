'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

export default function CreateOverrideModal({ 
  isOpen, 
  onClose, 
  schedule, 
  groupMembers, 
  onOverrideCreated 
}) {
  const { session } = useAuth();
  const [selectedUser, setSelectedUser] = useState('');
  const [reason, setReason] = useState('');
  const [overrideType, setOverrideType] = useState('temporary');
  const [overrideScope, setOverrideScope] = useState('full'); // 'full' or 'partial'
  const [partialStartDate, setPartialStartDate] = useState('');
  const [partialStartTime, setPartialStartTime] = useState('');
  const [partialEndDate, setPartialEndDate] = useState('');
  const [partialEndTime, setPartialEndTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen && schedule) {
      setSelectedUser('');
      setReason('');
      setOverrideType('temporary');
      setOverrideScope('full');
      
      // Initialize partial override times with schedule defaults
      const startDate = new Date(schedule.start_time);
      const endDate = new Date(schedule.end_time);
      
      setPartialStartDate(startDate.toISOString().split('T')[0]);
      setPartialStartTime(startDate.toISOString().split('T')[1].slice(0, 5));
      setPartialEndDate(endDate.toISOString().split('T')[0]);
      setPartialEndTime(endDate.toISOString().split('T')[1].slice(0, 5));
    }
  }, [isOpen, schedule]);

  if (!isOpen || !schedule) return null;

  // Validation helper functions
  const validatePartialOverride = () => {
    if (overrideScope !== 'partial') return { valid: true };

    const originalStart = new Date(schedule.start_time);
    const originalEnd = new Date(schedule.end_time);
    
    const overrideStart = new Date(`${partialStartDate}T${partialStartTime}:00.000Z`);
    const overrideEnd = new Date(`${partialEndDate}T${partialEndTime}:00.000Z`);

    if (overrideStart >= overrideEnd) {
      return { valid: false, error: 'Start time must be before end time' };
    }

    if (overrideStart < originalStart || overrideEnd > originalEnd) {
      return { 
        valid: false, 
        error: 'Override time must be within the original schedule timeframe' 
      };
    }

    if (overrideStart.getTime() === originalStart.getTime() && 
        overrideEnd.getTime() === originalEnd.getTime()) {
      return { 
        valid: false, 
        error: 'Partial override time cannot be the same as the full schedule. Use "Full Override" instead.' 
      };
    }

    return { valid: true };
  };

  const getOverrideTimes = () => {
    if (overrideScope === 'full') {
      return {
        override_start_time: schedule.start_time,
        override_end_time: schedule.end_time
      };
    } else {
      return {
        override_start_time: `${partialStartDate}T${partialStartTime}:00.000Z`,
        override_end_time: `${partialEndDate}T${partialEndTime}:00.000Z`
      };
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedUser) {
      toast.error('Please select a user to override with');
      return;
    }

    // Validate that selected user is not the same as original user
    if (selectedUser === schedule.user_id) {
      toast.error('Cannot override schedule with the same user. Please select a different user.');
      return;
    }

    // Validate partial override if applicable
    const validation = validatePartialOverride();
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    setIsSubmitting(true);
    
    try {
      const overrideTimes = getOverrideTimes();
      
      // Prepare override data (exclude override_scope - it's frontend only)
      const overrideData = {
        original_schedule_id: schedule.id,
        new_user_id: selectedUser,
        override_reason: reason || 'Manual override',
        override_type: overrideType,
        ...overrideTimes
      };
      
      await onOverrideCreated(overrideData);
      onClose();
    } catch (error) {
      console.error('Failed to create override:', error);
      toast.error('Failed to create override: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toISOString().split('T')[1].slice(0, 5);
  };

  return (
    <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border max-w-2xl shadow-lg rounded-md bg-white dark:bg-gray-800">
        <div className="mt-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Create Schedule Override
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Schedule Info */}
          <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h4 className="font-medium text-blue-900 dark:text-blue-200 mb-2">
              Schedule to Override:
            </h4>
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <p><strong>Current:</strong> {schedule.user_name} ({schedule.user_email})</p>
              <p><strong>Time:</strong> {formatDate(schedule.start_time)} {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)} UTC</p>
              {schedule.rotation_cycle_id && (
                <p className="text-xs mt-1 text-blue-600 dark:text-blue-400">
                  This is an automatic rotation schedule
                </p>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* User Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                New User (Override Assignment) *
              </label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                required
              >
                <option value="">Select a user...</option>
                {groupMembers
                  .filter(member => member.user_id !== schedule.user_id) // Filter out original user
                  .map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.user_name} ({member.user_email})
                    </option>
                  ))}
              </select>
            </div>

            {/* Override Scope Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Override Scope *
              </label>
              <div className="space-y-3">
                <div className="flex items-start">
                  <input
                    id="full-override"
                    type="radio"
                    value="full"
                    checked={overrideScope === 'full'}
                    onChange={(e) => setOverrideScope(e.target.value)}
                    className="mt-1 mr-3 h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div>
                    <label htmlFor="full-override" className="text-sm font-medium text-gray-900 dark:text-white cursor-pointer">
                      🕒 Full Override
                    </label>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Override the entire schedule time period ({formatDate(schedule.start_time)} {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)} UTC)
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <input
                    id="partial-override"
                    type="radio"
                    value="partial"
                    checked={overrideScope === 'partial'}
                    onChange={(e) => setOverrideScope(e.target.value)}
                    className="mt-1 mr-3 h-4 w-4 text-amber-600 border-gray-300 focus:ring-amber-500"
                  />
                  <div>
                    <label htmlFor="partial-override" className="text-sm font-medium text-gray-900 dark:text-white cursor-pointer">
                      🎯 Partial Override
                    </label>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Override only specific hours/days within the schedule period
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Partial Override Time Selection */}
            {overrideScope === 'partial' && (
              <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <h4 className="text-sm font-medium text-amber-900 dark:text-amber-200 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Set Partial Override Time
                </h4>
                
                <div className="grid grid-cols-2 gap-4">
                  {/* Start Time */}
                  <div>
                    <label className="block text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
                      Start Date & Time *
                    </label>
                    <div className="space-y-2">
                      <input
                        type="date"
                        value={partialStartDate}
                        onChange={(e) => setPartialStartDate(e.target.value)}
                        min={formatDate(schedule.start_time)}
                        max={formatDate(schedule.end_time)}
                        className="w-full px-2 py-1.5 text-sm border border-amber-300 dark:border-amber-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        required
                      />
                      <input
                        type="time"
                        value={partialStartTime}
                        onChange={(e) => setPartialStartTime(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-amber-300 dark:border-amber-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        required
                      />
                    </div>
                  </div>
                  
                  {/* End Time */}
                  <div>
                    <label className="block text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
                      End Date & Time *
                    </label>
                    <div className="space-y-2">
                      <input
                        type="date"
                        value={partialEndDate}
                        onChange={(e) => setPartialEndDate(e.target.value)}
                        min={formatDate(schedule.start_time)}
                        max={formatDate(schedule.end_time)}
                        className="w-full px-2 py-1.5 text-sm border border-amber-300 dark:border-amber-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        required
                      />
                      <input
                        type="time"
                        value={partialEndTime}
                        onChange={(e) => setPartialEndTime(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-amber-300 dark:border-amber-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        required
                      />
                    </div>
                  </div>
                </div>
                
                <div className="mt-3 space-y-2">
                  {/* Preview */}
                  <div className="p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded text-xs">
                    <div className="flex items-center gap-2 text-green-800 dark:text-green-300">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <strong>Override Period:</strong>
                      <br />
                      {partialStartDate} {partialStartTime} UTC - {partialEndDate} {partialEndTime} UTC
                    </div>
                  </div>
                  
                  {/* Note */}
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded text-xs text-amber-800 dark:text-amber-300">
                    <div className="flex items-start gap-2">
                      <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <strong>Constraint:</strong> Must be within original schedule:
                        <br />
                        {formatDate(schedule.start_time)} {formatTime(schedule.start_time)} UTC - {formatDate(schedule.end_time)} {formatTime(schedule.end_time)} UTC
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Override Type */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Override Type
              </label>
              <select
                value={overrideType}
                onChange={(e) => setOverrideType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="temporary">Temporary (can be removed)</option>
                <option value="permanent">Permanent (schedule change)</option>
                <option value="emergency">Emergency (urgent coverage)</option>
              </select>
            </div>

            {/* Reason */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Reason (optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                rows={3}
                placeholder="e.g., Vacation coverage, Emergency replacement, Schedule adjustment..."
              />
            </div>

            {/* Warning for permanent overrides */}
            {overrideType === 'permanent' && (
              <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex">
                  <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.96-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    <strong>Warning:</strong> Permanent overrides should be used sparingly. Consider if you need to update the rotation schedule instead.
                  </p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !selectedUser}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-amber-600 border border-transparent rounded-lg hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Creating...' : `Create ${overrideScope === 'partial' ? 'Partial' : 'Full'} Override`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
