'use client';

import { useState, useEffect } from 'react';
import AlertCard from './AlertCard';
import { apiClient } from '../../lib/api';

// Enhanced mock data with labels
const MOCK_ALERTS = [
  {
    id: '1',
    title: 'High CPU Usage',
    description: 'CPU usage has exceeded 80% for more than 5 minutes on web-01',
    severity: 'critical',
    status: 'firing',
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    source: 'prometheus',
    labels: {
      alertname: 'HighCPUUsage',
      instance: 'web-01',
      job: 'web-server',
      environment: 'production',
      service: 'web',
      team: 'platform',
      cluster: 'production'
    },
    assigned_to: 'user1',
    assigned_to_name: 'John Doe'
  },
  {
    id: '2',
    title: 'Database Connection Pool Exhausted',
    description: 'All database connections are in use. New requests are being queued.',
    severity: 'high',
    status: 'acknowledged',
    created_at: '2024-01-15T09:45:00Z',
    updated_at: '2024-01-15T10:15:00Z',
    source: 'alertmanager',
    labels: {
      alertname: 'DatabaseConnectionPoolExhausted',
      instance: 'db-01',
      job: 'database',
      environment: 'production',
      service: 'database',
      team: 'backend',
      cluster: 'production'
    },
    acked_by: 'Jane Smith',
    acked_at: '2024-01-15T10:15:00Z'
  },
  {
    id: '3',
    title: 'Disk Space Low',
    description: 'Available disk space is below 15% on redis-01',
    severity: 'medium',
    status: 'firing',
    created_at: '2024-01-15T09:00:00Z',
    updated_at: '2024-01-15T09:00:00Z',
    source: 'prometheus',
    labels: {
      alertname: 'DiskSpaceLow',
      instance: 'redis-01',
      job: 'redis',
      environment: 'production',
      service: 'redis',
      team: 'platform',
      cluster: 'production'
    }
  },
  {
    id: '4',
    title: 'API Response Time High',
    description: 'API response time has exceeded 2 seconds for the last 10 minutes',
    severity: 'medium',
    status: 'firing',
    created_at: '2024-01-15T08:30:00Z',
    updated_at: '2024-01-15T08:30:00Z',
    source: 'datadog',
    labels: {
      alertname: 'APIResponseTimeHigh',
      instance: 'api-01',
      job: 'api-server',
      environment: 'production',
      service: 'api',
      team: 'backend',
      cluster: 'production'
    }
  },
  {
    id: '5',
    title: 'Memory Usage Warning',
    description: 'Memory usage is approaching 85% on staging environment',
    severity: 'low',
    status: 'resolved',
    created_at: '2024-01-14T16:20:00Z',
    updated_at: '2024-01-14T18:45:00Z',
    source: 'prometheus',
    labels: {
      alertname: 'MemoryUsageWarning',
      instance: 'staging-web-01',
      job: 'web-server',
      environment: 'staging',
      service: 'web',
      team: 'frontend',
      cluster: 'staging'
    }
  },
  {
    id: '6',
    title: 'SSL Certificate Expiring',
    description: 'SSL certificate for api.example.com will expire in 7 days',
    severity: 'medium',
    status: 'firing',
    created_at: '2024-01-14T12:00:00Z',
    updated_at: '2024-01-14T12:00:00Z',
    source: 'custom',
    labels: {
      alertname: 'SSLCertificateExpiring',
      domain: 'api.example.com',
      environment: 'production',
      service: 'api',
      team: 'devops',
      cluster: 'production'
    }
  }
];

function filterAlerts(alerts, filters) {
  return alerts.filter(alert => {
    // Search filter
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      const matchesSearch = 
        alert.title.toLowerCase().includes(searchTerm) ||
        alert.description.toLowerCase().includes(searchTerm) ||
        Object.values(alert.labels || {}).some(value => 
          value.toLowerCase().includes(searchTerm)
        );
      if (!matchesSearch) return false;
    }

    // Severity filter
    if (filters.severity && alert.severity !== filters.severity) {
      return false;
    }

    // Status filter
    if (filters.status && alert.status !== filters.status) {
      return false;
    }

    // Label filters
    if (filters.labels) {
      for (const [labelKey, labelValue] of Object.entries(filters.labels)) {
        if (!alert.labels || alert.labels[labelKey] !== labelValue) {
          return false;
        }
      }
    }

    return true;
  });
}

function sortAlerts(alerts, sortBy) {
  const sorted = [...alerts];
  
  switch (sortBy) {
    case 'created_at_desc':
      return sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    case 'created_at_asc':
      return sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    case 'severity_desc':
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
      return sorted.sort((a, b) => (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0));
    case 'severity_asc':
      const severityOrderAsc = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
      return sorted.sort((a, b) => (severityOrderAsc[a.severity] || 0) - (severityOrderAsc[b.severity] || 0));
    case 'title_asc':
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case 'title_desc':
      return sorted.sort((a, b) => b.title.localeCompare(a.title));
    default:
      return sorted;
  }
}

