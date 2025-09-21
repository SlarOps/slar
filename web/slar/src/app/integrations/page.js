'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { toast, ConfirmationModal } from '../../components/ui';
import IntegrationModal from '../../components/integrations/IntegrationModal';
import { 
  PlusIcon, 
  Cog6ToothIcon, 
  TrashIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  FireIcon,
  ChartBarIcon,
  LinkIcon,
  CloudIcon,
  BoltIcon,
  CubeIcon
} from '@heroicons/react/24/outline';

export default function IntegrationsPage() {
  const { session } = useAuth();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, healthy, warning, unhealthy
  
  // Modal states
  const [showIntegrationModal, setShowIntegrationModal] = useState(false);
  const [integrationModalMode, setIntegrationModalMode] = useState('create');
  const [selectedIntegration, setSelectedIntegration] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [integrationToDelete, setIntegrationToDelete] = useState(null);

  useEffect(() => {
    loadIntegrations();
  }, []);

  const loadIntegrations = async () => {
    try {
      if (!session?.access_token) return;
      
      apiClient.setToken(session.access_token);
      const response = await apiClient.getIntegrations({ active_only: true });
      setIntegrations(response.integrations || []);
    } catch (error) {
      console.error('Failed to load integrations:', error);
      toast.error('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  // Modal handlers
  const handleCreateIntegration = () => {
    setIntegrationModalMode('create');
    setSelectedIntegration(null);
    setShowIntegrationModal(true);
  };

  const handleEditIntegration = (integration) => {
    setIntegrationModalMode('edit');
    setSelectedIntegration(integration);
    setShowIntegrationModal(true);
  };

  const handleDeleteIntegration = (integration) => {
    setIntegrationToDelete(integration);
    setShowDeleteModal(true);
  };

  const confirmDeleteIntegration = async () => {
    if (!integrationToDelete) return;

    try {
      apiClient.setToken(session.access_token);
      await apiClient.deleteIntegration(integrationToDelete.id);
      
      // Reload integrations
      await loadIntegrations();
      toast.success('Integration deleted successfully');
    } catch (error) {
      console.error('Failed to delete integration:', error);
      toast.error(`Failed to delete integration: ${error.message}`);
    } finally {
      setShowDeleteModal(false);
      setIntegrationToDelete(null);
    }
  };

  const handleIntegrationCreated = async (integration) => {
    await loadIntegrations();
  };

  const handleIntegrationUpdated = async (integration) => {
    await loadIntegrations();
  };

  const getIntegrationTypeIcon = (type) => {
    const iconProps = "h-6 w-6";
    
    switch (type) {
      case 'prometheus':
        return <FireIcon className={`${iconProps} text-orange-600 dark:text-orange-400`} />;
      case 'datadog':
        return <ChartBarIcon className={`${iconProps} text-purple-600 dark:text-purple-400`} />;
      case 'grafana':
        return <ChartBarIcon className={`${iconProps} text-yellow-600 dark:text-yellow-400`} />;
      case 'webhook':
        return <LinkIcon className={`${iconProps} text-blue-600 dark:text-blue-400`} />;
      case 'aws':
        return <CloudIcon className={`${iconProps} text-amber-600 dark:text-amber-400`} />;
      case 'custom':
        return <CubeIcon className={`${iconProps} text-gray-600 dark:text-gray-400`} />;
      default:
        return <BoltIcon className={`${iconProps} text-gray-600 dark:text-gray-400`} />;
    }
  };

  const getHealthStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
      case 'warning':
        return <ClockIcon className="h-5 w-5 text-yellow-500" />;
      case 'unhealthy':
        return <XCircleIcon className="h-5 w-5 text-red-500" />;
      default:
        return <ExclamationTriangleIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  const getHealthStatusText = (status) => {
    switch (status) {
      case 'healthy':
        return 'Healthy';
      case 'warning':
        return 'Warning';
      case 'unhealthy':
        return 'Unhealthy';
      default:
        return 'Unknown';
    }
  };

  const filteredIntegrations = integrations.filter(integration => {
    if (filter === 'all') return true;
    return integration.health_status === filter;
  });

  const healthSummary = integrations.reduce((acc, integration) => {
    const status = integration.health_status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Integrations
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage external monitoring integrations and alert sources
          </p>
        </div>
        
        <button 
          onClick={handleCreateIntegration}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          Add Integration
        </button>
      </div>

      {/* Health Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="h-5 w-5 text-green-500" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Healthy</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {healthSummary.healthy || 0}
          </p>
        </div>
        
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ClockIcon className="h-5 w-5 text-yellow-500" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Warning</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {healthSummary.warning || 0}
          </p>
        </div>
        
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <XCircleIcon className="h-5 w-5 text-red-500" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Unhealthy</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {healthSummary.unhealthy || 0}
          </p>
        </div>
        
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-gray-500" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Unknown</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {healthSummary.unknown || 0}
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        {[
          { key: 'all', label: 'All' },
          { key: 'healthy', label: 'Healthy' },
          { key: 'warning', label: 'Warning' },
          { key: 'unhealthy', label: 'Unhealthy' }
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              filter === key
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Integrations Grid */}
      {filteredIntegrations.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">⚡</div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            {filter === 'all' ? 'No integrations configured' : `No ${filter} integrations`}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {filter === 'all' 
              ? 'Get started by adding your first integration to receive alerts from external monitoring tools.'
              : `No integrations are currently in ${filter} status.`
            }
          </p>
          {filter === 'all' && (
            <button 
              onClick={handleCreateIntegration}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <PlusIcon className="h-4 w-4" />
              Add Your First Integration
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredIntegrations.map((integration) => (
            <div
              key={integration.id}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
            >
              {/* Integration Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700">
                    {getIntegrationTypeIcon(integration.type)}
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">
                      {integration.name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
                      {integration.type}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => handleEditIntegration(integration)}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="Edit integration"
                  >
                    <Cog6ToothIcon className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={() => handleDeleteIntegration(integration)}
                    className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                    title="Delete integration"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Health Status */}
              <div className="flex items-center gap-2 mb-3">
                {getHealthStatusIcon(integration.health_status)}
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {getHealthStatusText(integration.health_status)}
                </span>
              </div>

              {/* Description */}
              {integration.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  {integration.description}
                </p>
              )}

              {/* Stats */}
              <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>{integration.services_count || 0} services</span>
                {integration.last_heartbeat && (
                  <span>
                    Last seen: {new Date(integration.last_heartbeat).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Webhook URL */}
              <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-700 rounded text-xs font-mono text-gray-600 dark:text-gray-400 break-all">
                {integration.webhook_url}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Integration Modal */}
      <IntegrationModal
        isOpen={showIntegrationModal}
        onClose={() => setShowIntegrationModal(false)}
        mode={integrationModalMode}
        integration={selectedIntegration}
        onIntegrationCreated={handleIntegrationCreated}
        onIntegrationUpdated={handleIntegrationUpdated}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={confirmDeleteIntegration}
        title="Delete Integration"
        message={`Are you sure you want to delete "${integrationToDelete?.name}"? This action cannot be undone and will remove all service mappings for this integration.`}
        confirmText="Delete Integration"
        confirmVariant="danger"
      />
    </div>
  );
}