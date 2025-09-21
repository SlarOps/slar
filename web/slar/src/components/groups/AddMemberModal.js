'use client';

import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

const MEMBER_ROLES = [
  { value: 'member', label: 'Member', description: 'Regular group member' },
  { value: 'leader', label: 'Leader', description: 'Group leader with admin privileges' },
  { value: 'backup', label: 'Backup', description: 'Backup member for escalations' }
];

export default function AddMemberModal({ isOpen, onClose, onSubmit, existingMembers = [] }) {
  const { session } = useAuth();
  const [formData, setFormData] = useState({
    user_id: '',
    user_email: '',
    user_name: '',
    role: 'member',
    escalation_order: 1,
    notification_preferences: {
      fcm: true,
      email: true,
      sms: false
    }
  });
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [error, setError] = useState('');

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        user_id: '',
        user_email: '',
        user_name: '',
        role: 'member',
        escalation_order: 1,
        notification_preferences: {
          fcm: true,
          email: true,
          sms: false
        }
      });
      setSearchQuery('');
      setSearchResults([]);
      setSelectedUser(null);
      setError('');
    }
  }, [isOpen]);

  // Real API user search (GitHub-style)
  const handleSearch = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    
    try {
      if (!session?.access_token) {
        setError('Not authenticated');
        setSearchResults([]);
        return;
      }
      
      apiClient.setToken(session.access_token);
      const response = await apiClient.searchUsers({
        query: query,
        excludeUserIds: existingMembers.map(m => m.user_id),
        limit: 10
      });
      
      // Transform backend user data to frontend format
      const transformedUsers = response.users.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        bio: user.role + (user.team ? ` • ${user.team} Team` : ''),
        avatar: null
      }));
      
      setSearchResults(transformedUsers);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
      setError('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleUserSelect = (user) => {
    setSelectedUser(user);
    setFormData(prev => ({
      ...prev,
      user_id: user.id,
      user_email: user.email,
      user_name: user.name
    }));
    setSearchQuery(user.name);
    setSearchResults([]);
  };

  const handleNotificationChange = (type, enabled) => {
    setFormData(prev => ({
      ...prev,
      notification_preferences: {
        ...prev.notification_preferences,
        [type]: enabled
      }
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!selectedUser) {
      setError('Please select a user to add');
      return;
    }

    // Prepare data for API
    const memberData = {
      user_id: formData.user_id,
      role: formData.role,
      escalation_order: parseInt(formData.escalation_order),
      notification_preferences: formData.notification_preferences
    };

    onSubmit(memberData, selectedUser);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
            Add Team Member
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            )}

            {/* User Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Search User *
              </label>
              <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="text-gray-500">👥</div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Search all users • Emails will be visible (like GitHub)
                  </span>
                </div>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    handleSearch(e.target.value);
                    setError('');
                  }}
                  placeholder="Search by name, email, or role..."
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
                {isSearching && (
                  <div className="absolute right-3 top-2.5">
                    <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                  </div>
                )}
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="mt-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 max-h-48 overflow-y-auto">
                  {searchResults.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => handleUserSelect(user)}
                      className="w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors border-b border-gray-100 dark:border-gray-600 last:border-b-0"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {user.name}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {user.email}
                          </div>
                          <div className="text-xs text-gray-400 dark:text-gray-500">
                            {user.bio}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected User Preview */}
            {selectedUser && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center font-medium">
                    {selectedUser.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {selectedUser.name}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedUser.email}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      {selectedUser.bio}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Role Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Member Role
              </label>
              <div className="space-y-2">
                {MEMBER_ROLES.map((role) => (
                  <label key={role.value} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="role"
                      value={role.value}
                      checked={formData.role === role.value}
                      onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {role.label}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {role.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Escalation Order */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Escalation Order
              </label>
              <input
                type="number"
                value={formData.escalation_order}
                onChange={(e) => setFormData(prev => ({ ...prev, escalation_order: e.target.value }))}
                min="1"
                max="10"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Order in which this member will be contacted during escalations
              </p>
            </div>

            {/* Notification Preferences */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Notification Preferences
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.fcm}
                    onChange={(e) => handleNotificationChange('fcm', e.target.checked)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      Push Notifications
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Mobile app notifications
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.email}
                    onChange={(e) => handleNotificationChange('email', e.target.checked)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      Email Notifications
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Email alerts and summaries
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.sms}
                    onChange={(e) => handleNotificationChange('sms', e.target.checked)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      SMS Notifications
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Text message alerts for critical issues
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={!selectedUser}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Member
          </button>
        </div>
      </div>
    </div>
  );
}
