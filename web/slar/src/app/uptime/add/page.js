'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const SERVICE_TYPES = [
  { 
    value: 'https', 
    label: 'HTTPS', 
    description: 'Monitor HTTPS endpoints with SSL certificate checking',
    example: 'https://api.example.com/health'
  },
  { 
    value: 'http', 
    label: 'HTTP', 
    description: 'Monitor HTTP endpoints for basic availability',
    example: 'http://internal.service.com:8080/status'
  },
  { 
    value: 'tcp', 
    label: 'TCP', 
    description: 'Check if a TCP port is accepting connections',
    example: 'database.example.com:5432'
  },
  { 
    value: 'ping', 
    label: 'Ping', 
    description: 'Send ICMP ping packets to check network connectivity',
    example: '8.8.8.8 or server.example.com'
  }
];

const HTTP_METHODS = ['GET', 'POST', 'HEAD', 'PUT', 'DELETE'];
const CHECK_INTERVALS = [
  { value: 60, label: '1 minute' },
  { value: 180, label: '3 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' }
];

export default function AddServicePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    type: 'https',
    method: 'GET',
    interval: 300,
    timeout: 30,
    expected_status: 200,
    expected_body: '',
    headers: {}
  });
  const [errors, setErrors] = useState({});
  const [customHeaders, setCustomHeaders] = useState([{ key: '', value: '' }]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleHeaderChange = (index, field, value) => {
    const newHeaders = [...customHeaders];
    newHeaders[index][field] = value;
    setCustomHeaders(newHeaders);
    
    // Update formData headers
    const headersObj = {};
    newHeaders.forEach(header => {
      if (header.key && header.value) {
        headersObj[header.key] = header.value;
      }
    });
    setFormData(prev => ({ ...prev, headers: headersObj }));
  };

  const addHeader = () => {
    setCustomHeaders([...customHeaders, { key: '', value: '' }]);
  };

  const removeHeader = (index) => {
    const newHeaders = customHeaders.filter((_, i) => i !== index);
    setCustomHeaders(newHeaders);
    
    // Update formData headers
    const headersObj = {};
    newHeaders.forEach(header => {
      if (header.key && header.value) {
        headersObj[header.key] = header.value;
      }
    });
    setFormData(prev => ({ ...prev, headers: headersObj }));
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Service name is required';
    }

    if (!formData.url.trim()) {
      newErrors.url = 'URL/Endpoint is required';
    } else {
      // Basic URL validation based on type
      const url = formData.url.trim();
      switch (formData.type) {
        case 'https':
          if (!url.startsWith('https://')) {
            newErrors.url = 'HTTPS URLs must start with https://';
          }
          break;
        case 'http':
          if (!url.startsWith('http://')) {
            newErrors.url = 'HTTP URLs must start with http://';
          }
          break;
        case 'tcp':
          if (!/^[\w.-]+:\d+$/.test(url)) {
            newErrors.url = 'TCP format should be hostname:port (e.g., database.com:5432)';
          }
          break;
        case 'ping':
          // Basic hostname/IP validation
          if (!/^[\w.-]+$/.test(url) && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url)) {
            newErrors.url = 'Enter a valid hostname or IP address';
          }
          break;
      }
    }

    if (formData.interval < 60) {
      newErrors.interval = 'Check interval must be at least 60 seconds';
    }

    if (formData.timeout < 1 || formData.timeout > 300) {
      newErrors.timeout = 'Timeout must be between 1 and 300 seconds';
    }

    if ((formData.type === 'http' || formData.type === 'https') && 
        (formData.expected_status < 100 || formData.expected_status > 599)) {
      newErrors.expected_status = 'Expected status code must be between 100 and 599';
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
      // const result = await apiClient.createService(formData);
      console.log('Creating service:', formData);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // TODO: Show success notification
      router.push('/uptime');
    } catch (error) {
      console.error('Failed to create service:', error);
      setErrors({ submit: 'Failed to create service. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  const isHttpType = formData.type === 'http' || formData.type === 'https';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link 
          href="/uptime"
          className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Add Service</h1>
          <p className="text-gray-600 dark:text-gray-400">Set up monitoring for a new service or endpoint</p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 space-y-6">
        {/* Basic Information */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Basic Information</h2>
          
          {/* Service Name */}
          <div className="space-y-2 mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Service Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                errors.name ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
              }`}
              placeholder="e.g., Main API, Database, Frontend App"
            />
            {errors.name && (
              <p className="text-sm text-red-600 dark:text-red-400">{errors.name}</p>
            )}
          </div>

          {/* Service Type */}
          <div className="space-y-3 mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Service Type *
            </label>
            {SERVICE_TYPES.map((type) => (
              <label key={type.value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="type"
                  value={type.value}
                  checked={formData.type === type.value}
                  onChange={(e) => handleInputChange('type', e.target.value)}
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900 dark:text-white">{type.label}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">{type.description}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-500 font-mono mt-1">
                    Example: {type.example}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* URL/Endpoint */}
          <div className="space-y-2 mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {formData.type === 'ping' ? 'Hostname/IP Address' : 'URL/Endpoint'} *
            </label>
            <input
              type="text"
              value={formData.url}
              onChange={(e) => handleInputChange('url', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono ${
                errors.url ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
              }`}
              placeholder={SERVICE_TYPES.find(t => t.value === formData.type)?.example}
            />
            {errors.url && (
              <p className="text-sm text-red-600 dark:text-red-400">{errors.url}</p>
            )}
          </div>
        </div>

        {/* HTTP-specific settings */}
        {isHttpType && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">HTTP Settings</h2>
            
            {/* HTTP Method */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                HTTP Method
              </label>
              <select
                value={formData.method}
                onChange={(e) => handleInputChange('method', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {HTTP_METHODS.map(method => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
            </div>

            {/* Expected Status Code */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Expected Status Code
              </label>
              <input
                type="number"
                min="100"
                max="599"
                value={formData.expected_status}
                onChange={(e) => handleInputChange('expected_status', parseInt(e.target.value) || 200)}
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.expected_status ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
              {errors.expected_status && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.expected_status}</p>
              )}
            </div>

            {/* Expected Body Content */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Expected Body Content (optional)
              </label>
              <input
                type="text"
                value={formData.expected_body}
                onChange={(e) => handleInputChange('expected_body', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Text that should be present in the response"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                If specified, the response body must contain this text for the check to pass
              </p>
            </div>

            {/* Custom Headers */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Custom Headers (optional)
              </label>
              {customHeaders.map((header, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={header.key}
                    onChange={(e) => handleHeaderChange(index, 'key', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Header name"
                  />
                  <input
                    type="text"
                    value={header.value}
                    onChange={(e) => handleHeaderChange(index, 'value', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Header value"
                  />
                  {customHeaders.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeHeader(index)}
                      className="px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addHeader}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                + Add Header
              </button>
            </div>
          </div>
        )}

        {/* Monitoring Settings */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Monitoring Settings</h2>
          
          {/* Check Interval */}
          <div className="space-y-2 mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Check Interval
            </label>
            <select
              value={formData.interval}
              onChange={(e) => handleInputChange('interval', parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {CHECK_INTERVALS.map(interval => (
                <option key={interval.value} value={interval.value}>{interval.label}</option>
              ))}
            </select>
          </div>

          {/* Timeout */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Timeout (seconds)
            </label>
            <input
              type="number"
              min="1"
              max="300"
              value={formData.timeout}
              onChange={(e) => handleInputChange('timeout', parseInt(e.target.value) || 30)}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                errors.timeout ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
              }`}
            />
            {errors.timeout && (
              <p className="text-sm text-red-600 dark:text-red-400">{errors.timeout}</p>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Maximum time to wait for a response (1-300 seconds)
            </p>
          </div>
        </div>

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
                Add Service
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
