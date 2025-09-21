'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import toast from 'react-hot-toast';
import EscalationPoliciesList from './EscalationPoliciesList';
import EscalationPolicyModal from './EscalationPolicyModal';
import PolicyUsageModal from './PolicyUsageModal';

export default function EscalationPolicyTab({ groupId, members = [] }) {
  const { session } = useAuth();
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal states
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' or 'edit'
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState(null);

  // Fetch escalation policies
  const fetchPolicies = async () => {
    if (!session?.access_token || !groupId) return;

    setLoading(true);
    setError(null);
    try {
      apiClient.setToken(session.access_token);
      const response = await apiClient.getGroupEscalationPolicies(groupId);
      setPolicies(response.policies || []);
    } catch (error) {
      console.error('Failed to fetch escalation policies:', error);
      setError('Failed to load escalation policies');
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, [session, groupId]);

  // Handlers
  const handlePolicyCreated = (newPolicy) => {
    setPolicies(prev => [newPolicy, ...prev]);
    // Modal will close automatically via onClose handler
  };

  const handlePolicyUpdated = (updatedPolicy) => {
    setPolicies(prev => prev.map(p => p.id === updatedPolicy.id ? updatedPolicy : p));
    // Modal will close automatically via onClose handler
  };

  const handleCreatePolicy = () => {
    setModalMode('create');
    setSelectedPolicy(null);
    setShowPolicyModal(true);
  };

  const handleEditPolicy = (policy) => {
    setModalMode('edit');
    setSelectedPolicy(policy);
    setShowPolicyModal(true);
  };

  const handleDeletePolicy = async (policyId) => {
    if (!confirm('Are you sure you want to delete this escalation policy? This action cannot be undone.')) {
      return;
    }

    try {
      apiClient.setToken(session.access_token);
      await apiClient.deleteEscalationPolicy(policyId);
      setPolicies(prev => prev.filter(p => p.id !== policyId));
      toast.success('Escalation policy deleted successfully!');
    } catch (error) {
      console.error('Failed to delete escalation policy:', error);
      toast.error('Failed to delete escalation policy');
    }
  };

  const handleViewUsage = (policy) => {
    setSelectedPolicy(policy);
    setShowUsageModal(true);
  };

  const closeModals = () => {
    setShowPolicyModal(false);
    setShowUsageModal(false);
    setSelectedPolicy(null);
    setModalMode('create');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600 dark:text-gray-400">Loading escalation policies...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Escalation Policies
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Define how alerts escalate when team members don't respond
          </p>
        </div>
        <button
          onClick={handleCreatePolicy}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Create Policy
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/30 p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                Error loading escalation policies
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p>
              <button
                onClick={fetchPolicies}
                className="mt-2 text-sm text-red-600 dark:text-red-400 hover:text-red-500 dark:hover:text-red-300"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {!error && (
        <EscalationPoliciesList
          policies={policies}
          onEdit={handleEditPolicy}
          onDelete={handleDeletePolicy}
          onViewUsage={handleViewUsage}
          loading={loading}
        />
      )}

      {/* Modals */}
      <EscalationPolicyModal
        isOpen={showPolicyModal}
        onClose={closeModals}
        groupId={groupId}
        members={members}
        policyID={selectedPolicy?.id}
        onPolicyCreated={handlePolicyCreated}
        onPolicyUpdated={handlePolicyUpdated}
        editPolicy={modalMode === 'edit' ? selectedPolicy : null}
      />

      {showUsageModal && selectedPolicy && (
        <PolicyUsageModal
          isOpen={showUsageModal}
          onClose={closeModals}
          policy={selectedPolicy}
          groupId={groupId}
        />
      )}
    </div>
  );
}
