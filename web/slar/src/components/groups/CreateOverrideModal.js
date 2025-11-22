'use client';

import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import Modal, { ModalFooter, ModalButton } from '../ui/Modal';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';

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
    // If called from form submit, prevent default
    if (e && e.preventDefault) e.preventDefault();

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

  // Prepare options for Select
  const memberOptions = members.map(member => ({
    value: member.user_id,
    label: member.user_name
  }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create an Override"
      size="lg"
      footer={
        <ModalFooter>
          <ModalButton
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            loading={isSubmitting}
            disabled={isSubmitting || !!validationError}
          >
            Create Override
          </ModalButton>
        </ModalFooter>
      }
    >
      <div className="space-y-6">
        {/* Current User Info */}
        {currentUser && (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
              <span className="text-sm font-medium text-blue-600 dark:text-blue-300">
                {currentUser.user_name[0].toUpperCase()}
              </span>
            </div>
            <span className="font-medium">{currentUser.user_name}</span>
            <span className="text-gray-400 mx-1">•</span>
            <span>Current Assignee</span>
          </div>
        )}

        {/* Original Shift Info */}
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

        {/* Form Fields */}
        <div className="space-y-4">
          {/* User Selector */}
          <Select
            label="Who should take this shift?"
            value={formData.userId}
            onChange={(value) => setFormData(prev => ({ ...prev, userId: value }))}
            options={memberOptions}
            placeholder="Select a user"
            required
            disabled={isSubmitting}
          />

          {/* Date and Time Inputs */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="date"
              label="Start Date"
              value={formData.startDate}
              onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
              disabled={isSubmitting}
              required
            />
            <Input
              type="time"
              label="Start time (+07)"
              value={formData.startTime}
              onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
              disabled={isSubmitting}
              required
            />
            <Input
              type="date"
              label="End Date"
              value={formData.endDate}
              onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
              disabled={isSubmitting}
              required
            />
            <Input
              type="time"
              label="End time (+07)"
              value={formData.endTime}
              onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
              disabled={isSubmitting}
              required
              helperText={durationDays > 0 && !validationError ? `(${durationDays} days)` : undefined}
            />
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
              {validationError}
            </div>
          )}

          {/* Reason (Optional) */}
          <Textarea
            label="Reason (Optional)"
            value={formData.reason}
            onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
            disabled={isSubmitting}
            rows={3}
            placeholder="Why is this override needed?"
          />
        </div>
      </div>
    </Modal>
  );
}
