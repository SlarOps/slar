'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import GroupCard from './GroupCard';

const MOCK_GROUPS = [
  {
    id: '1',
    name: 'Platform Team On-Call',
    description: 'Primary escalation group for platform infrastructure alerts and incidents.',
    type: 'escalation',
    is_active: true,
    escalation_timeout: 300,
    escalation_method: 'sequential',
    member_count: 5,
    created_at: '2024-01-10T08:00:00Z',
    created_by: 'admin@example.com',
    members: [
      { user_id: '1', user_name: 'John Doe', user_email: 'john@example.com', role: 'leader' },
      { user_id: '2', user_name: 'Jane Smith', user_email: 'jane@example.com', role: 'member' },
      { user_id: '3', user_name: 'Bob Wilson', user_email: 'bob@example.com', role: 'backup' }
    ]
  },
  {
    id: '2',
    name: 'Security Incidents',
    description: 'Emergency response team for security-related alerts and breaches.',
    type: 'escalation',
    is_active: true,
    escalation_timeout: 180,
    escalation_method: 'parallel',
    member_count: 3,
    created_at: '2024-01-08T14:30:00Z',
    created_by: 'security@example.com'
  },
  {
    id: '3',
    name: 'Backend Team Notifications',
    description: 'General notifications for backend service deployments and updates.',
    type: 'notification',
    is_active: true,
    member_count: 8,
    created_at: '2024-01-05T10:15:00Z',
    created_by: 'backend-lead@example.com'
  },
  {
    id: '4',
    name: 'Database Maintenance',
    description: 'Approval group for database changes and maintenance windows.',
    type: 'approval',
    is_active: false,
    member_count: 2,
    created_at: '2023-12-20T16:45:00Z',
    created_by: 'dba@example.com'
  }
];

export default function GroupsList({ filters, activeTab, refreshTrigger, onGroupAction, onCreateGroup, onEditGroup }) {
  const { session } = useAuth();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchGroups = async () => {
      if (!session?.access_token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Set authentication token
        apiClient.setToken(session.access_token);
        
        let data;
        // Call different endpoints based on active tab
        switch (activeTab) {
          case 'my':
            data = await apiClient.getMyGroups(filters);
            break;
          case 'public':
            data = await apiClient.getPublicGroups(filters);
            break;
          case 'all':
            data = await apiClient.getAllGroups(filters);
            break;
          default:
            data = await apiClient.getGroups(filters);
            break;
        }
        
        setGroups(data.groups || []);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch groups:', err);
        setError(err.message || 'Failed to load groups');
        setGroups([]);
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, [filters, activeTab, session, refreshTrigger]);

  const handleEditGroup = (groupId) => {
    console.log('Editing group:', groupId);
    onEditGroup(groupId);
  };

  const handleDeleteGroup = async (groupId) => {
    if (!window.confirm('Are you sure you want to delete this group? This action cannot be undone.')) {
      return;
    }

    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      apiClient.setToken(session.access_token);
      await apiClient.deleteGroup(groupId);
      
      // Optimistically update UI
      setGroups(prev => prev.filter(group => group.id !== groupId));
      
      if (onGroupAction) {
        onGroupAction('delete', groupId);
      }
    } catch (error) {
      console.error('Failed to delete group:', error);
      // TODO: Show error notification
      alert('Failed to delete group: ' + error.message);
    }
  };

  const handleToggleStatus = async (groupId, newStatus) => {
    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      apiClient.setToken(session.access_token);
      await apiClient.updateGroup(groupId, { is_active: newStatus });
      
      // Optimistically update UI
      setGroups(prev => prev.map(group => 
        group.id === groupId 
          ? { ...group, is_active: newStatus, updated_at: new Date().toISOString() }
          : group
      ));
      
      if (onGroupAction) {
        onGroupAction('toggle', groupId);
      }
    } catch (error) {
      console.error('Failed to toggle group status:', error);
      alert('Failed to update group: ' + error.message);
    }
  };

  const handleJoinGroup = async (groupId) => {
    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      // Get current user ID from session
      const currentUserId = session.user?.id;
      if (!currentUserId) {
        throw new Error('User ID not found');
      }

      apiClient.setToken(session.access_token);
      await apiClient.addGroupMember(groupId, {
        user_id: `oauth-google-${currentUserId}`, // Transform user ID
        role: 'member',
        escalation_order: 1,
        notification_preferences: {
          fcm: true,
          email: true,
          sms: false
        }
      });
      
      // Refresh the groups list
      const refreshData = async () => {
        try {
          let data;
          switch (activeTab) {
            case 'my':
              data = await apiClient.getMyGroups(filters);
              break;
            case 'public':
              data = await apiClient.getPublicGroups(filters);
              break;
            case 'all':
              data = await apiClient.getAllGroups(filters);
              break;
            default:
              data = await apiClient.getGroups(filters);
              break;
          }
          setGroups(data.groups || []);
        } catch (err) {
          console.error('Failed to refresh groups:', err);
        }
      };
      
      await refreshData();
      
      if (onGroupAction) {
        onGroupAction('join', groupId);
      }
    } catch (error) {
      console.error('Failed to join group:', error);
      alert('Failed to join group: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className="animate-pulse space-y-3">
              <div className="flex gap-2">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
              </div>
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
        <div className="text-red-600 dark:text-red-400 mb-2">
          <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Error loading groups
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
        <div className="text-gray-400 dark:text-gray-500 mb-3">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No groups found</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {Object.values(filters).some(v => v) 
            ? 'Try adjusting your filters to see more results.'
            : 'Get started by creating your first group.'
          }
        </p>
        <button
          onClick={onCreateGroup}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create First Group
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {groups.map((group) => (
        <GroupCard
          key={group.id}
          group={group}
          activeTab={activeTab}
          onEdit={handleEditGroup}
          onDelete={handleDeleteGroup}
          onToggleStatus={handleToggleStatus}
          onJoinGroup={handleJoinGroup}
        />
      ))}
    </div>
  );
}
