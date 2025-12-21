'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import IncidentTabs from '../../components/incidents/IncidentTabs';
import IncidentsTable from '../../components/incidents/IncidentsTable';
import BulkActionsToolbar from '../../components/incidents/BulkActionsToolbar';
import CreateIncidentModal from '../../components/incidents/CreateIncidentModal';
import IncidentDetailModal from '../../components/incidents/IncidentDetailModal';
import IncidentFilters from '../../components/incidents/IncidentFilters';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { apiClient } from '../../lib/api';

const INITIAL_FILTERS = {
  search: '',
  severity: '',
  priority: '',
  status: '',
  urgency: '',
  assignedTo: '',
  service: '',
  group: '',
  timeRange: 'last_30_days',
  sort: 'created_at_desc'
};

export default function IncidentsPage() {
  const { user, session } = useAuth();
  const { currentOrg, currentProject, loading: orgLoading } = useOrg();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState('triggered');
  const [incidents, setIncidents] = useState([]);
  const [selectedIncidents, setSelectedIncidents] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    triggered: 0,
    acknowledged: 0,
    resolved: 0,
    high_urgency: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  // Modal state from URL
  const modalIncidentId = searchParams.get('modal');
  const isModalOpen = !!modalIncidentId;

  // Fetch real incident stats from API
  useEffect(() => {
    const fetchStats = async () => {
      // ReBAC: MUST have both session AND org_id for tenant isolation
      if (!session?.access_token || !currentOrg?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        // Set authentication token
        apiClient.setToken(session.access_token);

        // Fetch incidents from API with org and project filter
        // ReBAC: org_id is MANDATORY, project_id is OPTIONAL
        const filterParams = {
          org_id: currentOrg.id,
          ...(currentProject?.id && { project_id: currentProject.id })
        };
        const data = await apiClient.getIncidents('', filterParams);

        // Calculate stats from incidents data
        const incidents = data.incidents || [];
        const calculatedStats = {
          total: incidents.length,
          triggered: incidents.filter(incident => incident.status === 'triggered').length,
          acknowledged: incidents.filter(incident => incident.status === 'acknowledged').length,
          resolved: incidents.filter(incident => incident.status === 'resolved').length,
          high_urgency: incidents.filter(incident => incident.urgency === 'high').length
        };

        setStats(calculatedStats);
        setError(null);
      } catch (err) {
        console.error('Error fetching incidents:', err);
        setError('Failed to fetch incidents');
        // Fallback to default stats
        setStats({
          total: 0,
          triggered: 0,
          acknowledged: 0,
          resolved: 0,
          high_urgency: 0
        });
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [session, refreshTrigger, currentOrg?.id, currentProject?.id]);

  // Fetch incidents based on active tab
  useEffect(() => {
    const fetchIncidents = async () => {
      // ReBAC: MUST have both session AND org_id for tenant isolation
      if (!session?.access_token || !currentOrg?.id) return;

      try {
        setLoading(true);
        apiClient.setToken(session.access_token);

        // Build filters object with org_id and project_id
        // ReBAC: org_id is MANDATORY, project_id is OPTIONAL
        const filterParams = {
          ...filters,
          status: activeTab === 'any_status' ? '' : activeTab,
          org_id: currentOrg.id,
          ...(currentProject?.id && { project_id: currentProject.id })
        };

        const data = await apiClient.getIncidents('', filterParams);
        setIncidents(data.incidents || []);

      } catch (err) {
        console.error('Error fetching incidents:', err);
        setError('Failed to load incidents');
        // Use mock data for demo
        setIncidents([
          {
            id: '1',
            title: 'No traffic on feeds* service, the_iconic_au on cluster gke-prod-ause1',
            description: 'Service is experiencing connectivity issues',
            status: 'acknowledged',
            priority: 'P2',
            urgency: 'high',
            severity: 'error',
            created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            service_name: 'Datajet',
            assigned_to_name: 'Chon Le',
            incident_number: '260'
          }
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchIncidents();
  }, [session, activeTab, filters, refreshTrigger, currentOrg?.id, currentProject?.id]);

  const handleIncidentAction = async (action, incidentId) => {
    try {
      switch (action) {
        case 'acknowledge':
          await apiClient.acknowledgeIncident(incidentId);
          break;
        case 'resolve':
          await apiClient.resolveIncident(incidentId);
          break;
        case 'assign':
          // This will be handled by the component with user selection
          break;
        default:
          console.log(`Incident ${action}:`, incidentId);
      }

      // Refresh stats after action
      setRefreshTrigger(prev => prev + 1);

    } catch (err) {
      console.error(`Error ${action} incident:`, err);
      setError(`Failed to ${action} incident`);
    }
  };

  const handleIncidentCreated = (newIncident) => {
    console.log('New incident created:', newIncident);
    // Refresh data
    setRefreshTrigger(prev => prev + 1);
    // Clear any existing errors
    setError(null);
  };

  const handleIncidentSelect = (incidentId, selected) => {
    if (selected) {
      setSelectedIncidents(prev => [...prev, incidentId]);
    } else {
      setSelectedIncidents(prev => prev.filter(id => id !== incidentId));
    }
  };

  const handleSelectAll = (selected) => {
    if (selected) {
      setSelectedIncidents(incidents.map(incident => incident.id));
    } else {
      setSelectedIncidents([]);
    }
  };

  const handleBulkAction = async (action, value) => {
    try {
      console.log(`Bulk ${action} for incidents:`, selectedIncidents, value);

      // Perform bulk action
      for (const incidentId of selectedIncidents) {
        await handleIncidentAction(action, incidentId);
      }

      // Clear selection and refresh
      setSelectedIncidents([]);
      setRefreshTrigger(prev => prev + 1);

    } catch (err) {
      console.error(`Error performing bulk ${action}:`, err);
      setError(`Failed to ${action} selected incidents`);
    }
  };

  const handleClearSelection = () => {
    setSelectedIncidents([]);
  };

  const handleCloseModal = () => {
    router.push('/incidents', undefined, { shallow: true });
  };

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  // Show loading state while org is being loaded
  if (orgLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading organization...</p>
        </div>
      </div>
    );
  }

  // Show message if no organization is selected
  if (!currentOrg?.id) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Organization Selected</h3>
          <p className="text-gray-600 dark:text-gray-400">Please select an organization to view incidents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
      {/* Header with Stats */}
      <div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Incidents</h1>
          <button
            className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            onClick={() => setShowCreateModal(true)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Create Incident</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
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

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 md:p-4">
            <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              {loading ? '...' : stats.total}
            </div>
            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">Total</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-red-200 dark:border-red-800 p-3 md:p-4">
            <div className="text-xl md:text-2xl font-bold text-red-600 dark:text-red-400">
              {loading ? '...' : stats.triggered}
            </div>
            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">Triggered</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-yellow-200 dark:border-yellow-800 p-3 md:p-4">
            <div className="text-xl md:text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {loading ? '...' : stats.acknowledged}
            </div>
            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">Acknowledged</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-800 p-3 md:p-4">
            <div className="text-xl md:text-2xl font-bold text-green-600 dark:text-green-400">
              {loading ? '...' : stats.resolved}
            </div>
            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">Resolved</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-orange-200 dark:border-orange-800 p-3 md:p-4 col-span-2 md:col-span-1">
            <div className="text-xl md:text-2xl font-bold text-orange-600 dark:text-orange-400">
              {loading ? '...' : stats.high_urgency}
            </div>
            <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">High Urgency</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <IncidentTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        stats={stats}
      />

      {/* Filters */}
      <IncidentFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onClearFilters={handleClearFilters}
      />

      {/* Bulk Actions */}
      <BulkActionsToolbar
        selectedCount={selectedIncidents.length}
        onBulkAction={handleBulkAction}
        onClearSelection={handleClearSelection}
      />

      {/* Incidents Table */}
      <IncidentsTable
        incidents={incidents}
        loading={loading}
        onIncidentAction={handleIncidentAction}
        selectedIncidents={selectedIncidents}
        onIncidentSelect={handleIncidentSelect}
        onSelectAll={handleSelectAll}
      />

      {/* Create Incident Modal */}
      <CreateIncidentModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onIncidentCreated={handleIncidentCreated}
      />

      {/* Incident Detail Modal */}
      <IncidentDetailModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        incidentId={modalIncidentId}
      />
    </div>
  );
}
