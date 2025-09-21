'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function getTypeColor(type) {
  switch (type) {
    case 'escalation': return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800';
    case 'notification': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800';
    case 'approval': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800';
    default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
  }
}

function getEscalationMethodIcon(method) {
  switch (method) {
    case 'parallel':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      );
    case 'sequential':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      );
    case 'round_robin':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
    default:
      return null;
  }
}

function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  
  // Use UTC time for consistent calculation
  const dateUTC = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffMs = nowUTC - dateUTC;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
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
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'private':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      );
    case 'organization':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      );
    default:
      return null;
  }
}

export default function GroupCard({ group, activeTab, onEdit, onDelete, onToggleStatus, onJoinGroup }) {
  const router = useRouter();
  const [showActions, setShowActions] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  const handleAction = async (action) => {
    setActionLoading(action);
    try {
      switch (action) {
        case 'edit':
          onEdit(group.id);
          break;
        case 'delete':
          await onDelete(group.id);
          break;
        case 'toggle':
          await onToggleStatus(group.id, !group.is_active);
          break;
        case 'join':
          await onJoinGroup(group.id);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error(`Failed to ${action} group:`, error);
    } finally {
      setActionLoading('');
      setShowActions(false);
    }
  };

  const handleViewDetails = () => {
    router.push(`/groups/${group.id}`);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
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
          
          <h3 
            className="text-lg font-semibold text-gray-900 dark:text-white mb-1 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 line-clamp-1"
            onClick={handleViewDetails}
          >
            {group.name}
          </h3>
          
          {group.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
              {group.description}
            </p>
          )}
        </div>

        {/* Actions Menu */}
        <div className="relative ml-2">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Group actions"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>

          {showActions && (
            <div className="absolute right-0 top-8 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
              <button
                onClick={handleViewDetails}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                View Details
              </button>
              
              {/* Show join button for public groups when viewing public tab */}
              {activeTab === 'public' && (group.visibility === 'public' || group.visibility === 'organization') && (
                <button
                  onClick={() => handleAction('join')}
                  disabled={actionLoading === 'join'}
                  className="w-full px-4 py-2 text-left text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'join' ? 'Joining...' : 'Join Group'}
                </button>
              )}
              
              <button
                onClick={() => handleAction('edit')}
                disabled={actionLoading === 'edit'}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Edit Group
              </button>
              <button
                onClick={() => handleAction('toggle')}
                disabled={actionLoading === 'toggle'}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {group.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <hr className="border-gray-200 dark:border-gray-700" />
              <button
                onClick={() => handleAction('delete')}
                disabled={actionLoading === 'delete'}
                className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'delete' ? 'Deleting...' : 'Delete Group'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Group Stats */}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Members</span>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {group.member_count || 0}
          </p>
        </div>
        {group.type === 'escalation' && (
          <div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Timeout</span>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              {group.escalation_timeout ? `${Math.floor(group.escalation_timeout / 60)}m` : 'N/A'}
            </p>
          </div>
        )}
      </div>

      {/* Escalation Method */}
      {group.type === 'escalation' && group.escalation_method && (
        <div className="flex items-center gap-2 mb-3">
          {getEscalationMethodIcon(group.escalation_method)}
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {group.escalation_method.replace('_', ' ')}
          </span>
        </div>
      )}

      {/* Members Preview */}
      {group.members && group.members.length > 0 && (
        <div className="mb-3">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">Members:</span>
          <div className="flex items-center gap-1">
            {group.members.slice(0, 3).map((member, index) => (
              <div
                key={member.user_id}
                className="w-6 h-6 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center"
                title={member.user_name || member.user_email}
              >
                {(member.user_name || member.user_email || '?').charAt(0).toUpperCase()}
              </div>
            ))}
            {group.members.length > 3 && (
              <div className="w-6 h-6 bg-gray-400 text-white text-xs rounded-full flex items-center justify-center">
                +{group.members.length - 3}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-3 border-t border-gray-200 dark:border-gray-700">
        <span>Created {formatTimeAgo(group.created_at)}</span>
        {group.user_name && (
          <span>by {group.user_name}</span>
        )}
      </div>

      {/* Click overlay to close actions */}
      {showActions && (
        <div 
          className="fixed inset-0 z-0" 
          onClick={() => setShowActions(false)}
        />
      )}
    </div>
  );
}
