'use client';

import React, { useState } from 'react';
import Input from '../ui/Input';

export default function MembersList({ members, selectedMembers, onMembersChange }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Available members (not yet selected)
  const availableMembers = members?.filter(member =>
    !selectedMembers.find(sm => sm.user_id === member.user_id)
  ) || [];

  // Filtered members based on search
  const filteredMembers = availableMembers.filter(member =>
    member.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.user_email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    if (draggedIndex === null) return;

    const newMembers = [...selectedMembers];
    const draggedMember = newMembers[draggedIndex];
    newMembers.splice(draggedIndex, 1);
    newMembers.splice(dropIndex, 0, draggedMember);

    onMembersChange(newMembers);
    setDraggedIndex(null);
  };

  const addMember = (member) => {
    onMembersChange([...selectedMembers, member]);
    setSearchTerm('');
    setShowDropdown(false);
  };

  const removeMember = (memberId) => {
    onMembersChange(selectedMembers.filter(m => m.user_id !== memberId));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Members <span className="text-red-500">*</span>
      </label>

      {/* Search Input */}
      <div className="relative mb-3">
        <Input
          placeholder="Search for members"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => {
            // Delay hide to allow click on dropdown items
            setTimeout(() => setShowDropdown(false), 200);
          }}
          rightElement={
            <button
              type="button"
              onClick={() => setShowDropdown(!showDropdown)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          }
        />
      </div>

      {/* Available Members Dropdown */}
      {showDropdown && availableMembers.length > 0 && (
        <div className="mb-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 max-h-48 overflow-y-auto shadow-lg z-10">
          {filteredMembers.length > 0 ? (
            <>
              <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-600">
                Available Members ({filteredMembers.length})
              </div>
              {filteredMembers.map((member, idx) => (
                <button
                  key={member.user_id || member.id || `filtered-${idx}`}
                  onClick={() => addMember(member)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center gap-3 border-b border-gray-100 dark:border-gray-600 last:border-b-0"
                >
                  <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                    {member.user_name?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {member.user_name || 'Unknown User'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {member.user_email}
                    </div>
                    {member.role && (
                      <div className="text-xs text-blue-600 dark:text-blue-400">
                        {member.role}
                      </div>
                    )}
                  </div>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              ))}
            </>
          ) : (
            <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No members found matching "{searchTerm}"
            </div>
          )}
        </div>
      )}

      {/* No available members message */}
      {availableMembers.length === 0 && selectedMembers.length > 0 && (
        <div className="mb-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="text-sm text-green-700 dark:text-green-300">
            All group members have been added to the schedule
          </div>
        </div>
      )}

      {/* Selected Members List */}
      <div className="space-y-2">
        {selectedMembers.length === 0 ? (
          <div className="p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-center">
            <div className="text-gray-500 dark:text-gray-400 text-sm">
              No members selected. Search and add members above.
            </div>
          </div>
        ) : (
          selectedMembers.map((member, index) => (
            <div
              key={member.user_id || member.id || `member-${index}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cursor-move hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center gap-2 text-gray-400">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z" />
                </svg>
                <span className="text-sm font-medium">{index + 1}.</span>
              </div>
              <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                {member.user_name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {member.user_name || 'Unknown User'}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {member.user_email}
                </div>
              </div>
              <button
                onClick={() => removeMember(member.user_id)}
                className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Remove member"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
