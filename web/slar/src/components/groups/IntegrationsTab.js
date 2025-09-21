'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { toast, ConfirmationModal } from '../ui';
import IntegrationModal from '../integrations/IntegrationModal';
import IntegrationDetailModal from '../integrations/IntegrationDetailModal';
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

export default function IntegrationsTab({ groupId }) {
  const { session } = useAuth();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [showIntegrationModal, setShowIntegrationModal] = useState(false);
  const [integrationModalMode, setIntegrationModalMode] = useState('create');
  const [selectedIntegration, setSelectedIntegration] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [integrationToDelete, setIntegrationToDelete] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailIntegration, setDetailIntegration] = useState(null);

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

  const handleViewDetails = (integration) => {
    setDetailIntegration(integration);
    setShowDetailModal(true);
  };

  const handleEditFromDetail = (integration) => {
    setShowDetailModal(false);
    setIntegrationModalMode('edit');
    setSelectedIntegration(integration);
    setShowIntegrationModal(true);
  };

  const confirmDeleteIntegration = async () => {
    if (!integrationToDelete) return;

    try {
      apiClient.setToken(session.access_token);
      await apiClient.deleteIntegration(integrationToDelete.id);
      
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

  const handleIntegrationCreated = async () => {
    await loadIntegrations();
  };

  const handleIntegrationUpdated = async () => {
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

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-32"></div>
                  <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                  <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
                </div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-48"></div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Integrations Section */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Integrations
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Manage external monitoring integrations for alert routing
            </p>
          </div>
          <button 
            onClick={handleCreateIntegration}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 border border-transparent rounded-lg transition-colors"
          >
            <PlusIcon className="h-4 w-4" />
            Add Integration
          </button>
        </div>

        {integrations.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {integrations.map((integration) => (
              <div 
                key={integration.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                onClick={() => handleViewDetails(integration)}
              >
                {/* Integration Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700">
                      {getIntegrationTypeIcon(integration.type)}
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">
                        {integration.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
                        {integration.type}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditIntegration(integration);
                      }}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="Edit integration"
                    >
                      <Cog6ToothIcon className="h-4 w-4" />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteIntegration(integration);
                      }}
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
                    {integration.health_status || 'Unknown'}
                  </span>
                </div>

                {/* Description */}
                {integration.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    {integration.description}
                  </p>
                )}

                {/* Stats */}
                <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 mb-3">
                  <span>{integration.services_count || 0} services</span>
                  {integration.last_heartbeat && (
                    <span>
                      {new Date(integration.last_heartbeat).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {/* Webhook URL */}
                <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded text-xs font-mono text-gray-600 dark:text-gray-400 break-all">
                  {integration.webhook_url}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <div className="text-6xl mb-4">⚡</div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              No integrations configured
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Add integrations to receive alerts from external monitoring tools like Prometheus, Datadog, or custom webhooks.
            </p>
            <button 
              onClick={handleCreateIntegration}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <PlusIcon className="h-4 w-4" />
              Add Your First Integration
            </button>
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

      {/* Integration Detail Modal */}
      <IntegrationDetailModal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        integration={detailIntegration}
        onEdit={handleEditFromDetail}
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
