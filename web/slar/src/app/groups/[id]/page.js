'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../lib/api';
import ServicesTab from '../../../components/groups/ServicesTab';
import IntegrationsTab from '../../../components/groups/IntegrationsTab';
import MembersTab from '../../../components/groups/MembersTab';
import SchedulerTab from '../../../components/groups/SchedulerTab';
import EscalationPolicyTab from '../../../components/groups/EscalationPolicyTab';





function getRoleColor(role) {
  switch (role) {
    case 'leader': return 'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-900/30 dark:border-purple-800';
    case 'member': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800';
    case 'backup': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800';
    default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
  }
}

function getTypeColor(type) {
  switch (type) {
    case 'escalation': return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800';
    case 'notification': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800';
    case 'approval': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800';
    default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
  }
}

function getVisibilityColor(visibility) {
  switch (visibility) {
    case 'public': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800';
    case 'private': return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
    case 'organization': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800';
    default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
  }
}

function getVisibilityIcon(visibility) {
  switch (visibility) {
    case 'public':
      return (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'private':
      return (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      );
    case 'organization':
      return (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      );
    default:
      return null;
  }
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  // Compact UTC format - just date
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

export default function GroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { session } = useAuth();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [memberLoading, setMemberLoading] = useState('');
  const [activeTab, setActiveTab] = useState('integrations');

  useEffect(() => {
    const fetchGroup = async () => {
      if (!session?.access_token || !params.id) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Set authentication token
        apiClient.setToken(session.access_token);
        
        // Fetch group with members
        const data = await apiClient.getGroupWithMembers(params.id);
        setGroup(data);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch group:', err);
        setError(err.message || 'Failed to load group details');
        setGroup(null);
      } finally {
        setLoading(false);
      }
    };

    fetchGroup();
  }, [params.id, session]);

  const handleEditGroup = () => {
    router.push(`/groups/${params.id}/edit`);
  };

  const handleAddMember = async (memberData, selectedUser) => {
    if (!session?.access_token) {
      alert('Not authenticated');
      return;
    }

    try {
      apiClient.setToken(session.access_token);
      await apiClient.addGroupMember(params.id, memberData);
      
      // Refresh group data to show new member
      const updatedGroup = await apiClient.getGroupWithMembers(params.id);
      setGroup(updatedGroup);
      // setShowAddMember(false);
      
      // Show success message
      alert(`Successfully added ${selectedUser.name} to the group!`);
    } catch (error) {
      console.error('Failed to add member:', error);
      alert('Failed to add member: ' + (error.message || 'Unknown error'));
    }
  };

  const handleRemoveMember = async (memberId, userId) => {
    if (!window.confirm('Are you sure you want to remove this member from the group?')) {
      return;
    }

    if (!session?.access_token) {
      alert('Not authenticated');
      return;
    }

    setMemberLoading(memberId);
    try {
      apiClient.setToken(session.access_token);
      await apiClient.removeGroupMember(params.id, userId);
      
      // Optimistically update UI
      setGroup(prev => ({
        ...prev,
        members: prev.members.filter(member => member.id !== memberId)
      }));
    } catch (error) {
      console.error('Failed to remove member:', error);
      alert('Failed to remove member: ' + error.message);
    } finally {
      setMemberLoading('');
    }
  };

  const handleUpdateMemberRole = async (memberId, userId, newRole) => {
    if (!session?.access_token) {
      alert('Not authenticated');
      return;
    }

    setMemberLoading(memberId);
    try {
      apiClient.setToken(session.access_token);
      await apiClient.updateGroupMember(params.id, userId, { role: newRole });
      
      // Optimistically update UI
      setGroup(prev => ({
        ...prev,
        members: prev.members.map(member => 
          member.id === memberId 
            ? { ...member, role: newRole }
            : member
        )
      }));
    } catch (error) {
      console.error('Failed to update member role:', error);
      alert('Failed to update member role: ' + error.message);
    } finally {
      setMemberLoading('');
    }
  };



  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse"></div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
            <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link 
            href="/groups"
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Group Details</h1>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
          <div className="text-red-600 dark:text-red-400 mb-2">
            <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Error loading group
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Go Back
          </button>
        </div>
      </div>
          );
  }

  const tabs = [
    {
      id: 'services',
      name: 'Services',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
        </svg>
      )
    },
    {
      id: 'integrations',
      name: 'Integrations',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      )
    },
    {
      id: 'members',
      name: 'Members',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      )
    },
    {
      id: 'scheduler',
      name: 'Scheduler',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )
    },
    {
      id: 'escalation',
      name: 'Escalation',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5zM4.343 4.343l1.414 1.414M20.657 4.343l-1.414 1.414M3 12h2m14 0h2M4.343 19.657l1.414-1.414M20.657 19.657l-1.414-1.414M12 3v2m0 14v2" />
        </svg>
      )
    }
  ];

  const renderServiceTab = () => (
    <ServicesTab 
      groupId={params.id} 
      members={group?.members || []}
      onServiceCreate={(data) => {
        if (data.action === 'schedule_created') {
          // Switch to scheduler tab to see the new schedule
          setActiveTab('scheduler');
        }
      }}
    />
  );

  const renderIntegrationTab = () => (
    <IntegrationsTab groupId={params.id} />
  );

  const renderMembersTab = () => (
    <MembersTab 
      group={group}
      onAddMember={handleAddMember}
      onRemoveMember={handleRemoveMember}
      onUpdateMemberRole={handleUpdateMemberRole}
      memberLoading={memberLoading}
    />
  );

  const renderSchedulerTab = () => (
    <SchedulerTab groupId={params.id} members={group?.members} />
  );

  const renderEscalationTab = () => (
    <EscalationPolicyTab 
      groupId={params.id} 
      members={group?.members || []}
    />
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'services':
        return renderServiceTab();
      case 'integrations':
        return renderIntegrationTab();
      case 'members':
        return renderMembersTab();
      case 'scheduler':
        return renderSchedulerTab();
      case 'escalation':
        return renderEscalationTab();
      default:
        return renderMembersTab();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link 
            href="/groups"
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{group.name}</h1>
            <p className="text-gray-600 dark:text-gray-400">Group Details</p>
          </div>
        </div>
      </div>

      {/* Group Information */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${getTypeColor(group.type)}`}>
                {group.type}
              </span>
              <div className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                group.is_active 
                  ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
                  : 'text-gray-600 bg-gray-100 dark:bg-gray-900/30'
              }`}>
                {group.is_active ? 'Active' : 'Inactive'}
              </div>
              {group.visibility && (
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${getVisibilityColor(group.visibility)}`}>
                  {getVisibilityIcon(group.visibility)}
                  {group.visibility}
                </div>
              )}
            </div>
            
            {group.description && (
              <p className="text-gray-600 dark:text-gray-400 mb-4">{group.description}</p>
            )}

            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <div className="flex items-center gap-4 flex-wrap">
                <span>Created {formatDateTime(group.created_at)}</span>
                <span>•</span>
                <span>Updated {formatDateTime(group.updated_at)}</span>
                <span>•</span>
                <span>by {group.created_by}</span>
              </div>
              {group.type === 'escalation' && (
                <div className="flex items-center gap-4 flex-wrap">
                  <span>Method: {group.escalation_method?.replace('_', ' ')}</span>
                  <span>•</span>
                  <span>Timeout: {Math.floor(group.escalation_timeout / 60)}min</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {tab.icon}
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {renderTabContent()}
        </div>
      </div>


    </div>
  );
}
