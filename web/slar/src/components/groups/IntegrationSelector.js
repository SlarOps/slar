'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { apiClient } from '../../lib/api';
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react';
import { ChevronDownIcon, PlusIcon, TrashIcon, ExclamationTriangleIcon } from '@heroicons/react/20/solid';
import { 
  FireIcon,
  ChartBarIcon,
  LinkIcon,
  CloudIcon,
  BoltIcon,
  CubeIcon
} from '@heroicons/react/24/outline';
import { toast } from '../ui';

export default function IntegrationSelector({
  serviceId,
  selectedIntegrations = [],
  onIntegrationsChange,
  disabled = false
}) {
  const { session } = useAuth();
  const { currentOrg, currentProject } = useOrg();
  const [integrations, setIntegrations] = useState([]);
  const [serviceIntegrations, setServiceIntegrations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);

  // Load available integrations
  useEffect(() => {
    loadIntegrations();
  }, [currentOrg?.id, currentProject?.id]);

  // Load service integrations when serviceId changes
  useEffect(() => {
    if (serviceId) {
      loadServiceIntegrations();
    }
  }, [serviceId]);

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
      setLoadingIntegrations(false);
    }
  };

  const loadServiceIntegrations = async () => {
    try {
      // Skip loading for new services (not yet saved)
      if (!session?.access_token || !serviceId || serviceId === 'new' || !currentOrg?.id) return;

      apiClient.setToken(session.access_token);
      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };
      const response = await apiClient.getServiceIntegrations(serviceId, rebacFilters);
      setServiceIntegrations(response.service_integrations || []);

      // Update parent component
      if (onIntegrationsChange) {
        onIntegrationsChange(response.service_integrations || []);
      }
    } catch (error) {
      console.error('Failed to load service integrations:', error);
      toast.error('Failed to load service integrations');
    }
  };

  const addIntegration = async (integrationId) => {
    if (!serviceId || serviceId === 'new') {
      toast.error('Please save the service first before adding integrations');
      return;
    }

    if (!currentOrg?.id) {
      toast.error('Organization context required');
      return;
    }

    setLoading(true);
    try {
      apiClient.setToken(session.access_token);

      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };

      // Create service-integration mapping with default routing conditions
      const response = await apiClient.createServiceIntegration(serviceId, {
        integration_id: integrationId,
        routing_conditions: {
          // Default conditions - user can customize later
          severity: ['critical', 'warning'],
          alertname: ['*'] // Match all alert names by default
        },
        priority: 100
      }, rebacFilters);

      // Reload service integrations
      await loadServiceIntegrations();
      toast.success('Integration added successfully');
    } catch (error) {
      console.error('Failed to add integration:', error);
      toast.error(`Failed to add integration: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const removeIntegration = async (serviceIntegrationId) => {
    if (!currentOrg?.id) {
      toast.error('Organization context required');
      return;
    }

    setLoading(true);
    try {
      apiClient.setToken(session.access_token);

      // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
      const rebacFilters = {
        org_id: currentOrg.id,
        ...(currentProject?.id && { project_id: currentProject.id })
      };

      await apiClient.deleteServiceIntegration(serviceIntegrationId, rebacFilters);

      // Reload service integrations
      await loadServiceIntegrations();
      toast.success('Integration removed successfully');
    } catch (error) {
      console.error('Failed to remove integration:', error);
      toast.error(`Failed to remove integration: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getIntegrationTypeIcon = (type) => {
    const iconProps = "h-5 w-5";
    
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

  const getIntegrationHealthColor = (healthStatus) => {
    switch (healthStatus) {
      case 'healthy':
        return 'text-green-600 dark:text-green-400';
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'unhealthy':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  // Get integrations that are not yet linked to this service
  const availableIntegrations = integrations.filter(integration => 
    !serviceIntegrations.some(si => si.integration_id === integration.id)
  );

  if (loadingIntegrations) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Integrations
        </label>
        <div className="animate-pulse bg-gray-200 dark:bg-gray-700 h-10 rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Integrations
        </label>
        
        {/* Add Integration Button */}
        {serviceId && serviceId !== 'new' && availableIntegrations.length > 0 && (
          <Menu as="div" className="relative">
            <MenuButton
              disabled={disabled || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-50/80 dark:bg-blue-900/80 backdrop-blur-sm py-2 px-3 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors disabled:opacity-50"
            >
              <PlusIcon className="h-4 w-4" />
              Add Integration
              <ChevronDownIcon className="h-4 w-4" />
            </MenuButton>
            
            <MenuItems className="absolute right-0 z-50 mt-2 w-72 rounded-lg bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 focus:outline-none">
              <div className="p-2">
                {availableIntegrations.map((integration) => (
                  <MenuItem key={integration.id}>
                    {({ active }) => (
                      <button
                        onClick={() => addIntegration(integration.id)}
                        className={`${
                          active ? 'bg-gray-50 dark:bg-gray-700' : ''
                        } group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors`}
                      >
                        <div className="p-1 rounded bg-gray-50 dark:bg-gray-700">
                          {getIntegrationTypeIcon(integration.type)}
                        </div>
                        <div className="flex-1 text-left">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {integration.name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {integration.type} • {integration.health_status || 'unknown'}
                          </div>
                        </div>
                        <div className={`h-2 w-2 rounded-full ${
                          integration.health_status === 'healthy' ? 'bg-green-500' :
                          integration.health_status === 'warning' ? 'bg-yellow-500' :
                          integration.health_status === 'unhealthy' ? 'bg-red-500' :
                          'bg-gray-400'
                        }`} />
                      </button>
                    )}
                  </MenuItem>
                ))}
              </div>
            </MenuItems>
          </Menu>
        )}
      </div>

      {/* Service Integration List */}
      <div className="space-y-2">
        {serviceIntegrations.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            {serviceId === 'new' ? (
              <div className="space-y-2">
                <ExclamationTriangleIcon className="h-8 w-8 mx-auto text-yellow-500" />
                <p>Save the service first to add integrations</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p>No integrations configured</p>
                <p className="text-sm">Add integrations to receive alerts from external monitoring tools</p>
              </div>
            )}
          </div>
        ) : (
          serviceIntegrations.map((serviceIntegration) => (
            <div
              key={serviceIntegration.id}
              className="flex items-center justify-between p-3 bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="p-1 rounded bg-gray-50 dark:bg-gray-700">
                  {getIntegrationTypeIcon(serviceIntegration.integration_type)}
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {serviceIntegration.integration_name}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Priority: {serviceIntegration.priority} • 
                    {Object.keys(serviceIntegration.routing_conditions || {}).length} routing conditions
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Health Status Indicator */}
                <div className={`h-2 w-2 rounded-full ${
                  serviceIntegration.health_status === 'healthy' ? 'bg-green-500' :
                  serviceIntegration.health_status === 'warning' ? 'bg-yellow-500' :
                  serviceIntegration.health_status === 'unhealthy' ? 'bg-red-500' :
                  'bg-gray-400'
                }`} />
                
                {/* Remove Button */}
                <button
                  onClick={() => removeIntegration(serviceIntegration.id)}
                  disabled={disabled || loading}
                  className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                  title="Remove integration"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Integration Summary */}
      {serviceIntegrations.length > 0 && (
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-blue-50/50 dark:bg-blue-900/20 p-3 rounded-lg">
          <p className="font-medium mb-1">Integration Summary:</p>
          <p>
            {serviceIntegrations.length} integration{serviceIntegrations.length !== 1 ? 's' : ''} configured. 
            Alerts matching the routing conditions will be sent to this service's escalation policy.
          </p>
        </div>
      )}
    </div>
  );
}
