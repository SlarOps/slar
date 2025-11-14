'use client';

import EscalationPolicyCard from './EscalationPolicyCard';

export default function EscalationPoliciesList({ 
  policies = [], 
  onEdit, 
  onDelete, 
  onViewUsage, 
  loading = false 
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-4"></div>
              <div className="flex gap-2">
                <div className="h-7 sm:h-8 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                <div className="h-7 sm:h-8 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (policies.length === 0) {
    return (
      <div className="text-center py-8 sm:py-12 px-4">
        <svg className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 17h5l-5 5v-5zM4.343 4.343l1.414 1.414M20.657 4.343l-1.414 1.414M3 12h2m14 0h2M4.343 19.657l1.414-1.414M20.657 19.657l-1.414-1.414M12 3v2m0 14v2" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No escalation policies</h3>
        <p className="mt-1 text-xs sm:text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          Get started by creating your first escalation policy.
        </p>
        <div className="mt-4 sm:mt-6">
          <button
            onClick={() => onEdit && onEdit(null)} // Trigger create
            className="inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 border border-transparent shadow-sm text-xs sm:text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>Create Escalation Policy</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Stats Summary */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {policies.length} {policies.length === 1 ? 'Policy' : 'Policies'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {policies.filter(p => p.is_active).length} active
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Total services using policies: {policies.reduce((acc, p) => acc + (p.services_count || 0), 0)}
            </p>
          </div>
        </div>
      </div>

      {/* Policies Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {policies.map((policy) => (
          <EscalationPolicyCard
            key={policy.id}
            policy={policy}
            onEdit={onEdit}
            onDelete={onDelete}
            onViewUsage={onViewUsage}
          />
        ))}
      </div>
    </div>
  );
}
