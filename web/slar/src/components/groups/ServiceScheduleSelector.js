'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';

export default function ServiceScheduleSelector({ 
  groupId, 
  selectedScope, 
  selectedServiceId, 
  onScopeChange, 
  onServiceChange,
  session 
}) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (groupId && session?.access_token) {
      fetchGroupServices();
    }
  }, [groupId, session]);

  const fetchGroupServices = async () => {
    setLoading(true);
    try {
      apiClient.setToken(session.access_token);
      const response = await apiClient.getGroupServices(groupId);
      setServices(response.services || []);
    } catch (error) {
      console.error('Failed to fetch services:', error);
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  const handleScopeChange = (newScope) => {
    onScopeChange(newScope);
    
    // Reset service selection when changing to group scope
    if (newScope === 'group') {
      onServiceChange(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Schedule Scope Selection */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
          Schedule Scope <span className="text-red-500">*</span>
        </label>
        <div className="space-y-2">
          {/* Group-wide option */}
          <label className="flex items-center">
            <input
              type="radio"
              name="scheduleScope"
              value="group"
              checked={selectedScope === 'group'}
              onChange={(e) => handleScopeChange(e.target.value)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Group-wide Schedule
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Applies to all services in this group (fallback/default schedule)
              </div>
            </div>
          </label>

          {/* Service-specific option */}
          <label className="flex items-center">
            <input
              type="radio"
              name="scheduleScope"
              value="service"
              checked={selectedScope === 'service'}
              onChange={(e) => handleScopeChange(e.target.value)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Service-specific Schedule
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Applies only to a specific service (overrides group schedule)
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Service Selection (only show when service scope is selected) */}
      {selectedScope === 'service' && (
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            Select Service <span className="text-red-500">*</span>
          </label>
          
          {loading ? (
            <div className="animate-pulse">
              <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
            </div>
          ) : services.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              No services found in this group. 
              <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline ml-1">
                Create a service first
              </a>
            </div>
          ) : (
            <select
              value={selectedServiceId || ''}
              onChange={(e) => onServiceChange(e.target.value || null)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required={selectedScope === 'service'}
            >
              <option value="">Select a service...</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                  {service.description && ` - ${service.description}`}
                </option>
              ))}
            </select>
          )}
          
          {selectedServiceId && (
            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start">
                <svg className="w-4 h-4 text-blue-500 mt-0.5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-xs text-blue-700 dark:text-blue-300">
                  <div className="font-medium mb-1">Service-specific Schedule Behavior:</div>
                  <ul className="space-y-1 list-disc list-inside ml-2">
                    <li>This schedule will only apply to alerts from the selected service</li>
                    <li>It will override any group-wide schedule for this service</li>
                    <li>Other services will continue using the group-wide schedule (if any)</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scope Preview */}
      <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Schedule Preview:
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {selectedScope === 'group' && (
            <>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 mr-2">
                Group Schedule
              </span>
              This schedule will be the default for all services in the group
            </>
          )}
          {selectedScope === 'service' && selectedServiceId && (
            <>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 mr-2">
                Service Schedule
              </span>
              This schedule will only apply to "{services.find(s => s.id === selectedServiceId)?.name}" service
            </>
          )}
          {selectedScope === 'service' && !selectedServiceId && (
            <span className="text-gray-400 italic">Please select a service</span>
          )}
        </div>
      </div>
    </div>
  );
}
