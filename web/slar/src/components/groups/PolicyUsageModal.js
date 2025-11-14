'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';

export default function PolicyUsageModal({ isOpen, onClose, policy, groupId }) {
  const { session } = useAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && policy?.id) {
      fetchPolicyUsage();
    }
  }, [isOpen, policy?.id]);

  const fetchPolicyUsage = async () => {
    if (!session?.access_token || !policy?.id) return;

    setLoading(true);
    setError(null);
    try {
      apiClient.setToken(session.access_token);
      // Get services that use this escalation policy
      const response = await apiClient.getServicesByEscalationPolicy(policy.id);
      setServices(response.services || []);
    } catch (error) {
      console.error('Failed to fetch policy usage:', error);
      setError('Failed to load policy usage');
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !policy) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="relative mx-auto border w-full max-w-2xl shadow-lg rounded-lg sm:rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-start sm:items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1 min-w-0">
            <h3 className="text-base sm:text-lg font-medium text-gray-900 dark:text-white truncate">
              Policy Usage: {policy.name}
            </h3>
            <p className="mt-1 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              Services currently using this escalation policy
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 p-1"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 sm:mt-6">
          {loading ? (
            /* Loading State */
            <div className="flex items-center justify-center py-6 sm:py-8">
              <div className="animate-spin rounded-full h-6 w-6 sm:h-8 sm:w-8 border-b-2 border-blue-600"></div>
              <span className="ml-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">Loading usage information...</span>
            </div>
          ) : error ? (
            /* Error State */
            <div className="text-center py-6 sm:py-8 px-4">
              <svg className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="mt-2 text-xs sm:text-sm font-medium text-gray-900 dark:text-white">Error loading usage data</h3>
              <p className="mt-1 text-xs sm:text-sm text-gray-500 dark:text-gray-400">{error}</p>
              <button
                onClick={fetchPolicyUsage}
                className="mt-4 text-xs sm:text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300"
              >
                Try again
              </button>
            </div>
          ) : services.length === 0 ? (
            /* Empty State */
            <div className="text-center py-6 sm:py-8 px-4">
              <svg className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              <h3 className="mt-2 text-xs sm:text-sm font-medium text-gray-900 dark:text-white">No services using this policy</h3>
              <p className="mt-1 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                This escalation policy is not currently assigned to any services.
              </p>
            </div>
          ) : (
            /* Services List */
            <div className="space-y-3 sm:space-y-4">
              {/* Summary */}
              <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 sm:p-4">
                <div className="flex items-start sm:items-center gap-2">
                  <svg className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5 sm:mt-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-blue-900 dark:text-blue-300">
                      {services.length} {services.length === 1 ? 'service is' : 'services are'} using this policy
                    </p>
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      Deleting this policy will affect these services
                    </p>
                  </div>
                </div>
              </div>

              {/* Services */}
              <div className="space-y-2 sm:space-y-3">
                {services.map((service) => (
                  <div
                    key={service.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                      {/* Service Icon */}
                      <div className="flex-shrink-0">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                          <svg className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                          </svg>
                        </div>
                      </div>

                      {/* Service Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">
                          {service.name}
                        </p>
                        {service.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {service.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center mt-1 gap-1 sm:gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className="truncate">Routing Key: {service.routing_key}</span>
                          {service.is_active ? (
                            <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 flex-shrink-0">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400 flex-shrink-0">
                              Inactive
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Service Stats */}
                    <div className="flex-shrink-0 text-left sm:text-right pl-9 sm:pl-0">
                      <div className="text-xs sm:text-sm text-gray-900 dark:text-white">
                        {service.alert_count || 0} alerts
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {service.incident_count || 0} incidents
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Warning */}
              {services.length > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-3 sm:p-4">
                  <div className="flex gap-2">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs sm:text-sm font-medium text-yellow-800 dark:text-yellow-300">
                        Impact Warning
                      </h4>
                      <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-200">
                        Modifying or deleting this escalation policy will affect all {services.length} service{services.length !== 1 ? 's' : ''} listed above.
                        Make sure to update their escalation settings before making changes.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-4 sm:pt-6 border-t border-gray-200 dark:border-gray-700 mt-4 sm:mt-6">
          <button
            onClick={onClose}
            className="px-3 sm:px-4 py-1.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
