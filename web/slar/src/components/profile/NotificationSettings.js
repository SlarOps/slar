'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/api';
import { toast } from 'react-hot-toast';
import { 
  SlackIcon, 
  EmailIcon, 
  SmartphoneIcon, 
  FlaskIcon, 
  SaveIcon, 
  LoadingSpinner,
  ToggleSwitch,
  AlertCircleIcon,
  InfoIcon,
  CheckCircleIcon 
} from '../ui/Icons';
import { Input, Select } from '../ui';

const timezoneOptions = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'Eastern Time (New York)' },
  { value: 'America/Chicago', label: 'Central Time (Chicago)' },
  { value: 'America/Denver', label: 'Mountain Time (Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)' },
  { value: 'Europe/London', label: 'Greenwich Mean Time (London)' },
  { value: 'Europe/Paris', label: 'Central European Time (Paris)' },
  { value: 'Europe/Berlin', label: 'Central European Time (Berlin)' },
  { value: 'Asia/Tokyo', label: 'Japan Standard Time (Tokyo)' },
  { value: 'Asia/Shanghai', label: 'China Standard Time (Shanghai)' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Indochina Time (Ho Chi Minh City)' },
  { value: 'Asia/Bangkok', label: 'Indochina Time (Bangkok)' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time (Sydney)' }
];

export default function NotificationSettings({ userId }) {
  const { session } = useAuth();
  const [config, setConfig] = useState({
    slack_user_id: '',
    slack_channel_id: '',
    slack_enabled: true,
    email_enabled: true,
    push_enabled: true,
    timezone: 'Asia/Ho_Chi_Minh'
  });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (session?.access_token && userId) {
      apiClient.setToken(session.access_token);
      loadNotificationConfig();
      loadNotificationStats();
    }
  }, [session, userId]);

  const loadNotificationConfig = async () => {
    try {
      const response = await apiClient.getUserNotificationConfig(userId);
      setConfig({
        slack_user_id: response.slack_user_id || '',
        slack_channel_id: response.slack_channel_id || '',
        slack_enabled: response.slack_enabled ?? true,
        email_enabled: response.email_enabled ?? true,
        push_enabled: response.push_enabled ?? true,
        timezone: response.timezone || 'Asia/Ho_Chi_Minh'
      });
    } catch (error) {
      console.error('Failed to load notification config:', error);
      // Use default config if API fails
    } finally {
      setLoading(false);
    }
  };

  const loadNotificationStats = async () => {
    try {
      const response = await apiClient.getUserNotificationStats(userId);
      setStats(response);
    } catch (error) {
      console.error('Failed to load notification stats:', error);
    }
  };

  const handleSave = async () => {
    if (!userId) return;

    setSaving(true);
    try {
      await apiClient.updateUserNotificationConfig(userId, config);
      toast.success('Notification settings saved successfully!');
      
      // Reload stats after save
      await loadNotificationStats();
    } catch (error) {
      console.error('Failed to save notification config:', error);
      toast.error('Failed to save notification settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestSlack = async () => {
    if (!userId) return;

    setTesting(true);
    try {
      await apiClient.testSlackNotification(userId);
      toast.success('Test notification sent! Check your Slack.');
    } catch (error) {
      console.error('Failed to send test notification:', error);
      toast.error('Failed to send test notification. Check your Slack configuration.');
    } finally {
      setTesting(false);
    }
  };

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Slack Configuration Skeleton */}
        <div className="border border-gray-200 rounded-lg p-6">
          <div className="animate-pulse">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gray-200 rounded-lg"></div>
                <div>
                  <div className="h-5 bg-gray-200 rounded w-40 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-56"></div>
                </div>
              </div>
              <div className="w-11 h-6 bg-gray-200 rounded-full"></div>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
                <div className="h-10 bg-gray-200 rounded w-full"></div>
                <div className="h-3 bg-gray-200 rounded w-64"></div>
              </div>
              
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-32"></div>
                <div className="h-10 bg-gray-200 rounded w-full"></div>
                <div className="h-3 bg-gray-200 rounded w-48"></div>
              </div>
              
              <div className="h-8 bg-gray-200 rounded w-48"></div>
            </div>
          </div>
        </div>

        {/* Email Configuration Skeleton */}
        <div className="border border-gray-200 rounded-lg p-6">
          <div className="animate-pulse">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gray-200 rounded-lg"></div>
                <div>
                  <div className="h-5 bg-gray-200 rounded w-36 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-44"></div>
                </div>
              </div>
              <div className="w-11 h-6 bg-gray-200 rounded-full"></div>
            </div>
            
            <div className="h-12 bg-gray-200 rounded w-full"></div>
          </div>
        </div>

        {/* Push Notifications Skeleton */}
        <div className="border border-gray-200 rounded-lg p-6">
          <div className="animate-pulse">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gray-200 rounded-lg"></div>
                <div>
                  <div className="h-5 bg-gray-200 rounded w-32 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-52"></div>
                </div>
              </div>
              <div className="w-11 h-6 bg-gray-200 rounded-full"></div>
            </div>
            
            <div className="h-12 bg-gray-200 rounded w-full"></div>
          </div>
        </div>

        {/* General Settings Skeleton */}
        <div className="border border-gray-200 rounded-lg p-6">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-32 mb-4"></div>
            
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-20"></div>
              <div className="h-10 bg-gray-200 rounded w-full"></div>
              <div className="h-3 bg-gray-200 rounded w-72"></div>
            </div>
          </div>
        </div>

        {/* Statistics Skeleton */}
        <div className="border border-gray-200 rounded-lg p-6">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-48 mb-4"></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="text-center">
                  <div className="h-8 bg-gray-200 rounded w-12 mx-auto mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-16 mx-auto"></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Save Button Skeleton */}
        <div className="flex justify-end">
          <div className="animate-pulse">
            <div className="h-10 bg-gray-200 rounded w-32"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Slack Configuration */}
      <div className="border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
              <SlackIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="text-lg font-medium text-gray-900">Slack Notifications</h4>
              <p className="text-sm text-gray-600">Get incident notifications in Slack</p>
            </div>
          </div>
          <ToggleSwitch 
            enabled={config.slack_enabled}
            onChange={(enabled) => handleConfigChange('slack_enabled', enabled)}
          />
        </div>

        {config.slack_enabled && (
          <div className="space-y-4">
            <Input
              label="Slack User ID"
              type="text"
              value={config.slack_user_id}
              onChange={(e) => handleConfigChange('slack_user_id', e.target.value)}
              placeholder="@U1234567890"
              helperText="Your Slack user ID (starts with @U). Find it in your Slack profile."
              leftIcon={<SlackIcon className="w-4 h-4" />}
              required
            />

            <Input
              label="Slack Channel ID (optional)"
              type="text"
              value={config.slack_channel_id}
              onChange={(e) => handleConfigChange('slack_channel_id', e.target.value)}
              placeholder="#C1234567890 or leave empty for DM"
              helperText="Channel to receive notifications. Leave empty to receive direct messages."
              leftIcon={<span className="text-sm font-mono text-gray-400">#</span>}
            />

            <button
              onClick={handleTestSlack}
              disabled={testing || !config.slack_user_id}
              className="flex items-center space-x-2 px-3 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? (
                <>
                  <LoadingSpinner className="w-4 h-4 text-white" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <FlaskIcon className="w-4 h-4 text-white" />
                  <span>Test Slack Notification</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Email Configuration */}
      <div className="border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
              <EmailIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="text-lg font-medium text-gray-900">Email Notifications</h4>
              <p className="text-sm text-gray-600">Receive notifications via email</p>
            </div>
          </div>
          <ToggleSwitch 
            enabled={config.email_enabled}
            onChange={(enabled) => handleConfigChange('email_enabled', enabled)}
          />
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-start space-x-2">
            <InfoIcon className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-yellow-700">
              Email notifications are coming soon. You'll receive incident notifications at your registered email address.
            </p>
          </div>
        </div>
      </div>

      {/* Push Notifications */}
      <div className="border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
              <SmartphoneIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="text-lg font-medium text-gray-900">Push Notifications</h4>
              <p className="text-sm text-gray-600">Mobile and browser push notifications</p>
            </div>
          </div>
          <ToggleSwitch 
            enabled={config.push_enabled}
            onChange={(enabled) => handleConfigChange('push_enabled', enabled)}
          />
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-start space-x-2">
            <InfoIcon className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-700">
              Push notifications will be available when you install the SLAR mobile app.
            </p>
          </div>
        </div>
      </div>

      {/* General Settings */}
      <div className="border border-gray-200 rounded-lg p-6">
        <h4 className="text-lg font-medium text-gray-900 mb-4">General Settings</h4>
        
        <div className="space-y-4">
          <Select
            label="Timezone"
            value={config.timezone}
            onChange={(value) => handleConfigChange('timezone', value)}
            options={timezoneOptions}
            placeholder="Select your timezone..."
            helperText="Your timezone for notification scheduling and quiet hours."
            leftIcon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>}
          />
        </div>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="border border-gray-200 rounded-lg p-6">
          <h4 className="text-lg font-medium text-gray-900 mb-4">Notification Statistics</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.total_notifications || 0}</div>
              <div className="text-sm text-gray-600">Total Sent</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{stats.slack_notifications || 0}</div>
              <div className="text-sm text-gray-600">Slack</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{stats.email_notifications || 0}</div>
              <div className="text-sm text-gray-600">Email</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">{stats.failed_notifications || 0}</div>
              <div className="text-sm text-gray-600">Failed</div>
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <LoadingSpinner className="w-4 h-4 text-white" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <SaveIcon className="w-4 h-4 text-white" />
              <span>Save Settings</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
