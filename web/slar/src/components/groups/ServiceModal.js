'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { Modal, ModalFooter, ModalButton, Input, Textarea, Checkbox, CheckboxGroup, toast } from '../ui';
import EscalationPolicySelector from './EscalationPolicySelector';
import IntegrationSelector from './IntegrationSelector';

export default function ServiceModal({ 
  isOpen, 
  onClose, 
  mode = 'create', // 'create' or 'edit'
  service = null, // Required for edit mode
  groupId, 
  onServiceCreated,
  onServiceUpdated 
}) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    routing_key: '',
    escalation_policy_id: '',
    is_active: true,
    integrations: {},
    notification_settings: {
      email: true,
      fcm: true,
      sms: false
    }
  });
  const [serviceIntegrations, setServiceIntegrations] = useState([]);

  const isEditMode = mode === 'edit';
  const modalTitle = isEditMode ? 'Edit Service' : 'Create New Service';
  const submitButtonText = isEditMode ? 'Update Service' : 'Create Service';
  const submitButtonVariant = isEditMode ? 'success' : 'primary';

  // Initialize form data when modal opens or service changes
  useEffect(() => {
    if (isOpen) {
      if (isEditMode && service) {
        // Edit mode - populate with existing service data
        setFormData({
          name: service.name || '',
          description: service.description || '',
          routing_key: service.routing_key || '',
          escalation_policy_id: service.escalation_policy_id || '',
          is_active: service.is_active !== false, // Default to true if undefined
          integrations: service.integrations || {},
          notification_settings: {
            email: service.notification_settings?.email !== false,
            fcm: service.notification_settings?.fcm !== false,
            sms: service.notification_settings?.sms === true,
            ...service.notification_settings
          }
        });
      } else {
        // Create mode - reset to defaults
        setFormData({
          name: '',
          description: '',
          routing_key: '',
          escalation_policy_id: '',
          is_active: true,
          integrations: {},
          notification_settings: {
            email: true,
            fcm: true,
            sms: false
          }
        });
      }
    }
  }, [isOpen, isEditMode, service]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!session?.access_token) {
      toast.error('Authentication required');
      return;
    }

    if (isEditMode && !service?.id) {
      toast.error('Service ID is required for editing');
      return;
    }

    if (!isEditMode && !groupId) {
      toast.error('Group ID is required for creating service');
      return;
    }

    setLoading(true);
    try {
      apiClient.setToken(session.access_token);
      
      let response;
      if (isEditMode) {
        // Update existing service
        response = await apiClient.updateService(service.id, formData);
        if (response.service) {
          onServiceUpdated && onServiceUpdated(response.service);
          toast.success('Service updated successfully!');
        }
      } else {
        // Create new service
        response = await apiClient.createService(groupId, formData);
        if (response.service) {
          onServiceCreated && onServiceCreated(response.service);
          toast.success('Service created successfully!');
          // Reset form for create mode
          setFormData({
            name: '',
            description: '',
            routing_key: '',
            escalation_policy_id: '',
            is_active: true,
            integrations: {},
            notification_settings: {
              email: true,
              fcm: true,
              sms: false
            }
          });
        }
      }
      
      onClose();
    } catch (error) {
      console.error(`Failed to ${isEditMode ? 'update' : 'create'} service:`, error);
      toast.error(`Failed to ${isEditMode ? 'update' : 'create'} service: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const generateRoutingKey = () => {
    const name = formData.name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim('-');
    
    if (name) {
      setFormData(prev => ({
        ...prev,
        routing_key: `${name}-alerts`
      }));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="md"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={onClose}>
            Cancel
          </ModalButton>
          <ModalButton 
            variant={submitButtonVariant}
            onClick={handleSubmit}
            loading={loading}
            type="submit"
            disabled={loading || !formData.name || !formData.routing_key}
          >
            {submitButtonText}
          </ModalButton>
        </ModalFooter>
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {/* Service Status - Only show in edit mode */}
          {isEditMode && (
            <Checkbox
              label="Service is active"
              description="Inactive services won't receive alerts"
              checked={formData.is_active}
              onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
              className="p-4 bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm rounded-lg"
            />
          )}

          {/* Service Name */}
          <Input
            label="Service Name"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            onBlur={!isEditMode ? generateRoutingKey : undefined}
            placeholder="Web Application, Backend API, Database..."
            required
          />

          {/* Description */}
          <Textarea
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Brief description of this service..."
            rows={3}
          />

          {/* Routing Key */}
          <Input
            label="Routing Key"
            value={formData.routing_key}
            onChange={(e) => setFormData(prev => ({ ...prev, routing_key: e.target.value }))}
            placeholder="service-alerts"
            helperText="Unique identifier for routing alerts to this service"
            required
            rightElement={!isEditMode && (
              <button
                type="button"
                onClick={generateRoutingKey}
                className="rounded-lg bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm py-2 px-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                Generate
              </button>
            )}
          />

          {/* Escalation Policy */}
          <div>
            <EscalationPolicySelector
              groupId={groupId}
              selectedPolicyId={formData.escalation_policy_id}
              onSelect={(policyId) => setFormData(prev => ({ ...prev, escalation_policy_id: policyId }))}
            />
          </div>

          {/* Integration Management */}
          <IntegrationSelector
            serviceId={isEditMode ? service?.id : 'new'}
            selectedIntegrations={serviceIntegrations}
            onIntegrationsChange={setServiceIntegrations}
            disabled={loading}
          />

          {/* Notification Settings */}
          <CheckboxGroup label="Notification Settings">
            <Checkbox
              label="Email notifications"
              checked={formData.notification_settings.email}
              onChange={(e) => setFormData(prev => ({
                ...prev,
                notification_settings: {
                  ...prev.notification_settings,
                  email: e.target.checked
                }
              }))}
            />
            <Checkbox
              label="Push notifications"
              checked={formData.notification_settings.fcm}
              onChange={(e) => setFormData(prev => ({
                ...prev,
                notification_settings: {
                  ...prev.notification_settings,
                  fcm: e.target.checked
                }
              }))}
            />
            <Checkbox
              label="SMS notifications"
              checked={formData.notification_settings.sms}
              onChange={(e) => setFormData(prev => ({
                ...prev,
                notification_settings: {
                  ...prev.notification_settings,
                  sms: e.target.checked
                }
              }))}
            />
          </CheckboxGroup>
        </div>
      </form>
    </Modal>
  );
}
