'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import { apiClient } from '../../lib/api';
import Modal, { ModalFooter, ModalButton } from '../ui/Modal';

export default function EditGroupModal({ isOpen, onClose, onGroupUpdated, groupId }) {
  const { session } = useAuth();
  const { currentOrg, currentProject } = useOrg();
  const [loading, setLoading] = useState(false);
  const [fetchingGroup, setFetchingGroup] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: ''
  });

  // Fetch group data when modal opens
  useEffect(() => {
    const fetchGroup = async () => {
      // ReBAC: MUST have session AND org_id for tenant isolation
      if (!isOpen || !groupId || !session?.access_token || !currentOrg?.id) return;

      setFetchingGroup(true);
      try {
        apiClient.setToken(session.access_token);
        // ReBAC: Build filters with org_id (MANDATORY) and project_id (OPTIONAL)
        const rebacFilters = {
          org_id: currentOrg.id,
          ...(currentProject?.id && { project_id: currentProject.id })
        };
        const group = await apiClient.getGroup(groupId, rebacFilters);

        setFormData({
          name: group.name || '',
          description: group.description || ''
        });
      } catch (error) {
        console.error('Failed to fetch group:', error);
        alert('Failed to load group data: ' + error.message);
      } finally {
        setFetchingGroup(false);
      }
    };

    fetchGroup();
  }, [isOpen, groupId, session, currentOrg?.id, currentProject?.id]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!session?.access_token || !currentOrg?.id) {
      alert('Not authenticated');
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

      const result = await apiClient.updateGroup(groupId, formData, rebacFilters);

      onGroupUpdated(result);
      onClose();
    } catch (error) {
      console.error('Failed to update group:', error);
      alert('Failed to update group: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Loading content for when fetching group data
  const loadingContent = (
    <div className="py-8">
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
        <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
      </div>
    </div>
  );

  // Form content
  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Group Name *
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter group name"
          required
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Description
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => handleInputChange('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter group description"
          rows={3}
        />
      </div>
    </form>
  );

  // Footer with action buttons
  const footer = (
    <ModalFooter>
      <ModalButton variant="secondary" onClick={onClose}>
        Cancel
      </ModalButton>
      <ModalButton
        type="submit"
        variant="primary"
        onClick={handleSubmit}
        disabled={loading || !formData.name.trim() || fetchingGroup}
        loading={loading}
      >
        Update Group
      </ModalButton>
    </ModalFooter>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Group"
      size="md"
      footer={footer}
    >
      {fetchingGroup ? loadingContent : formContent}
    </Modal>
  );
}
