'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { Modal, ModalFooter, ModalButton, Input, Textarea, Select, toast } from '../ui';
import { 
  FireIcon,
  ChartBarIcon,
  LinkIcon,
  CloudIcon,
  BoltIcon,
  CubeIcon
} from '@heroicons/react/24/outline';

const INTEGRATION_TYPES = [
  { 
    value: 'prometheus', 
    label: 'Prometheus', 
    icon: FireIcon,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    borderColor: 'border-orange-200 dark:border-orange-800'
  },
  { 
    value: 'datadog', 
    label: 'Datadog', 
    icon: ChartBarIcon,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    borderColor: 'border-purple-200 dark:border-purple-800'
  },
  { 
    value: 'grafana', 
    label: 'Grafana', 
    icon: ChartBarIcon,
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
    borderColor: 'border-yellow-200 dark:border-yellow-800'
  },
  { 
    value: 'webhook', 
    label: 'Generic Webhook', 
    icon: LinkIcon,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800'
  },
  { 
    value: 'aws', 
    label: 'AWS CloudWatch', 
    icon: CloudIcon,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800'
  },
  { 
    value: 'custom', 
    label: 'Custom', 
    icon: CubeIcon,
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-900/20',
    borderColor: 'border-gray-200 dark:border-gray-800'
  }
];

export default function IntegrationModal({ 
  isOpen, 
  onClose, 
  mode = 'create', // 'create' or 'edit'
  integration = null,
  onIntegrationCreated,
  onIntegrationUpdated 
}) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'prometheus',
    description: ''
  });

  const isEditMode = mode === 'edit';
  const modalTitle = isEditMode ? 'Edit Integration' : 'Create New Integration';
  const submitButtonText = isEditMode ? 'Update Integration' : 'Create Integration';

  // Initialize form data when modal opens or integration changes
  useEffect(() => {
    if (isOpen) {
      if (isEditMode && integration) {
        setFormData({
          name: integration.name || '',
          type: integration.type || 'prometheus',
          description: integration.description || ''
        });
      } else {
        // Reset for create mode
        setFormData({
          name: '',
          type: 'prometheus',
          description: ''
        });
      }
    }
  }, [isOpen, isEditMode, integration]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!session?.access_token) {
      toast.error('Authentication required');
      return;
    }

    if (isEditMode && !integration?.id) {
      toast.error('Integration ID is required for editing');
      return;
    }

    setLoading(true);
    try {
      apiClient.setToken(session.access_token);
      
      let response;
      if (isEditMode) {
        // Update existing integration
        response = await apiClient.updateIntegration(integration.id, formData);
        if (response.integration) {
          onIntegrationUpdated && onIntegrationUpdated(response.integration);
          toast.success('Integration updated successfully!');
        }
      } else {
        // Create new integration
        response = await apiClient.createIntegration(formData);
        if (response.integration) {
          onIntegrationCreated && onIntegrationCreated(response.integration);
          toast.success('Integration created successfully!');
        }
      }
      
      onClose();
    } catch (error) {
      console.error(`Failed to ${isEditMode ? 'update' : 'create'} integration:`, error);
      toast.error(`Failed to ${isEditMode ? 'update' : 'create'} integration: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };



  const getTypeConfig = (type) => {
    switch (type) {
      case 'prometheus':
        return {
          placeholder: 'e.g., Production Prometheus AlertManager',
          description: 'Prometheus AlertManager integration for receiving alerts'
        };
      case 'datadog':
        return {
          placeholder: 'e.g., Production Datadog',
          description: 'Datadog webhook integration for receiving monitor alerts'
        };
      case 'grafana':
        return {
          placeholder: 'e.g., Production Grafana',
          description: 'Grafana webhook integration for receiving alerts'
        };
      case 'webhook':
        return {
          placeholder: 'e.g., Custom Monitoring System',
          description: 'Generic webhook integration for custom monitoring tools'
        };
      case 'aws':
        return {
          placeholder: 'e.g., AWS CloudWatch',
          description: 'AWS CloudWatch integration for receiving alerts'
        };
      case 'custom':
        return {
          placeholder: 'e.g., My Custom Integration',
          description: 'Custom integration for your monitoring system'
        };
      default:
        return {
          placeholder: 'e.g., My Integration',
          description: 'Custom integration configuration'
        };
    }
  };

  const typeConfig = getTypeConfig(formData.type);
  const selectedType = INTEGRATION_TYPES.find(t => t.value === formData.type);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="lg"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={onClose}>
            Cancel
          </ModalButton>
          <ModalButton 
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            disabled={loading || !formData.name.trim() || !formData.type}
          >
            {submitButtonText}
          </ModalButton>
        </ModalFooter>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Integration Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Integration Type
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {INTEGRATION_TYPES.map((type) => {
              const IconComponent = type.icon;
              const isSelected = formData.type === type.value;
              
              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, type: type.value }))}
                  className={`p-4 rounded-lg border-2 transition-all duration-200 ${
                    isSelected
                      ? `${type.borderColor} ${type.bgColor} shadow-sm`
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <div className={`flex flex-col items-center gap-2 ${isSelected ? type.color : 'text-gray-600 dark:text-gray-400'}`}>
                    <IconComponent className="h-8 w-8" />
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {type.label}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Integration Name */}
        <Input
          label="Integration Name"
          value={formData.name}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder={typeConfig.placeholder}
          required
        />

        {/* Description */}
        <Textarea
          label="Description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder={typeConfig.description}
          rows={3}
        />

        {/* Info Message */}
        <div className="p-4 bg-blue-50/50 dark:bg-blue-900/20 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Integration Details
              </h4>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                Webhook URL and integration key will be automatically generated after creation. 
                You can view these details in the integration list or detail view.
              </p>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
