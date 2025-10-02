'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MarkdownRenderer } from '../ui';

function getSeverityColor(severity) {
  switch (severity) {
    case 'critical': return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800';
    case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:bg-yellow-900/30 dark:border-yellow-800';
    case 'info': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800';
    default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
  }
}

function getStatusColor(status) {
  switch (status) {
    case 'firing': return 'text-red-600 bg-red-100 dark:bg-red-900/30';
    case 'acked': return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30';
    case 'resolved': return 'text-green-600 bg-green-100 dark:bg-green-900/30';
    default: return 'text-gray-600 bg-gray-100 dark:bg-gray-900/30';
  }
}

function formatTime(timeString) {
  const date = new Date(timeString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

function formatDateTime(timeString) {
  const date = new Date(timeString);
  return date.toLocaleString();
}

export default function AlertCard({ alert, onAcknowledge, onResolve, onViewDetails, showLabels = false }) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  const handleAction = async (action, alertId) => {
    setActionLoading(action);
    try {
      if (action === 'acknowledge') {
        await onAcknowledge(alertId);
      } else if (action === 'resolve') {
        await onResolve(alertId);
      }
    } catch (error) {
      console.error(`Failed to ${action} alert:`, error);
    } finally {
      setActionLoading('');
    }
  };

  const canAcknowledge = alert.status === 'new';
  const canResolve = alert.status === 'new' || alert.status === 'acked';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${getSeverityColor(alert.severity)}`}>
              {alert.severity}
            </span>
            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(alert.status)}`}>
              {alert.status}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {alert.source}
            </span>
          </div>
          
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1 line-clamp-2">
            {alert.title}
          </h3>
          
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Created {formatTime(alert.created_at)} • Updated {formatTime(alert.updated_at)}
          </p>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <svg 
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Description */}
      {alert.description && (
        <div className={`mb-3 ${isExpanded ? '' : 'line-clamp-3'}`}>
          <MarkdownRenderer
            content={alert.description}
            size="sm"
            className="text-sm text-gray-600 dark:text-gray-400"
          />
        </div>
      )}

      {/* Labels (show when labels exist and showLabels is true) */}
      {showLabels && alert.labels && Object.keys(alert.labels).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Labels:</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(alert.labels).map(([key, value]) => (
              <span 
                key={`${key}:${value}`}
                className="inline-flex px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border"
              >
                {key}={value}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-3">
          {/* Labels in expanded view (when not shown above) */}
          {!showLabels && alert.labels && Object.keys(alert.labels).length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Labels:</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(alert.labels).map(([key, value]) => (
                  <span 
                    key={`${key}:${value}`}
                    className="inline-flex px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border"
                  >
                    {key}={value}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Created:</span>
              <span className="ml-1 text-gray-500 dark:text-gray-400">{formatDateTime(alert.created_at)}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Updated:</span>
              <span className="ml-1 text-gray-500 dark:text-gray-400">{formatDateTime(alert.updated_at)}</span>
            </div>
          </div>

          {/* Acknowledgment Info */}
          {alert.acked_by && alert.acked_at && (
            <div className="text-xs">
              <span className="font-medium text-gray-700 dark:text-gray-300">Acknowledged by:</span>
              <span className="ml-1 text-gray-500 dark:text-gray-400">
                {alert.acked_by} on {formatDateTime(alert.acked_at)}
              </span>
            </div>
          )}

          {/* Labels */}
          {alert.labels && Object.keys(alert.labels).length > 0 && (
            <div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">Labels:</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(alert.labels).map(([key, value]) => (
                  <span 
                    key={key}
                    className="inline-flex px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
                  >
                    {key}: {value}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex gap-2">
          {canAcknowledge && (
            <button
              onClick={() => handleAction('acknowledge', alert.id)}
              disabled={actionLoading === 'acknowledge'}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 dark:text-yellow-300 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50 border border-yellow-200 dark:border-yellow-800 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading === 'acknowledge' ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              Acknowledge
            </button>
          )}
          
          {canResolve && (
            <button
              onClick={() => handleAction('resolve', alert.id)}
              disabled={actionLoading === 'resolve'}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 dark:text-green-300 dark:bg-green-900/30 dark:hover:bg-green-900/50 border border-green-200 dark:border-green-800 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading === 'resolve' ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              Resolve
            </button>
          )}
        </div>

        <button
          onClick={() => router.push(`/alerts/${alert.id}`)}
          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          View Details
        </button>
      </div>
    </div>
  );
}
