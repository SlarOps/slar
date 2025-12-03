'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { apiClient } from '../../lib/api';
import { toast, ConfirmationModal } from '../ui';
import IntegrationModal from '../integrations/IntegrationModal';
import IntegrationDetailModal from '../integrations/IntegrationDetailModal';
import SkillUploadModal from '../SkillUploadModal';
import MonitorIntegrationModal from '../monitors/MonitorIntegrationModal';
import { uploadSkillFile } from '../../lib/mcpStorage';
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
  CubeIcon,
  DocumentPlusIcon,
  ServerIcon
} from '@heroicons/react/24/outline';

export default function IntegrationsTab({ groupId }) {
  const { session } = useAuth();
  const { currentOrg, currentProject } = useOrg();
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

  // Skill upload modal state
  const [showSkillUploadModal, setShowSkillUploadModal] = useState(false);

  // Monitor deployments state
  const [deployments, setDeployments] = useState([]);
  const [showMonitorIntegrationModal, setShowMonitorIntegrationModal] = useState(false);
  const [selectedDeployment, setSelectedDeployment] = useState(null);

  useEffect(() => {
    loadIntegrations();
    loadDeployments();
  }, [currentOrg?.id, currentProject?.id]);

  const loadIntegrations = async () => {
    try {
      if (!session?.access_token || !currentOrg?.id) return;

      apiClient.setToken(session.access_token);

      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id }),
        active_only: true
      };
      const response = await apiClient.getIntegrations(rebacFilters);
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
    if (!integrationToDelete || !currentOrg?.id) return;

    try {
      apiClient.setToken(session.access_token);
      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };
      await apiClient.deleteIntegration(integrationToDelete.id, rebacFilters);

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

  // Skill upload handlers
  const handleOpenSkillUpload = () => {
    setShowSkillUploadModal(true);
  };

  const handleSkillUploaded = async (file) => {
    try {
      if (!session?.user?.id) {
        throw new Error('User ID not found');
      }

      // Upload skill file to Supabase Storage
      const result = await uploadSkillFile(session.user.id, file);

      if (!result.success) {
        throw new Error(result.error || 'Failed to upload skill file');
      }

      toast.success('Skill file uploaded successfully!');

      // Call backend API to sync skills to workspace
      const syncResponse = await fetch(`${process.env.NEXT_PUBLIC_AI_API_URL}/api/sync-skills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auth_token: session.access_token
        })
      });

      const syncResult = await syncResponse.json();

      if (syncResult.success) {
        toast.success(`Skills synced: ${syncResult.synced_count} skill(s) extracted to workspace`);
      } else {
        toast.warning(`Skill uploaded but sync had issues: ${syncResult.message}`);
      }

    } catch (error) {
      console.error('Error uploading skill:', error);
      throw error;
    }
  };

  // Monitor deployment handlers
  const loadDeployments = async () => {
    try {
      if (!session?.access_token || !currentOrg?.id) return;

      apiClient.setToken(session.access_token);

      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };
      const deploymentsList = await apiClient.getMonitorDeployments(rebacFilters);
      setDeployments(deploymentsList || []);
    } catch (error) {
      console.error('Failed to load deployments:', error);
    }
  };

  const handleLinkIntegration = (deployment) => {
    setSelectedDeployment(deployment);
    setShowMonitorIntegrationModal(true);
  };

  const handleIntegrationLinked = async () => {
    await loadDeployments();
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
      <div className="space-y-3 sm:space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 animate-pulse">
              <div className="flex items-start gap-2 mb-3">
                <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg flex-shrink-0"></div>
                <div className="flex-1 min-w-0">
                  <div className="h-4 sm:h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
                  <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                </div>
                <div className="flex gap-1">
                  <div className="w-6 h-6 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="w-6 h-6 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
              </div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-3"></div>
              <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-3"></div>
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Integrations Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <div className="flex-1 min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
            Integrations
          </h2>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
            Manage external monitoring integrations for alert routing
          </p>
        </div>
        <button
          onClick={handleCreateIntegration}
          className="inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 border border-transparent rounded-lg transition-colors flex-shrink-0"
        >
          <PlusIcon className="h-4 w-4 flex-shrink-0" />
          <span>Add Integration</span>
        </button>
      </div>

      {integrations.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {integrations.map((integration) => (
            <div
              key={integration.id}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
              onClick={() => handleViewDetails(integration)}
            >
              {/* Integration Header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <div className="p-1.5 sm:p-2 rounded-lg bg-gray-50 dark:bg-gray-700 flex-shrink-0">
                    {getIntegrationTypeIcon(integration.type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm sm:text-base text-gray-900 dark:text-white truncate">
                      {integration.name}
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 capitalize">
                      {integration.type}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditIntegration(integration);
                    }}
                    className="p-1 sm:p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="Edit integration"
                  >
                    <Cog6ToothIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteIntegration(integration);
                    }}
                    className="p-1 sm:p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                    title="Delete integration"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Health Status */}
              <div className="flex items-center gap-2 mb-3">
                {getHealthStatusIcon(integration.health_status)}
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                  {integration.health_status || 'Unknown'}
                </span>
              </div>

              {/* Description */}
              {integration.description && (
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                  {integration.description}
                </p>
              )}

              {/* Stats */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-3">
                <span>{integration.services_count || 0} services</span>
                {integration.last_heartbeat && (
                  <span className="text-xs">
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
        <div className="text-center py-8 sm:py-12 px-4 text-gray-500 dark:text-gray-400">
          <div className="text-4xl sm:text-6xl mb-3 sm:mb-4">⚡</div>
          <h3 className="text-base sm:text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            No integrations configured
          </h3>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-md mx-auto">
            Add integrations to receive alerts from external monitoring tools like Prometheus, Datadog, or custom webhooks.
          </p>
          <button
            onClick={handleCreateIntegration}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <PlusIcon className="h-4 w-4 flex-shrink-0" />
            <span>Add Your First Integration</span>
          </button>
        </div>
      )}

      {/* Monitor Workers Section */}
      <div className="mt-8 sm:mt-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
              Monitor Workers
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
              Link monitor workers to integrations for webhook-based incident reporting
            </p>
          </div>
        </div>

        {deployments.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {deployments.map((deployment) => (
              <div
                key={deployment.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                {/* Deployment Header */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                    <div className="p-1.5 sm:p-2 rounded-lg bg-gray-50 dark:bg-gray-700 flex-shrink-0">
                      <ServerIcon className="h-6 w-6 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-sm sm:text-base text-gray-900 dark:text-white truncate">
                        {deployment.name}
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                        {deployment.worker_name}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Integration Status */}
                <div className="mb-3">
                  {deployment.integration_id ? (
                    <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
                      <LinkIcon className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                      <span className="text-xs text-green-700 dark:text-green-300 truncate">
                        Linked to integration
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
                      <ExclamationTriangleIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        No integration linked
                      </span>
                    </div>
                  )}
                </div>

                {/* Deployment Info */}
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  {deployment.last_deployed_at && (
                    <span>
                      Last deployed: {new Date(deployment.last_deployed_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {/* Link Integration Button */}
                <button
                  onClick={() => handleLinkIntegration(deployment)}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors"
                >
                  <LinkIcon className="h-4 w-4" />
                  {deployment.integration_id ? 'Manage Integration' : 'Link Integration'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 sm:py-12 px-4 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg">
            <ServerIcon className="h-12 w-12 mx-auto mb-3 text-gray-400" />
            <h3 className="text-base sm:text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              No monitor workers deployed
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
              Deploy a monitor worker from the Monitors page to link it to an integration.
            </p>
          </div>
        )}
      </div>

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

      {/* Skill Upload Modal */}
      <SkillUploadModal
        isOpen={showSkillUploadModal}
        onClose={() => setShowSkillUploadModal(false)}
        onSkillUploaded={handleSkillUploaded}
      />

      {/* Monitor Integration Modal */}
      <MonitorIntegrationModal
        isOpen={showMonitorIntegrationModal}
        onClose={() => setShowMonitorIntegrationModal(false)}
        deployment={selectedDeployment}
        onIntegrationUpdated={handleIntegrationLinked}
      />
    </div>
  );
}
