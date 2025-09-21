'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Modal, ModalFooter, ModalButton } from '../ui';
import { Input, Textarea, Select } from '../ui';

export default function CreateIncidentModal({ 
  isOpen, 
  onClose, 
  onIncidentCreated 
}) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [services, setServices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [escalationPolicies, setEscalationPolicies] = useState([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    urgency: 'high',
    priority: 'P2',
    severity: 'error',
    service_id: '',
    group_id: '',
    escalation_policy_id: ''
  });

  // Fetch services and escalation policies for dropdowns
  useEffect(() => {
    const fetchData = async () => {
      if (!session?.access_token) return;
      
      try {
        apiClient.setToken(session.access_token);
        
        // Fetch services
        const servicesData = await apiClient.getAllServices();
        const serviceOptions = (servicesData.services || []).map(service => ({
          value: service.id,
          label: service.name
        }));
        setServices(serviceOptions);

        // Fetch groups for selection
        try {
          const groupsData = await apiClient.getGroups();
          console.log('Fetched groups:', groupsData);
          
          const groupOptions = (groupsData.groups || []).map(group => ({
            value: group.id,
            label: group.name,
            description: group.description || `${group.members_count || 0} members`
          }));
          setGroups(groupOptions);
          
        } catch (groupsErr) {
          console.error('Failed to fetch groups:', groupsErr);
          // Set mock groups if API fails
          setGroups([
            { value: 'group-1', label: 'DevOps Team', description: '5 members' },
            { value: 'group-2', label: 'Backend Team', description: '8 members' },
            { value: 'group-3', label: 'Frontend Team', description: '6 members' },
            { value: 'group-4', label: 'Database Team', description: '3 members' }
          ]);
        }
        
      } catch (err) {
        console.error('Error fetching data:', err);
        // Use mock data if API fails
        setServices([
          { value: 'service-1', label: 'Web Application' },
          { value: 'service-2', label: 'Database' },
          { value: 'service-3', label: 'API Gateway' },
          { value: 'service-4', label: 'Message Queue' }
        ]);
        setEscalationPolicies([
          { value: 'policy-1', label: 'DevOps Team Policy', description: 'Group: DevOps' },
          { value: 'policy-2', label: 'Backend Team Policy', description: 'Group: Backend' },
          { value: 'policy-3', label: 'Frontend Team Policy', description: 'Group: Frontend' },
          { value: 'policy-4', label: 'Database Team Policy', description: 'Group: Database' }
        ]);
      }
    };

    if (isOpen) {
      fetchData();
    }
  }, [isOpen, session]);

  // Fetch escalation policies when group is selected
  useEffect(() => {
    const fetchEscalationPolicies = async () => {
      if (!session?.access_token || !formData.group_id) {
        console.log('Clearing escalation policies - no session or group_id:', { 
          hasSession: !!session?.access_token, 
          groupId: formData.group_id 
        });
        setEscalationPolicies([]);
        return;
      }

      try {
        apiClient.setToken(session.access_token);
        console.log(`🔄 Fetching escalation policies for selected group: ${formData.group_id}`);
        
        const groupPolicies = await apiClient.getGroupEscalationPolicies(formData.group_id);
        console.log(`✅ Group ${formData.group_id} policies response:`, groupPolicies);
        
        // Check if response has the expected structure
        if (!groupPolicies) {
          console.warn('❌ No response from escalation policies API');
          setEscalationPolicies([]);
          return;
        }

        const policies = groupPolicies.policies || groupPolicies.escalation_policies || [];
        console.log(`📋 Raw policies array:`, policies);
        
        if (policies.length === 0) {
          console.warn('⚠️ No escalation policies found for this group');
          setEscalationPolicies([]);
          return;
        }
        
        const policyOptions = policies.map(policy => ({
          value: policy.id,
          label: policy.name,
          description: policy.description || 'No description'
        }));
        
        console.log(`🎯 Formatted policy options:`, policyOptions);
        setEscalationPolicies(policyOptions);
        
        // Reset escalation policy selection when group changes
        if (formData.escalation_policy_id) {
          console.log('🔄 Resetting escalation policy selection');
          setFormData(prev => ({
            ...prev,
            escalation_policy_id: ''
          }));
        }
        
      } catch (err) {
        console.error(`❌ Failed to fetch escalation policies for group ${formData.group_id}:`, err);
        console.error('Error details:', {
          message: err.message,
          status: err.status,
          response: err.response
        });
        
        // Set mock data for testing
        console.log('🔧 Setting mock escalation policies for testing');
        setEscalationPolicies([
          { value: 'mock-policy-1', label: 'Mock Policy 1', description: 'Test policy 1' },
          { value: 'mock-policy-2', label: 'Mock Policy 2', description: 'Test policy 2' }
        ]);
      }
    };

    fetchEscalationPolicies();
  }, [formData.group_id, session]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSelectChange = (name, value) => {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };



  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }

    if (!formData.description.trim()) {
      setError('Description is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      apiClient.setToken(session.access_token);
      
      // Prepare incident data
      const incidentData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        urgency: formData.urgency,
        priority: formData.priority || undefined,
        severity: formData.severity,
        service_id: formData.service_id || undefined,
        group_id: formData.group_id || undefined,
        escalation_policy_id: formData.escalation_policy_id || undefined
      };

      const createdIncident = await apiClient.createIncident(incidentData);
      
      // Reset form
      setFormData({
        title: '',
        description: '',
        urgency: 'high',
        priority: 'P2',
        severity: 'error',
        service_id: '',
        group_id: '',
        escalation_policy_id: ''
      });

      // Notify parent component
      if (onIncidentCreated) {
        onIncidentCreated(createdIncident);
      }

      // Close modal
      onClose();

    } catch (err) {
      console.error('Error creating incident:', err);
      setError(err.response?.data?.error || 'Failed to create incident');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setError('');
      onClose();
    }
  };

  // Prepare select options
  const urgencyOptions = [
    { value: 'high', label: 'High' },
    { value: 'low', label: 'Low' }
  ];

  const priorityOptions = [
    { value: '', label: 'Select Priority' },
    { value: 'P0', label: 'P0 - Critical' },
    { value: 'P1', label: 'P1 - High' },
    { value: 'P2', label: 'P2 - Medium' },
    { value: 'P3', label: 'P3 - Low' },
    { value: 'P4', label: 'P4 - Lowest' }
  ];

  const severityOptions = [
    { value: 'critical', label: 'Critical' },
    { value: 'error', label: 'Error' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Info' }
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Incident"
      size="2xl"
      closeOnOverlayClick={!loading}
      footer={
        <ModalFooter>
          <ModalButton
            variant="secondary"
            onClick={handleClose}
            disabled={loading}
          >
            Cancel
          </ModalButton>
          <ModalButton
            variant="danger"
            onClick={handleSubmit}
            loading={loading}
            disabled={!formData.title.trim() || !formData.description.trim()}
          >
            Create Incident
          </ModalButton>
        </ModalFooter>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Error Display */}
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

        {/* Title */}
        <Input
          label="Title"
          name="title"
          value={formData.title}
          onChange={handleInputChange}
          placeholder="Brief description of the incident"
          required
          disabled={loading}
        />

        {/* Description */}
        <Textarea
          label="Description"
          name="description"
          value={formData.description}
          onChange={handleInputChange}
          placeholder="Detailed description of the incident, including impact and symptoms"
          rows={4}
          required
          disabled={loading}
          resize={true}
        />

        {/* Urgency and Priority Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Urgency"
            value={formData.urgency}
            onChange={(value) => handleSelectChange('urgency', value)}
            options={urgencyOptions}
            required
            disabled={loading}
          />

          <Select
            label="Priority"
            value={formData.priority}
            onChange={(value) => handleSelectChange('priority', value)}
            options={priorityOptions}
            placeholder="Select Priority"
            clearable
            disabled={loading}
          />
        </div>

        {/* Severity and Service Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Severity"
            value={formData.severity}
            onChange={(value) => handleSelectChange('severity', value)}
            options={severityOptions}
            required
            disabled={loading}
          />

          <Select
            label="Service"
            value={formData.service_id}
            onChange={(value) => handleSelectChange('service_id', value)}
            options={services}
            placeholder="Select Service"
            clearable
            disabled={loading}
          />
        </div>

        {/* Group Selection */}
        <Select
          label="Group"
          value={formData.group_id}
          onChange={(value) => handleSelectChange('group_id', value)}
          options={groups}
          placeholder="Select group to handle this incident"
          required
          disabled={loading}
          helperText="Choose which team/group should handle this incident"
        />

        {/* Escalation Policy */}
        <Select
          label="Escalation Policy"
          value={formData.escalation_policy_id}
          onChange={(value) => handleSelectChange('escalation_policy_id', value)}
          options={escalationPolicies}
          placeholder={formData.group_id ? "Select escalation policy (optional)" : "Select a group first"}
          clearable
          disabled={loading || !formData.group_id}
          helperText={formData.group_id ? "Choose specific escalation policy or leave empty for default" : "Select a group first to see available policies"}
        />
      </form>
    </Modal>
  );
}
