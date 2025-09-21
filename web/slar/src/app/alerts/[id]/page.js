'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// Mock detailed alert data
const MOCK_ALERT_DETAIL = {
  id: '1',
  title: 'High CPU Usage on Production Server',
  description: 'CPU usage has exceeded 90% for more than 5 minutes on prod-web-01. This may impact application performance and user experience.',
  severity: 'critical',
  status: 'firing',
  source: 'Prometheus',
  created_at: '2024-01-15T10:30:00Z',
  updated_at: '2024-01-15T10:35:00Z',
  labels: {
    instance: 'prod-web-01',
    service: 'web-server',
    datacenter: 'us-east-1',
    team: 'platform',
    environment: 'production'
  },
  annotations: {
    summary: 'High CPU usage detected',
    description: 'CPU usage on {{ $labels.instance }} has exceeded 90% for 5 minutes',
    runbook_url: 'https://runbooks.example.com/high-cpu'
  },
  history: [
    {
      timestamp: '2024-01-15T10:35:00Z',
      action: 'state_change',
      details: 'Alert continues firing',
      user: 'system'
    },
    {
      timestamp: '2024-01-15T10:30:00Z',
      action: 'created',
      details: 'Alert created',
      user: 'prometheus'
    }
  ]
};

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

function formatDateTime(timeString) {
  const date = new Date(timeString);
  return date.toLocaleString();
}

export default function AlertDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState('');

  useEffect(() => {
    const fetchAlert = async () => {
      try {
        // TODO: Replace with actual API call
        // const data = await apiClient.getAlert(params.id);
        setTimeout(() => {
          setAlert(MOCK_ALERT_DETAIL);
          setLoading(false);
        }, 800);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    if (params.id) {
      fetchAlert();
    }
  }, [params.id]);

  const handleAction = async (action) => {
    setActionLoading(action);
    try {
      // TODO: Implement API calls
      if (action === 'acknowledge') {
        // await apiClient.acknowledgeAlert(params.id);
        setAlert(prev => ({
          ...prev,
          status: 'acked',
          acked_by: 'current-user@example.com',
          acked_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));
      } else if (action === 'resolve') {
        // await apiClient.resolveAlert(params.id);
        setAlert(prev => ({
          ...prev,
          status: 'resolved',
          updated_at: new Date().toISOString()
        }));
      }
    } catch (error) {
      console.error(`Failed to ${action} alert:`, error);
    } finally {
      setActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse"></div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
            <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link 
            href="/alerts"
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Alert Details</h1>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
          <div className="text-red-600 dark:text-red-400 mb-2">
            <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Error loading alert
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const canAcknowledge = alert.status === 'firing';
  const canResolve = alert.status === 'firing' || alert.status === 'acked';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link 
          href="/alerts"
          className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Alert Details</h1>
      </div>

      {/* Alert Info */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${getSeverityColor(alert.severity)}`}>
                {alert.severity}
              </span>
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(alert.status)}`}>
                {alert.status}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Source: {alert.source}
              </span>
            </div>
            
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              {alert.title}
            </h2>
            
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {alert.description}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">Created:</span>
                <span className="ml-2 text-gray-500 dark:text-gray-400">{formatDateTime(alert.created_at)}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">Last Updated:</span>
                <span className="ml-2 text-gray-500 dark:text-gray-400">{formatDateTime(alert.updated_at)}</span>
              </div>
              {alert.acked_by && alert.acked_at && (
                <>
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Acknowledged by:</span>
                    <span className="ml-2 text-gray-500 dark:text-gray-400">{alert.acked_by}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Acknowledged at:</span>
                    <span className="ml-2 text-gray-500 dark:text-gray-400">{formatDateTime(alert.acked_at)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 ml-4">
            {canAcknowledge && (
              <button
                onClick={() => handleAction('acknowledge')}
                disabled={actionLoading === 'acknowledge'}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 dark:text-yellow-300 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50 border border-yellow-200 dark:border-yellow-800 rounded transition-colors disabled:opacity-50"
              >
                {actionLoading === 'acknowledge' ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                Acknowledge
              </button>
            )}
            
            {canResolve && (
              <button
                onClick={() => handleAction('resolve')}
                disabled={actionLoading === 'resolve'}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 dark:text-green-300 dark:bg-green-900/30 dark:hover:bg-green-900/50 border border-green-200 dark:border-green-800 rounded transition-colors disabled:opacity-50"
              >
                {actionLoading === 'resolve' ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                Resolve
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Labels and Annotations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Labels */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Labels</h3>
          {alert.labels && Object.keys(alert.labels).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(alert.labels).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">{key}:</span>
                  <span className="text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">No labels</p>
          )}
        </div>

        {/* Annotations */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Annotations</h3>
          {alert.annotations && Object.keys(alert.annotations).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(alert.annotations).map(([key, value]) => (
                <div key={key}>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 block">{key}:</span>
                  {key === 'runbook_url' ? (
                    <a 
                      href={value} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline break-all"
                    >
                      {value}
                    </a>
                  ) : (
                    <span className="text-sm text-gray-500 dark:text-gray-400 break-words">{value}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">No annotations</p>
          )}
        </div>
      </div>

      {/* History */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">History</h3>
        {alert.history && alert.history.length > 0 ? (
          <div className="space-y-3">
            {alert.history.map((entry, index) => (
              <div key={index} className="flex items-start gap-3 pb-3 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0"></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {entry.action.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      by {entry.user}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{entry.details}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {formatDateTime(entry.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">No history available</p>
        )}
      </div>
    </div>
  );
}
