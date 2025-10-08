'use client';

import { useState, useEffect } from 'react';
import { Button } from '@headlessui/react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { Modal, MarkdownRenderer } from '../ui';

export default function IncidentDetailModal({ 
  isOpen, 
  onClose, 
  incidentId 
}) {
  const { session } = useAuth();
  const router = useRouter();
  const [incident, setIncident] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    const fetchIncident = async () => {
      if (!incidentId || !session?.access_token || !isOpen) {
        return;
      }

      try {
        setLoading(true);
        setError(null);
        apiClient.setToken(session.access_token);
        
        const data = await apiClient.getIncident(incidentId);
        setIncident(data);
        setEvents(data.recent_events || []);
      } catch (err) {
        console.error('Error fetching incident:', err);
        setError('Failed to fetch incident details');
      } finally {
        setLoading(false);
      }
    };

    fetchIncident();
  }, [incidentId, session, isOpen]);

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
      const data = await apiClient.getIncident(incidentId);
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

  const getEventIcon = (eventType) => {
    switch (eventType) {
      case 'triggered':
        return (
          <div className="w-8 h-8 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
        );
      case 'acknowledged':
        return (
          <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/20 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        );
      case 'resolved':
        return (
          <div className="w-8 h-8 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        );
      case 'assigned':
      case 'escalated':
        return (
          <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        );
      case 'escalation_completed':
        return (
          <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/20 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        );
      default:
        return (
          <div className="w-8 h-8 bg-gray-100 dark:bg-gray-900/20 rounded-full flex items-center justify-center">
            <div className="w-2 h-2 bg-gray-600 dark:text-gray-400 rounded-full"></div>
          </div>
        );
    }
  };

  const formatEventDescription = (event) => {
    const eventType = event.event_type;
    const eventData = event.event_data || {};

    switch (eventType) {
      case 'triggered':
        return `Incident triggered from ${eventData.source || 'unknown source'}`;
      case 'acknowledged':
        return `Incident acknowledged${event.created_by_name ? ` by ${event.created_by_name}` : ''}`;
      case 'resolved':
        return `Incident resolved${event.created_by_name ? ` by ${event.created_by_name}` : ''}`;
      case 'assigned':
        if (eventData.method === 'escalation_policy') {
          return `Auto-assigned via escalation policy${eventData.assigned_to ? ` to user` : ''}`;
        }
        return `Manually assigned${event.created_by_name ? ` by ${event.created_by_name}` : ''}`;
      case 'escalated':
        const level = eventData.escalation_level || eventData.level;
        const targetType = eventData.target_type;
        const targetName = eventData.target_name || eventData.assigned_to;

        let description = `Escalated to policy level ${level}`;
        if (targetType === 'scheduler') {
          description += ` (on-call scheduler)`;
        } else if (targetType === 'user') {
          description += ` (direct user assignment)`;
        } else if (targetType === 'group') {
          description += ` (group assignment)`;
        }

        if (targetName) {
          description += ` → ${targetName}`;
        }

        return description;
      case 'escalation_completed':
        const finalLevel = eventData.final_level;
        const finalAssignee = eventData.final_assignee;

        let completedDescription = `Escalation completed`;
        if (finalLevel) {
          completedDescription += ` at level ${finalLevel}`;
        }
        if (finalAssignee) {
          completedDescription += ` → Final assignee: ${finalAssignee}`;
        }

        return completedDescription;
      default:
        return eventType.replace('_', ' ').toLowerCase();
    }
  };

  if (!isOpen) return null;

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      size="5xl"
      scrollable={true}
      maxHeight="calc(90vh - 120px)"
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {loading ? (
              <div className="animate-pulse">
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-4"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
              </div>
            ) : incident ? (
              <>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Incident #{incident.id.slice(-8)}
                </h1>
                
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
              </>
            ) : (
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Incident Details
              </h1>
            )}
          </div>

          {/* Action Buttons */}
          {incident && (
            <div className="flex space-x-2 ml-4">
              {/* Ask AI Agent Button */}
              <Button
                onClick={() => {
                  // Store incident data in sessionStorage to pass to AI agent
                  const incidentData = {
                    id: incident.id,
                    title: incident.title,
                    description: incident.description,
                    status: incident.status,
                    severity: incident.severity,
                    urgency: incident.urgency,
                    service_name: incident.service_name,
                    assigned_to_name: incident.assigned_to_name,
                    created_at: incident.created_at,
                    acknowledged_at: incident.acknowledged_at,
                    resolved_at: incident.resolved_at
                  };
                  sessionStorage.setItem('attachedIncident', JSON.stringify(incidentData));
                  router.push('/ai-agent');
                }}
                className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span>Ask AI Agent</span>
              </Button>

              {incident.status === 'triggered' && (
                <Button
                  onClick={() => handleAction('acknowledge')}
                  disabled={actionLoading}
                  className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  {actionLoading ? 'Processing...' : 'Acknowledge'}
                </Button>
              )}

              {incident.status !== 'resolved' && (
                <Button
                  onClick={() => handleAction('resolve')}
                  disabled={actionLoading}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                >
                  {actionLoading ? 'Processing...' : 'Resolve'}
                </Button>
              )}

              {incident.status !== 'resolved' && (
                <Button
                  onClick={() => handleAction('escalate')}
                  disabled={actionLoading}
                  className="bg-slate-500 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
                >
                  {actionLoading ? 'Processing...' : 'Escalate'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="ml-3">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
              <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          </div>
        ) : incident ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content - Alert Information */}
            <div className="lg:col-span-2 space-y-6">
              {/* Alert Content */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Alert Information</h3>
                
                <div className="space-y-4">
                  {/* Alert Title and Description */}
                  <div>
                    <h4 className="text-base font-bold text-gray-900 dark:text-white mb-2">
                      {incident.title}
                    </h4>
                    {incident.description && (
                      <MarkdownRenderer
                        content={incident.description}
                        size="base"
                        className="text-sm text-gray-600 dark:text-gray-400"
                      />
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
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Timeline & Escalation History
                </h3>

                {events.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">No events recorded yet.</p>
                ) : (
                  <div className="flow-root">
                    <ul className="-mb-8">
                      {events.map((event, index) => (
                        <li key={event.id || index}>
                          <div className="relative pb-8">
                            {index !== events.length - 1 && (
                              <span
                                className="absolute top-8 left-4 -ml-px h-full w-0.5 bg-gray-200 dark:bg-gray-600"
                                aria-hidden="true"
                              />
                            )}
                            <div className="relative flex space-x-3">
                              <div className="flex-shrink-0">
                                {getEventIcon(event.event_type)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                                      {formatEventDescription(event)}
                                    </p>
                                    <div className="flex items-center space-x-2 mt-1">
                                      <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {new Date(event.created_at).toLocaleString()}
                                      </span>
                                      {event.event_type === 'escalated' && event.event_data?.escalation_level && (
                                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
                                          Level {event.event_data.escalation_level}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Additional event details */}
                                <div className="mt-2 space-y-1">
                                  {event.event_data?.assigned_to && (
                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                      <span className="font-medium">Assigned to:</span> {event.event_data.assigned_to}
                                    </p>
                                  )}

                                  {event.event_data?.escalation_policy && (
                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                      <span className="font-medium">Policy:</span> {event.event_data.escalation_policy}
                                    </p>
                                  )}

                                  {event.event_data?.target_type && (
                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                      <span className="font-medium">Target:</span> {event.event_data.target_type}
                                      {event.event_data.target_name && ` (${event.event_data.target_name})`}
                                    </p>
                                  )}

                                  {event.event_data?.note && (
                                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-2 p-2 bg-gray-100 dark:bg-gray-700 rounded">
                                      {event.event_data.note}
                                    </p>
                                  )}

                                  {event.event_data?.reason && (
                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                      <span className="font-medium">Reason:</span> {event.event_data.reason}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar - Details */}
            <div className="space-y-6">
              {/* Incident Details */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
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
                  
                  {incident.group_name && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Group</dt>
                      <dd className="text-sm text-gray-900 dark:text-white">
                        {incident.group_name}
                      </dd>
                    </div>
                  )}
                  

                  
                  {/* Escalation Information */}
                  {incident.escalation_policy_name && (
                    <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Escalation Status</h4>

                      <div className="space-y-2">
                        <div>
                          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Escalation Progress</dt>
                          <dd className="text-sm text-gray-900 dark:text-white">
                            {incident.current_escalation_level === 0 ? (
                              <span>Not escalated yet</span>
                            ) : (
                              <span>Escalated to Level {incident.current_escalation_level}</span>
                            )}
                            {incident.escalation_status && (
                              <span className={`ml-2 px-2 py-1 text-xs font-medium rounded-full ${
                                incident.escalation_status === 'escalating'
                                  ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300'
                                  : incident.escalation_status === 'completed'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                                  : incident.escalation_status === 'pending'
                                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
                                  : 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
                              }`}>
                                {incident.escalation_status}
                              </span>
                            )}
                          </dd>
                        </div>

                        {incident.last_escalated_at && (
                          <div>
                            <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Last Escalated</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                              {new Date(incident.last_escalated_at).toLocaleString()}
                            </dd>
                          </div>
                        )}

                        <div>
                          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Policy</dt>
                          <dd className="text-sm text-gray-900 dark:text-white">
                            {incident.escalation_policy_name}
                          </dd>
                        </div>
                      </div>
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
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">No incident data available</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
