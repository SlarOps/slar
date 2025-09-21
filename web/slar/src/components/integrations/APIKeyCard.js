'use client';

import { useState } from 'react';

function getEnvironmentColor(environment) {
  switch (environment) {
    case 'prod': return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800';
    case 'dev': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800';
    case 'test': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800';
    default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
  }
}

function formatLastUsed(dateString) {
  if (!dateString) return 'Never used';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function formatExpiry(dateString) {
  if (!dateString) return 'No expiry';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date - now;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return 'Expired';
  if (diffDays === 0) return 'Expires today';
  if (diffDays === 1) return 'Expires tomorrow';
  if (diffDays < 30) return `Expires in ${diffDays} days`;
  return `Expires ${date.toLocaleDateString()}`;
}

export default function APIKeyCard({ apiKey, onEdit, onDelete, onToggleStatus, onViewUsage, onRegenerate }) {
  const [showActions, setShowActions] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  const handleAction = async (action) => {
    setActionLoading(action);
    try {
      switch (action) {
        case 'edit':
          onEdit(apiKey.id);
          break;
        case 'regenerate':
          await onRegenerate(apiKey.id);
          break;
        case 'delete':
          await onDelete(apiKey.id);
          break;
        case 'toggle':
          await onToggleStatus(apiKey.id, !apiKey.is_active);
          break;
        case 'usage':
          onViewUsage(apiKey.id);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error(`Failed to ${action} API key:`, error);
    } finally {
      setActionLoading('');
      setShowActions(false);
    }
  };

  const isExpiringSoon = apiKey.expires_at && new Date(apiKey.expires_at) - new Date() < 7 * 24 * 60 * 60 * 1000;
  const isExpired = apiKey.expires_at && new Date(apiKey.expires_at) < new Date();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${getEnvironmentColor(apiKey.environment)}`}>
              {apiKey.environment.toUpperCase()}
            </span>
            <div className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
              apiKey.is_active && !isExpired
                ? 'text-green-600 bg-green-100 dark:bg-green-900/30' 
                : 'text-gray-600 bg-gray-100 dark:bg-gray-900/30'
            }`}>
              {isExpired ? 'Expired' : apiKey.is_active ? 'Active' : 'Inactive'}
            </div>
            {isExpiringSoon && !isExpired && (
              <div className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30">
                Expiring Soon
              </div>
            )}
          </div>
          
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 line-clamp-1">
            {apiKey.name}
          </h3>
          
          {apiKey.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
              {apiKey.description}
            </p>
          )}
        </div>

        {/* Actions Menu */}
        <div className="relative ml-2">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="API key actions"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>

          {showActions && (
            <div className="absolute right-0 top-8 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
              <button
                onClick={() => handleAction('usage')}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                View Usage
              </button>
              <button
                onClick={() => handleAction('edit')}
                disabled={actionLoading === 'edit'}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Edit API Key
              </button>
              <button
                onClick={() => handleAction('toggle')}
                disabled={actionLoading === 'toggle'}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {apiKey.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <hr className="border-gray-200 dark:border-gray-700" />
              <button
                onClick={() => handleAction('regenerate')}
                disabled={actionLoading === 'regenerate'}
                className="w-full px-4 py-2 text-left text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'regenerate' ? 'Regenerating...' : '🔄 Regenerate Key'}
              </button>
              <button
                onClick={() => handleAction('delete')}
                disabled={actionLoading === 'delete'}
                className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'delete' ? 'Deleting...' : 'Delete API Key'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Permissions */}
      <div className="mb-3">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">Permissions:</span>
        <div className="flex flex-wrap gap-1">
          {apiKey.permissions && apiKey.permissions.length > 0 ? (
            apiKey.permissions.map((permission) => (
              <span 
                key={permission}
                className="inline-flex px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
              >
                {permission.replace('_', ' ')}
              </span>
            ))
          ) : (
            <span className="text-xs text-gray-500 dark:text-gray-400">No permissions</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Requests</span>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {apiKey.total_requests || 0}
          </p>
        </div>
        <div>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Alerts Created</span>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {apiKey.total_alerts_created || 0}
          </p>
        </div>
      </div>

      {/* Rate Limits */}
      {(apiKey.rate_limit_per_hour || apiKey.rate_limit_per_day) && (
        <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-700 rounded">
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Rate Limits:</div>
          <div className="flex gap-4 text-xs text-gray-600 dark:text-gray-400">
            {apiKey.rate_limit_per_hour && (
              <span>{apiKey.rate_limit_per_hour}/hour</span>
            )}
            {apiKey.rate_limit_per_day && (
              <span>{apiKey.rate_limit_per_day}/day</span>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="space-y-1">
          <div>Last used: {formatLastUsed(apiKey.last_used_at)}</div>
          <div>Created: {new Date(apiKey.created_at).toLocaleDateString()}</div>
        </div>
        {apiKey.expires_at && (
          <div className={`text-right ${
            isExpired ? 'text-red-600 dark:text-red-400' : 
            isExpiringSoon ? 'text-yellow-600 dark:text-yellow-400' : ''
          }`}>
            {formatExpiry(apiKey.expires_at)}
          </div>
        )}
      </div>

      {/* Click overlay to close actions */}
      {showActions && (
        <div 
          className="fixed inset-0 z-0" 
          onClick={() => setShowActions(false)}
        />
      )}
    </div>
  );
}
