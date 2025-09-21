'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function getStatusColor(status) {
  switch (status) {
    case 'up': return 'text-green-600 bg-green-100 dark:bg-green-900/30';
    case 'down': return 'text-red-600 bg-red-100 dark:bg-red-900/30';
    case 'timeout': return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30';
    case 'error': return 'text-gray-600 bg-gray-100 dark:bg-gray-900/30';
    default: return 'text-gray-600 bg-gray-100 dark:bg-gray-900/30';
  }
}

function getStatusIcon(status) {
  switch (status) {
    case 'up':
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      );
    case 'down':
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      );
    case 'timeout':
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
      );
    case 'error':
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      );
    default:
      return null;
  }
}

function getTypeColor(type) {
  switch (type) {
    case 'https': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800';
    case 'http': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800';
    case 'tcp': return 'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-900/30 dark:border-purple-800';
    case 'ping': return 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:bg-yellow-900/30 dark:border-yellow-800';
    default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
  }
}

function formatResponseTime(responseTime) {
  if (responseTime < 1000) return `${responseTime}ms`;
  return `${(responseTime / 1000).toFixed(2)}s`;
}

function formatUptime(uptime) {
  return `${uptime.toFixed(2)}%`;
}

function formatLastCheck(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

export default function ServiceCard({ service, onEdit, onDelete, onToggleStatus, onCheckNow }) {
  const router = useRouter();
  const [showActions, setShowActions] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  const handleAction = async (action) => {
    setActionLoading(action);
    try {
      switch (action) {
        case 'edit':
          onEdit(service.id);
          break;
        case 'delete':
          await onDelete(service.id);
          break;
        case 'toggle':
          await onToggleStatus(service.id, !service.is_enabled);
          break;
        case 'check':
          await onCheckNow(service.id);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error(`Failed to ${action} service:`, error);
    } finally {
      setActionLoading('');
      setShowActions(false);
    }
  };

  const handleViewDetails = () => {
    router.push(`/uptime/${service.id}`);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${getTypeColor(service.type)}`}>
              {service.type.toUpperCase()}
            </span>
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(service.last_status)}`}>
              {getStatusIcon(service.last_status)}
              {service.last_status || 'Unknown'}
            </div>
            <div className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
              service.is_enabled 
                ? 'text-green-600 bg-green-100 dark:bg-green-900/30' 
                : 'text-gray-600 bg-gray-100 dark:bg-gray-900/30'
            }`}>
              {service.is_enabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>
          
          <h3 
            className="text-lg font-semibold text-gray-900 dark:text-white mb-1 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 line-clamp-1"
            onClick={handleViewDetails}
          >
            {service.name}
          </h3>
          
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 font-mono break-all">
            {service.url}
          </p>
        </div>

        {/* Actions Menu */}
        <div className="relative ml-2">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Service actions"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>

          {showActions && (
            <div className="absolute right-0 top-8 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
              <button
                onClick={handleViewDetails}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                View Details
              </button>
              <button
                onClick={() => handleAction('check')}
                disabled={actionLoading === 'check'}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'check' ? 'Checking...' : 'Check Now'}
              </button>
              <button
                onClick={() => handleAction('edit')}
                disabled={actionLoading === 'edit'}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Edit Service
              </button>
              <button
                onClick={() => handleAction('toggle')}
                disabled={actionLoading === 'toggle'}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {service.is_enabled ? 'Disable' : 'Enable'}
              </button>
              <hr className="border-gray-200 dark:border-gray-700" />
              <button
                onClick={() => handleAction('delete')}
                disabled={actionLoading === 'delete'}
                className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'delete' ? 'Deleting...' : 'Delete Service'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Service Stats */}
      <div className="grid grid-cols-3 gap-4 mb-3">
        <div>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Uptime</span>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {service.uptime_percentage ? formatUptime(service.uptime_percentage) : 'N/A'}
          </p>
        </div>
        <div>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Response</span>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {service.last_response_time ? formatResponseTime(service.last_response_time) : 'N/A'}
          </p>
        </div>
        <div>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Interval</span>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {service.interval ? `${Math.floor(service.interval / 60)}m` : 'N/A'}
          </p>
        </div>
      </div>

      {/* SSL Certificate Info (for HTTPS) */}
      {service.type === 'https' && service.ssl_expiry && (
        <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-700 rounded">
          <div className="flex items-center gap-2 text-xs">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="font-medium text-gray-700 dark:text-gray-300">SSL:</span>
            <span className={`font-medium ${
              service.ssl_days_left > 30 
                ? 'text-green-600 dark:text-green-400'
                : service.ssl_days_left > 7
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              {service.ssl_days_left} days left
            </span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-3 border-t border-gray-200 dark:border-gray-700">
        <span>
          Last check: {service.last_checked_at ? formatLastCheck(service.last_checked_at) : 'Never'}
        </span>
        {service.last_status === 'down' && service.incident_count > 0 && (
          <span className="text-red-600 dark:text-red-400 font-medium">
            {service.incident_count} incident{service.incident_count !== 1 ? 's' : ''}
          </span>
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
