'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../lib/api';

export default function IncidentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { session } = useAuth();
  const [incident, setIncident] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    const fetchIncident = async () => {
      console.log('Fetching incident with ID:', params.id);
      
      if (!session?.access_token || !params.id) {
        console.log('Missing session or params.id:', { session: !!session?.access_token, paramsId: params.id });
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        apiClient.setToken(session.access_token);
        
        console.log('Making API call for incident:', params.id);
        const data = await apiClient.getIncident(params.id);
        console.log('Received incident data:', { id: data.id, title: data.title, status: data.status });
        
        setIncident(data);
        setEvents(data.recent_events || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching incident:', err);
        setError('Failed to fetch incident details');
      } finally {
        setLoading(false);
      }
    };

    fetchIncident();
  }, [session, params.id]);

  const handleAction = async (action) => {
    if (!incident) return;
    
    try {
      setActionLoading(true);
      
      switch (action) {
        case 'acknowledge':
          await apiClient.acknowledgeIncident(incident.id);
          break;
        case 'resolve':
          await apiClient.resolveIncident(incident.id);
          break;
        case 'escalate':
          await apiClient.escalateIncident(incident.id);
          break;
      }
      
      // Refresh incident data
      const data = await apiClient.getIncident(params.id);
      setIncident(data);
      setEvents(data.recent_events || []);
      
    } catch (err) {
      console.error(`Error ${action} incident:`, err);
      setError(`Failed to ${action} incident`);
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'triggered':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      case 'acknowledged':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300';
      case 'resolved':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
    }
  };

  const getUrgencyColor = (urgency) => {
    return urgency === 'high' 
      ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex">
          <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="ml-3">
            <p className="text-sm text-red-700 dark:text-red-300">{error || 'Incident not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <button
              onClick={() => router.back()}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Incident #{incident.id.slice(-8)}
              <span className="text-sm text-gray-500 ml-2">(URL: {params.id})</span>
            </h1>
          </div>
          
          <div className="flex items-center space-x-3 mb-4">
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(incident.status)}`}>
              {incident.status.toUpperCase()}
            </span>
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getUrgencyColor(incident.urgency)}`}>
              {incident.urgency.toUpperCase()} URGENCY
            </span>
            {incident.severity && (
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300">
                {incident.severity.toUpperCase()}
              </span>
            )}
          </div>
          

        </div>

        {/* Action Buttons */}
        <div className="flex space-x-2 ml-4">
          {incident.status === 'triggered' && (
            <button
              onClick={() => handleAction('acknowledge')}
              disabled={actionLoading}
              className="bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {actionLoading ? 'Processing...' : 'Acknowledge'}
            </button>
          )}
          
          {incident.status !== 'resolved' && (
            <button
              onClick={() => handleAction('resolve')}
              disabled={actionLoading}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {actionLoading ? 'Processing...' : 'Resolve'}
            </button>
          )}
          
          {incident.status !== 'resolved' && (
            <button
              onClick={() => handleAction('escalate')}
              disabled={actionLoading}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {actionLoading ? 'Processing...' : 'Escalate'}
            </button>
          )}
        </div>
      </div>

      {/* Incident Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - Alert Information */}
        <div className="lg:col-span-2 space-y-6">
          {/* Alert Content */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Alert Information</h3>
            
            <div className="space-y-4">
              {/* Alert Title and Description */}
              <div>
                <h4 className="text-base font-medium text-gray-900 dark:text-white mb-2">
                  {incident.title}
                </h4>
                {incident.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {incident.description}
                  </p>
                )}
              </div>
              
              {/* Alert Metadata */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Severity</dt>
                  <dd className="text-sm text-gray-900 dark:text-white mt-1">
                    {incident.severity || 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Urgency</dt>
                  <dd className="text-sm text-gray-900 dark:text-white mt-1">
                    {incident.urgency || 'Normal'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</dt>
                  <dd className="text-sm text-gray-900 dark:text-white mt-1">
                    {incident.status}
                  </dd>
                </div>
                {incident.source && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Source</dt>
                    <dd className="text-sm text-gray-900 dark:text-white mt-1">
                      {incident.source}
                    </dd>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Timeline */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Timeline</h3>
            
            {events.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">No events recorded yet.</p>
            ) : (
              <div className="space-y-4">
                {events.map((event, index) => (
                  <div key={event.id || index} className="flex space-x-3">
                    <div className="flex-shrink-0">
                      <div className="w-2 h-2 bg-blue-600 rounded-full mt-2"></div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {event.event_type.replace('_', ' ').toUpperCase()}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {new Date(event.created_at).toLocaleString()}
                        </span>
                      </div>
                      {event.created_by_name && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          by {event.created_by_name}
                        </p>
                      )}
                      {event.event_data?.note && (
                        <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                          {event.event_data.note}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Details */}
        <div className="space-y-6">
          {/* Incident Details */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Details</h3>
            
            <div className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Incident ID</dt>
                <dd className="text-sm text-gray-900 dark:text-white font-mono">
                  {incident.id}
                </dd>
              </div>
              
              {incident.incident_number && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Incident Number</dt>
                  <dd className="text-sm text-gray-900 dark:text-white">
                    #{incident.incident_number}
                  </dd>
                </div>
              )}
              
              {incident.priority && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Priority</dt>
                  <dd className="text-sm text-gray-900 dark:text-white">
                    <span className="px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                      {incident.priority}
                    </span>
                  </dd>
                </div>
              )}
              
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created</dt>
                <dd className="text-sm text-gray-900 dark:text-white">
                  {new Date(incident.created_at).toLocaleString()}
                </dd>
              </div>
              
              {incident.acknowledged_at && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Acknowledged</dt>
                  <dd className="text-sm text-gray-900 dark:text-white">
                    {new Date(incident.acknowledged_at).toLocaleString()}
                  </dd>
                </div>
              )}
              
              {incident.resolved_at && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Resolved</dt>
                  <dd className="text-sm text-gray-900 dark:text-white">
                    {new Date(incident.resolved_at).toLocaleString()}
                  </dd>
                </div>
              )}
              
              {incident.assigned_to_name && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Assigned To</dt>
                  <dd className="text-sm text-gray-900 dark:text-white">
                    {incident.assigned_to_name}
                  </dd>
                </div>
              )}
              
              {incident.service_name && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Service</dt>
                  <dd className="text-sm text-gray-900 dark:text-white">
                    {incident.service_name}
                  </dd>
                </div>
              )}
              
              {incident.escalation_policy_name && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Escalation Policy</dt>
                  <dd className="text-sm text-gray-900 dark:text-white">
                    {incident.escalation_policy_name}
                  </dd>
                </div>
              )}
              
              {incident.current_escalation_level > 0 && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Escalation Level</dt>
                  <dd className="text-sm text-gray-900 dark:text-white">
                    Level {incident.current_escalation_level}
                    {incident.escalation_status && (
                      <span className="ml-2 px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
                        {incident.escalation_status}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              
              {incident.source && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Source</dt>
                  <dd className="text-sm text-gray-900 dark:text-white">
                    {incident.source}
                  </dd>
                </div>
              )}
              
              {incident.external_url && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">External Link</dt>
                  <dd className="text-sm">
                    <a 
                      href={incident.external_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      View in source system →
                    </a>
                  </dd>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
