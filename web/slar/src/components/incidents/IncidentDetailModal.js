'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { Modal, MarkdownRenderer } from '../ui';
import IncidentHeader from './IncidentHeader';
import IncidentTimeline from './IncidentTimeline';
import IncidentSidebar from './IncidentSidebar';

export default function IncidentDetailModal({
  isOpen,
  onClose,
  incidentId
}) {
  const { session } = useAuth();
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

    // Store previous state for rollback
    const previousIncident = { ...incident };

    try {
      setActionLoading(true);

      // Optimistic Update
      let optimisticStatus = incident.status;
      if (action === 'acknowledge') optimisticStatus = 'acknowledged';
      if (action === 'resolve') optimisticStatus = 'resolved';

      setIncident(prev => ({
        ...prev,
        status: optimisticStatus
      }));

      switch (action) {
        case 'acknowledge':
          await apiClient.acknowledgeIncident(incident.id);
          break;
        case 'resolve':
          await apiClient.resolveIncident(incident.id);
          break;
        case 'escalate':
          const result = await apiClient.escalateIncident(incident.id);
          console.log('Escalation result:', result);
          break;
      }

      // Refresh incident data to get canonical state
      const data = await apiClient.getIncident(incidentId);
      setIncident(data);
      setEvents(data.recent_events || []);

    } catch (err) {
      console.error(`Error ${action} incident:`, err);
      setError(`Failed to ${action} incident`);
      // Rollback on error
      setIncident(previousIncident);
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="5xl"
      scrollable={true}
      maxHeight="calc(100vh - 40px)"
    >
      <div className="space-y-4 md:space-y-6">
        <IncidentHeader
          incident={incident}
          loading={loading}
          actionLoading={actionLoading}
          onAction={handleAction}
          error={error}
        />

        {/* Content */}
        {
          loading ? (
            <div className="space-y-4">
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
                <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            </div>
          ) : incident ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
              {/* Main Content - Alert Information */}
              <div className="lg:col-span-2 space-y-4 md:space-y-6">
                {/* Alert Content */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 md:p-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Alert Information</h3>

                  <div className="space-y-4">
                    {/* Alert Title and Description */}
                    <div>
                      <h4 className="text-base font-bold text-gray-900 dark:text-white mb-2 break-words">
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
                    </div>

                  </div>
                </div>

                <IncidentTimeline events={events} />
              </div>

              {/* Sidebar - Details */}
              <IncidentSidebar incident={incident} />
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
