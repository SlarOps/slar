'use client';

import { useState, useEffect } from 'react';
import IncidentCard from './IncidentCard';
import { apiClient } from '../../lib/api';

export default function IncidentsList({ 
  filters, 
  onIncidentAction, 
  session,
  loading: parentLoading = false,
  refreshTrigger = 0
}) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    hasMore: false
  });

  // Fetch incidents based on filters
  useEffect(() => {
    const fetchIncidents = async () => {
      if (!session?.access_token) {
        setIncidents([]);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        apiClient.setToken(session.access_token);
        
        // Build query parameters from filters
        const params = new URLSearchParams();
        
        if (filters.search) params.append('search', filters.search);
        if (filters.status) params.append('status', filters.status);
        if (filters.severity) params.append('severity', filters.severity);
        if (filters.urgency) params.append('urgency', filters.urgency);
        if (filters.assignedTo) params.append('assigned_to', filters.assignedTo);
        if (filters.service) params.append('service_id', filters.service);
        if (filters.sort) params.append('sort', filters.sort);
        
        params.append('page', pagination.page.toString());
        params.append('limit', pagination.limit.toString());
        
        const data = await apiClient.getIncidents(params.toString());
        
        setIncidents(data.incidents || []);
        setPagination({
          page: data.page || 1,
          limit: data.limit || 20,
          total: data.total || 0,
          hasMore: data.has_more || false
        });
        
      } catch (err) {
        console.error('Error fetching incidents:', err);
        setError('Failed to fetch incidents');
        setIncidents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchIncidents();
  }, [session, filters, pagination.page, refreshTrigger]);

  const handleIncidentAction = async (action, incidentId) => {
    try {
      await onIncidentAction(action, incidentId);
      
      // Update the incident in the local state
      setIncidents(prevIncidents => 
        prevIncidents.map(incident => {
          if (incident.id === incidentId) {
            let updatedIncident = { ...incident };
            
            switch (action) {
              case 'acknowledge':
                updatedIncident.status = 'acknowledged';
                updatedIncident.acknowledged_at = new Date().toISOString();
                break;
              case 'resolve':
                updatedIncident.status = 'resolved';
                updatedIncident.resolved_at = new Date().toISOString();
                break;
            }
            
            return updatedIncident;
          }
          return incident;
        })
      );
      
    } catch (err) {
      console.error(`Error ${action} incident:`, err);
    }
  };

  const loadMore = () => {
    if (!loading && pagination.hasMore) {
      setPagination(prev => ({ ...prev, page: prev.page + 1 }));
    }
  };

  const isLoading = loading || parentLoading;

  if (isLoading && incidents.length === 0) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-6 h-6 bg-gray-300 dark:bg-gray-600 rounded"></div>
                  <div className="h-5 bg-gray-300 dark:bg-gray-600 rounded w-3/4"></div>
                </div>
                <div className="flex space-x-2 mb-2">
                  <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
                  <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-12"></div>
                </div>
              </div>
            </div>
            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-full mb-2"></div>
            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-2/3"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex">
          <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="ml-3">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="text-sm text-red-600 dark:text-red-400 underline mt-1"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (incidents.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No incidents</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {Object.values(filters).some(v => v) 
            ? 'No incidents match your current filters.' 
            : 'No incidents have been created yet.'
          }
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Results Summary */}
      <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
        <span>
          Showing {incidents.length} of {pagination.total} incidents
        </span>
        {pagination.total > 0 && (
          <span>
            Page {pagination.page} of {Math.ceil(pagination.total / pagination.limit)}
          </span>
        )}
      </div>

      {/* Incidents List */}
      <div className="space-y-4">
        {incidents.map((incident) => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            onAction={handleIncidentAction}
            showActions={true}
          />
        ))}
      </div>

      {/* Load More Button */}
      {pagination.hasMore && (
        <div className="text-center pt-6">
          <button
            onClick={loadMore}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {/* Loading Indicator for Additional Results */}
      {loading && incidents.length > 0 && (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      )}
    </div>
  );
}
