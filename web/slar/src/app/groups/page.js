'use client';

import { useState, useEffect } from 'react';
import GroupFilters from '../../components/groups/GroupFilters';
import GroupsList from '../../components/groups/GroupsList';
import CreateGroupModal from '../../components/groups/CreateGroupModal';
import EditGroupModal from '../../components/groups/EditGroupModal';

const INITIAL_FILTERS = {
  search: '',
  type: '',
  status: '',
  sort: 'created_at_desc'
};

export default function GroupsPage() {
  const [activeTab, setActiveTab] = useState('my'); // 'my', 'public', 'all'
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    escalation: 0,
    notification: 0,
    approval: 0
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Simulate fetching group stats
  useEffect(() => {
    const fetchStats = async () => {
      // TODO: Replace with actual API call
      // const data = await apiClient.getGroupStats();
      setTimeout(() => {
        setStats({
          total: 4,
          active: 3,
          escalation: 2,
          notification: 1,
          approval: 1
        });
      }, 500);
    };

    fetchStats();
  }, []);

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
  };

  const handleCreateGroup = () => {
    setShowCreateModal(true);
  };

  const handleGroupCreated = async (newGroup) => {
    console.log('Group created:', newGroup);
    // Trigger a refresh in the GroupsList component
    setRefreshTrigger(prev => prev + 1);
  };

  const handleEditGroup = (groupId) => {
    setEditingGroupId(groupId);
    setShowEditModal(true);
  };

  const handleGroupUpdated = async (updatedGroup) => {
    console.log('Group updated:', updatedGroup);
    // Trigger a refresh in the GroupsList component
    setRefreshTrigger(prev => prev + 1);
  };

  const handleGroupAction = (action, groupId) => {
    console.log(`Group ${action}:`, groupId);
    // TODO: Show toast notification
    // TODO: Refresh stats if needed
  };

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Groups</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Manage on-call groups, escalation policies, and team notifications
        </p>
        
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Groups</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-800 p-3">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.active}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Active</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-red-200 dark:border-red-800 p-3">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.escalation}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Escalation</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-800 p-3">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.notification}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Notification</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-800 p-3">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.approval}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Approval</div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('my')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'my'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            My Groups
          </button>
          <button
            onClick={() => setActiveTab('public')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'public'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Public Groups
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'all'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            All Groups
          </button>
        </nav>
      </div>

      {/* Filters */}
      <GroupFilters 
        filters={filters}
        onFiltersChange={handleFiltersChange}
        totalCount={stats.total}
        onCreateGroup={handleCreateGroup}
      />

      {/* Groups List */}
      <GroupsList 
        filters={filters}
        activeTab={activeTab}
        refreshTrigger={refreshTrigger}
        onGroupAction={handleGroupAction}
        onCreateGroup={handleCreateGroup}
        onEditGroup={handleEditGroup}
      />

      {/* Create Group Modal */}
      <CreateGroupModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onGroupCreated={handleGroupCreated}
      />

      {/* Edit Group Modal */}
      <EditGroupModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingGroupId(null);
        }}
        onGroupUpdated={handleGroupUpdated}
        groupId={editingGroupId}
      />
    </div>
  );
}


