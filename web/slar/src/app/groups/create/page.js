'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const GROUP_TYPES = [
  { value: 'escalation', label: 'Escalation', description: 'For alert escalation and on-call management' },
  { value: 'notification', label: 'Notification', description: 'For general notifications and updates' },
  { value: 'approval', label: 'Approval', description: 'For approval workflows and processes' }
];

const ESCALATION_METHODS = [
  { value: 'sequential', label: 'Sequential', description: 'Contact members one by one in order' },
  { value: 'parallel', label: 'Parallel', description: 'Contact all members simultaneously' },
  { value: 'round_robin', label: 'Round Robin', description: 'Rotate through members for each alert' }
];

export default function CreateGroupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'escalation',
    escalation_timeout: 300,
    escalation_method: 'sequential'
  });
  const [errors, setErrors] = useState({});

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Group name is required';
    } else if (formData.name.length < 3) {
      newErrors.name = 'Group name must be at least 3 characters';
    }

    if (!formData.type) {
      newErrors.type = 'Group type is required';
    }

    if (formData.type === 'escalation') {
      if (!formData.escalation_method) {
        newErrors.escalation_method = 'Escalation method is required';
      }
      if (!formData.escalation_timeout || formData.escalation_timeout < 60) {
        newErrors.escalation_timeout = 'Escalation timeout must be at least 60 seconds';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      // TODO: Replace with actual API call
      // const result = await apiClient.createGroup(formData);
      console.log('Creating group:', formData);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // TODO: Show success notification
      router.push('/groups');
    } catch (error) {
      console.error('Failed to create group:', error);
      setErrors({ submit: 'Failed to create group. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link 
          href="/groups"
          className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create Group</h1>
          <p className="text-gray-600 dark:text-gray-400">Set up a new group for on-call management</p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 space-y-6">
        {/* Basic Information */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Basic Information</h2>
          
          {/* Group Name */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Group Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                errors.name ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
              }`}
              placeholder="Enter group name"
            />
            {errors.name && (
              <p className="text-sm text-red-600 dark:text-red-400">{errors.name}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Describe the purpose of this group"
            />
          </div>
        </div>

        {/* Group Type */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Group Type</h2>
          
          <div className="space-y-3">
            {GROUP_TYPES.map((type) => (
              <label key={type.value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="type"
                  value={type.value}
                  checked={formData.type === type.value}
                  onChange={(e) => handleInputChange('type', e.target.value)}
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{type.label}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">{type.description}</div>
                </div>
              </label>
            ))}
          </div>
          {errors.type && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">{errors.type}</p>
          )}
        </div>

        {/* Escalation Settings (only for escalation groups) */}
        {formData.type === 'escalation' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Escalation Settings</h2>
            
            {/* Escalation Method */}
            <div className="space-y-3 mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Escalation Method *
              </label>
              {ESCALATION_METHODS.map((method) => (
                <label key={method.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="escalation_method"
                    value={method.value}
                    checked={formData.escalation_method === method.value}
                    onChange={(e) => handleInputChange('escalation_method', e.target.value)}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">{method.label}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{method.description}</div>
                  </div>
                </label>
              ))}
              {errors.escalation_method && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.escalation_method}</p>
              )}
            </div>

            {/* Escalation Timeout */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Escalation Timeout (seconds) *
              </label>
              <input
                type="number"
                min="60"
                max="3600"
                value={formData.escalation_timeout}
                onChange={(e) => handleInputChange('escalation_timeout', parseInt(e.target.value) || 0)}
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.escalation_timeout ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
                }`}
                placeholder="300"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Time to wait before escalating to the next member or level (60-3600 seconds)
              </p>
              {errors.escalation_timeout && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.escalation_timeout}</p>
              )}
            </div>
          </div>
        )}

        {/* Submit Error */}
        {errors.submit && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{errors.submit}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-6 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Group
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
