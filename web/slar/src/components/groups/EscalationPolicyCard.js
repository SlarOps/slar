'use client';

export default function EscalationPolicyCard({ policy, onEdit, onDelete, onViewUsage }) {
  const formatTimeout = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  };

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800';
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-900/30 dark:border-orange-800';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:bg-yellow-900/30 dark:border-yellow-800';
      case 'low': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800';
      default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow duration-200">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h4 className="text-lg font-medium text-gray-900 dark:text-white truncate">
              {policy.name}
            </h4>
            {policy.description && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                {policy.description}
              </p>
            )}
          </div>
          
          {/* Status Badge */}
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            policy.is_active 
              ? 'text-green-800 bg-green-100 dark:bg-green-900/30 dark:text-green-400'
              : 'text-gray-800 bg-gray-100 dark:bg-gray-900/30 dark:text-gray-400'
          }`}>
            {policy.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Policy Details */}
        <div className="space-y-3 mb-4">
          {/* Escalation Levels */}
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Escalation Levels
            </p>
            <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {policy.max_escalation_levels || 3} levels
              <span className="mx-2">•</span>
              {formatTimeout(policy.escalation_timeout || 300)} timeout
            </div>
          </div>

          {/* Severity Levels */}
          {policy.severity_levels && policy.severity_levels.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Severity Levels
              </p>
              <div className="flex flex-wrap gap-1">
                {policy.severity_levels.slice(0, 3).map((severity, index) => (
                  <span
                    key={index}
                    className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${getSeverityColor(severity)}`}
                  >
                    {severity}
                  </span>
                ))}
                {policy.severity_levels.length > 3 && (
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 dark:bg-gray-900/30 dark:border-gray-700 dark:text-gray-400">
                    +{policy.severity_levels.length - 3} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Usage Stats */}
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Usage
            </p>
            <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              {policy.services_count || 0} {(policy.services_count || 0) === 1 ? 'service' : 'services'}
              {policy.services_count > 0 && (
                <>
                  <span className="mx-2">•</span>
                  <button 
                    onClick={() => onViewUsage(policy)}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300"
                  >
                    View details
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Created {new Date(policy.created_at).toLocaleDateString()}
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(policy)}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-xs font-medium rounded text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
            >
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            
            <button
              onClick={() => onDelete(policy.id)}
              className="inline-flex items-center px-3 py-1.5 border border-red-300 dark:border-red-600 text-xs font-medium rounded text-red-700 dark:text-red-300 bg-white dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 dark:focus:ring-offset-gray-800"
            >
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
