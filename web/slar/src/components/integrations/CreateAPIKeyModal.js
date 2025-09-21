'use client';

import { useState } from 'react';

const PERMISSIONS = [
  { value: 'create_alerts', label: 'Create Alerts', description: 'Allow creating new alerts via API' },
  { value: 'read_alerts', label: 'Read Alerts', description: 'Access to view existing alerts' },
  { value: 'manage_oncall', label: 'Manage On-Call', description: 'Manage on-call schedules and rotations' },
  { value: 'view_dashboard', label: 'View Dashboard', description: 'Access to dashboard and statistics' },
  { value: 'manage_services', label: 'Manage Services', description: 'Manage uptime monitoring services' }
];

const ENVIRONMENTS = [
  { value: 'prod', label: 'Production', description: 'For production systems and critical alerts' },
  { value: 'dev', label: 'Development', description: 'For development and testing environments' },
  { value: 'test', label: 'Testing', description: 'For testing and staging environments' }
];

export default function CreateAPIKeyModal({ isOpen, onClose, onSubmit, loading }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    environment: 'prod',
    permissions: ['create_alerts'],
    expires_at: '',
    rate_limit_per_hour: 1000,
    rate_limit_per_day: 10000
  });
  const [errors, setErrors] = useState({});

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handlePermissionChange = (permission, checked) => {
    setFormData(prev => ({
      ...prev,
      permissions: checked 
        ? [...prev.permissions, permission]
        : prev.permissions.filter(p => p !== permission)
    }));
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'API key name is required';
    }

    if (!formData.environment) {
      newErrors.environment = 'Environment is required';
    }

    if (formData.permissions.length === 0) {
      newErrors.permissions = 'At least one permission is required';
    }

    if (formData.rate_limit_per_hour && formData.rate_limit_per_hour < 1) {
      newErrors.rate_limit_per_hour = 'Hourly rate limit must be at least 1';
    }

    if (formData.rate_limit_per_day && formData.rate_limit_per_day < 1) {
      newErrors.rate_limit_per_day = 'Daily rate limit must be at least 1';
    }

    if (formData.expires_at) {
      const expiryDate = new Date(formData.expires_at);
      const now = new Date();
      if (expiryDate <= now) {
        newErrors.expires_at = 'Expiry date must be in the future';
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

    const submitData = {
      ...formData,
      expires_at: formData.expires_at ? new Date(formData.expires_at).toISOString() : null
    };

    await onSubmit(submitData);
  };

  const handleClose = () => {
    setFormData({
      name: '',
      description: '',
      environment: 'prod',
      permissions: ['create_alerts'],
      expires_at: '',
      rate_limit_per_hour: 1000,
      rate_limit_per_day: 10000
    });
    setErrors({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm transition-all" onClick={handleClose}></div>
      
      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-2xl bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 animate-in zoom-in-95 duration-200">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Create API Key</h2>
            <button
              type="button"
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Basic Information */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Basic Information</h3>
            
            {/* API Key Name */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                API Key Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.name ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
                }`}
                placeholder="e.g., Prometheus Integration, Production Alerts"
              />
              {errors.name && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.name}</p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Optional description for this API key"
              />
            </div>

            {/* Environment */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Environment *
              </label>
              {ENVIRONMENTS.map((env) => (
                <label key={env.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="environment"
                    value={env.value}
                    checked={formData.environment === env.value}
                    onChange={(e) => handleInputChange('environment', e.target.value)}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">{env.label}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{env.description}</div>
                  </div>
                </label>
              ))}
              {errors.environment && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.environment}</p>
              )}
            </div>
          </div>

          {/* Permissions */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Permissions</h3>
            <div className="space-y-3">
              {PERMISSIONS.map((permission) => (
                <label key={permission.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.permissions.includes(permission.value)}
                    onChange={(e) => handlePermissionChange(permission.value, e.target.checked)}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">{permission.label}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{permission.description}</div>
                  </div>
                </label>
              ))}
              {errors.permissions && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.permissions}</p>
              )}
            </div>
          </div>

          {/* Advanced Settings */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Advanced Settings</h3>
            
            {/* Expiry Date */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Expiry Date (optional)
              </label>
              <input
                type="datetime-local"
                value={formData.expires_at}
                onChange={(e) => handleInputChange('expires_at', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.expires_at ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
              {errors.expires_at && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.expires_at}</p>
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Leave blank for no expiry. Recommended for better security.
              </p>
            </div>

            {/* Rate Limits */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Hourly Rate Limit
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.rate_limit_per_hour}
                  onChange={(e) => handleInputChange('rate_limit_per_hour', parseInt(e.target.value) || 0)}
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    errors.rate_limit_per_hour ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {errors.rate_limit_per_hour && (
                  <p className="text-sm text-red-600 dark:text-red-400">{errors.rate_limit_per_hour}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Daily Rate Limit
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.rate_limit_per_day}
                  onChange={(e) => handleInputChange('rate_limit_per_day', parseInt(e.target.value) || 0)}
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    errors.rate_limit_per_day ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {errors.rate_limit_per_day && (
                  <p className="text-sm text-red-600 dark:text-red-400">{errors.rate_limit_per_day}</p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleClose}
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  Create API Key
                </>
              )}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