function groupAlertsByLabel(alerts, groupBy) {
  if (!groupBy || !alerts.length) return { ungrouped: alerts };
  
  const groups = {};
  const ungrouped = [];
  
  alerts.forEach(alert => {
    const labelValue = alert.labels?.[groupBy];
    if (labelValue) {
      if (!groups[labelValue]) {
        groups[labelValue] = [];
      }
      groups[labelValue].push(alert);
    } else {
      ungrouped.push(alert);
    }
  });
  
  if (ungrouped.length > 0) {
    groups['ungrouped'] = ungrouped;
  }
  
  return groups;
}

export default function AlertsList({ filters, onAlertAction, limit, showGrouping = true, session, loading: parentLoading }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [groupBy, setGroupBy] = useState('');

  useEffect(() => {
    const fetchAlerts = async () => {
      if (!session?.access_token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      
      try {
        // Set authentication token
        apiClient.setToken(session.access_token);
        
        // Fetch alerts from API
        const data = await apiClient.getAlerts(filters);
        
        let fetchedAlerts = data.alerts || [];
        
        // Apply client-side sorting if needed
        fetchedAlerts = sortAlerts(fetchedAlerts, filters.sort);
        
        if (limit) {
          fetchedAlerts = fetchedAlerts.slice(0, limit);
        }
        
        setAlerts(fetchedAlerts);
      } catch (err) {
        console.error('Failed to fetch alerts:', err);
        setError(err.message);
        // Fallback to mock data for demonstration
        let filteredAlerts = filterAlerts(MOCK_ALERTS, filters);
        filteredAlerts = sortAlerts(filteredAlerts, filters.sort);
        
        if (limit) {
          filteredAlerts = filteredAlerts.slice(0, limit);
        }
        
        setAlerts(filteredAlerts);
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();
  }, [filters, limit, session]);

  const handleAlertAction = async (action, alertId) => {
    if (!session?.access_token) {
      console.error('No authentication token available');
      return;
    }

    try {
      apiClient.setToken(session.access_token);
      
      if (action === 'acknowledge') {
        // Call API to acknowledge alert
        await apiClient.acknowledgeAlert(alertId);
        
        // Optimistically update UI
        setAlerts(prev => prev.map(alert => 
          alert.id === alertId 
            ? { ...alert, status: 'acked', acked_by: 'Current User', acked_at: new Date().toISOString() }
            : alert
        ));
      } else if (action === 'resolve') {
        // Call API to close/resolve alert
        await apiClient.resolveAlert(alertId);
        
        setAlerts(prev => prev.map(alert => 
          alert.id === alertId 
            ? { ...alert, status: 'closed', updated_at: new Date().toISOString() }
            : alert
        ));
      }
    } catch (err) {
      console.error(`Failed to ${action} alert:`, err);
      // Could show a toast notification here
      setError(`Failed to ${action} alert: ${err.message}`);
    }
    
    onAlertAction(action, alertId);
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="animate-pulse space-y-3">
                <div className="flex gap-2">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
                </div>
                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
                <div className="flex gap-2">
                  {[1, 2, 3].map((j) => (
                    <div key={j} className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const groupedAlerts = groupBy ? groupAlertsByLabel(alerts, groupBy) : { all: alerts };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Alerts {!limit && `(${alerts.length})`}
          </h2>
          
          {showGrouping && alerts.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Group by:</span>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">No grouping</option>
                <option value="environment">Environment</option>
                <option value="service">Service</option>
                <option value="team">Team</option>
                <option value="cluster">Cluster</option>
                <option value="severity">Severity</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Error Display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="ml-3">
                <p className="text-sm text-red-700 dark:text-red-300">
                  Failed to load alerts from API: {error}. Showing mock data instead.
                </p>
              </div>
            </div>
          </div>
        )}

        {alerts.length === 0 && !loading ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="mb-2">No alerts found matching your filters.</p>
            <p className="text-sm">Try adjusting your search criteria or clearing filters.</p>
          </div>
        ) : alerts.length > 0 ? (
          <div className="space-y-6">
            {Object.entries(groupedAlerts).map(([groupName, groupAlerts]) => (
              <div key={groupName}>
                {/* Group Header */}
                {groupBy && Object.keys(groupedAlerts).length > 1 && (
                  <div className="mb-3">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {groupName === 'ungrouped' ? 'Ungrouped' : `${groupBy}: ${groupName}`}
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        ({groupAlerts.length} alert{groupAlerts.length !== 1 ? 's' : ''})
                      </span>
                    </h3>
                  </div>
                )}
                
                {/* Alert Cards */}
                <div className="space-y-3">
                  {groupAlerts.map((alert) => (
                    <AlertCard
                      key={alert.id}
                      alert={alert}
                      onAcknowledge={(id) => handleAlertAction('acknowledge', id)}
                      onResolve={(id) => handleAlertAction('resolve', id)}
                      onViewDetails={(id) => handleAlertAction('view', id)}
                      showLabels={true}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}