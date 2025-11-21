'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { Modal, ModalFooter, ModalButton, Select, toast } from '../ui';
import { LinkIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function MonitorIntegrationModal({
    isOpen,
    onClose,
    deployment,
    onIntegrationUpdated
}) {
    const { session } = useAuth();
    const [loading, setLoading] = useState(false);
    const [integrations, setIntegrations] = useState([]);
    const [selectedIntegrationId, setSelectedIntegrationId] = useState('');
    const [currentIntegration, setCurrentIntegration] = useState(null);

    useEffect(() => {
        if (isOpen) {
            loadIntegrations();
            loadCurrentIntegration();
        }
    }, [isOpen, deployment]);

    const loadIntegrations = async () => {
        try {
            if (!session?.access_token) return;

            apiClient.setToken(session.access_token);
            const response = await apiClient.getIntegrations({ active_only: true });

            // Handle both response formats: {integrations: [...]} or {count: N, integrations: [...]}
            const allIntegrations = response.integrations || [];

            // Filter to only show 'webhook' type integrations
            // Monitor workers send PagerDuty Events API format, which is compatible with generic webhooks
            // Prometheus/Datadog integrations expect their own specific formats
            const webhookIntegrations = allIntegrations.filter(integration => integration.type === 'webhook');

            console.log('Loaded integrations:', allIntegrations.length, 'total,', webhookIntegrations.length, 'webhook type');
            setIntegrations(webhookIntegrations);

            if (webhookIntegrations.length === 0) {
                console.warn('No webhook integrations found. Please create a webhook integration first.');
            }
        } catch (error) {
            console.error('Failed to load integrations:', error);
            toast.error('Failed to load integrations');
        }
    };

    const loadCurrentIntegration = async () => {
        if (!deployment?.id || !session?.access_token) return;

        try {
            apiClient.setToken(session.access_token);
            const response = await apiClient.getDeploymentIntegration(deployment.id);
            setCurrentIntegration(response.integration);
            setSelectedIntegrationId(response.integration?.id || '');
        } catch (error) {
            console.error('Failed to load current integration:', error);
        }
    };

    const handleLink = async () => {
        if (!selectedIntegrationId) {
            toast.error('Please select an integration');
            return;
        }

        setLoading(true);
        try {
            apiClient.setToken(session.access_token);
            await apiClient.updateDeploymentIntegration(deployment.id, selectedIntegrationId);

            toast.success('Integration linked successfully! Please redeploy the worker for changes to take effect.');
            onIntegrationUpdated && onIntegrationUpdated();
            onClose();
        } catch (error) {
            console.error('Failed to link integration:', error);
            toast.error(`Failed to link integration: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleUnlink = async () => {
        setLoading(true);
        try {
            apiClient.setToken(session.access_token);
            await apiClient.updateDeploymentIntegration(deployment.id, null);

            toast.success('Integration unlinked successfully! Please redeploy the worker for changes to take effect.');
            onIntegrationUpdated && onIntegrationUpdated();
            onClose();
        } catch (error) {
            console.error('Failed to unlink integration:', error);
            toast.error(`Failed to unlink integration: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Link Integration"
            size="md"
            footer={
                <ModalFooter>
                    <ModalButton variant="secondary" onClick={onClose}>
                        Cancel
                    </ModalButton>
                    {currentIntegration && (
                        <ModalButton
                            variant="danger"
                            onClick={handleUnlink}
                            loading={loading}
                            disabled={loading}
                        >
                            <XMarkIcon className="h-4 w-4 mr-2" />
                            Unlink
                        </ModalButton>
                    )}
                    <ModalButton
                        variant="primary"
                        onClick={handleLink}
                        loading={loading}
                        disabled={loading || !selectedIntegrationId}
                    >
                        <LinkIcon className="h-4 w-4 mr-2" />
                        Link Integration
                    </ModalButton>
                </ModalFooter>
            }
        >
            <div className="space-y-4">
                {/* Current Integration Status */}
                {currentIntegration ? (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex items-start gap-2">
                            <LinkIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                    Currently Linked
                                </p>
                                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                                    {currentIntegration.name} ({currentIntegration.type})
                                </p>
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 font-mono break-all">
                                    {currentIntegration.webhook_url}
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            No integration linked. Select a <strong>webhook integration</strong> below to enable webhook-based incident reporting.
                        </p>
                    </div>
                )}

                {/* Integration Selector */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Select Integration
                    </label>
                    <Select
                        value={selectedIntegrationId}
                        onChange={(value) => setSelectedIntegrationId(value)}
                        options={integrations.map((integration) => ({
                            value: integration.id,
                            label: `${integration.name} (${integration.type})`,
                            description: integration.webhook_url
                        }))}
                        placeholder="-- Select Integration --"
                        disabled={loading}
                    />
                    {integrations.length === 0 && (
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            💡 No webhook integrations found. Create a <strong>Generic Webhook</strong> integration in the Integrations section above.
                        </p>
                    )}
                </div>

                {/* Info Message */}
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <div className="flex items-start gap-2">
                        <svg className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div>
                            <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                                Redeploy Required
                            </p>
                            <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                                After linking or unlinking an integration, you must redeploy the worker for the changes to take effect.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
