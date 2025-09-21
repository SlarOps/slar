'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

const MOCK_INCIDENTS = [
  {
    id: '1',
    title: 'High CPU Usage on Production Servers',
    severity: 'critical',
    status: 'triggered',
    urgency: 'high',
    created_at: '2024-01-15T10:30:00Z',
    source: 'Prometheus',
    assigned_to_name: 'John Doe'
  },
  {
    id: '2', 
    title: 'Database Connection Pool Exhausted',
    severity: 'error',
    status: 'acknowledged',
    urgency: 'high',
    created_at: '2024-01-15T09:15:00Z',
    source: 'App Monitor',
    assigned_to_name: 'Jane Smith'
  },
  {
    id: '3',
    title: 'Disk Space Warning on Log Server',
    severity: 'warning', 
    status: 'resolved',
    urgency: 'low',
    created_at: '2024-01-15T08:45:00Z',
    source: 'System Monitor',
    resolved_by_name: 'Mike Johnson'
  }
];

function getSeverityColor(severity) {
  switch (severity) {
    case 'critical': return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800';
    case 'error': return 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800';
    case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800';
    case 'info': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800';
    default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600';
  }
}

function getStatusColor(status) {
  switch (status) {
    case 'triggered': return 'text-red-600 dark:text-red-400';
    case 'acknowledged': return 'text-yellow-600 dark:text-yellow-400';
    case 'resolved': return 'text-green-600 dark:text-green-400';
    default: return 'text-gray-600 dark:text-gray-400';
  }
}

function getUrgencyIcon(urgency) {
  return urgency === 'high' ? '🔥' : '📋';
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

export default function IncidentsList({ limit = 5 }) {
  const { session } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchIncidents = async () => {
      if (!session?.access_token) {
        // Use mock data when not authenticated
        setTimeout(() => {
          setIncidents(MOCK_INCIDENTS.slice(0, limit));
          setLoading(false);
        }, 1000);
        return;
      }

      try {
        setLoading(true);
        apiClient.setToken(session.access_token);
        
        const data = await apiClient.getRecentIncidents(limit);
        setIncidents(data.incidents || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching incidents:', err);
        setError(err.message);
        // Fallback to mock data
        setIncidents(MOCK_INCIDENTS.slice(0, limit));
      } finally {
        setLoading(false);
      }
    };

    fetchIncidents();
  }, [limit, session]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Incidents</h3>
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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Incidents</h3>
        <Link 
          href="/incidents" 
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          View all
        </Link>
      </div>
      
      {error && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            Using demo data. {error}
          </p>
        </div>
      )}
      
      {incidents.length === 0 ? (
        <div className="text-center py-8">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No recent incidents</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">All systems operational</p>
        </div>
      ) : (
        <div className="space-y-3">
          {incidents.map((incident) => (
            <Link
              key={incident.id}
              href={`/incidents/${incident.id}`}
              className="block p-3 rounded-lg border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{getUrgencyIcon(incident.urgency)}</span>
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${getSeverityColor(incident.severity)}`}>
                      {incident.severity}
                    </span>
                    <span className={`text-xs font-medium ${getStatusColor(incident.status)}`}>
                      {incident.status.toUpperCase()}
                    </span>
                    {incident.urgency === 'high' && (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300">
                        HIGH URGENCY
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {incident.title}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span>{incident.source}</span>
                    <span>•</span>
                    <span>{formatTime(incident.created_at)}</span>
                    {incident.assigned_to_name && (
                      <>
                        <span>•</span>
                        <span>Assigned to {incident.assigned_to_name}</span>
                      </>
                    )}
                    {incident.resolved_by_name && (
                      <>
                        <span>•</span>
                        <span>Resolved by {incident.resolved_by_name}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="ml-2 flex-shrink-0">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
