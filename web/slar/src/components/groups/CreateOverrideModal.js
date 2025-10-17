'use client';

import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';

export default function CreateOverrideModal({ 
  isOpen, 
  onClose, 
  shift,
  members,
  groupId,
  session,
  onOverrideCreated
}) {
  const [formData, setFormData] = useState({
    userId: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    reason: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Initialize form data when shift changes
  useEffect(() => {
    if (shift && isOpen) {
      const startDate = new Date(shift.start_time || shift.start);
      const endDate = new Date(shift.end_time || shift.end);

      setFormData({
        userId: shift.user_id || '',
        startDate: startDate.toISOString().split('T')[0],
        startTime: startDate.toTimeString().slice(0, 5),
        endDate: endDate.toISOString().split('T')[0],
        endTime: endDate.toTimeString().slice(0, 5),
        reason: ''
      });
      setValidationError('');
    }
  }, [shift, isOpen]);

  // Validate dates
  useEffect(() => {
    if (formData.startDate && formData.startTime && formData.endDate && formData.endTime) {
      const start = new Date(`${formData.startDate}T${formData.startTime}`);
      const end = new Date(`${formData.endDate}T${formData.endTime}`);
      const now = new Date();

      if (end <= start) {
        setValidationError('End date and time must be after start date and time');
      } else if (end <= now) {
        setValidationError('End date and time must be on or after current date and time');
      } else {
        setValidationError('');
      }
    }
  }, [formData.startDate, formData.startTime, formData.endDate, formData.endTime]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (!formData.userId) {
      toast.error('Please select a user');
      return;
    }

    setIsSubmitting(true);

    try {
      const startDateTime = new Date(`${formData.startDate}T${formData.startTime}`);
      const endDateTime = new Date(`${formData.endDate}T${formData.endTime}`);

      const overrideData = {
        original_schedule_id: shift.id,
        new_user_id: formData.userId,
        override_start_time: startDateTime.toISOString(),
        override_end_time: endDateTime.toISOString(),
        override_type: 'temporary',
        override_reason: formData.reason || 'Manual override'
      };

      // Use the API client to create override
      const { apiClient } = await import('../../lib/api');
      apiClient.setToken(session.access_token);
      
      const response = await apiClient.createOverride(groupId, overrideData);
      
      if (onOverrideCreated) {
        onOverrideCreated(response);
      } else {
        // Only close if no callback (fallback)
        toast.success('Override created successfully');
        onClose();
      }
    } catch (error) {
      console.error('Failed to create override:', error);
      toast.error(error.message || 'Failed to create override');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !shift) return null;

  const shiftStartDate = new Date(shift.start_time || shift.start);
  const shiftEndDate = new Date(shift.end_time || shift.end);
  const currentUser = members.find(m => m.user_id === shift.user_id);

  // Calculate duration
  const startDateTime = new Date(`${formData.startDate}T${formData.startTime}`);
  const endDateTime = new Date(`${formData.endDate}T${formData.endTime}`);
  const durationMs = endDateTime - startDateTime;
  const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
              Create an Override
            </h3>
            {currentUser && (
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                    <span className="text-sm font-medium text-blue-600 dark:text-blue-300">
                      {currentUser.user_name[0].toUpperCase()}
                    </span>
                  </div>
                  <span className="font-medium">{currentUser.user_name}</span>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 disabled:opacity-50"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Original Shift Info */}
        <div className="px-6 pt-4 pb-2">
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">From (GMT+7)</span>
              <span className="text-sm text-gray-900 dark:text-white">
                {shiftStartDate.toLocaleDateString('en-US', { 
                  weekday: 'short', 
                  month: 'short', 
                  day: 'numeric' 
                })} @ {shiftStartDate.toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: true 
                })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">To</span>
              <span className="text-sm text-gray-900 dark:text-white">
                {shiftEndDate.toLocaleDateString('en-US', { 
                  weekday: 'short', 
                  month: 'short', 
                  day: 'numeric' 
                })} @ {shiftEndDate.toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: true 
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* User Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Who should take this shift?
            </label>
            <select
              value={formData.userId}
              onChange={(e) => setFormData(prev => ({ ...prev, userId: e.target.value }))}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
              required
            >
              <option value="">Select a user</option>
              {members.map(member => (
                <option key={member.user_id} value={member.user_id}>
                  {member.user_name}
                </option>
              ))}
            </select>
          </div>

          {/* Date and Time Inputs */}
          <div className="grid grid-cols-2 gap-4">
            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                required
              />
            </div>

            {/* Start Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Start time (+07)
              </label>
              <input
                type="time"
                value={formData.startTime}
                onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                required
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                required
              />
            </div>

            {/* End Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                End time (+07)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                  disabled={isSubmitting}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                  required
                />
                {durationDays > 0 && !validationError && (
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    ({durationDays}d)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {validationError}
            </div>
          )}

          {/* Reason (Optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Reason (Optional)
            </label>
            <textarea
              value={formData.reason}
              onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
              disabled={isSubmitting}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 resize-none"
              placeholder="Why is this override needed?"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !!validationError}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting && (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
              )}
              {isSubmitting ? 'Creating...' : 'Create Override'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
