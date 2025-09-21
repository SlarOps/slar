'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/api';
import NotificationSettings from '../../components/profile/NotificationSettings';
import UserProfileForm from '../../components/profile/UserProfileForm';
import { toast } from 'react-hot-toast';
import { UserIcon, BellIcon, LockIcon } from '../../components/ui/Icons';

const ProfileTabs = {
  PROFILE: 'profile',
  NOTIFICATIONS: 'notifications',
  SECURITY: 'security'
};

export default function ProfilePage() {
  const { user, session } = useAuth();
  const [activeTab, setActiveTab] = useState(ProfileTabs.PROFILE);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session?.access_token) {
      apiClient.setToken(session.access_token);
      loadUserData();
    }
  }, [session]);

  const loadUserData = async () => {
    try {
      setLoading(true);
      // Try to get current user data from API
      // For now, use the user from auth context
      setUserData(user);
    } catch (error) {
      console.error('Failed to load user data:', error);
      toast.error('Failed to load user profile');
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    {
      key: ProfileTabs.PROFILE,
      label: 'Profile',
      icon: UserIcon,
      description: 'Personal information and basic settings'
    },
    {
      key: ProfileTabs.NOTIFICATIONS,
      label: 'Notifications',
      icon: BellIcon,
      description: 'Configure how you receive notifications'
    },
    {
      key: ProfileTabs.SECURITY,
      label: 'Security',
      icon: LockIcon,
      description: 'Password and security settings'
    }
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto py-8">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading profile...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">User Profile</h1>
          <p className="text-gray-600">Manage your account settings and preferences</p>
        </div>

        {/* Profile Card */}
        <div className="bg-white rounded-lg border border-gray-200 mb-6">
          <div className="p-6">
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                {userData?.user_metadata?.name?.[0]?.toUpperCase() || userData?.email?.[0]?.toUpperCase() || '?'}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {userData?.user_metadata?.name || 'User'}
                </h2>
                <p className="text-gray-600">{userData?.email}</p>
                <p className="text-sm text-gray-500">
                  Member since {new Date(userData?.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg border border-gray-200">
          {/* Tab Navigation */}
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" role="tablist">
              {tabs.map((tab) => {
                const IconComponent = tab.icon;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`
                      py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-colors
                      ${activeTab === tab.key
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }
                    `}
                    role="tab"
                    aria-selected={activeTab === tab.key}
                  >
                    <IconComponent className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === ProfileTabs.PROFILE && (
              <div>
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Profile Information</h3>
                  <p className="text-gray-600">Update your personal information and profile details.</p>
                </div>
                <UserProfileForm userData={userData} onUpdate={setUserData} />
              </div>
            )}

            {activeTab === ProfileTabs.NOTIFICATIONS && (
              <div>
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Notification Preferences</h3>
                  <p className="text-gray-600">Configure how you want to receive notifications for incidents and alerts.</p>
                </div>
                <NotificationSettings userId={userData?.id} />
              </div>
            )}

            {activeTab === ProfileTabs.SECURITY && (
              <div>
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Security Settings</h3>
                  <p className="text-gray-600">Manage your password and security preferences.</p>
                </div>
                
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <span className="text-yellow-400">⚠️</span>
                    </div>
                    <div className="ml-3">
                      <h4 className="text-sm font-medium text-yellow-800">Security Settings</h4>
                      <p className="mt-1 text-sm text-yellow-700">
                        Security settings are managed through your authentication provider. 
                        Password changes and 2FA setup should be done through your account settings.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
