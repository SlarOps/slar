'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const MOCK_ALERTS = [
  {
    id: '1',
    title: 'High CPU Usage',
    severity: 'critical',
    status: 'firing',
    created_at: '2024-01-15T10:30:00Z',
    source: 'Prometheus'
  },
  {
    id: '2', 
    title: 'Database Connection Timeout',
    severity: 'warning',
    status: 'firing',
    created_at: '2024-01-15T09:15:00Z',
    source: 'App Monitor'
  },
  {
    id: '3',
    title: 'Disk Space Low',
    severity: 'warning', 
    status: 'resolved',
    created_at: '2024-01-15T08:45:00Z',
    source: 'System Monitor'
  }
];

function getSeverityColor(severity) {
  switch (severity) {
    case 'critical': return 'text-red-600 bg-red-50 border-red-200';
    case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    case 'info': return 'text-blue-600 bg-blue-50 border-blue-200';
    default: return 'text-gray-600 bg-gray-50 border-gray-200';
  }
}

function getStatusColor(status) {
  switch (status) {
    case 'firing': return 'text-red-600';
    case 'resolved': return 'text-green-600';
    case 'acked': return 'text-yellow-600';
    default: return 'text-gray-600';
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

export default function AlertsList({ limit = 5 }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Simulate API call
    const fetchAlerts = async () => {
      try {
        // TODO: Replace with actual API call
        // const data = await apiClient.getRecentAlerts(limit);
        setTimeout(() => {
          setAlerts(MOCK_ALERTS.slice(0, limit));
          setLoading(false);
        }, 1000);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchAlerts();
  }, [limit]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Alerts</h3>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Alerts</h3>
        <p className="text-red-600 dark:text-red-400">Error loading alerts: {error}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Alerts</h3>
        <Link 
          href="/alerts" 
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          View all
        </Link>
      </div>
      
      {alerts.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No recent alerts</p>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div 
              key={alert.id}
              className="flex items-start justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${getSeverityColor(alert.severity)}`}>
                    {alert.severity}
                  </span>
                  <span className={`text-xs font-medium ${getStatusColor(alert.status)}`}>
                    {alert.status}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {alert.title}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {alert.source} • {formatTime(alert.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
