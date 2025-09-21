'use client';

import React, { useState, useEffect } from 'react';

export default function ShiftSwapModal({ 
  isOpen, 
  onClose, 
  currentSchedule, 
  allSchedules,
  groupMembers, 
  onSwapRequested,
  isLeader = true // Assume leader by default for simplified experience
}) {
  const [selectedSwapSchedule, setSelectedSwapSchedule] = useState('');
  const [swapMessage, setSwapMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedSwapSchedule('');
      setSwapMessage('');
    }
  }, [isOpen]);

  if (!isOpen || !currentSchedule) return null;

  // Get available schedules to swap with (exclude current user's schedules)
  const availableSwapSchedules = allSchedules.filter(schedule => {
    // Exclude current schedule
    if (schedule.id === currentSchedule.id) return false;
    
    // Exclude schedules from same user
    if (schedule.user_id === currentSchedule.user_id) return false;
    
    // Only include active schedules
    if (!schedule.is_active) return false;
    
    // Only include schedules within reasonable time range (e.g., same week or month)
    const currentStart = new Date(currentSchedule.start_time);
    const scheduleStart = new Date(schedule.start_time);
    const timeDiff = Math.abs(scheduleStart.getTime() - currentStart.getTime());
    const daysDiff = timeDiff / (1000 * 3600 * 24);
    
    // Allow swaps within 30 days
    return daysDiff <= 30;
  });

  const formatScheduleTime = (startTime, endTime) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    const startDate = start.toISOString().split('T')[0];
    const startTime24 = start.toISOString().split('T')[1].slice(0, 5);
    const endDate = end.toISOString().split('T')[0];
    const endTime24 = end.toISOString().split('T')[1].slice(0, 5);
    
    if (startDate === endDate) {
      return `${startDate} ${startTime24} - ${endTime24} UTC`;
    }
    return `${startDate} ${startTime24} UTC - ${endDate} ${endTime24} UTC`;
  };

  const getScheduleStatus = (startTime, endTime) => {
    const now = new Date();
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    if (now < start) return { status: 'upcoming', label: 'Upcoming', color: 'text-blue-600 bg-blue-50' };
    if (now >= start && now <= end) return { status: 'active', label: 'Active', color: 'text-green-600 bg-green-50' };
    return { status: 'past', label: 'Past', color: 'text-gray-600 bg-gray-50' };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSwapSchedule) {
      alert('Please select a schedule to swap with');
      return;
    }

    const targetSchedule = availableSwapSchedules.find(s => s.id === selectedSwapSchedule);
    if (!targetSchedule) {
      alert('Selected schedule not found');
      return;
    }

    setIsSubmitting(true);
    
    try {
      await onSwapRequested({
        current_schedule_id: currentSchedule.id,
        target_schedule_id: selectedSwapSchedule,
        swap_message: swapMessage || 'Shift swap by group leader',
        swap_type: 'instant', // Leaders always get instant swap
        current_user_id: currentSchedule.user_id,
        target_user_id: targetSchedule.user_id
      });
      onClose();
    } catch (error) {
      console.error('Failed to swap shifts:', error);
      alert('Failed to swap shifts: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border max-w-3xl shadow-lg rounded-md bg-white dark:bg-gray-800">
        <div className="mt-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              ⚡ Quick Shift Swap {isLeader && <span className="text-sm text-green-600">(Leader)</span>}
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

          {/* Current Schedule Info */}
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h4 className="font-medium text-blue-900 dark:text-blue-200 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Your Current Shift:
            </h4>
            <div className="bg-white dark:bg-gray-700 p-3 rounded border">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center font-medium text-sm">
                    {currentSchedule.user_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {currentSchedule.user_name} ({currentSchedule.user_email})
                    </div>
                  </div>
                </div>
                <div className={`px-2 py-1 text-xs font-medium rounded ${getScheduleStatus(currentSchedule.start_time, currentSchedule.end_time).color}`}>
                  {getScheduleStatus(currentSchedule.start_time, currentSchedule.end_time).label}
                </div>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {formatScheduleTime(currentSchedule.start_time, currentSchedule.end_time)}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Leader Info */}
            {isLeader && (
              <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm text-green-800 dark:text-green-300">
                  ⚡ As a group leader, your shift swaps happen instantly without requiring approval.
                </p>
              </div>
            )}

            {/* Available Schedules to Swap With */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Select Shift to Swap With *
              </label>
              
              {availableSwapSchedules.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p>No available shifts to swap with</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {availableSwapSchedules.map((schedule) => {
                    const status = getScheduleStatus(schedule.start_time, schedule.end_time);
                    return (
                      <label
                        key={schedule.id}
                        className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${
                          selectedSwapSchedule === schedule.id
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-600'
                        }`}
                      >
                        <input
                          type="radio"
                          value={schedule.id}
                          checked={selectedSwapSchedule === schedule.id}
                          onChange={(e) => setSelectedSwapSchedule(e.target.value)}
                          className="mr-3 h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <div className="flex items-center justify-between flex-1">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center font-medium text-sm">
                              {schedule.user_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-gray-900 dark:text-white text-sm">
                                {schedule.user_name}
                              </div>
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {formatScheduleTime(schedule.start_time, schedule.end_time)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 text-xs font-medium rounded ${status.color}`}>
                              {status.label}
                            </span>
                            {schedule.rotation_cycle_id && (
                              <span className="inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-blue-50 border border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400">
                                🔁 Auto
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Swap Message */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Message (optional)
              </label>
              <textarea
                value={swapMessage}
                onChange={(e) => setSwapMessage(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                rows={3}
                placeholder={`Hi! I'd like to swap my shift with yours. Let me know if this works for you.`}
              />
            </div>

            {/* Preview */}
            {selectedSwapSchedule && (
              <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <h4 className="font-medium text-green-900 dark:text-green-200 mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  Swap Preview:
                </h4>
                <div className="text-sm text-green-800 dark:text-green-300">
                  {(() => {
                    const targetSchedule = availableSwapSchedules.find(s => s.id === selectedSwapSchedule);
                    return (
                      <>
                        <p><strong>You will take:</strong> {targetSchedule?.user_name}'s shift ({formatScheduleTime(targetSchedule?.start_time, targetSchedule?.end_time)})</p>
                        <p><strong>They will take:</strong> Your shift ({formatScheduleTime(currentSchedule.start_time, currentSchedule.end_time)})</p>
                      </>
                    );
                  })()}
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
                disabled={isSubmitting || !selectedSwapSchedule || availableSwapSchedules.length === 0}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Swapping...' : '⚡ Swap Shifts Instantly'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
