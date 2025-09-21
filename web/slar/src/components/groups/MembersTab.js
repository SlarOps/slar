'use client';

import { useState } from 'react';
import AddMemberModal from './AddMemberModal';

function getRoleColor(role) {
  switch (role) {
    case 'leader': return 'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-900/30 dark:border-purple-800';
    case 'member': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800';
    case 'backup': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800';
    default: return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700';
  }
}

export default function MembersTab({ 
  group, 
  onAddMember, 
  onRemoveMember, 
  onUpdateMemberRole,
  memberLoading 
}) {
  const [showAddMember, setShowAddMember] = useState(false);

  const handleAddMember = async (memberData, selectedUser) => {
    if (onAddMember) {
      await onAddMember(memberData, selectedUser);
      setShowAddMember(false);
    }
  };

  const handleRemoveMember = async (memberId, userId) => {
    if (!window.confirm('Are you sure you want to remove this member from the group?')) {
      return;
    }

    if (onRemoveMember) {
      await onRemoveMember(memberId, userId);
    }
  };

  const handleUpdateMemberRole = async (memberId, userId, newRole) => {
    if (onUpdateMemberRole) {
      await onUpdateMemberRole(memberId, userId, newRole);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Members ({group?.members?.length || 0})
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Manage group members and their roles
          </p>
        </div>
        <button
          onClick={() => setShowAddMember(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Member
        </button>
      </div>

      {group?.members && group.members.length > 0 ? (
        <div className="space-y-3">
          {group.members.map((member) => (
            <div 
              key={member.id}
              className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center font-medium">
                  {member.user_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900 dark:text-white">{member.user_name}</h3>
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${getRoleColor(member.role)}`}>
                      {member.role}
                    </span>
                    {group.type === 'escalation' && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Order: {member.escalation_order}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{member.user_email}</p>
                  {member.user_team && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{member.user_team} Team</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Role Selector */}
                <select
                  value={member.role}
                  onChange={(e) => handleUpdateMemberRole(member.id, member.user_id, e.target.value)}
                  disabled={memberLoading === member.id}
                  className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="member">Member</option>
                  <option value="leader">Leader</option>
                  <option value="backup">Backup</option>
                </select>

                {/* Remove Button */}
                <button
                  onClick={() => handleRemoveMember(member.id, member.user_id)}
                  disabled={memberLoading === member.id}
                  className="p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                  title="Remove member"
                >
                  {memberLoading === member.id ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p>No members in this group yet.</p>
          <button
            onClick={() => setShowAddMember(true)}
            className="mt-2 text-blue-600 dark:text-blue-400 hover:underline"
          >
            Add the first member
          </button>
        </div>
      )}

      {/* Add Member Modal */}
      <AddMemberModal
        isOpen={showAddMember}
        onClose={() => setShowAddMember(false)}
        onSubmit={handleAddMember}
        existingMembers={group?.members || []}
      />
    </div>
  );
}
